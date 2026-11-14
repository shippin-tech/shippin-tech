//! The link between a person's account and their Google Drive, written for shippin.tech.
//!
//! Each person connects their own Google account with OAuth. The client secret and
//! the tokens never reach the browser: refresh tokens are kept encrypted in the data
//! store, and every Google call is made from here. Configuration comes from the
//! environment (`shippin.tech_GOOGLE_*`); without a client id the link is off.

use super::keys::{self, Service};
use crate::Server;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{sync::LazyLock, time::Duration};
use store::{
    IterateParams, ValueKey,
    rand::{RngExt, distr::Alphanumeric, rng},
    write::{BatchBuilder, InMemoryClass, Operation, ValueClass, ValueOp, now},
};
use trc::AddContext;

/// In-memory key prefix for the Google link (next to stats' 41 and lessons' 42).
pub const KV_GOOGLE: u8 = 43;
const TAG_TOKEN: u8 = b't';
const TAG_STATE: u8 = b's';
const STATE_SECONDS: u64 = 600;
const REFRESH_MARGIN: u64 = 60;
/// How tokens were sealed before the Google link had its own key (see keys::open_any).
const LEGACY_CONTEXT: &str = "shippin.tech google link tokens v1";
/// The most this link moves in one file, matching the default Drive file limit.
pub const MAX_TRANSFER: usize = 100 * 1024 * 1024;

pub const FOLDER_TYPE: &str = "application/vnd.google-apps.folder";
const GOOGLE_APP_PREFIX: &str = "application/vnd.google-apps.";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GoogleConfig {
    pub client_id: String,
    pub client_secret: String,
    pub redirect_url: String,
    /// What the person's browser is sent to.
    pub auth_url: String,
    pub token_url: String,
    pub revoke_url: String,
    pub api_base: String,
    pub scopes: String,
}

impl GoogleConfig {
    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Option<Self> {
        let value = |key: &str| get(key).filter(|value| !value.trim().is_empty());
        let client_id = value("shippin.tech_GOOGLE_CLIENT_ID")?;
        let client_secret = value("shippin.tech_GOOGLE_CLIENT_SECRET")?;
        let redirect_url = value("shippin.tech_GOOGLE_REDIRECT_URL")?;
        Some(GoogleConfig {
            client_id,
            client_secret,
            redirect_url,
            auth_url: value("shippin.tech_GOOGLE_AUTH_URL")
                .unwrap_or_else(|| "https://accounts.google.com/o/oauth2/v2/auth".into()),
            token_url: value("shippin.tech_GOOGLE_TOKEN_URL")
                .unwrap_or_else(|| "https://oauth2.googleapis.com/token".into()),
            revoke_url: value("shippin.tech_GOOGLE_REVOKE_URL")
                .unwrap_or_else(|| "https://oauth2.googleapis.com/revoke".into()),
            api_base: value("shippin.tech_GOOGLE_API_BASE")
                .unwrap_or_else(|| "https://www.googleapis.com".into())
                .trim_end_matches('/')
                .to_string(),
            scopes: value("shippin.tech_GOOGLE_SCOPES")
                .unwrap_or_else(|| "https://www.googleapis.com/auth/drive".into()),
        })
    }

    pub fn authorize_url(&self, state: &str, challenge: &str) -> String {
        let query = form_urlencoded::Serializer::new(String::new())
            .append_pair("client_id", &self.client_id)
            .append_pair("redirect_uri", &self.redirect_url)
            .append_pair("response_type", "code")
            .append_pair("scope", &self.scopes)
            .append_pair("access_type", "offline")
            .append_pair("prompt", "consent")
            .append_pair("state", state)
            .append_pair("code_challenge", challenge)
            .append_pair("code_challenge_method", "S256")
            .finish();
        format!("{}?{query}", self.auth_url)
    }
}

pub static GOOGLE: LazyLock<Option<GoogleConfig>> =
    LazyLock::new(|| GoogleConfig::from_lookup(|key| std::env::var(key).ok()));

