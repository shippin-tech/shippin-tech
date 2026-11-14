//! Self-service mail panel: the free plan.
//!
//! Customers bring their own domain. They prove they control it with a TXT
//! record whose value is derived from a server secret, and that creates the
//! domain plus an owner mailbox. The owner then manages mailboxes and aliases
//! inside that one domain, within the plan limits configured by the operator.
//!
//! Every write runs through the normal JMAP management handlers with a token
//! that carries only the permissions listed in `panel_token`, so validation,
//! password hashing, DKIM key generation and cache invalidation are exactly what
//! the admin portal gets. Ownership is the "Self-service domain owner" role on
//! the owner's account; customers cannot change their own roles.

use crate::auth::authenticate::Authenticator;
use common::{
    Server,
    auth::{AccessToken, RECOVERY_ADMIN_ID},
    shippin::keys::{self, Service},
};
use http_proto::{HttpRequest, HttpResponse, HttpSessionData, JsonResponse, ToHttpResponse};
use hyper::{Method, StatusCode};
use jmap::api::request::RequestHandler;
use jmap_proto::request::Request;
use registry::types::EnumImpl;
use registry::schema::{
    enums::{AccountType, Permission, StorageQuota},
    prelude::{ObjectType, Property},
    structs::{Account, Credential, Domain, MtaInboundThrottle, Rate, Role, UserAccount, UserRoles},
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::sync::LazyLock;
use store::registry::RegistryQuery;
use types::id::Id;

/// Role description that marks a domain owner. Operators can grant or revoke it
/// in the admin portal like any other role.
pub const OWNER_ROLE: &str = "Self-service domain owner";
/// TXT record label customers publish to prove they control a domain.
pub const VERIFY_LABEL: &str = "_shippin-verify";
/// Throttle description for the free plan's sending cap. Created once, then left to the operator.
pub const SEND_LIMIT: &str = "Free plan: messages per signed-in sender per day";
/// Only signed-in senders are counted, so mail arriving from the internet is never throttled by it.
pub const SEND_LIMIT_MATCH: &str = "!is_empty(authenticated_as)";
/// Key-value prefix for the signup rate limit. Unused by the server core (see common::KV_*).
const KV_RATE_LIMIT_PANEL_SIGNUP: u8 = 40;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Plan {
    pub signup_open: bool,
    pub dns_proof: bool,
    pub max_domains: usize,
    pub mailboxes: usize,
    pub aliases: usize,
    pub mailbox_bytes: u64,
    pub signups_per_hour: u64,
    pub sends_per_day: u64,
}

impl Plan {
    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Self {
        let num = |key: &str, default: u64| {
            get(key)
                .and_then(|value| value.trim().parse::<u64>().ok())
                .unwrap_or(default)
        };
        Plan {
            signup_open: get("shippin.tech_PANEL_SIGNUP")
                .is_some_and(|value| value.trim().eq_ignore_ascii_case("open")),
            dns_proof: !get("shippin.tech_PANEL_INSECURE_SKIP_DNS_PROOF")
                .is_some_and(|value| value.trim() == "1"),
            max_domains: num("shippin.tech_PANEL_MAX_DOMAINS", 100) as usize,
            mailboxes: num("shippin.tech_PANEL_MAILBOXES", 5).max(1) as usize,
            aliases: num("shippin.tech_PANEL_ALIASES", 20) as usize,
            mailbox_bytes: num("shippin.tech_PANEL_MAILBOX_MB", 1024).max(1) * 1024 * 1024,
            signups_per_hour: num("shippin.tech_PANEL_SIGNUPS_PER_HOUR", 10).max(1),
            sends_per_day: num("shippin.tech_PANEL_SENDS_PER_DAY", 200).max(1),
        }
    }
}

static PLAN: LazyLock<Plan> = LazyLock::new(|| Plan::from_lookup(|key| std::env::var(key).ok()));

/// Lowercased, trimmed domain without a trailing dot, or None if it is not a valid name.
pub fn normalize_domain(input: &str) -> Option<String> {
    let domain = input.trim().trim_end_matches('.').to_ascii_lowercase();
    let labels = domain.split('.').collect::<Vec<_>>();
    let label_ok = |label: &str| {
        (1..=63).contains(&label.len())
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    };
    let tld_ok = labels
        .last()
        .is_some_and(|tld| tld.len() >= 2 && (tld.bytes().all(|b| b.is_ascii_alphabetic()) || tld.starts_with("xn--")));
    (labels.len() >= 2 && domain.len() <= 253 && labels.iter().all(|l| label_ok(l)) && tld_ok)
        .then_some(domain)
}

/// Local part rules for mailboxes and aliases created through the panel.
pub fn normalize_local_part(input: &str) -> Option<String> {
    let local = input.trim().to_ascii_lowercase();
    let valid = !local.is_empty()
        && local.len() <= 64
        && !local.starts_with('.')
        && !local.ends_with('.')
        && !local.contains("..")
        && local
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    valid.then_some(local)
}

/// Passwords arrive as plain text. A value that looks like a stored hash would
/// be saved as-is by the account handler, skipping the strength check.
pub fn acceptable_password(password: &str) -> Result<(), &'static str> {
    if password.chars().count() < 10 {
        Err("Use at least 10 characters.")
    } else if password.len() > 256 {
        Err("Use at most 256 characters.")
    } else if password.starts_with('$') || password.starts_with('{') {
        Err("Passwords cannot start with $ or {.")
    } else {
        Ok(())
    }
}

pub fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    let mut block = [0u8; 64];
    if key.len() > 64 {
        block[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        block[..key.len()].copy_from_slice(key);
    }
    let mut inner_pad = [0x36u8; 64];
    let mut outer_pad = [0x5cu8; 64];
    for (index, byte) in block.iter().enumerate() {
        inner_pad[index] ^= byte;
        outer_pad[index] ^= byte;
    }
    let inner = Sha256::new()
        .chain_update(inner_pad)
        .chain_update(message)
        .finalize();
    Sha256::new()
        .chain_update(outer_pad)
        .chain_update(inner)
        .finalize()
        .into()
}

