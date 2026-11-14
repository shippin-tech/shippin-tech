//! `GET /api/stats`: the portal dashboard's data.
//!
//! `period=24h|7d|30d|90d`, or `from` and `to` in seconds since 1970 for any
//! range, plus an optional `node` id. Our own endpoint over `common::stats`; it
//! needs no licence key. Only administrators (the `liveMetrics` permission) can
//! read it.

use crate::auth::authenticate::Authenticator;
use common::{
    Server,
    stats::{Period, Range, query},
};
use http_proto::{HttpRequest, HttpResponse, HttpSessionData, JsonResponse, ToHttpResponse};
use hyper::StatusCode;
use registry::schema::enums::Permission;
use serde_json::json;
use utils::url_params::UrlParams;

pub trait StatsApi: Sync + Send {
    fn handle_stats_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
    ) -> impl Future<Output = trc::Result<HttpResponse>> + Send;
}

fn invalid(message: &str) -> trc::Result<HttpResponse> {
    Ok(JsonResponse::with_status(
        StatusCode::BAD_REQUEST,
        json!({ "error": "invalidRange", "message": message }),
    )
    .no_cache()
    .into_http_response())
}

impl StatsApi for Server {
    async fn handle_stats_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
    ) -> trc::Result<HttpResponse> {
        let (_in_flight, access_token) = self.authenticate_headers(req, session).await?;
        access_token.enforce_permission(Permission::LiveMetrics)?;

        let params = UrlParams::new(req.uri().query());
        let range = match (params.get("from"), params.get("to")) {
            (Some(from), Some(to)) => match (from.parse::<u64>(), to.parse::<u64>()) {
                (Ok(from), Ok(to)) => Range::Custom { from, to },
                _ => return invalid("from and to are seconds since 1970."),
            },
            (None, None) => match Period::parse(params.get("period").unwrap_or("24h")) {
                Some(period) => Range::Preset(period),
                None => return invalid("Use 24h, 7d, 30d or 90d, or from and to."),
            },
            _ => return invalid("Give both from and to."),
        };
        let node = match params.get("node") {
            None | Some("") | Some("all") => None,
            Some(node) => match node.parse::<u16>() {
                Ok(node) => Some(node),
                Err(_) => return invalid("node is a node id."),
            },
        };

        match query(self, range, node).await? {
            Ok(stats) => Ok(JsonResponse::new(stats).no_cache().into_http_response()),
            Err(reason) => invalid(reason),
        }
    }
}
