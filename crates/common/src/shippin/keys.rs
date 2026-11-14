//! Keys for our own services: one key, one purpose (NIST SP 800-57 Part 1 Rev. 5, §5.2).
//!
//! Each service has its own key set. The primary key seals new values. A key it replaced
//! stays only to open what it sealed, until that is sealed again, and is then destroyed.
//! A key is either generated here from a secure random generator, and then stored wrapped
//! by the key-wrapping key, or brought by the administrator in an environment variable or
//! a file, and then never stored at all.
//!
//! The key-wrapping key has that one job. It lives next to the settings file in the data
//! volume, outside the database, unless `shippin.tech_KEY_WRAPPING_KEY_FILE` names another
//! file. The install key (`crate::manager::setup_key`) is separate again: it only lets the
//! first administrator in. See KEYS.md.

use crate::{Server, auth::oauth::crypto::SymmetricEncrypt};
use aes_gcm_siv::{
    Aes256GcmSiv, Key, KeyInit, Nonce,
    aead::{Aead, Payload},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::{LazyLock, OnceLock},
};
use store::{
    Deserialize as StoreDeserialize, ValueKey,
    rand::{RngExt, rng},
    write::{BatchBuilder, InMemoryClass, Operation, ValueClass, ValueOp, now},
};
use trc::AddContext;

pub const KV_KEYS: u8 = 55;
const TAG_SET: u8 = b's';
const MAGIC: u8 = b'K';
const VERSION: u8 = 1;
const HEADER_LEN: usize = 7;
const NONCE_LEN: usize = 12;
pub const KEY_LEN: usize = 32;
const WRAPPING_FILE: &str = "key-wrapping.key";
const WRAPPING_ENV: &str = "shippin.tech_KEY_WRAPPING_KEY_FILE";

/// The services that seal secrets with keys of their own.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Service {
    /// The AI provider key an administrator pastes.
    Ai,
    /// Each domain's sign-in client secret.
    Sso,
    /// The Google tokens held for each person who connected Drive.
    Google,
    /// Signs the DNS value a free-plan owner publishes to prove a domain. An HMAC key,
    /// never used to seal anything.
    DomainProof,
}

impl Service {
    pub const ALL: [Service; 4] = [Service::Ai, Service::Sso, Service::Google, Service::DomainProof];

    fn id(self) -> u8 {
        match self {
            Service::Ai => 1,
            Service::Sso => 2,
            Service::Google => 3,
            Service::DomainProof => 4,
        }
    }

    fn from_id(id: u8) -> Option<Self> {
        Service::ALL.into_iter().find(|service| service.id() == id)
    }

    pub fn name(self) -> &'static str {
        match self {
            Service::Ai => "ai",
            Service::Sso => "sso",
            Service::Google => "google",
            Service::DomainProof => "domain-proof",
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        Service::ALL.into_iter().find(|service| service.name() == name)
    }
}

/// Where a key's bytes come from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "@type", rename_all = "camelCase")]
pub enum Source {
    /// Kept as `[nonce][ciphertext]` in hex, wrapped by the key-wrapping key: generated here,
    /// or pasted by an administrator (`yours`).
    Stored {
        wrapped: String,
        #[serde(default)]
        yours: bool,
    },
    /// Brought by the administrator: base64 of 32 bytes in this variable.
    EnvironmentVariable { name: String },
    /// Brought by the administrator: base64 of 32 bytes in this file.
    File { path: String },
}

