//! `/api/brand/<domain>`: a domain's logo (`common::brand`).
//!
//! `GET` is public, because the sign-in page shows it. `POST` (the image as the body)
//! and `DELETE` are for whoever manages that domain: the server's administrators, the
//! organisation it belongs to, or its free-plan owner.

use crate::{
    auth::authenticate::Authenticator,
    panel::{owner_domain_id, problem, reply},
};
use common::{
    Server,
    auth::AccessToken,
    brand::{clear_logo, logo, logo_problem, set_logo},
    orgs::org_for_admin,
};
use http_proto::{HttpRequest, HttpResponse, HttpSessionData};
use hyper::{Method, StatusCode};
use registry::schema::enums::Permission;
use serde_json::json;
use types::id::Id;

pub(crate) async fn may_manage(server: &Server, token: &AccessToken, domain_id: u32) -> trc::Result<bool> {
    if token.has_permission(Permission::SysDomainUpdate) {
        return Ok(true);
    }
    let account_id = token.account_id();
    let domain = Id::from(domain_id);
    if org_for_admin(server, &Id::from(account_id).to_string())
        .await?
        .is_some_and(|org| org.has_domain(&domain.to_string()))
    {
        return Ok(true);
    }
    Ok(owner_domain_id(server, account_id).await? == Some(domain))
}

pub trait BrandApi: Sync + Send {
    fn handle_brand_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        path: &[&str],
        body: Option<Vec<u8>>,
    ) -> impl Future<Output = trc::Result<HttpResponse>> + Send;
}

impl BrandApi for Server {
    async fn handle_brand_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        path: &[&str],
        body: Option<Vec<u8>>,
    ) -> trc::Result<HttpResponse> {
        let [name] = path else {
            return Err(trc::ResourceEvent::NotFound.into_err());
        };
        let Some(domain) = self.domain(&name.to_lowercase()).await? else {
            return Err(trc::ResourceEvent::NotFound.into_err());
        };

        if req.method() == Method::GET {
            return match logo(self, domain.id).await? {
                Some((kind, bytes)) => Ok(HttpResponse::new(StatusCode::OK)
                    .with_content_type(kind)
                    .with_binary_body(bytes)
                    .with_header("Cache-Control", "public, max-age=300")
                    .with_header("X-Content-Type-Options", "nosniff")),
                None => Err(trc::ResourceEvent::NotFound.into_err()),
            };
        }

        let (_in_flight, access_token) = self.authenticate_headers(req, session).await?;
        if !may_manage(self, &access_token, domain.id).await? {
            return problem(
                StatusCode::FORBIDDEN,
                "notYourDomain",
                "You do not manage that domain.",
            );
        }

        match req.method() {
            &Method::POST => {
                let bytes = body.unwrap_or_default();
                if let Some(reason) = logo_problem(&bytes) {
                    return problem(StatusCode::BAD_REQUEST, "invalidLogo", reason);
                }
                set_logo(self, domain.id, &bytes).await?;
                reply(json!({ "domain": name }))
            }
            &Method::DELETE => {
                clear_logo(self, domain.id).await?;
                reply(json!({ "domain": name }))
            }
            _ => Err(trc::ResourceEvent::NotFound.into_err()),
        }
    }
}