/// The S256 code challenge for a PKCE verifier.
pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn random_token(length: usize) -> String {
    rng()
        .sample_iter(Alphanumeric)
        .take(length)
        .map(char::from)
        .collect()
}

/// A value inside a Drive search, with its quotes and backslashes escaped.
pub fn query_literal(value: &str) -> String {
    format!("'{}'", value.replace('\\', "\\\\").replace('\'', "\\'"))
}

/// The Drive search for a folder, a name, or what others have shared.
pub fn list_query(folder: Option<&str>, search: Option<&str>, shared: bool) -> String {
    let mut parts = vec!["trashed=false".to_string()];
    if let Some(search) = search.filter(|text| !text.trim().is_empty()) {
        parts.push(format!("name contains {}", query_literal(search.trim())));
    } else if shared {
        parts.push("sharedWithMe=true".to_string());
    } else {
        parts.push(format!(
            "{} in parents",
            query_literal(folder.filter(|id| !id.is_empty()).unwrap_or("root"))
        ));
    }
    parts.join(" and ")
}

/// Whether a type is one of Google's own (Docs, Sheets, Slides) with no bytes to fetch directly.
pub fn is_google_app(mime: &str) -> bool {
    mime.starts_with(GOOGLE_APP_PREFIX) && mime != FOLDER_TYPE
}

/// The formats a Google file can be exported to: `(key, type, extension)`.
pub fn export_formats(mime: &str) -> &'static [(&'static str, &'static str, &'static str)] {
    const PDF: (&str, &str, &str) = ("pdf", "application/pdf", "pdf");
    const DOCX: (&str, &str, &str) = (
        "docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "docx",
    );
    const XLSX: (&str, &str, &str) = (
        "xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xlsx",
    );
    const PPTX: (&str, &str, &str) = (
        "pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "pptx",
    );
    match mime {
        "application/vnd.google-apps.document" => &[DOCX, PDF],
        "application/vnd.google-apps.spreadsheet" => &[XLSX, PDF],
        "application/vnd.google-apps.presentation" => &[PPTX, PDF],
        "application/vnd.google-apps.drawing" => &[PDF],
        _ => &[],
    }
}