/// The TXT value a domain must publish. Stable per server and domain, so the
/// signup holds no state between "get the record" and "verify".
pub fn verification_value(secret: &[u8], domain: &str) -> String {
    let digest = hmac_sha256(secret, format!("panel-domain-verify:{domain}").as_bytes());
    let hex = digest.iter().map(|b| format!("{b:02x}")).collect::<String>();
    format!("shippin-verify={}", &hex[..32])
}

/// Turns a JMAP /set response into the created object, or a readable reason.
pub fn set_created(response: &Value, key: &str) -> Result<Value, String> {
    if let Some(created) = response.get("created").and_then(|c| c.get(key)) {
        Ok(created.clone())
    } else {
        Err(set_reason(response.get("notCreated").and_then(|c| c.get(key))))
    }
}

pub fn set_updated(response: &Value, id: &str) -> Result<(), String> {
    if response.get("updated").and_then(|u| u.get(id)).is_some() {
        Ok(())
    } else {
        Err(set_reason(response.get("notUpdated").and_then(|u| u.get(id))))
    }
}

pub fn set_destroyed(response: &Value, id: &str) -> Result<(), String> {
    let destroyed = response
        .get("destroyed")
        .and_then(Value::as_array)
        .is_some_and(|ids| ids.iter().any(|v| v.as_str() == Some(id)));
    if destroyed {
        Ok(())
    } else {
        Err(set_reason(response.get("notDestroyed").and_then(|u| u.get(id))))
    }
}

fn set_reason(error: Option<&Value>) -> String {
    let Some(error) = error else {
        return "The server did not confirm the change.".to_string();
    };
    if let Some(description) = error.get("description").and_then(Value::as_str) {
        return description.to_string();
    }
    match error.get("type").and_then(Value::as_str) {
        Some("primaryKeyViolation") => "That name is already in use.".to_string(),
        Some("overQuota") => "Your plan limit has been reached.".to_string(),
        Some(other) => format!("The server rejected the change ({other})."),
        None => "The server rejected the change.".to_string(),
    }
}

pub(crate) fn reply(value: Value) -> trc::Result<HttpResponse> {
    Ok(JsonResponse::new(value).no_cache().into_http_response())
}

pub(crate) fn problem(status: StatusCode, code: &str, message: impl Into<String>) -> trc::Result<HttpResponse> {
    Ok(
        JsonResponse::with_status(status, json!({ "error": code, "message": message.into() }))
            .no_cache()
            .into_http_response(),
    )
}

pub(crate) fn input(body: &Option<Vec<u8>>) -> Value {
    body.as_deref()
        .and_then(|bytes| serde_json::from_slice::<Value>(bytes).ok())
        .unwrap_or(Value::Null)
}

pub(crate) fn text<'x>(value: &'x Value, key: &str) -> &'x str {
    value.get(key).and_then(Value::as_str).unwrap_or_default()
}

/// What the panel's own handlers write. Never Impersonate, never settings.
const PANEL_PERMISSIONS: &[Permission] = &[
    Permission::SysDomainGet,
    Permission::SysDomainCreate,
    Permission::SysDomainUpdate,
    Permission::SysDomainDestroy,
    Permission::SysDomainQuery,
    Permission::SysAccountGet,
    Permission::SysAccountCreate,
    Permission::SysAccountUpdate,
    Permission::SysAccountDestroy,
    Permission::SysAccountQuery,
    Permission::SysRoleGet,
    Permission::SysRoleCreate,
    Permission::SysRoleQuery,
    Permission::SysDkimSignatureGet,
    Permission::SysDkimSignatureCreate,
    Permission::SysDkimSignatureQuery,
    Permission::SysDkimSignatureDestroy,
    Permission::SysMtaInboundThrottleGet,
    Permission::SysMtaInboundThrottleCreate,
    Permission::SysMtaInboundThrottleQuery,
];

struct Owner {
    account_id: u32,
    domain_id: Id,
    domain: Domain,
    role_id: Id,
}

impl Owner {
    fn email(&self, local: &str) -> String {
        format!("{local}@{}", self.domain.name)
    }
}

fn has_role(user: &UserAccount, role_id: Id) -> bool {
    matches!(&user.roles, UserRoles::Custom(custom) if custom.role_ids.contains(&role_id))
}

pub trait PanelApi: Sync + Send {
    fn handle_panel_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        path: &[String],
        body: Option<Vec<u8>>,
    ) -> impl Future<Output = trc::Result<HttpResponse>> + Send;
}

