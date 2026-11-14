//! `/api/calendar-templates`: reword the calendar emails (`common::calendar_templates`).
//!
//! `GET` lists them, `POST /<kind>` saves one and `DELETE /<kind>` goes back to the
//! built-in one. For the server's administrators.

use crate::{
    auth::authenticate::Authenticator,
    panel::{input, problem, reply, text},
};
use common::{
    Server,
    calendar_templates::{TemplateKind, reset, save, saved, template_problem},
};
use http_proto::{HttpRequest, HttpResponse, HttpSessionData};
use hyper::{Method, StatusCode};
use registry::schema::enums::Permission;
use serde_json::json;

pub trait CalendarTemplatesApi: Sync + Send {
    fn handle_calendar_templates_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        path: &[&str],
        body: Option<Vec<u8>>,
    ) -> impl Future<Output = trc::Result<HttpResponse>> + Send;
}

impl CalendarTemplatesApi for Server {
    async fn handle_calendar_templates_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        path: &[&str],
        body: Option<Vec<u8>>,
    ) -> trc::Result<HttpResponse> {
        let (_in_flight, access_token) = self.authenticate_headers(req, session).await?;
        access_token.enforce_permission(Permission::SysCalendarSchedulingUpdate)?;
        let body = input(&body);

        match (path, req.method()) {
            ([] | [""], &Method::GET) => {
                let mut templates = Vec::new();
                for kind in TemplateKind::ALL {
                    let custom = saved(self, kind).await?;
                    templates.push(json!({
                        "id": kind.id(),
                        "builtIn": kind.default_source(),
                        "custom": custom,
                    }));
                }
                reply(json!({ "templates": templates }))
            }
            ([id], method) => {
                let Some(kind) = TemplateKind::parse(id) else {
                    return Err(trc::ResourceEvent::NotFound.into_err());
                };
                match method {
                    &Method::POST => {
                        let source = text(&body, "source");
                        if let Some(reason) = template_problem(source) {
                            return problem(StatusCode::BAD_REQUEST, "invalid", reason);
                        }
                        save(self, kind, source).await?;
                        reply(json!({ "saved": kind.id() }))
                    }
                    &Method::DELETE => {
                        reset(self, kind).await?;
                        reply(json!({ "reset": kind.id() }))
                    }
                    _ => Err(trc::ResourceEvent::NotFound.into_err()),
                }
            }
            _ => Err(trc::ResourceEvent::NotFound.into_err()),
        }
    }
}
