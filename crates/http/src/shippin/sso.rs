//! `/api/sso`: signing in through a domain's own identity provider (`common::sso`).
//!
//! - `GET /api/sso/<domain>` says whether the domain offers it. Public: the sign-in page asks.
//! - `POST /api/sso/begin` starts a sign-in and returns the provider's address.
//! - `GET /api/sso/callback` is where the provider sends the browser back.
//! - `GET`, `POST` and `DELETE /api/sso/<domain>/settings` are for whoever manages the domain.

use crate::{
    auth::{
        authenticate::Authenticator,
        oauth::{
            OAuthCode, OAuthStatus, PkceCodeChallenge, auth::grant_scope,
            registration::ClientRegistrationHandler,
        },
    },
    brand::may_manage,
    panel::{input, problem, reply, text},
};
use common::{
    KV_OAUTH, Server,
    auth::oauth::{
        CLIENT_ID_MAX_LEN, DEVICE_CODE_LEN, client_id::decode_client_id,
        registration::redirect_uri_matches,
    },
    sso::{self, SsoPending},
};
use http_proto::{HttpRequest, HttpResponse, HttpSessionData};
use hyper::{Method, StatusCode, header};
use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
use registry::schema::structs::Account;
use serde_json::{Value, json};
use store::{
    Serialize,
    dispatch::lookup::KeyValue,
    rand::{RngExt, distr::Alphanumeric, rng},
    write::Archiver,
};
use trc::AddContext;
use types::id::Id;
use utils::url_params::UrlParams;

fn redirect(location: &str) -> trc::Result<HttpResponse> {
    Ok(HttpResponse::new(StatusCode::FOUND)
        .with_header(header::LOCATION, location)
        .with_no_store())
}

fn failed(reason: &str) -> trc::Result<HttpResponse> {
    trc::event!(
        Auth(trc::AuthEvent::Failed),
        Details = format!("Domain sign-in failed: {reason}")
    );
    redirect("/login?sso=failed")
}

fn escape(value: &str) -> String {
    utf8_percent_encode(value, NON_ALPHANUMERIC).to_string()
}

/// The same checks a password sign-in makes on the application asking.
fn client_problem(server: &Server, pending: &SsoPending) -> Option<&'static str> {
    if pending.client_id.len() > CLIENT_ID_MAX_LEN {
        return Some("That client is not valid.");
    }
    decode_client_id(server.core.oauth.oauth_key.as_bytes(), &pending.client_id).and_then(|meta| {
        (!meta
            .redirect_uris
            .iter()
            .any(|uri| redirect_uri_matches(uri, &pending.redirect_uri)))
        .then_some("That client is not valid.")
    })
}

pub trait SsoApi: Sync + Send {
    fn handle_sso_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        path: &[&str],
        body: Option<Vec<u8>>,
    ) -> impl Future<Output = trc::Result<HttpResponse>> + Send;

    fn sso_callback(
        &self,
        code: &str,
        state: &str,
        session: &HttpSessionData,
    ) -> impl Future<Output = trc::Result<HttpResponse>> + Send;
}

