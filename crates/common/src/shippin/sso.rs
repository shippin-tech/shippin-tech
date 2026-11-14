//! Signing in through a domain's own identity provider, written for shippin.tech:
//! our own open code.
//!
//! A domain's manager names an OpenID Connect provider. People on that domain can then
//! sign in there instead of with a password. The provider is trusted only for its own
//! domain: the address it reports must be on that domain and belong to an account of
//! that domain, and the server's administrators always sign in with a password.
//!
//! Whoever configures a provider chooses where this server sends requests, so addresses
//! that resolve to private networks are refused. `shippin.tech_SSO_ALLOW_PRIVATE=1`
//! lifts that, and the https requirement, for local testing.

use super::keys::{self, Service};
use crate::Server;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{net::IpAddr, sync::LazyLock, time::Duration};
use store::{
    IterateParams, ValueKey,
    rand::{RngExt, distr::Alphanumeric, rng},
    write::{BatchBuilder, InMemoryClass, Operation, ValueClass, ValueOp, now},
};
use trc::AddContext;

pub const KV_SSO: u8 = 51;
const TAG_SETTINGS: u8 = b'c';
const TAG_PENDING: u8 = b's';
const PENDING_SECONDS: u64 = 600;
/// How client secrets were sealed before sign-in had its own key (see keys::open_any).
const LEGACY_CONTEXT: &str = "shippin.tech sso client secret";

static ALLOW_PRIVATE: LazyLock<bool> =
    LazyLock::new(|| std::env::var("shippin.tech_SSO_ALLOW_PRIVATE").as_deref() == Ok("1"));

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SsoSettings {
    pub issuer: String,
    pub client_id: String,
    /// Sealed by the sign-in service's key (`keys`), in hex, bound to the domain.
    pub sealed_secret: String,
    pub enabled: bool,
}

/// One sign-in on its way through the provider. Used once.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SsoPending {
    pub domain_id: u32,
    pub verifier: String,
    pub client_id: String,
    pub redirect_uri: String,
    pub nonce: Option<String>,
    pub scope: Option<String>,
    pub code_challenge: String,
    pub state: Option<String>,
}

#[derive(Debug)]
pub struct Endpoints {
    pub authorization: String,
    pub token: String,
    pub userinfo: String,
}

fn key(tag: u8, rest: &[u8]) -> Vec<u8> {
    let mut key = vec![KV_SSO, tag];
    key.extend_from_slice(rest);
    key
}

fn value_key(key: Vec<u8>) -> ValueKey<ValueClass> {
    ValueKey::from(ValueClass::InMemory(InMemoryClass::Key(key)))
}

async fn put(server: &Server, key: Vec<u8>, value: Option<Vec<u8>>) -> trc::Result<()> {
    let mut batch = BatchBuilder::new();
    batch.any_op(Operation::Value {
        class: ValueClass::InMemory(InMemoryClass::Key(key)),
        op: value.map_or(ValueOp::Clear, ValueOp::Set),
    });
    server
        .store()
        .write(batch.build_all())
        .await
        .caused_by(trc::location!())
        .map(|_| ())
}

async fn get(server: &Server, key: Vec<u8>) -> trc::Result<Option<Vec<u8>>> {
    let mut found = None;
    server
        .store()
        .iterate(
            IterateParams::new(value_key(key.clone()), value_key(key)).only_first(),
            |_, value| {
                found = Some(value.to_vec());
                Ok(false)
            },
        )
        .await
        .caused_by(trc::location!())?;
    Ok(found.and_then(|value| {
        let expires = u64::from_be_bytes(value.get(..8)?.try_into().ok()?);
        (expires > now()).then(|| value[8..].to_vec())
    }))
}

fn with_expiry(expires: u64, value: &[u8]) -> Vec<u8> {
    let mut out = expires.to_be_bytes().to_vec();
    out.extend_from_slice(value);
    out
}

pub async fn settings(server: &Server, domain_id: u32) -> trc::Result<Option<SsoSettings>> {
    Ok(get(server, key(TAG_SETTINGS, &domain_id.to_be_bytes()))
        .await?
        .and_then(|value| serde_json::from_slice(&value).ok()))
}

pub async fn is_enabled(server: &Server, domain_id: u32) -> trc::Result<bool> {
    Ok(settings(server, domain_id)
        .await?
        .is_some_and(|settings| settings.enabled))
}

