//! First-run setup: turn the printed setup key into a real administrator.
//!
//! `GET /api/setup` says whether setup is pending. `POST /api/setup/admin`, called
//! by someone signed in as "admin" with the setup key, creates the administrator's
//! domain if needed and the administrator account, then retires the key for good.

use crate::{
    auth::authenticate::Authenticator,
    panel::{acceptable_password, internal_call, normalize_domain, normalize_local_part, set_created},
};
use common::{
    Server,
    auth::{AccessToken, RECOVERY_ADMIN_ID},
    manager::setup_key::retire_setup_key,
};
use http_proto::{HttpRequest, HttpResponse, HttpSessionData, JsonResponse, ToHttpResponse};
use hyper::{Method, StatusCode};
use registry::schema::prelude::{ObjectType, Property};
use serde_json::{Value, json};

fn reply(status: StatusCode, value: Value) -> trc::Result<HttpResponse> {
    Ok(JsonResponse::with_status(status, value).no_cache().into_http_response())
}

fn problem(status: StatusCode, code: &str, message: &str) -> trc::Result<HttpResponse> {
    reply(status, json!({ "error": code, "message": message }))
}

/// Splits "name@domain" into a valid mailbox name and domain.
pub fn split_admin_email(input: &str) -> Option<(String, String)> {
    let (local, domain) = input.trim().rsplit_once('@')?;
    Some((normalize_local_part(local)?, normalize_domain(domain)?))
}

pub trait SetupApi: Sync + Send {
    fn handle_setup_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        path: &[String],
        body: Option<Vec<u8>>,
    ) -> impl Future<Output = trc::Result<HttpResponse>> + Send;
}

impl SetupApi for Server {
    async fn handle_setup_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        path: &[String],
        body: Option<Vec<u8>>,
    ) -> trc::Result<HttpResponse> {
        let pending = self.registry().setup_key().is_some();
        match (path.first().map(String::as_str).unwrap_or_default(), req.method()) {
            ("", &Method::GET) => reply(StatusCode::OK, json!({ "pending": pending })),
            ("admin", &Method::POST) => {
                let (_in_flight, access_token) = self.authenticate_headers(req, session).await?;
                if !pending {
                    return problem(StatusCode::CONFLICT, "done", "This server already has an administrator.");
                }
                if access_token.account_id() != RECOVERY_ADMIN_ID {
                    return problem(StatusCode::FORBIDDEN, "notSetup", "Sign in as admin with the setup key first.");
                }
                let body = body
                    .as_deref()
                    .and_then(|bytes| serde_json::from_slice::<Value>(bytes).ok())
                    .unwrap_or(Value::Null);
                let email = body.get("email").and_then(Value::as_str).unwrap_or_default();
                let password = body.get("password").and_then(Value::as_str).unwrap_or_default();
                let Some((name, domain)) = split_admin_email(email) else {
                    return problem(StatusCode::BAD_REQUEST, "invalidEmail", "Enter an address like you@example.com.");
                };
                if let Err(reason) = acceptable_password(password) {
                    return problem(StatusCode::BAD_REQUEST, "weakPassword", reason);
                }
                create_admin(self, session, &name, &domain, password).await
            }
            _ => Err(trc::ResourceEvent::NotFound.into_err()),
        }
    }
}

async fn create_admin(
    server: &Server,
    session: &HttpSessionData,
    name: &str,
    domain: &str,
    password: &str,
) -> trc::Result<HttpResponse> {
    let token = AccessToken::new_admin();
    let existing = server
        .registry()
        .primary_key(ObjectType::Domain.into(), Property::Name, domain.as_bytes().to_vec())
        .await?;
    let (domain_id, created_domain) = match existing {
        Some(id) => (id.id().to_string(), false),
        None => {
            let response = internal_call(
                server,
                &token,
                session,
                "x:Domain/set",
                json!({ "create": { "d": { "name": domain, "description": "Server administrator's domain" } } }),
            )
            .await?;
            match set_created(&response, "d") {
                Ok(created) => (
                    created.get("id").and_then(Value::as_str).unwrap_or_default().to_string(),
                    true,
                ),
                Err(reason) => return problem(StatusCode::BAD_REQUEST, "domainRejected", &reason),
            }
        }
    };
    let response = internal_call(
        server,
        &token,
        session,
        "x:Account/set",
        json!({ "create": { "a": {
            "@type": "User",
            "name": name,
            "domainId": domain_id,
            "credentials": { "0": { "@type": "Password", "secret": password } },
            "roles": { "@type": "Admin" },
            "description": "Server administrator",
        } } }),
    )
    .await?;
    if let Err(reason) = set_created(&response, "a") {
        if created_domain {
            let _ = internal_call(server, &token, session, "x:Domain/set", json!({ "destroy": [domain_id] })).await;
        }
        return problem(StatusCode::BAD_REQUEST, "adminRejected", &reason);
    }
    retire_setup_key(server.registry());
    reply(StatusCode::OK, json!({ "email": format!("{name}@{domain}") }))
}

#[cfg(test)]
mod tests {
    use super::split_admin_email;

    #[test]
    fn admin_email_is_split_and_checked() {
        assert_eq!(
            split_admin_email(" Jesse@Shippin.Tech "),
            Some(("jesse".to_string(), "shippin.tech".to_string()))
        );
        assert_eq!(split_admin_email("admin"), None);
        assert_eq!(split_admin_email("a@localhost"), None);
        assert_eq!(split_admin_email("bad name@example.com"), None);
    }
}