/// A multipart body for a Google upload: JSON metadata, then the bytes.
pub fn multipart_upload(boundary: &str, metadata: &Value, mime: &str, bytes: &[u8]) -> Vec<u8> {
    let mut body = Vec::with_capacity(bytes.len() + 256);
    body.extend_from_slice(
        format!("--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n--{boundary}\r\nContent-Type: {mime}\r\n\r\n").as_bytes(),
    );
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GoogleAccount {
    pub refresh_token: String,
    pub access_token: String,
    pub expires_at: u64,
    pub email: String,
}

#[derive(Debug)]
pub enum GoogleError {
    NotConfigured,
    NotConnected,
    /// Google refused or failed; the status and what to tell the person.
    Google(u16, String),
    Internal(trc::Error),
}

impl From<trc::Error> for GoogleError {
    fn from(err: trc::Error) -> Self {
        GoogleError::Internal(err)
    }
}

impl From<reqwest::Error> for GoogleError {
    fn from(_: reqwest::Error) -> Self {
        GoogleError::Google(502, "Google could not be reached.".to_string())
    }
}

fn key(tag: u8, rest: &[u8]) -> Vec<u8> {
    let mut key = Vec::with_capacity(2 + rest.len());
    key.push(KV_GOOGLE);
    key.push(tag);
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

/// Reads one stored value: the expiry prefix is checked and removed.
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

/// A person's Google tokens. Ones sealed under a replaced or older key are sealed again
/// under the Google link's primary key.
pub async fn load_account(server: &Server, account_id: u32) -> trc::Result<Option<GoogleAccount>> {
    let Some(sealed) = get(server, key(TAG_TOKEN, &account_id.to_be_bytes())).await? else {
        return Ok(None);
    };
    let Some(opened) = keys::open_any(server, Service::Google, account_id, &sealed, LEGACY_CONTEXT).await else {
        return Ok(None);
    };
    let account = serde_json::from_slice::<GoogleAccount>(&opened.plain).ok();
    if opened.stale
        && let Some(account) = &account
    {
        let _ = save_account(server, account_id, account).await;
    }
    Ok(account)
}

/// Seals again under the primary key every person's tokens that are under another key:
/// (sealed again, could not be read).
pub async fn reseal_all(server: &Server) -> trc::Result<(usize, usize)> {
    let (mut done, mut failed) = (0, 0);
    for (account_id, sealed) in each_with_id(server, KV_GOOGLE, TAG_TOKEN).await? {
        let opened = keys::open_any(server, Service::Google, account_id, &sealed, LEGACY_CONTEXT).await;
        let stale = opened.as_ref().is_some_and(|opened| opened.stale);
        let account = opened.and_then(|opened| serde_json::from_slice::<GoogleAccount>(&opened.plain).ok());
        match account {
            Some(_) if !stale => {}
            Some(account) if save_account(server, account_id, &account).await.is_ok() => done += 1,
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

async fn save_account(
    server: &Server,
    account_id: u32,
    account: &GoogleAccount,
) -> Result<(), GoogleError> {
    let plain = serde_json::to_vec(account).map_err(|err| GoogleError::Google(500, err.to_string()))?;
    let sealed = keys::seal(server, Service::Google, account_id, &plain)
        .await
        .map_err(|reason| GoogleError::Google(500, reason))?;
    put(
        server,
        key(TAG_TOKEN, &account_id.to_be_bytes()),
        Some(with_expiry(u64::MAX, &sealed)),
    )
    .await?;
    Ok(())
}

fn client() -> Result<reqwest::Client, GoogleError> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(GoogleError::from)
}

fn config() -> Result<&'static GoogleConfig, GoogleError> {
    GOOGLE.as_ref().ok_or(GoogleError::NotConfigured)
}

/// Starts a connection: remembers who asked and returns where to send their browser.
pub async fn begin_connect(server: &Server, account_id: u32) -> Result<String, GoogleError> {
    let config = config()?;
    let state = random_token(40);
    let verifier = random_token(64);
    let value = serde_json::json!({ "account": account_id, "verifier": verifier }).to_string();
    put(
        server,
        key(TAG_STATE, state.as_bytes()),
        Some(with_expiry(now() + STATE_SECONDS, value.as_bytes())),
    )
    .await?;
    Ok(config.authorize_url(&state, &pkce_challenge(&verifier)))
}

#[derive(Deserialize)]
struct TokenAnswer {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
}

async fn token_request(form: &[(&str, &str)]) -> Result<TokenAnswer, GoogleError> {
    let config = config()?;
    let response = client()?.post(&config.token_url).form(form).send().await?;
    let status = response.status();
    if !status.is_success() {
        return Err(GoogleError::Google(
            status.as_u16(),
            "Google refused the sign-in.".to_string(),
        ));
    }
    response
        .json::<TokenAnswer>()
        .await
        .map_err(GoogleError::from)
}

/// Finishes a connection when Google sends the person back. Returns who connected.
pub async fn finish_connect(server: &Server, state: &str, code: &str) -> Result<u32, GoogleError> {
    let config = config()?;
    let state_key = key(TAG_STATE, state.as_bytes());
    let stored = get(server, state_key.clone())
        .await?
        .ok_or_else(|| GoogleError::Google(400, "That sign-in has expired. Try again.".into()))?;
    put(server, state_key, None).await?;
    let stored: Value = serde_json::from_slice(&stored)
        .map_err(|_| GoogleError::Google(400, "That sign-in has expired. Try again.".into()))?;
    let account_id = stored["account"].as_u64().unwrap_or_default() as u32;
    let verifier = stored["verifier"].as_str().unwrap_or_default();

    let answer = token_request(&[
        ("client_id", config.client_id.as_str()),
        ("client_secret", config.client_secret.as_str()),
        ("code", code),
        ("code_verifier", verifier),
        ("grant_type", "authorization_code"),
        ("redirect_uri", config.redirect_url.as_str()),
    ])
    .await?;
    let refresh_token = answer.refresh_token.ok_or_else(|| {
        GoogleError::Google(
            400,
            "Google did not grant lasting access. Try again.".into(),
        )
    })?;

    let about = client()?
        .get(format!(
            "{}/drive/v3/about?fields=user(emailAddress)",
            config.api_base
        ))
        .bearer_auth(&answer.access_token)
        .send()
        .await?
        .json::<Value>()
        .await
        .unwrap_or_default();
    save_account(
        server,
        account_id,
        &GoogleAccount {
            refresh_token,
            access_token: answer.access_token,
            expires_at: now() + answer.expires_in.unwrap_or(3600),
            email: about["user"]["emailAddress"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
        },
    )
    .await?;
    Ok(account_id)
}

pub async fn disconnect(server: &Server, account_id: u32) -> Result<(), GoogleError> {
    let config = config()?;
    if let Some(account) = load_account(server, account_id).await? {
        // Best effort: the link is forgotten here whether or not Google answers.
        let _ = client()?
            .post(&config.revoke_url)
            .form(&[("token", account.refresh_token.as_str())])
            .send()
            .await;
    }
    put(server, key(TAG_TOKEN, &account_id.to_be_bytes()), None).await?;
    Ok(())
}

/// A working access token, refreshed when it is about to run out.
async fn access_token(server: &Server, account_id: u32) -> Result<String, GoogleError> {
    let config = config()?;
    let mut account = load_account(server, account_id)
        .await?
        .ok_or(GoogleError::NotConnected)?;
    if account.expires_at > now() + REFRESH_MARGIN {
        return Ok(account.access_token);
    }
    let answer = token_request(&[
        ("client_id", config.client_id.as_str()),
        ("client_secret", config.client_secret.as_str()),
        ("refresh_token", account.refresh_token.as_str()),
        ("grant_type", "refresh_token"),
    ])
    .await
    .map_err(|err| match err {
        GoogleError::Google(400 | 401, _) => GoogleError::NotConnected,
        other => other,
    })?;
    account.access_token = answer.access_token.clone();
    account.expires_at = now() + answer.expires_in.unwrap_or(3600);
    if let Some(refresh_token) = answer.refresh_token {
        account.refresh_token = refresh_token;
    }
    save_account(server, account_id, &account).await?;
    Ok(answer.access_token)
}

async fn failure(response: reqwest::Response) -> GoogleError {
    let status = response.status().as_u16();
    let body = response.json::<Value>().await.unwrap_or_default();
    let reason = body["error"]["errors"][0]["reason"]
        .as_str()
        .unwrap_or_default();
    GoogleError::Google(
        status,
        match (status, reason) {
            (401, _) => return GoogleError::NotConnected,
            (403, "storageQuotaExceeded") => "Your Google storage is full.".to_string(),
            (403, _) => "Google did not allow that.".to_string(),
            (404, _) => "That file is no longer in Google Drive.".to_string(),
            _ => "Google could not do that.".to_string(),
        },
    )
}

const FILE_FIELDS: &str = "id,name,mimeType,size,modifiedTime,webViewLink,parents";

/// Lists a folder, a search or what others have shared.
pub async fn list_files(
    server: &Server,
    account_id: u32,
    folder: Option<&str>,
    search: Option<&str>,
    shared: bool,
    page_token: Option<&str>,
) -> Result<Value, GoogleError> {
    let config = config()?;
    let token = access_token(server, account_id).await?;
    let mut query = vec![
        ("q", list_query(folder, search, shared)),
        ("pageSize", "200".to_string()),
        ("orderBy", "folder,name_natural".to_string()),
        ("fields", format!("nextPageToken,files({FILE_FIELDS})")),
        ("supportsAllDrives", "true".to_string()),
        ("includeItemsFromAllDrives", "true".to_string()),
    ];
    if let Some(page_token) = page_token.filter(|value| !value.is_empty()) {
        query.push(("pageToken", page_token.to_string()));
    }
    let response = client()?
        .get(format!("{}/drive/v3/files", config.api_base))
        .bearer_auth(token)
        .query(&query)
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(failure(response).await);
    }
    response.json::<Value>().await.map_err(GoogleError::from)
}

pub async fn file_info(server: &Server, account_id: u32, id: &str) -> Result<Value, GoogleError> {
    let config = config()?;
    let token = access_token(server, account_id).await?;
    let response = client()?
        .get(format!(
            "{}/drive/v3/files/{}",
            config.api_base,
            form_urlencoded::byte_serialize(id.as_bytes()).collect::<String>()
        ))
        .bearer_auth(token)
        .query(&[("fields", FILE_FIELDS), ("supportsAllDrives", "true")])
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(failure(response).await);
    }
    response.json::<Value>().await.map_err(GoogleError::from)
}

/// A file's bytes; Google's own documents are exported to `export`.
pub async fn file_content(
    server: &Server,
    account_id: u32,
    id: &str,
    mime: &str,
    export: Option<&str>,
) -> Result<(Vec<u8>, String, &'static str), GoogleError> {
    let config = config()?;
    let token = access_token(server, account_id).await?;
    let encoded = form_urlencoded::byte_serialize(id.as_bytes()).collect::<String>();
    let (request, content_type, extension) = if is_google_app(mime) {
        let formats = export_formats(mime);
        let format = formats
            .iter()
            .find(|(key, _, _)| Some(*key) == export)
            .or(formats.first())
            .ok_or_else(|| {
                GoogleError::Google(400, "That Google file cannot be exported.".into())
            })?;
        (
            client()?
                .get(format!(
                    "{}/drive/v3/files/{encoded}/export",
                    config.api_base
                ))
                .query(&[("mimeType", format.1)]),
            format.1.to_string(),
            format.2,
        )
    } else {
        (
            client()?
                .get(format!("{}/drive/v3/files/{encoded}", config.api_base))
                .query(&[("alt", "media"), ("supportsAllDrives", "true")]),
            mime.to_string(),
            "",
        )
    };
    let response = request.bearer_auth(token).send().await?;
    if !response.status().is_success() {
        return Err(failure(response).await);
    }
    if response
        .content_length()
        .is_some_and(|size| size as usize > MAX_TRANSFER)
    {
        return Err(GoogleError::Google(
            413,
            "That file is too large to bring over.".into(),
        ));
    }
    let bytes = response.bytes().await?;
    if bytes.len() > MAX_TRANSFER {
        return Err(GoogleError::Google(
            413,
            "That file is too large to bring over.".into(),
        ));
    }
    Ok((bytes.to_vec(), content_type, extension))
}

/// Puts a copy of a file in the person's Google Drive.
pub async fn upload_file(
    server: &Server,
    account_id: u32,
    name: &str,
    mime: &str,
    parent: Option<&str>,
    bytes: &[u8],
) -> Result<Value, GoogleError> {
    let config = config()?;
    let token = access_token(server, account_id).await?;
    let boundary = format!("shippin{}", random_token(24));
    let mut metadata = serde_json::json!({ "name": name, "mimeType": mime });
    if let Some(parent) = parent.filter(|value| !value.is_empty()) {
        metadata["parents"] = serde_json::json!([parent]);
    }
    let response = client()?
        .post(format!("{}/upload/drive/v3/files", config.api_base))
        .query(&[
            ("uploadType", "multipart"),
            ("fields", FILE_FIELDS),
            ("supportsAllDrives", "true"),
        ])
        .bearer_auth(token)
        .header(
            "Content-Type",
            format!("multipart/related; boundary={boundary}"),
        )
        .body(multipart_upload(&boundary, &metadata, mime, bytes))
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(failure(response).await);
    }
    response.json::<Value>().await.map_err(GoogleError::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(get: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
        move |key| {
            get.iter()
                .find(|(name, _)| *name == key)
                .map(|(_, value)| value.to_string())
        }
    }

    const MINIMAL: &[(&str, &str)] = &[
        ("shippin.tech_GOOGLE_CLIENT_ID", "id"),
        ("shippin.tech_GOOGLE_CLIENT_SECRET", "secret"),
        (
            "shippin.tech_GOOGLE_REDIRECT_URL",
            "https://mail.test/api/google/callback",
        ),
    ];

    #[test]
    fn config_needs_all_three_settings() {
        assert_eq!(GoogleConfig::from_lookup(settings(&[])), None);
        assert_eq!(GoogleConfig::from_lookup(settings(&MINIMAL[..2])), None);
        let config = GoogleConfig::from_lookup(settings(MINIMAL)).unwrap();
        assert_eq!(config.api_base, "https://www.googleapis.com");
        assert_eq!(config.scopes, "https://www.googleapis.com/auth/drive");
    }

    #[test]
    fn the_sign_in_address_asks_for_lasting_access_with_pkce() {
        let config = GoogleConfig::from_lookup(settings(MINIMAL)).unwrap();
        let url = config.authorize_url("st", "ch");
        assert!(url.starts_with("https://accounts.google.com/o/oauth2/v2/auth?"));
        for part in [
            "client_id=id",
            "access_type=offline",
            "state=st",
            "code_challenge=ch",
            "code_challenge_method=S256",
        ] {
            assert!(url.contains(part), "{part} in {url}");
        }
        assert!(url.contains("redirect_uri=https%3A%2F%2Fmail.test%2Fapi%2Fgoogle%2Fcallback"));
    }

    #[test]
    fn pkce_challenge_matches_the_rfc_example() {
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn searches_cannot_be_broken_out_of() {
        assert_eq!(query_literal("it's"), r"'it\'s'");
        assert_eq!(query_literal(r"a\b"), r"'a\\b'");
        assert_eq!(
            list_query(None, None, false),
            "trashed=false and 'root' in parents"
        );
        assert_eq!(
            list_query(Some("abc"), None, false),
            "trashed=false and 'abc' in parents"
        );
        assert_eq!(
            list_query(Some("abc"), Some("re'port"), false),
            r"trashed=false and name contains 're\'port'"
        );
        assert_eq!(
            list_query(None, None, true),
            "trashed=false and sharedWithMe=true"
        );
    }

    #[test]
    fn google_documents_export_to_office_and_pdf() {
        assert!(is_google_app("application/vnd.google-apps.document"));
        assert!(!is_google_app(FOLDER_TYPE));
        assert!(!is_google_app("application/pdf"));
        assert_eq!(
            export_formats("application/vnd.google-apps.document")[0].0,
            "docx"
        );
        assert_eq!(
            export_formats("application/vnd.google-apps.spreadsheet")[0].0,
            "xlsx"
        );
        assert!(export_formats("text/plain").is_empty());
    }

    #[test]
    fn tokens_are_sealed_to_their_account() {
        let account = GoogleAccount {
            refresh_token: "refresh-secret".into(),
            access_token: "access".into(),
            expires_at: 9,
            email: "a@b.test".into(),
        };
        let key = [3u8; keys::KEY_LEN];
        let plain = serde_json::to_vec(&account).unwrap();
        let sealed = keys::seal_with(Service::Google, 7, 1, &key, &plain).unwrap();
        assert!(!sealed.windows(14).any(|window| window == b"refresh-secret"));
        let opened = keys::open_with(Service::Google, 7, &sealed, &key).unwrap();
        assert_eq!(serde_json::from_slice::<GoogleAccount>(&opened).ok(), Some(account));
        assert_eq!(keys::open_with(Service::Google, 8, &sealed, &key), None);
        assert_eq!(keys::open_with(Service::Google, 7, &sealed, &[4u8; keys::KEY_LEN]), None);
        assert_eq!(keys::open_with(Service::Google, 7, &sealed[..4], &key), None);
    }

    #[test]
    fn uploads_are_multipart_related() {
        let body = multipart_upload(
            "B",
            &serde_json::json!({ "name": "x" }),
            "text/plain",
            b"hello",
        );
        let text = String::from_utf8(body).unwrap();
        assert!(text.starts_with("--B\r\nContent-Type: application/json"));
        assert!(text.contains("{\"name\":\"x\"}"));
        assert!(text.ends_with("hello\r\n--B--\r\n"));
    }
}