/// Saves a domain's provider. An empty secret keeps the one already saved.
pub async fn save_settings(
    server: &Server,
    domain_id: u32,
    issuer: &str,
    client_id: &str,
    client_secret: &str,
    enabled: bool,
) -> trc::Result<Result<(), String>> {
    let issuer = issuer.trim().trim_end_matches('/').to_string();
    let client_id = client_id.trim().to_string();
    if client_id.is_empty() || client_id.len() > 512 {
        return Ok(Err(
            "Enter the client ID from your identity provider.".into()
        ));
    }
    if let Err(reason) = check_url(&issuer).await {
        return Ok(Err(reason));
    }
    let sealed_secret = if client_secret.is_empty() {
        match settings(server, domain_id).await? {
            Some(existing) => existing.sealed_secret,
            None => {
                return Ok(Err(
                    "Enter the client secret from your identity provider.".into()
                ));
            }
        }
    } else {
        match keys::seal(server, Service::Sso, domain_id, client_secret.as_bytes()).await {
            Ok(sealed) => keys::hex(&sealed),
            Err(_) => return Ok(Err("The client secret could not be saved.".into())),
        }
    };
    let record = SsoSettings {
        issuer,
        client_id,
        sealed_secret,
        enabled,
    };
    store_settings(server, domain_id, &record).await?;
    Ok(Ok(()))
}

async fn store_settings(server: &Server, domain_id: u32, record: &SsoSettings) -> trc::Result<()> {
    put(
        server,
        key(TAG_SETTINGS, &domain_id.to_be_bytes()),
        Some(with_expiry(
            u64::MAX,
            &serde_json::to_vec(record).unwrap_or_default(),
        )),
    )
    .await
}

/// The client secret in clear, for one sign-in. One sealed under a replaced or older key is
/// sealed again under the sign-in service's primary key.
async fn client_secret(server: &Server, domain_id: u32, settings: &SsoSettings) -> Option<String> {
    let sealed = keys::unhex(&settings.sealed_secret)?;
    let opened = keys::open_any(server, Service::Sso, domain_id, &sealed, LEGACY_CONTEXT).await?;
    if opened.stale {
        reseal(server, domain_id, settings, &opened.plain).await;
    }
    String::from_utf8(opened.plain).ok()
}

async fn reseal(server: &Server, domain_id: u32, settings: &SsoSettings, plain: &[u8]) -> bool {
    match keys::seal(server, Service::Sso, domain_id, plain).await {
        Ok(sealed) => {
            let record = SsoSettings {
                sealed_secret: keys::hex(&sealed),
                ..settings.clone()
            };
            store_settings(server, domain_id, &record).await.is_ok()
        }
        Err(_) => false,
    }
}

/// Seals again under the primary key every client secret that is under another key:
/// (sealed again, could not be read).
pub async fn reseal_all(server: &Server) -> trc::Result<(usize, usize)> {
    let (mut done, mut failed) = (0, 0);
    for (domain_id, value) in each_with_id(server, KV_SSO, TAG_SETTINGS).await? {
        let Ok(settings) = serde_json::from_slice::<SsoSettings>(&value) else {
            continue;
        };
        let opened = match keys::unhex(&settings.sealed_secret) {
            Some(sealed) => keys::open_any(server, Service::Sso, domain_id, &sealed, LEGACY_CONTEXT).await,
            None => None,
        };
        match opened {
            Some(opened) if !opened.stale => {}
            Some(opened) if reseal(server, domain_id, &settings, &opened.plain).await => done += 1,
            _ => failed += 1,
        }
    }
    Ok((done, failed))
}

/// Every value stored under `[prefix][tag][id]`, with its id.
async fn each_with_id(server: &Server, prefix: u8, tag: u8) -> trc::Result<Vec<(u32, Vec<u8>)>> {
    let mut found = Vec::new();
    server
        .store()
        .iterate(
            IterateParams::new(
                value_key(vec![prefix, tag, 0, 0, 0, 0]),
                value_key(vec![prefix, tag, u8::MAX, u8::MAX, u8::MAX, u8::MAX]),
            ),
            |key, value| {
                if let (Some(id), Some(expires)) = (
                    key.get(key.len().saturating_sub(4)..)
                        .and_then(|id| id.try_into().ok())
                        .map(u32::from_be_bytes),
                    value.get(..8).and_then(|at| at.try_into().ok()).map(u64::from_be_bytes),
                ) && expires > now()
                {
                    found.push((id, value[8..].to_vec()));
                }
                Ok(true)
            },
        )
        .await
        .caused_by(trc::location!())?;
    Ok(found)
}

pub async fn clear_settings(server: &Server, domain_id: u32) -> trc::Result<()> {
    put(server, key(TAG_SETTINGS, &domain_id.to_be_bytes()), None).await
}

