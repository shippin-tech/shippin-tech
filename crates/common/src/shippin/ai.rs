//! A configurable AI provider, set by the server's administrators: our own open code.
//!
//! Off until someone sets it. Any address that speaks the OpenAI-compatible chat API
//! works, including a self-hosted Ollama, as does Anthropic's own API. The model is
//! whatever the administrator names. A private address is allowed here on purpose: a
//! model on your own machines is the way to keep mail and questions on them.

use super::keys::{self, Service};
use crate::Server;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::Duration;
use store::{
    Deserialize as StoreDeserialize, ValueKey,
    write::{BatchBuilder, InMemoryClass, Operation, ValueClass, ValueOp},
};
use trc::AddContext;

pub const KV_AI: u8 = 54;
const ANTHROPIC_VERSION: &str = "2026-10-21";
const MAX_TOKENS: u32 = 8000;
/// The owner a provider key is sealed to: the server itself, no domain or person.
const KEY_SCOPE: u32 = u32::MAX;
/// How provider keys were sealed before the AI service had its own key (see keys::open_any).
const LEGACY_CONTEXT: &str = "shippin.tech sso client secret";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    /// `openai` for any OpenAI-compatible address, `anthropic` for Anthropic's API.
    pub kind: String,
    pub endpoint: String,
    pub model: String,
    #[serde(default)]
    pub sealed_key: String,
    #[serde(default)]
    pub assistant: bool,
}

struct Raw(Vec<u8>);

impl StoreDeserialize for Raw {
    fn deserialize(bytes: &[u8]) -> trc::Result<Self> {
        Ok(Raw(bytes.to_vec()))
    }
}

fn class() -> ValueClass {
    ValueClass::InMemory(InMemoryClass::Key(vec![KV_AI, b's']))
}

pub async fn settings(server: &Server) -> trc::Result<Option<AiSettings>> {
    Ok(server
        .store()
        .get_value::<Raw>(ValueKey::from(class()))
        .await
        .caused_by(trc::location!())?
        .and_then(|value| serde_json::from_slice(value.0.get(8..)?).ok()))
}

async fn write(server: &Server, op: ValueOp) -> trc::Result<()> {
    let mut batch = BatchBuilder::new();
    batch.any_op(Operation::Value { class: class(), op });
    server
        .store()
        .write(batch.build_all())
        .await
        .caused_by(trc::location!())
        .map(|_| ())
}

pub async fn clear_settings(server: &Server) -> trc::Result<()> {
    write(server, ValueOp::Clear).await
}

/// What is wrong with these settings, in words for the administrator.
pub fn settings_problem(kind: &str, endpoint: &str, model: &str) -> Option<&'static str> {
    if !matches!(kind, "openai" | "anthropic") {
        return Some("Choose which kind of service this is.");
    }
    if !endpoint.starts_with("https://") && !endpoint.starts_with("http://") {
        return Some("The address starts with https:// or http://.");
    }
    if model.trim().is_empty() || model.len() > 200 {
        return Some("Enter the name of the model to use.");
    }
    None
}

/// Saves the settings. An empty key keeps the one already saved.
pub async fn save_settings(
    server: &Server,
    kind: &str,
    endpoint: &str,
    model: &str,
    key: &str,
    assistant: bool,
) -> trc::Result<Result<(), String>> {
    let endpoint = endpoint.trim().trim_end_matches('/');
    if let Some(problem) = settings_problem(kind, endpoint, model) {
        return Ok(Err(problem.to_string()));
    }
    let sealed_key = if key.is_empty() {
        settings(server)
            .await?
            .map(|saved| saved.sealed_key)
            .unwrap_or_default()
    } else {
        match keys::seal(server, Service::Ai, KEY_SCOPE, key.as_bytes()).await {
            Ok(sealed) => keys::hex(&sealed),
            Err(_) => return Ok(Err("The key could not be saved.".to_string())),
        }
    };
    let record = AiSettings {
        kind: kind.to_string(),
        endpoint: endpoint.to_string(),
        model: model.trim().to_string(),
        sealed_key,
        assistant,
    };
    store(server, &record).await?;
    Ok(Ok(()))
}

async fn store(server: &Server, record: &AiSettings) -> trc::Result<()> {
    let mut value = u64::MAX.to_be_bytes().to_vec();
    value.extend_from_slice(&serde_json::to_vec(record).unwrap_or_default());
    write(server, ValueOp::Set(value)).await
}

/// The provider key in clear, for one request. A key sealed under a replaced or older key
/// is sealed again under the AI service's primary key.
async fn provider_key(server: &Server, settings: &AiSettings) -> Option<String> {
    let sealed = keys::unhex(&settings.sealed_key)?;
    let opened = keys::open_any(server, Service::Ai, KEY_SCOPE, &sealed, LEGACY_CONTEXT).await?;
    if opened.stale {
        reseal(server, settings, &opened.plain).await;
    }
    String::from_utf8(opened.plain).ok()
}

async fn reseal(server: &Server, settings: &AiSettings, plain: &[u8]) {
    if let Ok(sealed) = keys::seal(server, Service::Ai, KEY_SCOPE, plain).await {
        let record = AiSettings {
            sealed_key: keys::hex(&sealed),
            ..settings.clone()
        };
        let _ = store(server, &record).await;
    }
}