impl PanelApi for Server {
    async fn handle_panel_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        path: &[String],
        body: Option<Vec<u8>>,
    ) -> trc::Result<HttpResponse> {
        let segment = |index: usize| path.get(index).map(String::as_str).unwrap_or_default();
        let method = req.method().clone();
        let body = input(&body);
        let panel = Panel(self);

        match (segment(0), &method) {
            ("plan", &Method::GET) => return panel.panel_plan(),
            ("signup", &Method::POST) => {
                if !PLAN.signup_open {
                    return problem(
                        StatusCode::FORBIDDEN,
                        "signupClosed",
                        "Signups are closed on this server.",
                    );
                }
                panel.panel_signup_rate(session).await?;
                return match segment(1) {
                    "code" => panel.panel_signup_code(&body).await,
                    "" => panel.panel_signup(&body, session).await,
                    _ => Err(trc::ResourceEvent::NotFound.into_err()),
                };
            }
            _ => {}
        }

        let (_in_flight, access_token) = self.authenticate_headers(req, session).await?;
        let Some(owner) = panel.panel_owner(access_token.account_id()).await? else {
            return problem(
                StatusCode::FORBIDDEN,
                "notOwner",
                "This account does not own a self-service domain.",
            );
        };

        match (segment(0), segment(1), segment(2), &method) {
            ("domain", "", _, &Method::GET) => panel.panel_domain(&owner).await,
            ("dns", "", _, &Method::GET) => panel.panel_dns(&owner).await,
            ("domain", "close", _, &Method::POST) => {
                panel.panel_close(&owner, &body, session).await
            }
            ("domain", "catchall", _, &Method::POST) => {
                panel.panel_catch_all(&owner, &body, session).await
            }
            ("mailboxes", "", _, &Method::GET) => panel.panel_mailboxes(&owner).await,
            ("mailboxes", "", _, &Method::POST) => {
                panel.panel_mailbox_create(&owner, &body, session).await
            }
            ("mailboxes", id, "", &Method::DELETE) if !id.is_empty() => {
                panel.panel_mailbox_destroy(&owner, id, session).await
            }
            ("mailboxes", id, "password", &Method::POST) => {
                panel.panel_mailbox_password(&owner, id, &body, session)
                    .await
            }
            ("mailboxes", id, "aliases", &Method::POST) => {
                panel.panel_alias_add(&owner, id, &body, session).await
            }
            ("mailboxes", id, "aliases", &Method::DELETE) => {
                panel.panel_alias_remove(&owner, id, segment(3), session)
                    .await
            }
            _ => Err(trc::ResourceEvent::NotFound.into_err()),
        }
    }
}

/// Runs one management method through the normal JMAP handlers with the given token,
/// so validation and side effects match the admin portal. Returns the method's result.
pub(crate) async fn internal_call(
    server: &Server,
    token: &AccessToken,
    session: &HttpSessionData,
    method: &str,
    args: Value,
) -> trc::Result<Value> {
    let body = json!({
        "using": ["urn:ietf:params:jmap:core", "urn:shippin.tech:jmap"],
        "methodCalls": [[method, args, "0"]],
    })
    .to_string();
    let request = Request::parse(body.as_bytes(), 4, 1024 * 1024)?;
    let response = server.handle_jmap_request(request, token, session).await;
    let mut value = serde_json::to_value(&response).unwrap_or(Value::Null);
    let call = value
        .get_mut("methodResponses")
        .and_then(|calls| calls.get_mut(0))
        .map(Value::take)
        .unwrap_or(Value::Null);
    if call.get(0).and_then(Value::as_str) == Some("error") {
        let detail = call
            .get(1)
            .and_then(|e| e.get("description").or_else(|| e.get("type")))
            .and_then(Value::as_str)
            .unwrap_or("unknown error")
            .to_string();
        return Err(trc::ResourceEvent::Error.into_err().details(detail));
    }
    Ok(call.get(1).cloned().unwrap_or(Value::Null))
}

/// A token for the management handlers: the user role's permissions plus
/// PANEL_PERMISSIONS. Enough to run a mailbox, never enough to be an administrator.
/// Callers decide which accounts and domains the person may touch before using it.
pub(crate) async fn management_token(server: &Server, account_id: u32) -> trc::Result<AccessToken> {
    let user = server
        .effective_permissions(
            &registry::schema::structs::Permissions::Inherit,
            &server.core.network.security.default_role_ids_user,
            None,
        )
        .await?
        .finalize();
    let granted = (0..Permission::COUNT as u16)
        .filter_map(Permission::from_id)
        .filter(|permission| user.get(*permission as usize));
    Ok(AccessToken::from_permissions(
        account_id,
        PANEL_PERMISSIONS.iter().copied().chain(granted),
    ))
}

/// The domain this account owns on the free plan, if it owns one.
pub(crate) async fn owner_domain_id(server: &Server, account_id: u32) -> trc::Result<Option<Id>> {
    Ok(Panel(server)
        .panel_owner(account_id)
        .await?
        .map(|owner| owner.domain_id))
}

/// Local wrapper so the panel's helpers can be methods without touching `Server`.
struct Panel<'x>(&'x Server);

impl std::ops::Deref for Panel<'_> {
    type Target = Server;
    fn deref(&self) -> &Server {
        self.0
    }
}