impl Source {
    pub fn origin(&self) -> &'static str {
        match self {
            Source::Stored { yours: false, .. } => "generated",
            _ => "yours",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum State {
    /// Seals new values and opens its own.
    Primary,
    /// Replaced: opens what it sealed, until that is sealed again.
    DecryptOnly,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceKey {
    pub id: u32,
    pub source: Source,
    pub state: State,
    pub created: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeySet {
    pub keys: Vec<ServiceKey>,
}

impl KeySet {
    pub fn primary(&self) -> Option<&ServiceKey> {
        self.keys.iter().find(|key| key.state == State::Primary)
    }

    fn next_id(&self) -> u32 {
        self.keys.iter().map(|key| key.id).max().unwrap_or(0) + 1
    }
}

/// A value opened, and whether it should be sealed again under the primary key.
#[derive(Debug, PartialEq, Eq)]
pub struct Opened {
    pub plain: Vec<u8>,
    pub stale: bool,
}

// ---- sealing, with the key in hand ----------------------------------------------------

fn cipher(key: &[u8; KEY_LEN]) -> Aes256GcmSiv {
    Aes256GcmSiv::new(&Key::<Aes256GcmSiv>::from(*key))
}

fn value_aad(service: Service, owner: u32, key_id: u32) -> Vec<u8> {
    let mut aad = b"shippin.tech value v1 ".to_vec();
    aad.extend_from_slice(service.name().as_bytes());
    aad.extend_from_slice(&owner.to_be_bytes());
    aad.extend_from_slice(&key_id.to_be_bytes());
    aad
}

fn wrap_aad(service: Service, key_id: u32) -> Vec<u8> {
    let mut aad = b"shippin.tech key wrap v1 ".to_vec();
    aad.extend_from_slice(service.name().as_bytes());
    aad.extend_from_slice(&key_id.to_be_bytes());
    aad
}

/// `[K][1][service][key id][nonce][ciphertext]`, bound to its service, owner and key.
pub fn seal_with(
    service: Service,
    owner: u32,
    key_id: u32,
    key: &[u8; KEY_LEN],
    plain: &[u8],
) -> Result<Vec<u8>, String> {
    let nonce: [u8; NONCE_LEN] = rng().random();
    let aad = value_aad(service, owner, key_id);
    let sealed = cipher(key)
        .encrypt(
            <&Nonce>::try_from(&nonce[..]).map_err(|err| err.to_string())?,
            Payload { msg: plain, aad: &aad },
        )
        .map_err(|err| err.to_string())?;
    let mut out = vec![MAGIC, VERSION, service.id()];
    out.extend_from_slice(&key_id.to_be_bytes());
    out.extend_from_slice(&nonce);
    out.extend(sealed);
    Ok(out)
}

/// The service and key a sealed value names, if it is in this format at all.
pub fn header(sealed: &[u8]) -> Option<(Service, u32)> {
    if sealed.len() < HEADER_LEN + NONCE_LEN || sealed[0] != MAGIC || sealed[1] != VERSION {
        return None;
    }
    Some((
        Service::from_id(sealed[2])?,
        u32::from_be_bytes(sealed[3..7].try_into().ok()?),
    ))
}

pub fn open_with(service: Service, owner: u32, sealed: &[u8], key: &[u8; KEY_LEN]) -> Option<Vec<u8>> {
    let (named, key_id) = header(sealed)?;
    if named != service {
        return None;
    }
    let nonce = &sealed[HEADER_LEN..HEADER_LEN + NONCE_LEN];
    let aad = value_aad(service, owner, key_id);
    cipher(key)
        .decrypt(
            <&Nonce>::try_from(nonce).ok()?,
            Payload { msg: &sealed[HEADER_LEN + NONCE_LEN..], aad: &aad },
        )
        .ok()
}

pub fn wrap(wrapping: &[u8; KEY_LEN], service: Service, key_id: u32, key: &[u8; KEY_LEN]) -> Result<Vec<u8>, String> {
    let nonce: [u8; NONCE_LEN] = rng().random();
    let aad = wrap_aad(service, key_id);
    let mut out = nonce.to_vec();
    out.extend(
        cipher(wrapping)
            .encrypt(
                <&Nonce>::try_from(&nonce[..]).map_err(|err| err.to_string())?,
                Payload { msg: key, aad: &aad },
            )
            .map_err(|err| err.to_string())?,
    );
    Ok(out)
}

pub fn unwrap(wrapping: &[u8; KEY_LEN], service: Service, key_id: u32, wrapped: &[u8]) -> Option<[u8; KEY_LEN]> {
    let (nonce, sealed) = wrapped.split_at_checked(NONCE_LEN)?;
    let aad = wrap_aad(service, key_id);
    cipher(wrapping)
        .decrypt(<&Nonce>::try_from(nonce).ok()?, Payload { msg: sealed, aad: &aad })
        .ok()?
        .try_into()
        .ok()
}

/// A key written by hand: base64 of exactly 32 bytes, surrounding space ignored.
pub fn decode_key(text: &str) -> Result<[u8; KEY_LEN], String> {
    let bytes = STANDARD
        .decode(text.trim())
        .map_err(|_| "A key is written as base64.".to_string())?;
    bytes
        .try_into()
        .map_err(|_| format!("A key is exactly {KEY_LEN} bytes (44 characters of base64)."))
}

pub fn encode_key(key: &[u8; KEY_LEN]) -> String {
    STANDARD.encode(key)
}

pub fn random_key() -> [u8; KEY_LEN] {
    rng().random()
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn unhex(text: &str) -> Option<Vec<u8>> {
    if text.len() % 2 != 0 {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|at| u8::from_str_radix(text.get(at..at + 2)?, 16).ok())
        .collect()
}

/// Values sealed before service keys existed used the engine's OAuth token key, `[nonce]
/// [ciphertext]` under a label per service. They are opened only to be sealed again under
/// their service's own key; nothing new is ever sealed this way.
pub fn open_legacy_with(oauth_key: &[u8], context: &str, owner: u32, sealed: &[u8]) -> Option<Vec<u8>> {
    let (nonce, cipher) = sealed.split_at_checked(SymmetricEncrypt::NONCE_LEN)?;
    SymmetricEncrypt::new(oauth_key, context)
        .decrypt_with_aad(cipher, nonce, &owner.to_be_bytes())
        .ok()
}

pub fn open_legacy(server: &Server, context: &str, owner: u32, sealed: &[u8]) -> Option<Vec<u8>> {
    open_legacy_with(legacy_secret(server), context, owner, sealed)
}

/// The engine's OAuth token key, which our services used before they had their own. Read
/// only to accept what was made with it before; this module is the one place that does.
pub fn legacy_secret(server: &Server) -> &[u8] {
    server.core.oauth.oauth_key.as_bytes()
}

// ---- the key-wrapping key ---------------------------------------------------------------

static WRAPPING: OnceLock<[u8; KEY_LEN]> = OnceLock::new();

fn wrapping_path(server: &Server) -> (PathBuf, bool) {
    match std::env::var(WRAPPING_ENV) {
        Ok(path) if !path.trim().is_empty() => (PathBuf::from(path.trim()), false),
        _ => (server.registry().path().with_file_name(WRAPPING_FILE), true),
    }
}

/// Reads the key-wrapping key, or makes it the first time when it is ours to make.
pub fn load_or_create_wrapping(path: &Path, may_create: bool) -> Result<[u8; KEY_LEN], String> {
    match std::fs::read_to_string(path) {
        Ok(text) => decode_key(&text).map_err(|reason| format!("{}: {reason}", path.display())),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound && may_create => {
            let key = random_key();
            match write_new_private(path, &format!("{}\n", encode_key(&key))) {
                Ok(()) => Ok(key),
                // Another process made it first: use that one.
                Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                    load_or_create_wrapping(path, false)
                }
                Err(err) => Err(format!("{}: {err}", path.display())),
            }
        }
        Err(err) => Err(format!("{}: {err}", path.display())),
    }
}

/// Creates the file readable by its owner only, from the first byte, and never replaces one.
fn write_new_private(path: &Path, text: &str) -> std::io::Result<()> {
    use std::io::Write;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(text.as_bytes())?;
    file.sync_all()
}

pub fn wrapping_key(server: &Server) -> Result<[u8; KEY_LEN], String> {
    if let Some(key) = WRAPPING.get() {
        return Ok(*key);
    }
    let (path, ours) = wrapping_path(server);
    let key = load_or_create_wrapping(&path, ours)?;
    Ok(*WRAPPING.get_or_init(|| key))
}

// ---- key sets in the store ----------------------------------------------------------------

struct Raw(Vec<u8>);

impl StoreDeserialize for Raw {
    fn deserialize(bytes: &[u8]) -> trc::Result<Self> {
        Ok(Raw(bytes.to_vec()))
    }
}

fn class(service: Service) -> ValueClass {
    ValueClass::InMemory(InMemoryClass::Key(vec![KV_KEYS, TAG_SET, service.id()]))
}

pub async fn key_set(server: &Server, service: Service) -> trc::Result<KeySet> {
    Ok(server
        .store()
        .get_value::<Raw>(ValueKey::from(class(service)))
        .await
        .caused_by(trc::location!())?
        .and_then(|value| serde_json::from_slice(value.0.get(8..)?).ok())
        .unwrap_or_default())
}

async fn save_set(server: &Server, service: Service, set: &KeySet) -> trc::Result<()> {
    let mut value = u64::MAX.to_be_bytes().to_vec();
    value.extend_from_slice(&serde_json::to_vec(set).unwrap_or_default());
    let mut batch = BatchBuilder::new();
    batch.any_op(Operation::Value {
        class: class(service),
        op: ValueOp::Set(value),
    });
    server
        .store()
        .write(batch.build_all())
        .await
        .caused_by(trc::location!())
        .map(|_| ())
}

/// One change to the key sets at a time.
static CHANGE: LazyLock<tokio::sync::Mutex<()>> = LazyLock::new(|| tokio::sync::Mutex::new(()));

/// The bytes of one of a service's keys.
pub fn resolve(server: &Server, service: Service, key: &ServiceKey) -> Result<[u8; KEY_LEN], String> {
    match &key.source {
        Source::Stored { wrapped, .. } => {
            let wrapped = unhex(wrapped).ok_or("A stored key is damaged.")?;
            unwrap(&wrapping_key(server)?, service, key.id, &wrapped)
                .ok_or_else(|| "A stored key does not open with this server's key-wrapping key.".to_string())
        }
        Source::EnvironmentVariable { name } => decode_key(
            &std::env::var(name).map_err(|_| format!("The variable {name} is not set."))?,
        ),
        Source::File { path } => decode_key(
            &std::fs::read_to_string(path).map_err(|err| format!("{path}: {err}"))?,
        ),
    }
}

/// Where a new key comes from.
pub enum NewKey {
    /// 32 bytes from a CSPRNG, stored wrapped.
    Random,
    /// Pasted by an administrator, stored wrapped.
    Value([u8; KEY_LEN]),
    /// An environment variable or a file the administrator provides; never stored.
    Outside(Source),
}

/// Makes a new primary key for a service; the old primary keeps opening its own values.
/// With `only_if_none`, leaves an existing primary alone (a service's first use).
async fn add_primary(
    server: &Server,
    service: Service,
    new: NewKey,
    only_if_none: bool,
) -> Result<u32, String> {
    let _guard = CHANGE.lock().await;
    let mut set = key_set(server, service).await.map_err(|err| err.to_string())?;
    if only_if_none {
        if let Some(primary) = set.primary() {
            return Ok(primary.id);
        }
    }
    let id = set.next_id();
    let source = match new {
        NewKey::Random => Source::Stored {
            wrapped: hex(&wrap(&wrapping_key(server)?, service, id, &random_key())?),
            yours: false,
        },
        NewKey::Value(key) => Source::Stored {
            wrapped: hex(&wrap(&wrapping_key(server)?, service, id, &key)?),
            yours: true,
        },
        NewKey::Outside(Source::Stored { .. }) => {
            return Err("Bring a key in an environment variable or a file.".into());
        }
        NewKey::Outside(source) => source,
    };
    let key = ServiceKey { id, source, state: State::Primary, created: now() };
    resolve(server, service, &key)?;
    for older in set.keys.iter_mut() {
        older.state = State::DecryptOnly;
    }
    set.keys.push(key);
    save_set(server, service, &set).await.map_err(|err| err.to_string())?;
    Ok(id)
}

/// A new random key for a service. Returns its id.
pub async fn generate(server: &Server, service: Service) -> Result<u32, String> {
    add_primary(server, service, NewKey::Random, false).await
}

/// A key the administrator brings in a variable or a file. Returns its id.
pub async fn bring(server: &Server, service: Service, source: Source) -> Result<u32, String> {
    add_primary(server, service, NewKey::Outside(source), false).await
}

/// Destroys a service's replaced keys. Call it once its values are sealed again.
pub async fn retire(server: &Server, service: Service) -> Result<usize, String> {
    let _guard = CHANGE.lock().await;
    let mut set = key_set(server, service).await.map_err(|err| err.to_string())?;
    let before = set.keys.len();
    set.keys.retain(|key| key.state == State::Primary);
    save_set(server, service, &set).await.map_err(|err| err.to_string())?;
    Ok(before - set.keys.len())
}

/// A service's primary key and its id, making the service's first key if it has none.
pub async fn primary(server: &Server, service: Service) -> Result<(u32, [u8; KEY_LEN]), String> {
    let set = key_set(server, service).await.map_err(|err| err.to_string())?;
    let primary = match set.primary() {
        Some(primary) => primary.clone(),
        None => {
            let id = add_primary(server, service, NewKey::Random, true).await?;
            key_set(server, service)
                .await
                .map_err(|err| err.to_string())?
                .keys
                .into_iter()
                .find(|key| key.id == id)
                .ok_or("The new key was not saved.")?
        }
    };
    Ok((primary.id, resolve(server, service, &primary)?))
}

/// Every key of a service that can still be read, the primary first.
pub async fn usable(server: &Server, service: Service) -> Vec<[u8; KEY_LEN]> {
    let Ok(mut set) = key_set(server, service).await else {
        return Vec::new();
    };
    set.keys.sort_by_key(|key| key.state != State::Primary);
    set.keys
        .iter()
        .filter_map(|key| resolve(server, service, key).ok())
        .collect()
}

/// Seals under the service's primary key, making the service's first key if it has none.
pub async fn seal(server: &Server, service: Service, owner: u32, plain: &[u8]) -> Result<Vec<u8>, String> {
    let (id, key) = primary(server, service).await?;
    seal_with(service, owner, id, &key, plain)
}

/// Opens a value sealed by one of the service's keys. `stale` means seal it again.
pub async fn open(server: &Server, service: Service, owner: u32, sealed: &[u8]) -> Option<Opened> {
    let (named, key_id) = header(sealed)?;
    if named != service {
        return None;
    }
    let set = key_set(server, service).await.ok()?;
    let key = set.keys.iter().find(|key| key.id == key_id)?;
    let plain = open_with(service, owner, sealed, &resolve(server, service, key).ok()?)?;
    Some(Opened { plain, stale: key.state != State::Primary })
}

/// Opens a value in either format: this one, or the old OAuth-key one (`legacy_context`).
/// Anything not under the primary key comes back `stale`.
pub async fn open_any(
    server: &Server,
    service: Service,
    owner: u32,
    sealed: &[u8],
    legacy_context: &str,
) -> Option<Opened> {
    if let Some(opened) = open(server, service, owner, sealed).await {
        return Some(opened);
    }
    open_legacy(server, legacy_context, owner, sealed).map(|plain| Opened { plain, stale: true })
}

/// Seals a service's values again under its primary key: (sealed again, could not be read).
/// Values already under the primary key are left as they are.
pub async fn reseal(server: &Server, service: Service) -> (usize, usize) {
    let result = match service {
        Service::Ai => Ok(super::ai::reseal_all(server).await),
        Service::Sso => super::sso::reseal_all(server).await,
        Service::Google => super::google::reseal_all(server).await,
        // Proof values are recomputed, never stored; replaced keys keep a published value good.
        Service::DomainProof => Ok((0, 0)),
    };
    result.unwrap_or_else(|err| {
        trc::error!(err.details("Could not seal values again under a new key"));
        (0, 1)
    })
}

/// What replacing a key did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Replaced {
    pub id: u32,
    pub resealed: usize,
    pub failed: usize,
    pub retired: usize,
}

/// Makes a new primary key, seals the service's values again under it, and destroys the
/// keys it replaced once nothing needs them. The domain-proof service keeps its replaced
/// keys, so a DNS value someone has already published still counts.
pub async fn replace(server: &Server, service: Service, new: NewKey) -> Result<Replaced, String> {
    let id = add_primary(server, service, new, false).await?;
    let (resealed, failed) = reseal(server, service).await;
    let retired = if failed == 0 && service != Service::DomainProof {
        retire(server, service).await?
    } else {
        0
    };
    Ok(Replaced { id, resealed, failed, retired })
}

/// Makes a key for every service that has none yet: the "author your keys" step.
pub async fn author_missing(server: &Server) -> Result<Vec<Service>, String> {
    let mut made = Vec::new();
    for service in Service::ALL {
        if key_set(server, service).await.map_err(|err| err.to_string())?.primary().is_none() {
            add_primary(server, service, NewKey::Random, true).await?;
            made.push(service);
        }
    }
    Ok(made)
}

/// A key as the admin panel shows it: never its bytes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyView {
    pub id: u32,
    /// `generated` or `yours`.
    pub origin: &'static str,
    /// `stored`, `environmentVariable` or `file`.
    pub kept: &'static str,
    /// The variable's name or the file's path, for keys kept outside.
    pub place: Option<String>,
    pub state: State,
    pub created: u64,
    /// Whether the server can read it right now.
    pub readable: bool,
}

pub async fn describe(server: &Server, service: Service) -> trc::Result<Vec<KeyView>> {
    let set = key_set(server, service).await?;
    Ok(set
        .keys
        .iter()
        .map(|key| {
            let (kept, place) = match &key.source {
                Source::Stored { .. } => ("stored", None),
                Source::EnvironmentVariable { name } => ("environmentVariable", Some(name.clone())),
                Source::File { path } => ("file", Some(path.clone())),
            };
            KeyView {
                id: key.id,
                origin: key.source.origin(),
                kept,
                place,
                state: key.state,
                created: key.created,
                readable: resolve(server, service, key).is_ok(),
            }
        })
        .collect())
}

/// Where the key-wrapping key is, and whether this server made it (rather than being given it).
pub fn wrapping_place(server: &Server) -> (String, bool) {
    let (path, ours) = wrapping_path(server);
    (path.display().to_string(), ours)
}

/// At start: moves values sealed the old way, or under replaced keys, onto each service's
/// primary key, then destroys replaced keys nothing needs any more (stage K5).
pub async fn sweep(server: &Server) {
    for service in Service::ALL {
        if service == Service::DomainProof {
            continue;
        }
        let (resealed, failed) = reseal(server, service).await;
        let replaced = key_set(server, service)
            .await
            .map(|set| set.keys.iter().any(|key| key.state == State::DecryptOnly))
            .unwrap_or(false);
        if failed == 0 && replaced {
            let _ = retire(server, service).await;
        }
        if resealed + failed > 0 {
            trc::event!(
                Server(trc::ServerEvent::Startup),
                Details = format!(
                    "Keys for {}: {resealed} sealed again, {failed} could not be read",
                    service.name()
                )
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: [u8; KEY_LEN] = [7; KEY_LEN];
    const OTHER: [u8; KEY_LEN] = [9; KEY_LEN];

    #[test]
    fn a_value_opens_only_for_its_own_service_owner_and_key() {
        let sealed = seal_with(Service::Ai, 3, 1, &KEY, b"sk-secret").unwrap();
        assert!(!sealed.windows(9).any(|window| window == b"sk-secret"));
        assert_eq!(header(&sealed), Some((Service::Ai, 1)));
        assert_eq!(open_with(Service::Ai, 3, &sealed, &KEY).as_deref(), Some(&b"sk-secret"[..]));
        assert_eq!(open_with(Service::Sso, 3, &sealed, &KEY), None);
        assert_eq!(open_with(Service::Ai, 4, &sealed, &KEY), None);
        assert_eq!(open_with(Service::Ai, 3, &sealed, &OTHER), None);
        let mut renamed = sealed.clone();
        renamed[3..7].copy_from_slice(&2u32.to_be_bytes());
        assert_eq!(open_with(Service::Ai, 3, &renamed, &KEY), None);
        assert_eq!(open_with(Service::Ai, 3, &sealed[..10], &KEY), None);
    }

    #[test]
    fn the_same_secret_never_seals_the_same_way_twice() {
        assert_ne!(
            seal_with(Service::Sso, 1, 1, &KEY, b"x").unwrap(),
            seal_with(Service::Sso, 1, 1, &KEY, b"x").unwrap()
        );
    }

    #[test]
    fn a_stored_key_opens_only_with_the_wrapping_key_for_its_service_and_id() {
        let wrapped = wrap(&OTHER, Service::Google, 5, &KEY).unwrap();
        assert!(!wrapped.windows(KEY_LEN).any(|window| window == KEY));
        assert_eq!(unwrap(&OTHER, Service::Google, 5, &wrapped), Some(KEY));
        assert_eq!(unwrap(&KEY, Service::Google, 5, &wrapped), None);
        assert_eq!(unwrap(&OTHER, Service::Ai, 5, &wrapped), None);
        assert_eq!(unwrap(&OTHER, Service::Google, 6, &wrapped), None);
    }

    #[test]
    fn keys_written_by_hand_are_base64_of_32_bytes() {
        let text = encode_key(&KEY);
        assert_eq!(text.len(), 44);
        assert_eq!(decode_key(&format!("  {text}\n")), Ok(KEY));
        assert!(decode_key("not base64!").is_err());
        assert!(decode_key(&STANDARD.encode([1u8; 16])).unwrap_err().contains("32 bytes"));
    }

    #[test]
    fn values_sealed_the_old_way_still_open() {
        let nonce = [4u8; SymmetricEncrypt::NONCE_LEN];
        let mut old = nonce.to_vec();
        old.extend(
            SymmetricEncrypt::new(b"oauth key", "shippin.tech sso client secret")
                .encrypt_with_aad(b"hunter2", &nonce, &12u32.to_be_bytes())
                .unwrap(),
        );
        assert_eq!(header(&old), None);
        assert_eq!(
            open_legacy_with(b"oauth key", "shippin.tech sso client secret", 12, &old).as_deref(),
            Some(&b"hunter2"[..])
        );
        assert_eq!(open_legacy_with(b"oauth key", "shippin.tech sso client secret", 13, &old), None);
    }

    #[test]
    fn the_wrapping_key_is_made_once_owner_only_and_then_kept() {
        let dir = std::env::temp_dir().join(format!("shippin-keys-{}", hex(&random_key()[..6])));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(WRAPPING_FILE);
        let _ = std::fs::remove_file(&path);
        assert!(load_or_create_wrapping(&path, false).is_err());
        let made = load_or_create_wrapping(&path, true).unwrap();
        assert_eq!(load_or_create_wrapping(&path, true).unwrap(), made);
        assert_eq!(load_or_create_wrapping(&path, false).unwrap(), made);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn our_services_no_longer_seal_with_the_oauth_key() {
        for (name, source) in [
            ("ai.rs", include_str!("ai.rs")),
            ("sso.rs", include_str!("sso.rs")),
            ("google.rs", include_str!("google.rs")),
        ] {
            assert!(!source.contains("oauth_key"), "{name} still reads the OAuth key");
            assert!(!source.contains("SymmetricEncrypt"), "{name} still seals on its own");
        }
    }
}
