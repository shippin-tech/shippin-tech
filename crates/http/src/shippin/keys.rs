//! `/api/keys`: our services' keys, for the server's administrators (KEYS.md).
//!
//! Shows each service's keys without their bytes, makes the keys a new server still lacks
//! (the "author your keys" step after the install key), and replaces one: made at random,
//! pasted, or kept outside the database in an environment variable or a file. Replacing a
//! key seals that service's values again under the new one before the old one is destroyed.

use crate::{
    auth::authenticate::Authenticator,
    panel::{input, problem, reply, text},
};
use common::{
    Server,
    orgs::is_server_admin,
    shippin::keys::{self, NewKey, Service, Source},
};
use http_proto::{HttpRequest, HttpResponse, HttpSessionData};
use hyper::{Method, StatusCode};
use serde_json::{Value, json};

pub trait KeysApi: Sync + Send {
    fn handle_keys_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        path: &[&str],
        body: Option<Vec<u8>>,
    ) -> impl Future<Output = trc::Result<HttpResponse>> + Send;
}

impl KeysApi for Server {
    async fn handle_keys_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        path: &[&str],
        body: Option<Vec<u8>>,
    ) -> trc::Result<HttpResponse> {
        let (_in_flight, access_token) = self.authenticate_headers(req, session).await?;
        if !is_server_admin(self, access_token.account_id()).await? {
            return problem(
                StatusCode::FORBIDDEN,
                "notAdmin",
                "Only the server's administrators can see or change keys.",
            );
        }
        let body = input(&body);

        match (path, req.method()) {
            ([] | [""], &Method::GET) => {
                let mut services = Vec::new();
                for service in Service::ALL {
                    services.push(json!({
                        "service": service.name(),
                        "keys": keys::describe(self, service).await?,
                    }));
                }
                let (place, made_here) = keys::wrapping_place(self);
                reply(json!({
                    "services": services,
                    "wrapping": {
                        "path": place,
                        "madeHere": made_here,
                        "readable": keys::wrapping_key(self).is_ok(),
                    },
                }))
            }
            (["author"], &Method::POST) => match keys::author_missing(self).await {
                Ok(made) => reply(json!({
                    "made": made.iter().map(|service| service.name()).collect::<Vec<_>>(),
                })),
                Err(reason) => problem(StatusCode::INTERNAL_SERVER_ERROR, "keys", reason),
            },
            ([service, "replace"], &Method::POST) => {
                let Some(service) = Service::parse(service) else {
                    return problem(StatusCode::NOT_FOUND, "unknownService", "There is no such service.");
                };
                let new = match new_key(&body) {
                    Ok(new) => new,
                    Err(reason) => return problem(StatusCode::BAD_REQUEST, "invalid", reason),
                };
                match keys::replace(self, service, new).await {
                    Ok(done) => reply(json!(done)),
                    Err(reason) => problem(StatusCode::BAD_REQUEST, "invalid", reason),
                }
            }
            _ => Err(trc::ResourceEvent::NotFound.into_err()),
        }
    }
}

/// Where a new key comes from: `{"from": "random"}`, `{"from": "value", "value": "<base64>"}`,
/// `{"from": "environmentVariable", "name": "X"}` or `{"from": "file", "path": "/run/secrets/x"}`.
pub fn new_key(body: &Value) -> Result<NewKey, String> {
    match text(body, "from") {
        "" | "random" => Ok(NewKey::Random),
        "value" => keys::decode_key(text(body, "value")).map(NewKey::Value),
        "environmentVariable" => {
            let name = text(body, "name").trim();
            let valid = name
                .chars()
                .next()
                .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
                && name.len() <= 128
                && name
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.');
            if valid {
                Ok(NewKey::Outside(Source::EnvironmentVariable { name: name.to_string() }))
            } else {
                Err("Enter the name of an environment variable, such as SHIPPIN_AI_KEY.".into())
            }
        }
        "file" => {
            let path = text(body, "path").trim();
            if path.starts_with('/') && path.len() <= 1024 && !path.contains('\0') {
                Ok(NewKey::Outside(Source::File { path: path.to_string() }))
            } else {
                Err("Enter the full path of the file, starting with /.".into())
            }
        }
        _ => Err("Choose where the new key comes from.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_key_comes_from_one_named_place() {
        assert!(matches!(new_key(&json!({})), Ok(NewKey::Random)));
        assert!(matches!(new_key(&json!({ "from": "random" })), Ok(NewKey::Random)));
        let pasted = keys::encode_key(&[5; keys::KEY_LEN]);
        assert!(matches!(new_key(&json!({ "from": "value", "value": pasted })), Ok(NewKey::Value(key)) if key == [5; keys::KEY_LEN]));
        assert!(new_key(&json!({ "from": "value", "value": "short" })).is_err());
        assert!(matches!(
            new_key(&json!({ "from": "environmentVariable", "name": "SHIPPIN_AI_KEY" })),
            Ok(NewKey::Outside(Source::EnvironmentVariable { name })) if name == "SHIPPIN_AI_KEY"
        ));
        assert!(new_key(&json!({ "from": "environmentVariable", "name": "1BAD" })).is_err());
        assert!(new_key(&json!({ "from": "environmentVariable", "name": "A=B" })).is_err());
        assert!(matches!(
            new_key(&json!({ "from": "file", "path": "/run/secrets/ai" })),
            Ok(NewKey::Outside(Source::File { path })) if path == "/run/secrets/ai"
        ));
        assert!(new_key(&json!({ "from": "file", "path": "relative/key" })).is_err());
        assert!(new_key(&json!({ "from": "somewhere" })).is_err());
    }
}