/// Seals the saved provider key again under the AI service's primary key, if it is under
/// another: (sealed again, could not be read).
pub async fn reseal_all(server: &Server) -> (usize, usize) {
    let Ok(Some(saved)) = settings(server).await else {
        return (0, 0);
    };
    if saved.sealed_key.is_empty() {
        return (0, 0);
    }
    let opened = match keys::unhex(&saved.sealed_key) {
        Some(sealed) => keys::open_any(server, Service::Ai, KEY_SCOPE, &sealed, LEGACY_CONTEXT).await,
        None => None,
    };
    match opened {
        Some(opened) if opened.stale => {
            reseal(server, &saved, &opened.plain).await;
            (1, 0)
        }
        Some(_) => (0, 0),
        None => (0, 1),
    }
}

pub fn openai_body(model: &str, system: &str, messages: &[(String, String)]) -> Value {
    let mut all = vec![json!({ "role": "system", "content": system })];
    all.extend(
        messages
            .iter()
            .map(|(role, content)| json!({ "role": role, "content": content })),
    );
    json!({ "model": model, "messages": all })
}

pub fn anthropic_body(model: &str, system: &str, messages: &[(String, String)]) -> Value {
    json!({
        "model": model,
        "max_tokens": MAX_TOKENS,
        "system": system,
        "messages": messages
            .iter()
            .map(|(role, content)| json!({ "role": role, "content": content }))
            .collect::<Vec<_>>(),
    })
}

pub fn parse_openai(reply: &Value) -> Result<String, String> {
    reply["choices"][0]["message"]["content"]
        .as_str()
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
        .ok_or_else(|| "the service returned no answer".to_string())
}

/// Only text blocks count: a reply can also carry thinking blocks.
pub fn parse_anthropic(reply: &Value) -> Result<String, String> {
    if reply["stop_reason"].as_str() == Some("refusal") {
        return Err("the service declined to answer".to_string());
    }
    let text = reply["content"]
        .as_array()
        .map(|blocks| {
            blocks
                .iter()
                .filter(|block| block["type"].as_str() == Some("text"))
                .filter_map(|block| block["text"].as_str())
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();
    let text = text.trim();
    if text.is_empty() {
        Err("the service returned no answer".to_string())
    } else {
        Ok(text.to_string())
    }
}

/// Asks the configured model. `messages` are `(role, text)`, oldest first.
pub async fn complete(
    server: &Server,
    settings: &AiSettings,
    system: &str,
    messages: &[(String, String)],
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|err| err.to_string())?;
    let key = provider_key(server, settings).await;
    let request = if settings.kind == "anthropic" {
        let mut request = client
            .post(format!("{}/v1/messages", settings.endpoint))
            .header("anthropic-version", ANTHROPIC_VERSION)
            .json(&anthropic_body(&settings.model, system, messages));
        if let Some(key) = &key {
            request = request.header("x-api-key", key.as_str());
        }
        request
    } else {
        let mut request = client
            .post(format!("{}/chat/completions", settings.endpoint))
            .json(&openai_body(&settings.model, system, messages));
        if let Some(key) = &key {
            request = request.bearer_auth(key);
        }
        request
    };
    let response = request.send().await.map_err(|err| err.to_string())?;
    let status = response.status();
    let body: Value = response.json().await.map_err(|err| err.to_string())?;
    if !status.is_success() {
        return Err(format!("the service answered {status}"));
    }
    if settings.kind == "anthropic" {
        parse_anthropic(&body)
    } else {
        parse_openai(&body)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn() -> Vec<(String, String)> {
        vec![("user".to_string(), "How do I add someone?".to_string())]
    }

    #[test]
    fn settings_are_checked_before_saving() {
        assert_eq!(
            settings_problem("openai", "http://ollama:11434/v1", "llama"),
            None
        );
        assert_eq!(
            settings_problem("anthropic", "https://api.anthropic.com", "a-model"),
            None
        );
        assert!(settings_problem("other", "https://x.test", "m").is_some());
        assert!(settings_problem("openai", "ftp://x.test", "m").is_some());
        assert!(settings_problem("openai", "https://x.test", " ").is_some());
    }

    #[test]
    fn the_openai_request_puts_the_instructions_first() {
        let body = openai_body("m", "Be brief.", &turn());
        assert_eq!(body["model"], "m");
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][1]["content"], "How do I add someone?");
    }

    #[test]
    fn the_anthropic_request_keeps_instructions_apart_and_sends_no_sampling() {
        let body = anthropic_body("m", "Be brief.", &turn());
        assert_eq!(body["system"], "Be brief.");
        assert_eq!(body["messages"][0]["role"], "user");
        assert!(body["max_tokens"].as_u64().unwrap() > 0);
        assert!(body.get("temperature").is_none());
    }

    #[test]
    fn answers_are_read_from_either_service() {
        assert_eq!(
            parse_openai(&json!({"choices":[{"message":{"content":" Hello "}}]})).unwrap(),
            "Hello"
        );
        assert!(parse_openai(&json!({"choices":[]})).is_err());
        assert_eq!(
            parse_anthropic(&json!({"stop_reason":"end_turn","content":[{"type":"thinking","thinking":""},{"type":"text","text":"Hello"}]})).unwrap(),
            "Hello"
        );
        assert!(parse_anthropic(&json!({"stop_reason":"refusal","content":[]})).is_err());
        assert!(parse_anthropic(&json!({"content":[{"type":"thinking","thinking":"x"}]})).is_err());
    }
}