fn is_private(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, ..] = ip.octets();
            ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_unspecified()
                || ip.is_broadcast()
                || ip.is_documentation()
                || (a == 100 && (64..128).contains(&b))
                || a == 0
        }
        IpAddr::V6(ip) => {
            let first = ip.segments()[0];
            ip.is_loopback()
                || ip.is_unspecified()
                || (first & 0xfe00) == 0xfc00
                || (first & 0xffc0) == 0xfe80
                || ip.to_ipv4_mapped().is_some_and(|ip| is_private(ip.into()))
        }
    }
}

fn url_host(url: &str) -> Option<(&str, u16)> {
    let (scheme, rest) = url.split_once("://")?;
    let default_port = match scheme {
        "https" => 443,
        "http" => 80,
        _ => return None,
    };
    let authority = rest.split(['/', '?', '#']).next()?;
    if authority.is_empty() || authority.contains('@') {
        return None;
    }
    if let Some(v6) = authority.strip_prefix('[') {
        let (host, tail) = v6.split_once(']')?;
        let port = match tail.strip_prefix(':') {
            Some(port) => port.parse().ok()?,
            None => default_port,
        };
        return Some((host, port));
    }
    Some(match authority.rsplit_once(':') {
        Some((host, port)) => (host, port.parse().ok()?),
        None => (authority, default_port),
    })
}

/// Refuses addresses this server should not be made to call.
async fn check_url(url: &str) -> Result<(), String> {
    let refused = || "Use the https address of your identity provider.".to_string();
    let (host, port) = url_host(url).ok_or_else(refused)?;
    if *ALLOW_PRIVATE {
        return Ok(());
    }
    if !url.starts_with("https://") {
        return Err(refused());
    }
    let addresses = tokio::net::lookup_host((host, port))
        .await
        .map_err(|_| "That identity provider's address could not be found.".to_string())?;
    let mut any = false;
    for address in addresses {
        any = true;
        if is_private(address.ip()) {
            return Err("That address is on a private network.".to_string());
        }
    }
    if any {
        Ok(())
    } else {
        Err("That identity provider's address could not be found.".to_string())
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|err| err.to_string())
}

/// Asks the provider where its endpoints are, and checks the answer names the provider.
pub async fn discover(issuer: &str) -> Result<Endpoints, String> {
    let body: Value = client()?
        .get(format!("{issuer}/.well-known/openid-configuration"))
        .send()
        .await
        .map_err(|err| err.to_string())?
        .json()
        .await
        .map_err(|err| err.to_string())?;
    if body["issuer"]
        .as_str()
        .map(|text| text.trim_end_matches('/'))
        != Some(issuer)
    {
        return Err("the provider reported a different issuer".into());
    }
    let endpoint = |name: &str| {
        body[name]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| format!("the provider did not report {name}"))
    };
    let endpoints = Endpoints {
        authorization: endpoint("authorization_endpoint")?,
        token: endpoint("token_endpoint")?,
        userinfo: endpoint("userinfo_endpoint")?,
    };
    check_url(&endpoints.token).await?;
    check_url(&endpoints.userinfo).await?;
    if !*ALLOW_PRIVATE && !endpoints.authorization.starts_with("https://") {
        return Err("the provider's sign-in page is not https".into());
    }
    Ok(endpoints)
}

fn random_text(length: usize) -> String {
    rng()
        .sample_iter(Alphanumeric)
        .take(length)
        .map(char::from)
        .collect()
}

