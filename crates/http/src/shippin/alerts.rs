//! `/api/alerts`: administrators' alert rules (`services::alerts`).
//!
//! `GET` lists rules and the metrics they can watch, `POST` saves a rule,
//! `DELETE /api/alerts/<id>` removes one, `POST /api/alerts/check` checks them now.

use crate::auth::authenticate::Authenticator;
use common::Server;
use http_proto::{HttpRequest, HttpResponse, HttpSessionData, JsonResponse, ToHttpResponse};
use hyper::{Method, StatusCode};
use registry::schema::enums::Permission;
use serde_json::{Value, json};
use services::alerts::{self, AlertRule};
use trc::MetricType;

fn reply(status: StatusCode, value: Value) -> trc::Result<HttpResponse> {
    Ok(JsonResponse::with_status(status, value)
        .no_cache()
        .into_http_response())
}

pub trait AlertsApi: Sync + Send {
    fn handle_alerts_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        path: &[&str],
        body: Option<Vec<u8>>,
    ) -> impl Future<Output = trc::Result<HttpResponse>> + Send;
}

impl AlertsApi for Server {
    async fn handle_alerts_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        path: &[&str],
        body: Option<Vec<u8>>,
    ) -> trc::Result<HttpResponse> {
        let (_in_flight, access_token) = self.authenticate_headers(req, session).await?;
        access_token.enforce_permission(Permission::LiveMetrics)?;

        match (path, req.method()) {
            ([] | [""], &Method::GET) => {
                let metrics = MetricType::variants()
                    .iter()
                    .map(|metric| json!({ "name": metric.as_str(), "description": metric.description() }))
                    .collect::<Vec<_>>();
                reply(
                    StatusCode::OK,
                    json!({ "rules": alerts::list_rules(self).await?, "metrics": metrics }),
                )
            }
            ([] | [""], &Method::POST) => {
                let Some(rule) = body
                    .as_deref()
                    .and_then(|bytes| serde_json::from_slice::<AlertRule>(bytes).ok())
                else {
                    return reply(
                        StatusCode::BAD_REQUEST,
                        json!({ "error": "invalid", "message": "That alert could not be read." }),
                    );
                };
                match alerts::save_rule(self, rule).await? {
                    Ok(rule) => reply(StatusCode::OK, json!(rule)),
                    Err(message) => reply(
                        StatusCode::BAD_REQUEST,
                        json!({ "error": "invalid", "message": message }),
                    ),
                }
            }
            (["check"], &Method::POST) => reply(
                StatusCode::OK,
                json!({ "results": alerts::check_alerts(self).await? }),
            ),
            ([id], &Method::DELETE) => {
                alerts::delete_rule(self, id).await?;
                reply(StatusCode::OK, json!({ "deleted": id }))
            }
            _ => Err(trc::ResourceEvent::NotFound.into_err()),
        }
    }
}
