//! `/api/masked`: a person's own masked addresses (`common::masks`).
//!
//! `GET` lists them, `POST` makes one, `POST /api/masked/<local part>` changes one,
//! `DELETE /api/masked/<local part>` removes one. Only ever the signed-in account's own.

use crate::auth::authenticate::Authenticator;
use common::{Server, masks};
use http_proto::{HttpRequest, HttpResponse, HttpSessionData, JsonResponse, ToHttpResponse};
use hyper::{Method, StatusCode};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Debug, Default, Deserialize)]
struct Change {
    enabled: Option<bool>,
    label: Option<String>,
}

fn reply(status: StatusCode, value: Value) -> trc::Result<HttpResponse> {
    Ok(JsonResponse::with_status(status, value)
        .no_cache()
        .into_http_response())
}

pub trait MaskedApi: Sync + Send {
    fn handle_masked_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        path: &[&str],
        body: Option<Vec<u8>>,
    ) -> impl Future<Output = trc::Result<HttpResponse>> + Send;
}

impl MaskedApi for Server {
    async fn handle_masked_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        path: &[&str],
        body: Option<Vec<u8>>,
    ) -> trc::Result<HttpResponse> {
        let (_in_flight, access_token) = self.authenticate_headers(req, session).await?;
        let account_id = access_token.account_id();
        let change = body
            .as_deref()
            .and_then(|bytes| serde_json::from_slice::<Change>(bytes).ok())
            .unwrap_or_default();

        match (path, req.method()) {
            ([] | [""], &Method::GET) => reply(
                StatusCode::OK,
                json!({ "limit": masks::limit(), "addresses": masks::list(self, account_id).await? }),
            ),
            ([] | [""], &Method::POST) => {
                match masks::create(
                    self,
                    account_id,
                    change.label.as_deref().unwrap_or_default(),
                )
                .await?
                {
                    Ok(record) => reply(StatusCode::OK, json!(record)),
                    Err(message) => reply(
                        StatusCode::BAD_REQUEST,
                        json!({ "error": "invalid", "message": message }),
                    ),
                }
            }
            ([local], &Method::POST) => match masks::find(self, account_id, local).await? {
                Some(record) => reply(
                    StatusCode::OK,
                    json!(
                        masks::update(self, record, change.enabled, change.label.as_deref())
                            .await?
                    ),
                ),
                None => Err(trc::ResourceEvent::NotFound.into_err()),
            },
            ([local], &Method::DELETE) => match masks::find(self, account_id, local).await? {
                Some(record) => {
                    masks::delete(self, &record).await?;
                    reply(StatusCode::OK, json!({ "deleted": record.address }))
                }
                None => Err(trc::ResourceEvent::NotFound.into_err()),
            },
            _ => Err(trc::ResourceEvent::NotFound.into_err()),
        }
    }
}