impl Panel<'_> {
    /// New mailboxes get the default user role, and the server lets a caller grant
    /// only permissions it holds. So the token holds exactly the user role's
    /// permissions plus PANEL_PERMISSIONS: enough for a normal mailbox, never admin.
    async fn panel_token(&self, account_id: u32) -> trc::Result<AccessToken> {
        management_token(self.0, account_id).await
    }

    async fn panel_call(
        &self,
        token: &AccessToken,
        session: &HttpSessionData,
        method: &str,
        args: Value,
    ) -> trc::Result<Value> {
        internal_call(self.0, token, session, method, args).await
    }

    fn panel_plan(&self) -> trc::Result<HttpResponse> {
        let plan = &*PLAN;
        reply(json!({
            "signup": if plan.signup_open { "open" } else { "closed" },
            "dnsProof": plan.dns_proof,
            "mailboxes": plan.mailboxes,
            "aliases": plan.aliases,
            "mailboxMb": plan.mailbox_bytes / (1024 * 1024),
            "sendsPerDay": plan.sends_per_day,
            "mailHost": self.core.network.server_name,
            "verifyLabel": VERIFY_LABEL,
        }))
    }

    async fn panel_signup_rate(&self, session: &HttpSessionData) -> trc::Result<()> {
        let rate = Rate {
            count: PLAN.signups_per_hour,
            period: registry::types::duration::Duration(std::time::Duration::from_secs(3600)),
        };
        if let Some(reset) = self
            .core
            .storage
            .memory
            .is_rate_allowed(
                KV_RATE_LIMIT_PANEL_SIGNUP,
                &common::network::ip_to_bytes(&session.remote_ip),
                &rate,
                false,
            )
            .await?
        {
            return Err(trc::LimitEvent::TooManyRequests
                .into_err()
                .ctx(trc::Key::Expires, reset)
                .ctx(trc::Key::Limit, rate.count));
        }
        Ok(())
    }

    async fn panel_domain_taken(&self, domain: &str) -> trc::Result<bool> {
        for property in [Property::Name, Property::Aliases] {
            if self
                .registry()
                .primary_key(
                    ObjectType::Domain.into(),
                    property,
                    domain.as_bytes().to_vec(),
                )
                .await?
                .is_some()
            {
                return Ok(true);
            }
        }
        Ok(false)
    }

    async fn panel_domain_capacity(&self) -> trc::Result<bool> {
        let count = self
            .registry()
            .query::<Vec<Id>>(RegistryQuery::new(ObjectType::Domain))
            .await?
            .len();
        Ok(count < PLAN.max_domains)
    }

    async fn panel_signup_code(&self, body: &Value) -> trc::Result<HttpResponse> {
        let Some(domain) = normalize_domain(text(body, "domain")) else {
            return problem(
                StatusCode::BAD_REQUEST,
                "invalidDomain",
                "Enter a domain name like example.com.",
            );
        };
        if self.panel_domain_taken(&domain).await? {
            return problem(
                StatusCode::CONFLICT,
                "domainTaken",
                "That domain is already hosted on this server.",
            );
        }
        let Ok((_, proof_key)) = keys::primary(self, Service::DomainProof).await else {
            return problem(
                StatusCode::INTERNAL_SERVER_ERROR,
                "keys",
                "The server could not make its domain-proof key. Ask its administrator.",
            );
        };
        reply(json!({
            "domain": domain,
            "record": {
                "type": "TXT",
                "name": format!("{VERIFY_LABEL}.{domain}"),
                "value": verification_value(&proof_key, &domain),
            },
            "dnsProof": PLAN.dns_proof,
        }))
    }

    async fn panel_domain_verified(&self, domain: &str) -> bool {
        if !PLAN.dns_proof {
            return true;
        }
        // Any of the proof service's keys, so a value published before a key was replaced
        // still counts; and the value made before the service had its own key (K5).
        let mut expected: Vec<String> = keys::usable(self, Service::DomainProof)
            .await
            .iter()
            .map(|key| verification_value(key, domain))
            .collect();
        expected.push(verification_value(keys::legacy_secret(self), domain));
        match self
            .core
            .smtp
            .resolvers
            .dns
            .txt_raw_lookup(format!("{VERIFY_LABEL}.{domain}."))
            .await
        {
            Ok(found) => {
                let found = String::from_utf8_lossy(&found);
                expected.iter().any(|value| found.contains(value.as_str()))
            }
            Err(_) => false,
        }
    }

    /// Finds the owner role, creating it the first time a domain is signed up.
    async fn panel_owner_role(
        &self,
        create_with: Option<(&AccessToken, &HttpSessionData)>,
    ) -> trc::Result<Option<Id>> {
        for id in self
            .registry()
            .query::<Vec<Id>>(RegistryQuery::new(ObjectType::Role))
            .await?
        {
            if let Some(role) = self.registry().object::<Role>(id).await?
                && role.description == OWNER_ROLE
            {
                return Ok(Some(id));
            }
        }
        let Some((token, session)) = create_with else {
            return Ok(None);
        };
        let response = self
            .panel_call(
                token,
                session,
                "x:Role/set",
                json!({ "create": { "r": { "description": OWNER_ROLE } } }),
            )
            .await?;
        Ok(set_created(&response, "r")
            .ok()
            .and_then(|created| created.get("id").and_then(Value::as_str).and_then(|id| id.parse::<Id>().ok())))
    }

    /// Makes sure free-plan senders have a daily cap. Never changes an existing one.
    async fn panel_ensure_send_limit(
        &self,
        token: &AccessToken,
        session: &HttpSessionData,
    ) -> trc::Result<()> {
        for id in self
            .registry()
            .query::<Vec<Id>>(RegistryQuery::new(ObjectType::MtaInboundThrottle))
            .await?
        {
            if let Some(throttle) = self.registry().object::<MtaInboundThrottle>(id).await?
                && throttle.description == SEND_LIMIT
            {
                return Ok(());
            }
        }
        let response = self
            .panel_call(
                token,
                session,
                "x:MtaInboundThrottle/set",
                json!({ "create": { "t": {
                    "description": SEND_LIMIT,
                    "enable": true,
                    "key": { "authenticatedAs": true },
                    "match": { "else": SEND_LIMIT_MATCH },
                    "rate": { "count": PLAN.sends_per_day, "period": 86_400_000u64 },
                } } }),
            )
            .await?;
        if let Err(reason) = set_created(&response, "t") {
            trc::event!(
                Server(trc::ServerEvent::Startup),
                Details = "Could not create the free plan sending limit",
                Reason = reason
            );
        }
        Ok(())
    }

    async fn panel_signup(
        &self,
        body: &Value,
        session: &HttpSessionData,
    ) -> trc::Result<HttpResponse> {
        let Some(domain) = normalize_domain(text(body, "domain")) else {
            return problem(
                StatusCode::BAD_REQUEST,
                "invalidDomain",
                "Enter a domain name like example.com.",
            );
        };
        let Some(local) = normalize_local_part(text(body, "name")) else {
            return problem(
                StatusCode::BAD_REQUEST,
                "invalidName",
                "Use letters, digits, dots, dashes or underscores for the address.",
            );
        };
        let password = text(body, "password");
        if let Err(reason) = acceptable_password(password) {
            return problem(StatusCode::BAD_REQUEST, "weakPassword", reason);
        }
        if self.panel_domain_taken(&domain).await? {
            return problem(
                StatusCode::CONFLICT,
                "domainTaken",
                "That domain is already hosted on this server.",
            );
        }
        if !self.panel_domain_capacity().await? {
            return problem(
                StatusCode::SERVICE_UNAVAILABLE,
                "full",
                "This server is not accepting new domains right now.",
            );
        }
        if !self.panel_domain_verified(&domain).await {
            return problem(
                StatusCode::UNPROCESSABLE_ENTITY,
                "notVerified",
                format!(
                    "The TXT record at {VERIFY_LABEL}.{domain} was not found yet. DNS changes can take a few minutes; try again shortly."
                ),
            );
        }

        let token = self.panel_token(RECOVERY_ADMIN_ID).await?;
        self.panel_ensure_send_limit(&token, session).await?;
        let Some(role_id) = self.panel_owner_role(Some((&token, session))).await? else {
            return problem(
                StatusCode::INTERNAL_SERVER_ERROR,
                "noRole",
                "The owner role could not be created.",
            );
        };

        let created = self
            .panel_call(
                &token,
                session,
                "x:Domain/set",
                json!({ "create": { "d": {
                    "name": domain,
                    "description": format!("Self-service free plan, owner {local}@{domain}"),
                } } }),
            )
            .await?;
        let domain_id = match set_created(&created, "d") {
            Ok(created) => created
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            Err(reason) => return problem(StatusCode::CONFLICT, "domainRejected", reason),
        };

        let mut role_ids = serde_json::Map::new();
        for id in &self.core.network.security.default_role_ids_user {
            role_ids.insert(id.to_string(), Value::Bool(true));
        }
        role_ids.insert(role_id.to_string(), Value::Bool(true));

        let created = self
            .panel_call(
                &token,
                session,
                "x:Account/set",
                json!({ "create": { "a": {
                    "@type": "User",
                    "name": local,
                    "domainId": domain_id,
                    "credentials": { "0": { "@type": "Password", "secret": password } },
                    "roles": { "@type": "Custom", "roleIds": role_ids },
                    "quotas": { "maxDiskQuota": PLAN.mailbox_bytes },
                    "description": "Domain owner",
                } } }),
            )
            .await?;
        if let Err(reason) = set_created(&created, "a") {
            // Do not leave a domain behind that nobody can manage.
            let _ = self.panel_remove_domain(&token, session, &domain_id).await;
            return problem(StatusCode::BAD_REQUEST, "ownerRejected", reason);
        }

        reply(json!({ "email": format!("{local}@{domain}"), "domain": domain }))
    }

    /// Removes a domain created moments ago. Its DKIM keys are generated at once and
    /// keep the domain from being deleted, so they go first.
    async fn panel_remove_domain(&self, token: &AccessToken, session: &HttpSessionData, domain_id: &str) -> bool {
        if let Ok(id) = domain_id.parse::<Id>()
            && let Ok(keys) = self
                .registry()
                .query::<Vec<Id>>(
                    RegistryQuery::new(ObjectType::DkimSignature)
                        .equal(Property::DomainId, id.document_id()),
                )
                .await
            && !keys.is_empty()
        {
            let keys = keys.iter().map(Id::to_string).collect::<Vec<_>>();
            let _ = self
                .panel_call(token, session, "x:DkimSignature/set", json!({ "destroy": keys }))
                .await;
        }
        let removed = self
            .panel_call(token, session, "x:Domain/set", json!({ "destroy": [domain_id] }))
            .await
            .ok()
            .is_some_and(|response| set_destroyed(&response, domain_id).is_ok());
        if !removed {
            trc::event!(
                Server(trc::ServerEvent::Startup),
                Details = "Self-service signup left a domain behind; remove it in the portal",
                Id = domain_id.to_string()
            );
        }
        removed
    }

    async fn panel_owner(&self, account_id: u32) -> trc::Result<Option<Owner>> {
        let Some(Account::User(user)) = self.registry().object::<Account>(Id::from(account_id)).await?
        else {
            return Ok(None);
        };
        let Some(role_id) = self.panel_owner_role(None).await? else {
            return Ok(None);
        };
        if !has_role(&user, role_id) {
            return Ok(None);
        }
        let Some(domain) = self.registry().object::<Domain>(user.domain_id).await? else {
            return Ok(None);
        };
        Ok(Some(Owner {
            account_id,
            domain_id: user.domain_id,
            domain,
            role_id,
        }))
    }

    async fn panel_users(&self, owner: &Owner) -> trc::Result<Vec<(Id, UserAccount)>> {
        let mut users = Vec::new();
        for id in self
            .registry()
            .query::<Vec<Id>>(
                RegistryQuery::new(ObjectType::Account)
                    .equal(Property::DomainId, owner.domain_id.document_id())
                    .equal(Property::Type, AccountType::User.to_id()),
            )
            .await?
        {
            if let Some(Account::User(user)) = self.registry().object::<Account>(id).await?
                && user.domain_id == owner.domain_id
            {
                users.push((id, user));
            }
        }
        users.sort_by(|a, b| a.1.name.cmp(&b.1.name));
        Ok(users)
    }

    async fn panel_user(&self, owner: &Owner, id: &str) -> trc::Result<Option<(Id, UserAccount)>> {
        let Some(id) = id.parse::<Id>().ok() else {
            return Ok(None);
        };
        Ok(match self.registry().object::<Account>(id).await? {
            Some(Account::User(user))
                if user.domain_id == owner.domain_id
                    && !common::orgs::is_server_admin(self.0, id.document_id()).await? =>
            {
                Some((id, user))
            }
            _ => None,
        })
    }

    async fn panel_domain(&self, owner: &Owner) -> trc::Result<HttpResponse> {
        let users = self.panel_users(owner).await?;
        let aliases = users.iter().map(|(_, u)| u.aliases.len()).sum::<usize>();
        let zone = self
            .build_bind_dns_records(owner.domain_id, &owner.domain)
            .await
            .unwrap_or_default();
        reply(json!({
            "domain": owner.domain.name,
            "plan": {
                "mailboxes": PLAN.mailboxes,
                "aliases": PLAN.aliases,
                "mailboxMb": PLAN.mailbox_bytes / (1024 * 1024),
            },
            "usage": { "mailboxes": users.len(), "aliases": aliases },
            "catchAll": owner.domain.catch_all_address,
            "mailHost": self.core.network.server_name,
            "dnsZone": zone,
        }))
    }

    /// Live lookup of the records mail needs, so owners can see what is still missing.
    async fn panel_dns(&self, owner: &Owner) -> trc::Result<HttpResponse> {
        use common::network::dns::records::DnsRecordState;
        let checks = self
            .check_dns_records(owner.domain_id, &owner.domain)
            .await?
            .into_iter()
            .map(|check| {
                let (state, actual) = match check.state {
                    DnsRecordState::Found => ("found", None),
                    DnsRecordState::Different(actual) => ("different", Some(actual)),
                    DnsRecordState::Missing => ("missing", None),
                };
                json!({
                    "kind": check.kind,
                    "name": check.name,
                    "expected": check.expected,
                    "state": state,
                    "actual": actual,
                })
            })
            .collect::<Vec<_>>();
        reply(json!({ "records": checks }))
    }

    /// Sends mail for unknown addresses in the domain to one of its mailboxes, or stops it.
    /// Deletes every mailbox in the domain, then the domain. The owner must type the
    /// domain name. Mail data is purged by the server's account-removal task.
    async fn panel_close(
        &self,
        owner: &Owner,
        body: &Value,
        session: &HttpSessionData,
    ) -> trc::Result<HttpResponse> {
        if !text(body, "confirm").trim().eq_ignore_ascii_case(&owner.domain.name) {
            return problem(
                StatusCode::BAD_REQUEST,
                "notConfirmed",
                format!("Type {} to confirm.", owner.domain.name),
            );
        }
        let token = self.panel_token(owner.account_id).await?;
        let mut ids = self
            .panel_users(owner)
            .await?
            .into_iter()
            .map(|(id, _)| id)
            .collect::<Vec<_>>();
        // The owner's own mailbox goes last, so a failure part-way leaves it able to retry.
        ids.sort_by_key(|id| id.document_id() == owner.account_id);
        let ids = ids.iter().map(Id::to_string).collect::<Vec<_>>();
        let response = self
            .panel_call(&token, session, "x:Account/set", json!({ "destroy": ids }))
            .await?;
        if let Some(failed) = ids.iter().find(|id| set_destroyed(&response, id).is_err()) {
            let reason = set_destroyed(&response, failed).unwrap_err();
            return problem(StatusCode::CONFLICT, "notClosed", reason);
        }
        // Someone closing their own domain is asking for it to be gone, not kept.
        for id in &ids {
            if let Ok(id) = id.to_string().parse::<Id>() {
                common::recover::erase_held(self, id).await?;
            }
        }
        if !self
            .panel_remove_domain(&token, session, &owner.domain_id.to_string())
            .await
        {
            return problem(
                StatusCode::CONFLICT,
                "notClosed",
                "The mailboxes were deleted but the domain could not be removed. The operator has been told in the server log.",
            );
        }
        reply(json!({ "closed": owner.domain.name }))
    }

    async fn panel_catch_all(
        &self,
        owner: &Owner,
        body: &Value,
        session: &HttpSessionData,
    ) -> trc::Result<HttpResponse> {
        let wanted = text(body, "mailbox").trim().to_ascii_lowercase();
        let target = if wanted.is_empty() {
            Value::Null
        } else {
            let exists = self
                .panel_users(owner)
                .await?
                .iter()
                .any(|(_, user)| user.name == wanted);
            if !exists {
                return problem(
                    StatusCode::BAD_REQUEST,
                    "unknownMailbox",
                    "Choose one of this domain's mailboxes.",
                );
            }
            Value::from(owner.email(&wanted))
        };
        let id = owner.domain_id.to_string();
        let mut update = serde_json::Map::new();
        update.insert(id.clone(), json!({ "catchAllAddress": target }));
        let response = self
            .panel_call(
                &self.panel_token(owner.account_id).await?,
                session,
                "x:Domain/set",
                json!({ "update": update }),
            )
            .await?;
        match set_updated(&response, &id) {
            Ok(()) => reply(json!({ "catchAll": target })),
            Err(reason) => problem(StatusCode::BAD_REQUEST, "rejected", reason),
        }
    }

    async fn panel_mailboxes(&self, owner: &Owner) -> trc::Result<HttpResponse> {
        let mut list = Vec::new();
        for (id, user) in self.panel_users(owner).await? {
            let used = self
                .get_used_quota_account(id.document_id())
                .await
                .unwrap_or_default()
                .max(0);
            list.push(json!({
                "id": id.to_string(),
                "name": user.name,
                "email": owner.email(&user.name),
                "owner": has_role(&user, owner.role_id),
                "you": id.document_id() == owner.account_id,
                "aliases": user
                    .aliases
                    .iter()
                    .filter(|alias| alias.domain_id == owner.domain_id)
                    .map(|alias| alias.name.clone())
                    .collect::<Vec<_>>(),
                "quotaBytes": user.quotas.get(&StorageQuota::MaxDiskQuota).copied().unwrap_or(PLAN.mailbox_bytes),
                "usedBytes": used,
            }));
        }
        reply(json!({ "mailboxes": list }))
    }

    async fn panel_mailbox_create(
        &self,
        owner: &Owner,
        body: &Value,
        session: &HttpSessionData,
    ) -> trc::Result<HttpResponse> {
        let Some(local) = normalize_local_part(text(body, "name")) else {
            return problem(
                StatusCode::BAD_REQUEST,
                "invalidName",
                "Use letters, digits, dots, dashes or underscores for the address.",
            );
        };
        let password = text(body, "password");
        if let Err(reason) = acceptable_password(password) {
            return problem(StatusCode::BAD_REQUEST, "weakPassword", reason);
        }
        if self.panel_users(owner).await?.len() >= PLAN.mailboxes {
            return problem(
                StatusCode::FORBIDDEN,
                "planLimit",
                format!("Your plan includes {} mailboxes.", PLAN.mailboxes),
            );
        }
        let response = self
            .panel_call(
                &self.panel_token(owner.account_id).await?,
                session,
                "x:Account/set",
                json!({ "create": { "a": {
                    "@type": "User",
                    "name": local,
                    "domainId": owner.domain_id.to_string(),
                    "credentials": { "0": { "@type": "Password", "secret": password } },
                    "roles": { "@type": "User" },
                    "quotas": { "maxDiskQuota": PLAN.mailbox_bytes },
                } } }),
            )
            .await?;
        match set_created(&response, "a") {
            Ok(created) => reply(json!({
                "id": created.get("id").cloned().unwrap_or(Value::Null),
                "email": owner.email(&local),
            })),
            Err(reason) => problem(StatusCode::BAD_REQUEST, "rejected", reason),
        }
    }

    async fn panel_mailbox_destroy(
        &self,
        owner: &Owner,
        id: &str,
        session: &HttpSessionData,
    ) -> trc::Result<HttpResponse> {
        let Some((id, user)) = self.panel_user(owner, id).await? else {
            return Err(trc::ResourceEvent::NotFound.into_err());
        };
        if id.document_id() == owner.account_id || has_role(&user, owner.role_id) {
            return problem(
                StatusCode::FORBIDDEN,
                "ownerMailbox",
                "The owner mailbox cannot be deleted from the panel.",
            );
        }
        let id = id.to_string();
        let response = self
            .panel_call(
                &self.panel_token(owner.account_id).await?,
                session,
                "x:Account/set",
                json!({ "destroy": [id] }),
            )
            .await?;
        match set_destroyed(&response, &id) {
            Ok(()) => reply(json!({ "destroyed": id })),
            Err(reason) => problem(StatusCode::BAD_REQUEST, "rejected", reason),
        }
    }

    /// One field-level update on a mailbox, e.g. {"credentials/0/secret": "..."}.
    /// Everything not named in the patch (app passwords, other aliases) stays as it is.
    async fn panel_patch(
        &self,
        owner: &Owner,
        id: Id,
        patch: serde_json::Map<String, Value>,
        session: &HttpSessionData,
    ) -> trc::Result<Result<(), String>> {
        let id = id.to_string();
        let mut update = serde_json::Map::new();
        update.insert(id.clone(), Value::Object(patch));
        let response = self
            .panel_call(
                &self.panel_token(owner.account_id).await?,
                session,
                "x:Account/set",
                json!({ "update": update }),
            )
            .await?;
        Ok(set_updated(&response, &id))
    }

    async fn panel_mailbox_password(
        &self,
        owner: &Owner,
        id: &str,
        body: &Value,
        session: &HttpSessionData,
    ) -> trc::Result<HttpResponse> {
        let Some((id, user)) = self.panel_user(owner, id).await? else {
            return Err(trc::ResourceEvent::NotFound.into_err());
        };
        let password = text(body, "password");
        if let Err(reason) = acceptable_password(password) {
            return problem(StatusCode::BAD_REQUEST, "weakPassword", reason);
        }
        let mut patch = serde_json::Map::new();
        match user
            .credentials
            .0
            .iter()
            .find(|(_, credential)| matches!(credential, Credential::Password(_)))
        {
            Some((key, _)) => {
                patch.insert(format!("credentials/{key}/secret"), Value::from(password));
            }
            None => {
                let next = user.credentials.0.iter().map(|(k, _)| k + 1).max().unwrap_or(0);
                patch.insert(
                    format!("credentials/{next}"),
                    json!({ "@type": "Password", "secret": password }),
                );
            }
        }
        match self.panel_patch(owner, id, patch, session).await? {
            Ok(()) => reply(json!({ "updated": id.to_string() })),
            Err(reason) => problem(StatusCode::BAD_REQUEST, "rejected", reason),
        }
    }

    async fn panel_alias_add(
        &self,
        owner: &Owner,
        id: &str,
        body: &Value,
        session: &HttpSessionData,
    ) -> trc::Result<HttpResponse> {
        let Some((id, user)) = self.panel_user(owner, id).await? else {
            return Err(trc::ResourceEvent::NotFound.into_err());
        };
        let Some(alias) = normalize_local_part(text(body, "alias")) else {
            return problem(
                StatusCode::BAD_REQUEST,
                "invalidName",
                "Use letters, digits, dots, dashes or underscores for the alias.",
            );
        };
        let total = self
            .panel_users(owner)
            .await?
            .iter()
            .map(|(_, u)| u.aliases.iter().filter(|a| a.domain_id == owner.domain_id).count())
            .sum::<usize>();
        if total >= PLAN.aliases {
            return problem(
                StatusCode::FORBIDDEN,
                "planLimit",
                format!("Your plan includes {} aliases.", PLAN.aliases),
            );
        }
        let exists = user
            .aliases
            .iter()
            .any(|a| a.domain_id == owner.domain_id && a.name == alias);
        if exists || alias == user.name {
            return problem(StatusCode::CONFLICT, "exists", "That alias already exists.");
        }
        let next = user.aliases.0.iter().map(|(k, _)| k + 1).max().unwrap_or(0);
        let mut patch = serde_json::Map::new();
        patch.insert(
            format!("aliases/{next}"),
            json!({ "enabled": true, "name": alias, "domainId": owner.domain_id.to_string() }),
        );
        match self.panel_patch(owner, id, patch, session).await? {
            Ok(()) => reply(json!({ "alias": owner.email(&alias) })),
            Err(reason) => problem(StatusCode::BAD_REQUEST, "rejected", reason),
        }
    }

    async fn panel_alias_remove(
        &self,
        owner: &Owner,
        id: &str,
        alias: &str,
        session: &HttpSessionData,
    ) -> trc::Result<HttpResponse> {
        let Some((id, user)) = self.panel_user(owner, id).await? else {
            return Err(trc::ResourceEvent::NotFound.into_err());
        };
        let alias = alias.to_ascii_lowercase();
        let Some((key, _)) = user
            .aliases
            .0
            .iter()
            .find(|(_, a)| a.domain_id == owner.domain_id && a.name == alias)
        else {
            return Err(trc::ResourceEvent::NotFound.into_err());
        };
        let mut patch = serde_json::Map::new();
        patch.insert(format!("aliases/{key}"), Value::Null);
        match self.panel_patch(owner, id, patch, session).await? {
            Ok(()) => reply(json!({ "removed": owner.email(&alias) })),
            Err(reason) => problem(StatusCode::BAD_REQUEST, "rejected", reason),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn plan_defaults_are_closed_with_dns_proof() {
        let plan = Plan::from_lookup(|_| None);
        assert!(!plan.signup_open);
        assert!(plan.dns_proof);
        assert_eq!(plan.mailboxes, 5);
        assert_eq!(plan.aliases, 20);
        assert_eq!(plan.mailbox_bytes, 1024 * 1024 * 1024);
        assert_eq!(plan.max_domains, 100);
        assert_eq!(plan.sends_per_day, 200);
    }

    #[test]
    fn plan_reads_operator_settings() {
        let env = HashMap::from([
            ("shippin.tech_PANEL_SIGNUP", "Open"),
            ("shippin.tech_PANEL_MAILBOXES", "3"),
            ("shippin.tech_PANEL_MAILBOX_MB", "512"),
            ("shippin.tech_PANEL_INSECURE_SKIP_DNS_PROOF", "1"),
            ("shippin.tech_PANEL_MAX_DOMAINS", "nonsense"),
        ]);
        let plan = Plan::from_lookup(|key| env.get(key).map(|v| v.to_string()));
        assert!(plan.signup_open);
        assert!(!plan.dns_proof);
        assert_eq!(plan.mailboxes, 3);
        assert_eq!(plan.mailbox_bytes, 512 * 1024 * 1024);
        assert_eq!(plan.max_domains, 100, "unparseable values fall back to the default");
    }

    #[test]
    fn domains_and_local_parts_are_normalized() {
        assert_eq!(normalize_domain(" Example.COM. ").as_deref(), Some("example.com"));
        assert_eq!(normalize_domain("mail.example.co.uk").as_deref(), Some("mail.example.co.uk"));
        assert_eq!(normalize_domain("localhost"), None);
        assert_eq!(normalize_domain("bad domain.com"), None);
        assert_eq!(normalize_domain("-bad.com"), None);
        assert_eq!(normalize_domain("example.c0m"), None);
        assert_eq!(normalize_domain("xn--bcher-kva.example").as_deref(), Some("xn--bcher-kva.example"));
        assert_eq!(normalize_domain("example.xn--p1ai").as_deref(), Some("example.xn--p1ai"));
        assert_eq!(normalize_domain(""), None);
        assert_eq!(normalize_local_part(" Jane.Doe ").as_deref(), Some("jane.doe"));
        assert_eq!(normalize_local_part("a..b"), None);
        assert_eq!(normalize_local_part(".a"), None);
        assert_eq!(normalize_local_part("a@b"), None);
        assert_eq!(normalize_local_part("sales+eu"), None, "plus would read as a sub-address tag");
        assert_eq!(normalize_local_part(&"x".repeat(65)), None);
    }

    #[test]
    fn passwords_that_look_like_hashes_are_refused() {
        assert!(acceptable_password("short").is_err());
        assert!(acceptable_password("$argon2id$v=19$abcdefgh").is_err());
        assert!(acceptable_password("{SHA}abcdefghijk").is_err());
        assert!(acceptable_password("correct horse battery").is_ok());
    }

    #[test]
    fn hmac_matches_rfc_4231_case_2() {
        let mac = hmac_sha256(b"Jefe", b"what do ya want for nothing?");
        let hex = mac.iter().map(|b| format!("{b:02x}")).collect::<String>();
        assert_eq!(hex, "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
    }

    #[test]
    fn verification_value_is_stable_per_domain_and_secret() {
        let a = verification_value(b"secret", "example.com");
        assert_eq!(a, verification_value(b"secret", "example.com"));
        assert_ne!(a, verification_value(b"secret", "example.org"));
        assert_ne!(a, verification_value(b"other", "example.com"));
        assert!(a.starts_with("shippin-verify="));
        assert_eq!(a.len(), "shippin-verify=".len() + 32);
    }

    #[test]
    fn set_responses_are_read_back() {
        let created = json!({ "created": { "a": { "id": "x1" } } });
        assert_eq!(set_created(&created, "a").unwrap()["id"], "x1");
        let rejected = json!({ "notCreated": { "a": { "type": "primaryKeyViolation" } } });
        assert_eq!(set_created(&rejected, "a").unwrap_err(), "That name is already in use.");
        let described = json!({ "notCreated": { "a": { "type": "invalidProperties", "description": "Password too weak" } } });
        assert_eq!(set_created(&described, "a").unwrap_err(), "Password too weak");
        assert!(set_updated(&json!({ "updated": { "x1": null } }), "x1").is_ok());
        assert!(set_updated(&json!({}), "x1").is_err());
        assert!(set_destroyed(&json!({ "destroyed": ["x1"] }), "x1").is_ok());
        assert!(set_destroyed(&json!({ "destroyed": [] }), "x1").is_err());
    }
}
