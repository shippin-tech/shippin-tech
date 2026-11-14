//! `/api/recover`: bring back deleted accounts and messages (`common::recover`,
//! `email::message::recover`). For the server's administrators.
//!
//! `GET accounts`, `POST accounts/<id>/restore`, `GET messages/<account>?before=<id>`,
//! `POST messages/<account>/<id>/restore`.

use crate::auth::authenticate::Authenticator;
use common::{
    Server,
    recover::{keep_days, list_held, restore_held},
};
use email::message::recover::{list_kept, restore_kept};
use http_proto::{HttpRequest, HttpResponse, HttpSessionData, JsonResponse, ToHttpResponse};
use hyper::{Method, StatusCode};
use registry::schema::enums::Permission;
use serde_json::{Value, json};
use types::id::Id;
use utils::url_params::UrlParams;

fn reply(status: StatusCode, value: Value) -> trc::Result<HttpResponse> {
    Ok(JsonResponse::with_status(status, value)
        .no_cache()
        .into_http_response())
}

fn refused(message: impl Into<String>) -> trc::Result<HttpResponse> {
    reply(
        StatusCode::CONFLICT,
        json!({ "error": "conflict", "message": message.into() }),
    )
}

fn not_found() -> trc::Result<HttpResponse> {
    Err(trc::ResourceEvent::NotFound.into_err())
}

pub trait RecoverApi: Sync + Send {
    fn handle_recover_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        path: &[&str],
    ) -> impl Future<Output = trc::Result<HttpResponse>> + Send;
}

impl RecoverApi for Server {
    async fn handle_recover_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        path: &[&str],
    ) -> trc::Result<HttpResponse> {
        let (_in_flight, access_token) = self.authenticate_headers(req, session).await?;

        match (path, req.method()) {
            (["accounts"], &Method::GET) => {
                access_token.enforce_permission(Permission::SysAccountGet)?;
                reply(
                    StatusCode::OK,
                    json!({ "keepDays": keep_days(), "accounts": list_held(self).await? }),
                )
            }
            (["accounts", id, "restore"], &Method::POST) => {
                access_token.enforce_permission(Permission::SysAccountCreate)?;
                let Ok(id) = id.parse::<Id>() else {
                    return not_found();
                };
                match restore_held(self, id).await? {
                    Ok(()) => reply(StatusCode::OK, json!({ "restored": id.to_string() })),
                    Err(message) => refused(message),
                }
            }
            (["messages", account], &Method::GET) => {
                access_token.enforce_permission(Permission::SysAccountUpdate)?;
                let Ok(account) = account.parse::<Id>() else {
                    return not_found();
                };
                let params = UrlParams::new(req.uri().query());
                reply(
                    StatusCode::OK,
                    json!({ "messages": list_kept(self, account.document_id(), params.get("before")).await? }),
                )
            }
            (["messages", account, id, "restore"], &Method::POST) => {
                access_token.enforce_permission(Permission::SysAccountUpdate)?;
                let Ok(account) = account.parse::<Id>() else {
                    return not_found();
                };
                match restore_kept(self, account.document_id(), id).await? {
                    Ok(()) => reply(StatusCode::OK, json!({ "restored": id })),
                    Err(message) => refused(message),
                }
            }
            _ => not_found(),
        }
    }
}
