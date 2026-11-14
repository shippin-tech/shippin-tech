//! Letting an identity provider manage a domain's people over SCIM, written for
//! shippin.tech from RFC 7643 and RFC 7644: our own open code.
//!
//! Each domain has its own bearer token, stored only as a hash and good only for that
//! domain. This module holds the tokens, the small amount of state SCIM needs beside the
//! account, and the parsing of what a provider sends.

use crate::Server;
use serde_json::Value;
use sha2::{Digest, Sha256};
use store::{
    Deserialize as StoreDeserialize, ValueKey,
    rand::{RngExt, distr::Alphanumeric, rng},
    write::{BatchBuilder, InMemoryClass, Operation, ValueClass, ValueOp},
};
use trc::AddContext;

pub const KV_PROVISIONING: u8 = 53;
const TAG_TOKEN: u8 = b't';
const TAG_INACTIVE: u8 = b'x';
const TAG_EXTERNAL: u8 = b'e';
const FOREVER: [u8; 8] = u64::MAX.to_be_bytes();

struct Raw(Vec<u8>);

impl StoreDeserialize for Raw {
    fn deserialize(bytes: &[u8]) -> trc::Result<Self> {
        Ok(Raw(bytes.to_vec()))
    }
}

fn key(tag: u8, id: u32) -> ValueClass {
    let mut key = vec![KV_PROVISIONING, tag];
    key.extend_from_slice(&id.to_be_bytes());
    ValueClass::InMemory(InMemoryClass::Key(key))
}

async fn get(server: &Server, tag: u8, id: u32) -> trc::Result<Option<Vec<u8>>> {
    Ok(server
        .store()
        .get_value::<Raw>(ValueKey::from(key(tag, id)))
        .await
        .caused_by(trc::location!())?
        .and_then(|value| value.0.get(8..).map(<[u8]>::to_vec)))
}

async fn put(server: &Server, tag: u8, id: u32, value: Option<&[u8]>) -> trc::Result<()> {
    let mut batch = BatchBuilder::new();
    batch.any_op(Operation::Value {
        class: key(tag, id),
        op: match value {
            Some(value) => {
                let mut stored = FOREVER.to_vec();
                stored.extend_from_slice(value);
                ValueOp::Set(stored)
            }
            None => ValueOp::Clear,
        },
    });
    server
        .store()
        .write(batch.build_all())
        .await
        .caused_by(trc::location!())
        .map(|_| ())
}

fn hash_token(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

fn random_text(length: usize) -> String {
    rng()
        .sample_iter(Alphanumeric)
        .take(length)
        .map(char::from)
        .collect()
}

fn domain_in_token(token: &str) -> Option<u32> {
    token.strip_prefix("scim.")?.split_once('.')?.0.parse().ok()
}

/// Makes a new token for a domain, replacing any other. Only this return value holds it.
pub async fn issue_token(server: &Server, domain_id: u32) -> trc::Result<String> {
    let token = format!("scim.{domain_id}.{}", random_text(48));
    put(server, TAG_TOKEN, domain_id, Some(&hash_token(&token))).await?;
    Ok(token)
}

pub async fn revoke_token(server: &Server, domain_id: u32) -> trc::Result<()> {
    put(server, TAG_TOKEN, domain_id, None).await
}

pub async fn has_token(server: &Server, domain_id: u32) -> trc::Result<bool> {
    Ok(get(server, TAG_TOKEN, domain_id).await?.is_some())
}

/// The domain this token is good for, if it is good for one.
pub async fn domain_for_token(server: &Server, token: &str) -> trc::Result<Option<u32>> {
    let Some(domain_id) = domain_in_token(token) else {
        return Ok(None);
    };
    Ok(get(server, TAG_TOKEN, domain_id)
        .await?
        .filter(|stored| *stored == hash_token(token))
        .map(|_| domain_id))
}

pub async fn is_inactive(server: &Server, account_id: u32) -> trc::Result<bool> {
    Ok(get(server, TAG_INACTIVE, account_id).await?.is_some())
}

pub async fn set_inactive(server: &Server, account_id: u32, inactive: bool) -> trc::Result<()> {
    put(
        server,
        TAG_INACTIVE,
        account_id,
        inactive.then_some(&[1u8][..]),
    )
    .await
}

pub async fn external_id(server: &Server, account_id: u32) -> trc::Result<Option<String>> {
    Ok(get(server, TAG_EXTERNAL, account_id)
        .await?
        .and_then(|value| String::from_utf8(value).ok()))
}

pub async fn set_external_id(
    server: &Server,
    account_id: u32,
    external: Option<&str>,
) -> trc::Result<()> {
    put(
        server,
        TAG_EXTERNAL,
        account_id,
        external.map(str::as_bytes),
    )
    .await
}

/// What is left to tidy once an account is destroyed.
pub async fn forget_account(server: &Server, account_id: u32) -> trc::Result<()> {
    put(server, TAG_INACTIVE, account_id, None).await?;
    put(server, TAG_EXTERNAL, account_id, None).await
}

/// `attribute eq "value"`, the one filter providers rely on.
pub fn parse_filter(filter: &str) -> Option<(String, String)> {
    let filter = filter.trim();
    let (attribute, rest) = filter.split_once(char::is_whitespace)?;
    let rest = rest.trim_start();
    let (op, value) = rest.split_once(char::is_whitespace)?;
    if !op.eq_ignore_ascii_case("eq") {
        return None;
    }
    let value = value.trim().strip_prefix('"')?.strip_suffix('"')?;
    Some((attribute.to_string(), value.replace("\\\"", "\"")))
}

/// Providers send booleans as JSON booleans or, in Microsoft's case, as strings.
pub fn as_bool(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(flag) => Some(*flag),
        Value::String(text) if text.eq_ignore_ascii_case("true") => Some(true),
        Value::String(text) if text.eq_ignore_ascii_case("false") => Some(false),
        _ => None,
    }
}