fn challenge_of(verifier: &str) -> String {
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
    use sha2::{Digest, Sha256};
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

pub fn callback_url(server: &Server) -> String {
    format!(
        "{}/api/sso/callback",
        server.core.network.http.url_https.trim_end_matches('/')
    )
}

pub fn authorize_url(
    endpoint: &str,
    client_id: &str,
    redirect_uri: &str,
    state: &str,
    challenge: &str,
    hint: &str,
) -> String {
    let query = form_urlencoded::Serializer::new(String::new())
        .append_pair("client_id", client_id)
        .append_pair("response_type", "code")
        .append_pair("scope", "openid email")
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("state", state)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("login_hint", hint)
        .finish();
    let joiner = if endpoint.contains('?') { '&' } else { '?' };
    format!("{endpoint}{joiner}{query}")
}

/// Starts a sign-in and gives the address to send the browser to.
pub async fn begin(
    server: &Server,
    settings: &SsoSettings,
    mut pending: SsoPending,
    hint: &str,
) -> Result<String, String> {
    let endpoints = discover(&settings.issuer).await?;
    pending.verifier = random_text(64);
    let state = random_text(40);
    let url = authorize_url(
        &endpoints.authorization,
        &settings.client_id,
        &callback_url(server),
        &state,
        &challenge_of(&pending.verifier),
        hint,
    );
    put(
        server,
        key(TAG_PENDING, state.as_bytes()),
        Some(with_expiry(
            now() + PENDING_SECONDS,
            &serde_json::to_vec(&pending).unwrap_or_default(),
        )),
    )
    .await
    .map_err(|err| err.to_string())?;
    Ok(url)
}

/// Takes a pending sign-in. It can only ever be taken once.
pub async fn take_pending(server: &Server, state: &str) -> trc::Result<Option<SsoPending>> {
    let state_key = key(TAG_PENDING, state.as_bytes());
    let found = get(server, state_key.clone()).await?;
    if found.is_some() {
        put(server, state_key, None).await?;
    }
    Ok(found.and_then(|value| serde_json::from_slice(&value).ok()))
}

/// Whether the address the provider reported may sign in to this domain.
pub fn email_acceptable(email: &str, verified: Option<bool>, domain_names: &[&str]) -> bool {
    verified != Some(false)
        && email.split_once('@').is_some_and(|(local, domain)| {
            !local.is_empty()
                && domain_names
                    .iter()
                    .any(|name| name.eq_ignore_ascii_case(domain))
        })
}

/// Trades the provider's code for the person's address.
pub async fn identify(
    server: &Server,
    settings: &SsoSettings,
    domain_id: u32,
    code: &str,
    verifier: &str,
) -> Result<(String, Option<bool>), String> {
    let endpoints = discover(&settings.issuer).await?;
    let client_secret = client_secret(server, domain_id, settings)
        .await
        .ok_or("the client secret could not be read")?;
    let callback = callback_url(server);
    let form = form_urlencoded::Serializer::new(String::new())
        .append_pair("grant_type", "authorization_code")
        .append_pair("code", code)
        .append_pair("redirect_uri", &callback)
        .append_pair("client_id", &settings.client_id)
        .append_pair("client_secret", &client_secret)
        .append_pair("code_verifier", verifier)
        .finish();
    let http = client()?;
    let token: Value = http
        .post(&endpoints.token)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(form)
        .send()
        .await
        .map_err(|err| err.to_string())?
        .json()
        .await
        .map_err(|err| err.to_string())?;
    let access = token["access_token"]
        .as_str()
        .ok_or("the provider returned no access token")?;
    let info: Value = http
        .get(&endpoints.userinfo)
        .bearer_auth(access)
        .send()
        .await
        .map_err(|err| err.to_string())?
        .json()
        .await
        .map_err(|err| err.to_string())?;
    let email = info["email"]
        .as_str()
        .ok_or("the provider did not report an address")?
        .to_lowercase();
    Ok((email, info["email_verified"].as_bool()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_domains_own_verified_addresses_are_accepted() {
        let names = ["hill.test", "hill.example"];
        assert!(email_acceptable("ada@hill.test", Some(true), &names));
        assert!(email_acceptable("ada@HILL.example", None, &names));
        assert!(!email_acceptable("ada@hill.test", Some(false), &names));
        assert!(!email_acceptable("ada@vale.test", Some(true), &names));
        assert!(!email_acceptable("ada@evilhill.test", Some(true), &names));
        assert!(!email_acceptable("@hill.test", Some(true), &names));
        assert!(!email_acceptable("nonsense", None, &names));
    }

    #[test]
    fn private_addresses_are_recognised() {
        for ip in [
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "127.0.0.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "::1",
            "fd00::1",
            "fe80::1",
            "::ffff:10.0.0.1",
        ] {
            assert!(is_private(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"] {
            assert!(!is_private(ip.parse().unwrap()), "{ip}");
        }
    }

    #[test]
    fn hosts_are_read_from_urls() {
        assert_eq!(url_host("https://id.test/x"), Some(("id.test", 443)));
        assert_eq!(url_host("http://id.test:8080"), Some(("id.test", 8080)));
        assert_eq!(url_host("https://[fd00::1]:9/x"), Some(("fd00::1", 9)));
        assert_eq!(url_host("ftp://id.test"), None);
        assert_eq!(url_host("https://user@id.test"), None);
        assert_eq!(url_host("https://"), None);
    }

    #[test]
    fn the_challenge_follows_rfc_7636() {
        // RFC 7636 appendix B.
        assert_eq!(
            challenge_of("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn the_sign_in_address_carries_state_and_challenge() {
        let url = authorize_url(
            "https://id.test/auth",
            "client",
            "https://mail.test/api/sso/callback",
            "st",
            "ch",
            "a@b.co",
        );
        assert!(url.starts_with("https://id.test/auth?client_id=client"));
        assert!(url.contains("state=st"));
        assert!(url.contains("code_challenge=ch"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("redirect_uri=https%3A%2F%2Fmail.test%2Fapi%2Fsso%2Fcallback"));
    }
}