impl SsoApi for Server {
    async fn handle_sso_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        path: &[&str],
        body: Option<Vec<u8>>,
    ) -> trc::Result<HttpResponse> {
        let body = input(&body);
        match (path, req.method()) {
            (["callback"], &Method::GET) => {
                let params = UrlParams::new(req.uri().query());
                match (params.get("code"), params.get("state")) {
                    (Some(code), Some(state)) => self.sso_callback(code, state, session).await,
                    _ => failed("the provider did not return a code"),
                }
            }
            (["begin"], &Method::POST) => {
                let account = text(&body, "account").trim().to_lowercase();
                let Some(domain) = account
                    .split_once('@')
                    .map(|(_, domain)| domain.to_string())
                else {
                    return problem(
                        StatusCode::BAD_REQUEST,
                        "invalid",
                        "Enter your full address.",
                    );
                };
                let unavailable = || {
                    problem(
                        StatusCode::BAD_REQUEST,
                        "unavailable",
                        "This domain does not offer that sign-in.",
                    )
                };
                let Some(domain) = self.domain(&domain).await? else {
                    return unavailable();
                };
                let Some(settings) = sso::settings(self, domain.id)
                    .await?
                    .filter(|settings| settings.enabled)
                else {
                    return unavailable();
                };
                // Only the proof-key flow, so a stolen code is useless.
                let challenge = text(&body, "codeChallenge");
                if challenge.is_empty() || text(&body, "codeChallengeMethod") != "S256" {
                    return problem(
                        StatusCode::BAD_REQUEST,
                        "invalid",
                        "That request is not valid.",
                    );
                }
                let optional = |name: &str| {
                    body.get(name)
                        .and_then(Value::as_str)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string)
                };
                let pending = SsoPending {
                    domain_id: domain.id,
                    verifier: String::new(),
                    client_id: text(&body, "clientId").to_string(),
                    redirect_uri: text(&body, "redirectUri").to_string(),
                    nonce: optional("nonce"),
                    scope: optional("scope"),
                    code_challenge: challenge.to_string(),
                    state: optional("state"),
                };
                if pending.redirect_uri.is_empty() {
                    return problem(
                        StatusCode::BAD_REQUEST,
                        "invalid",
                        "That request is not valid.",
                    );
                }
                if let Some(reason) = client_problem(self, &pending) {
                    return problem(StatusCode::BAD_REQUEST, "invalid", reason);
                }
                match sso::begin(self, &settings, pending, &account).await {
                    Ok(url) => reply(json!({ "url": url })),
                    Err(reason) => {
                        trc::event!(
                            Auth(trc::AuthEvent::Failed),
                            Details = format!("Domain sign-in could not start: {reason}")
                        );
                        problem(
                            StatusCode::BAD_GATEWAY,
                            "unreachable",
                            "Your organisation's sign-in could not be reached. Use your password or try again.",
                        )
                    }
                }
            }
            ([name], &Method::GET) => {
                let enabled = match self.domain(&name.to_lowercase()).await? {
                    Some(domain) => sso::is_enabled(self, domain.id).await?,
                    None => false,
                };
                reply(json!({ "enabled": enabled }))
            }
            ([name, "settings"], method) => {
                let Some(domain) = self.domain(&name.to_lowercase()).await? else {
                    return Err(trc::ResourceEvent::NotFound.into_err());
                };
                let (_in_flight, access_token) = self.authenticate_headers(req, session).await?;
                if !may_manage(self, &access_token, domain.id).await? {
                    return problem(
                        StatusCode::FORBIDDEN,
                        "notYourDomain",
                        "You do not manage that domain.",
                    );
                }
                match method {
                    &Method::GET => {
                        let saved = sso::settings(self, domain.id).await?;
                        reply(json!({
                            "issuer": saved.as_ref().map(|item| item.issuer.clone()),
                            "clientId": saved.as_ref().map(|item| item.client_id.clone()),
                            "hasSecret": saved.is_some(),
                            "enabled": saved.as_ref().is_some_and(|item| item.enabled),
                            "callback": sso::callback_url(self),
                        }))
                    }
                    &Method::POST => match sso::save_settings(
                        self,
                        domain.id,
                        text(&body, "issuer"),
                        text(&body, "clientId"),
                        text(&body, "clientSecret"),
                        body.get("enabled")
                            .and_then(Value::as_bool)
                            .unwrap_or(false),
                    )
                    .await?
                    {
                        Ok(()) => reply(json!({ "saved": name })),
                        Err(reason) => problem(StatusCode::BAD_REQUEST, "invalid", reason),
                    },
                    &Method::DELETE => {
                        sso::clear_settings(self, domain.id).await?;
                        reply(json!({ "removed": name }))
                    }
                    _ => Err(trc::ResourceEvent::NotFound.into_err()),
                }
            }
            _ => Err(trc::ResourceEvent::NotFound.into_err()),
        }
    }

    async fn sso_callback(
        &self,
        code: &str,
        state: &str,
        _session: &HttpSessionData,
    ) -> trc::Result<HttpResponse> {
        let Some(pending) = sso::take_pending(self, state).await? else {
            return failed("unknown or used state");
        };
        let Some(settings) = sso::settings(self, pending.domain_id)
            .await?
            .filter(|settings| settings.enabled)
        else {
            return failed("the domain no longer offers it");
        };
        let (email, verified) = match sso::identify(
            self,
            &settings,
            pending.domain_id,
            code,
            &pending.verifier,
        )
        .await
        {
            Ok(identity) => identity,
            Err(reason) => return failed(&reason),
        };
        let Some(domain) = self.domain_by_id(pending.domain_id).await? else {
            return failed("the domain has gone");
        };
        let names: Vec<&str> = domain.names.iter().map(|name| name.as_ref()).collect();
        if !sso::email_acceptable(&email, verified, &names) {
            return failed("the provider reported an address outside its domain");
        }
        let Some(account_id) = self.account_id_from_email(&email, false).await? else {
            return failed("no account for that address");
        };
        match self
            .registry()
            .object::<Account>(Id::from(account_id))
            .await?
        {
            Some(Account::User(user)) if user.domain_id.document_id() == pending.domain_id => {}
            _ => return failed("that account is not on this domain"),
        }
        if common::provisioning::is_inactive(self, account_id).await? {
            return failed("that account has been switched off");
        }
        // A domain's provider must never be a way to become the server's administrator.
        if common::orgs::is_server_admin(self, account_id).await? {
            return failed("administrators sign in with a password");
        }

        // The application, checked again now the account is known.
        let stateless = decode_client_id(self.core.oauth.oauth_key.as_bytes(), &pending.client_id);
        if client_problem(self, &pending).is_some() {
            return failed("invalid client");
        }
        if stateless.is_none()
            && self
                .validate_client_registration(
                    &pending.client_id,
                    Some(pending.redirect_uri.as_str()),
                    account_id,
                )
                .await?
                .is_some()
        {
            return failed("invalid client registration");
        }
        let scope = match &stateless {
            Some(meta) => grant_scope(pending.scope.as_deref(), meta.scope_mask),
            None => pending.scope.clone(),
        };

        let client_code = rng()
            .sample_iter(Alphanumeric)
            .take(DEVICE_CODE_LEN)
            .map(char::from)
            .collect::<String>();
        let value = Archiver::new(OAuthCode {
            status: OAuthStatus::Authorized,
            account_id,
            client_id: pending.client_id.clone(),
            nonce: pending.nonce.clone(),
            params: pending.redirect_uri.clone(),
            code_challenge: PkceCodeChallenge::S256(pending.code_challenge.clone()),
            scope,
            resources: vec![],
        })
        .untrusted()
        .serialize()
        .caused_by(trc::location!())?;
        self.in_memory_store()
            .key_set(
                KeyValue::with_prefix(KV_OAUTH, client_code.as_bytes(), value)
                    .expires(self.core.oauth.oauth_expiry_auth_code),
            )
            .await?;

        let joiner = if pending.redirect_uri.contains('?') {
            '&'
        } else {
            '?'
        };
        let mut target = format!(
            "{}{joiner}code={}&iss={}",
            pending.redirect_uri,
            escape(&client_code),
            escape(&self.core.network.http.url_https)
        );
        if let Some(state) = &pending.state {
            target.push_str(&format!("&state={}", escape(state)));
        }
        redirect(&target)
    }
}