#[derive(Debug, Default, PartialEq)]
pub struct UserChange {
    pub active: Option<bool>,
    pub display: Option<String>,
    pub password: Option<String>,
    pub external: Option<String>,
}

impl UserChange {
    fn apply(&mut self, path: &str, value: &Value) {
        match path.to_ascii_lowercase().as_str() {
            "active" => self.active = as_bool(value),
            "displayname" | "name.formatted" => {
                self.display = value.as_str().map(str::to_string);
            }
            "name" => {
                self.display = value
                    .get("formatted")
                    .and_then(Value::as_str)
                    .map(str::to_string);
            }
            "password" => self.password = value.as_str().map(str::to_string),
            "externalid" => self.external = value.as_str().map(str::to_string),
            _ => {}
        }
    }

    /// A full resource, as POST and PUT send.
    pub fn from_resource(resource: &Value) -> Self {
        let mut change = UserChange::default();
        if let Some(fields) = resource.as_object() {
            for (name, value) in fields {
                change.apply(name, value);
            }
        }
        change
    }

    /// A PATCH. A `displayName` set directly wins over one inside `name`.
    pub fn from_patch(operations: &[Value]) -> Self {
        let mut change = UserChange::default();
        for operation in operations {
            if operation
                .get("op")
                .and_then(Value::as_str)
                .is_some_and(|op| op.eq_ignore_ascii_case("remove"))
            {
                continue;
            }
            let value = operation.get("value").unwrap_or(&Value::Null);
            match operation.get("path").and_then(Value::as_str) {
                Some(path) => change.apply(path, value),
                None => {
                    if let Some(fields) = value.as_object() {
                        for (name, value) in fields {
                            change.apply(name, value);
                        }
                    }
                }
            }
        }
        change
    }
}

fn member_values(value: &Value) -> Vec<String> {
    match value {
        Value::Array(items) => items
            .iter()
            .filter_map(|item| item.get("value").and_then(Value::as_str))
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    }
}

/// `members[value eq "id"]`
fn member_in_path(path: &str) -> Option<String> {
    let inner = path.strip_prefix("members[")?.strip_suffix(']')?;
    let (attribute, value) = parse_filter(inner)?;
    attribute.eq_ignore_ascii_case("value").then_some(value)
}

#[derive(Debug, Default, PartialEq)]
pub struct GroupChange {
    pub display: Option<String>,
    pub external: Option<String>,
    pub set: Option<Vec<String>>,
    pub add: Vec<String>,
    pub remove: Vec<String>,
}

impl GroupChange {
    pub fn from_resource(resource: &Value) -> Self {
        GroupChange {
            display: resource
                .get("displayName")
                .and_then(Value::as_str)
                .map(str::to_string),
            external: resource
                .get("externalId")
                .and_then(Value::as_str)
                .map(str::to_string),
            set: resource.get("members").map(member_values),
            ..GroupChange::default()
        }
    }

    pub fn from_patch(operations: &[Value]) -> Self {
        let mut change = GroupChange::default();
        for operation in operations {
            let op = operation
                .get("op")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_ascii_lowercase();
            let value = operation.get("value").unwrap_or(&Value::Null);
            let path = operation.get("path").and_then(Value::as_str);
            match (op.as_str(), path) {
                ("remove", Some(path)) => match member_in_path(path) {
                    Some(member) => change.remove.push(member),
                    None if path.eq_ignore_ascii_case("members") => {
                        let members = member_values(value);
                        if members.is_empty() {
                            change.set = Some(Vec::new());
                        } else {
                            change.remove.extend(members);
                        }
                    }
                    None => {}
                },
                ("add", Some(path)) if path.eq_ignore_ascii_case("members") => {
                    change.add.extend(member_values(value));
                }
                ("replace", Some(path)) if path.eq_ignore_ascii_case("members") => {
                    change.set = Some(member_values(value));
                }
                (_, Some(path)) if path.eq_ignore_ascii_case("displayName") => {
                    change.display = value.as_str().map(str::to_string);
                }
                (_, Some(path)) if path.eq_ignore_ascii_case("externalId") => {
                    change.external = value.as_str().map(str::to_string);
                }
                ("add" | "replace", None) => {
                    if let Some(name) = value.get("displayName").and_then(Value::as_str) {
                        change.display = Some(name.to_string());
                    }
                    if let Some(external) = value.get("externalId").and_then(Value::as_str) {
                        change.external = Some(external.to_string());
                    }
                    if let Some(members) = value.get("members") {
                        if op == "add" {
                            change.add.extend(member_values(members));
                        } else {
                            change.set = Some(member_values(members));
                        }
                    }
                }
                _ => {}
            }
        }
        change
    }
}

/// A group's address, from whatever the provider calls it.
pub fn group_name(display: &str) -> Option<String> {
    let name: String = display
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let name = name
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    (!name.is_empty() && name.len() <= 64).then_some(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn tokens_name_their_domain() {
        assert_eq!(domain_in_token("scim.42.abc"), Some(42));
        assert_eq!(domain_in_token("scim.x.abc"), None);
        assert_eq!(domain_in_token("bearer"), None);
        assert_ne!(hash_token("a"), hash_token("b"));
    }

    #[test]
    fn the_filter_providers_send_is_understood() {
        assert_eq!(
            parse_filter(r#"userName eq "a@b.co""#),
            Some(("userName".into(), "a@b.co".into()))
        );
        assert_eq!(
            parse_filter(r#"externalId EQ "x y""#),
            Some(("externalId".into(), "x y".into()))
        );
        assert_eq!(parse_filter(r#"userName sw "a""#), None);
        assert_eq!(parse_filter("nonsense"), None);
        assert_eq!(parse_filter(r#"userName eq noquotes"#), None);
    }

    #[test]
    fn microsoft_style_booleans_are_read() {
        assert_eq!(as_bool(&json!(true)), Some(true));
        assert_eq!(as_bool(&json!("False")), Some(false));
        assert_eq!(as_bool(&json!("maybe")), None);
        assert_eq!(as_bool(&json!(1)), None);
    }

    #[test]
    fn user_changes_come_from_either_shape_of_patch() {
        assert_eq!(
            UserChange::from_patch(&[json!({"op":"Replace","path":"active","value":"False"})]),
            UserChange {
                active: Some(false),
                ..UserChange::default()
            }
        );
        assert_eq!(
            UserChange::from_patch(&[
                json!({"op":"replace","value":{"active":true,"displayName":"Ada","externalId":"e1"}})
            ]),
            UserChange {
                active: Some(true),
                display: Some("Ada".into()),
                external: Some("e1".into()),
                password: None
            }
        );
        assert_eq!(
            UserChange::from_patch(&[json!({"op":"remove","path":"active"})]),
            UserChange::default()
        );
    }

    #[test]
    fn a_full_user_is_read() {
        let change = UserChange::from_resource(
            &json!({"userName":"a@b.co","name":{"formatted":"Ada L"},"password":"p","active":false}),
        );
        assert_eq!(change.display.as_deref(), Some("Ada L"));
        assert_eq!(change.password.as_deref(), Some("p"));
        assert_eq!(change.active, Some(false));
    }

    #[test]
    fn group_members_change_in_every_shape_providers_use() {
        let added = GroupChange::from_patch(&[
            json!({"op":"Add","path":"members","value":[{"value":"u1"},{"value":"u2"}]}),
        ]);
        assert_eq!(added.add, vec!["u1", "u2"]);
        let removed =
            GroupChange::from_patch(&[json!({"op":"Remove","path":"members[value eq \"u1\"]"})]);
        assert_eq!(removed.remove, vec!["u1"]);
        let removed_list = GroupChange::from_patch(&[
            json!({"op":"remove","path":"members","value":[{"value":"u2"}]}),
        ]);
        assert_eq!(removed_list.remove, vec!["u2"]);
        let cleared = GroupChange::from_patch(&[json!({"op":"remove","path":"members"})]);
        assert_eq!(cleared.set, Some(vec![]));
        let replaced = GroupChange::from_patch(&[
            json!({"op":"replace","value":{"displayName":"Sales","members":[{"value":"u3"}]}}),
        ]);
        assert_eq!(replaced.display.as_deref(), Some("Sales"));
        assert_eq!(replaced.set, Some(vec!["u3".to_string()]));
    }

    #[test]
    fn group_names_become_addresses() {
        assert_eq!(group_name("Sales Team"), Some("sales-team".into()));
        assert_eq!(group_name("  R&D -- West "), Some("r-d-west".into()));
        assert_eq!(group_name("!!!"), None);
        assert_eq!(group_name(&"a".repeat(65)), None);
    }
}
