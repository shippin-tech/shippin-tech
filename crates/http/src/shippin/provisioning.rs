//! `/api/scim`: an identity provider manages one domain's people and teams (RFC 7644).
//!
//! `/api/scim/v2/...` takes the domain's bearer token and reaches nothing outside that
//! domain. `/api/scim/settings/<domain>` is for whoever manages the domain: `GET` says
//! whether a token exists, `POST` makes a new one and shows it once, `DELETE` revokes it.
//! The server's administrators are never changed from here.

use crate::{
    auth::authenticate::Authenticator,
    brand::may_manage,
    panel::{
        acceptable_password, internal_call, management_token, normalize_local_part, problem, reply,
        set_created, set_destroyed, set_updated,
    },
};
use common::{
    Server,
    auth::RECOVERY_ADMIN_ID,
    orgs::{Organisation, list_orgs},
    provisioning::{self as scim_state, GroupChange, UserChange, group_name, parse_filter},
};
use http_proto::{HttpRequest, HttpResponse, HttpSessionData};
use hyper::{Method, StatusCode, header};
use registry::{
    schema::{
        enums::{AccountType, StorageQuota},
        prelude::{ObjectType, Property},
        structs::{Account, Credential, GroupAccount, UserAccount},
    },
    types::EnumImpl,
};
use serde_json::{Map, Value, json};
use std::collections::BTreeSet;
use store::{
    rand::{RngExt, distr::Alphanumeric, rng},
    registry::RegistryQuery,
};
use types::id::Id;
use utils::url_params::UrlParams;

const USER_SCHEMA: &str = "urn:ietf:params:scim:schemas:core:2.0:User";
const GROUP_SCHEMA: &str = "urn:ietf:params:scim:schemas:core:2.0:Group";
const LIST_SCHEMA: &str = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const ERROR_SCHEMA: &str = "urn:ietf:params:scim:api:messages:2.0:Error";
const MAX_RESULTS: usize = 200;
/// Where a domain's organisation shares its storage, each new person starts with this.
const CAPPED_DEFAULT_STORAGE: u64 = 1024 * 1024 * 1024;

fn scim(status: StatusCode, body: Value) -> trc::Result<HttpResponse> {
    Ok(HttpResponse::new(status)
        .with_content_type("application/scim+json")
        .with_text_body(body.to_string())
        .with_no_store())
}

fn error(status: StatusCode, detail: impl Into<String>) -> trc::Result<HttpResponse> {
    scim(
        status,
        json!({
            "schemas": [ERROR_SCHEMA],
            "status": status.as_u16().to_string(),
            "detail": detail.into(),
        }),
    )
}

fn not_found() -> trc::Result<HttpResponse> {
    error(StatusCode::NOT_FOUND, "That resource does not exist.")
}

fn random_password() -> String {
    rng()
        .sample_iter(Alphanumeric)
        .take(48)
        .map(char::from)
        .collect()
}

struct Scope<'x> {
    server: &'x Server,
    session: &'x HttpSessionData,
    domain_id: Id,
    domain: String,
}

impl Scope<'_> {
    async fn call(&self, method: &str, args: Value) -> trc::Result<Value> {
        internal_call(
            self.server,
            &management_token(self.server, RECOVERY_ADMIN_ID).await?,
            self.session,
            method,
            args,
        )
        .await
    }

    async fn accounts(&self, kind: AccountType) -> trc::Result<Vec<(Id, Account)>> {
        let mut found = Vec::new();
        for id in self
            .server
            .registry()
            .query::<Vec<Id>>(
                RegistryQuery::new(ObjectType::Account)
                    .equal(Property::DomainId, self.domain_id.document_id())
                    .equal(Property::Type, kind.to_id()),
            )
            .await?
        {
            if let Some(account) = self.server.registry().object::<Account>(id).await? {
                found.push((id, account));
            }
        }
        Ok(found)
    }

    async fn users(&self) -> trc::Result<Vec<(Id, UserAccount)>> {
        Ok(self
            .accounts(AccountType::User)
            .await?
            .into_iter()
            .filter_map(|(id, account)| match account {
                Account::User(user) if user.domain_id == self.domain_id => Some((id, user)),
                _ => None,
            })
            .collect())
    }

    async fn groups(&self) -> trc::Result<Vec<(Id, GroupAccount)>> {
        Ok(self
            .accounts(AccountType::Group)
            .await?
            .into_iter()
            .filter_map(|(id, account)| match account {
                Account::Group(group) if group.domain_id == self.domain_id => Some((id, group)),
                _ => None,
            })
            .collect())
    }

    async fn user(&self, id: &str) -> trc::Result<Option<(Id, UserAccount)>> {
        let Ok(id) = id.parse::<Id>() else {
            return Ok(None);
        };
        Ok(match self.server.registry().object::<Account>(id).await? {
            Some(Account::User(user)) if user.domain_id == self.domain_id => Some((id, user)),
            _ => None,
        })
    }

    async fn group(&self, id: &str) -> trc::Result<Option<(Id, GroupAccount)>> {
        let Ok(id) = id.parse::<Id>() else {
            return Ok(None);
        };
        Ok(match self.server.registry().object::<Account>(id).await? {
            Some(Account::Group(group)) if group.domain_id == self.domain_id => Some((id, group)),
            _ => None,
        })
    }

    async fn is_protected(&self, id: Id) -> trc::Result<bool> {
        common::orgs::is_server_admin(self.server, id.document_id()).await
    }

    async fn org(&self) -> trc::Result<Option<Organisation>> {
        let domain = self.domain_id.to_string();
        Ok(list_orgs(self.server)
            .await?
            .into_iter()
            .find(|org| org.has_domain(&domain)))
    }

    async fn user_json(&self, id: Id, user: &UserAccount) -> trc::Result<Value> {
        let account_id = id.document_id();
        let email = format!("{}@{}", user.name, self.domain);
        let mut resource = json!({
            "schemas": [USER_SCHEMA],
            "id": id.to_string(),
            "userName": email,
            "active": !scim_state::is_inactive(self.server, account_id).await?,
            "emails": [{ "value": email, "primary": true, "type": "work" }],
            "meta": {
                "resourceType": "User",
                "location": format!("/api/scim/v2/Users/{id}"),
            },
        });
        if let Some(display) = &user.description {
            resource["displayName"] = Value::from(display.as_str());
            resource["name"] = json!({ "formatted": display });
        }
        if let Some(external) = scim_state::external_id(self.server, account_id).await? {
            resource["externalId"] = Value::from(external);
        }
        Ok(resource)
    }

    async fn group_json(&self, id: Id, group: &GroupAccount) -> trc::Result<Value> {
        let members = self
            .users()
            .await?
            .into_iter()
            .filter(|(_, user)| user.member_group_ids.iter().any(|member| *member == id))
            .map(|(member, user)| {
                json!({
                    "value": member.to_string(),
                    "display": format!("{}@{}", user.name, self.domain),
                })
            })
            .collect::<Vec<_>>();
        let mut resource = json!({
            "schemas": [GROUP_SCHEMA],
            "id": id.to_string(),
            "displayName": group.description.clone().unwrap_or_else(|| group.name.clone()),
            "members": members,
            "meta": {
                "resourceType": "Group",
                "location": format!("/api/scim/v2/Groups/{id}"),
            },
        });
        if let Some(external) = scim_state::external_id(self.server, id.document_id()).await? {
            resource["externalId"] = Value::from(external);
        }
        Ok(resource)
    }

    async fn update(&self, id: Id, patch: Map<String, Value>) -> trc::Result<Result<(), String>> {
        if patch.is_empty() {
            return Ok(Ok(()));
        }
        let key = id.to_string();
        let mut update = Map::new();
        update.insert(key.clone(), Value::Object(patch));
        let response = self
            .call("x:Account/set", json!({ "update": update }))
            .await?;
        Ok(set_updated(&response, &key))
    }

    /// Applies a change to a person and answers with who they now are.
    async fn change_user(
        &self,
        id: Id,
        user: &UserAccount,
        change: UserChange,
    ) -> trc::Result<HttpResponse> {
        if self.is_protected(id).await? {
            return error(
                StatusCode::FORBIDDEN,
                "Server administrators cannot be managed from here.",
            );
        }
        let mut patch = Map::new();
        if let Some(display) = &change.display {
            let display = display.trim();
            patch.insert(
                "description".to_string(),
                if display.is_empty() {
                    Value::Null
                } else {
                    Value::from(display)
                },
            );
        }
        // Switching someone off takes away every way in.
        let password = match (change.active, &change.password) {
            (Some(false), _) => Some(random_password()),
            (_, Some(password)) => {
                if let Err(reason) = acceptable_password(password) {
                    return error(StatusCode::BAD_REQUEST, reason);
                }
                Some(password.clone())
            }
            _ => None,
        };
        if change.active == Some(false) {
            patch.insert(
                "credentials".to_string(),
                json!({ "0": { "@type": "Password", "secret": password } }),
            );
        } else if let Some(password) = &password {
            let existing = user
                .credentials
                .0
                .iter()
                .find(|(_, credential)| matches!(credential, Credential::Password(_)));
            match existing {
                Some((key, _)) => {
                    patch.insert(
                        format!("credentials/{key}/secret"),
                        Value::from(password.as_str()),
                    );
                }
                None => {
                    let next = user
                        .credentials
                        .0
                        .iter()
                        .map(|(key, _)| key + 1)
                        .max()
                        .unwrap_or(0);
                    patch.insert(
                        format!("credentials/{next}"),
                        json!({ "@type": "Password", "secret": password }),
                    );
                }
            }
        }
        if let Err(reason) = self.update(id, patch).await? {
            return error(StatusCode::BAD_REQUEST, reason);
        }
        let account_id = id.document_id();
        if let Some(active) = change.active {
            scim_state::set_inactive(self.server, account_id, !active).await?;
        }
        if let Some(external) = &change.external {
            scim_state::set_external_id(self.server, account_id, Some(external)).await?;
        }
        match self.user(&id.to_string()).await? {
            Some((id, user)) => scim(StatusCode::OK, self.user_json(id, &user).await?),
            None => not_found(),
        }
    }

    async fn set_members(
        &self,
        group: Id,
        target: &BTreeSet<String>,
    ) -> trc::Result<Result<(), String>> {
        let key = group.to_string();
        for (id, user) in self.users().await? {
            let wanted = target.contains(&id.to_string());
            let has = user.member_group_ids.iter().any(|member| *member == group);
            if wanted == has {
                continue;
            }
            if self.is_protected(id).await? {
                return Ok(Err(
                    "Server administrators cannot be managed from here.".to_string()
                ));
            }
            let mut set: Map<String, Value> = user
                .member_group_ids
                .iter()
                .filter(|member| **member != group)
                .map(|member| (member.to_string(), Value::Bool(true)))
                .collect();
            if wanted {
                set.insert(key.clone(), Value::Bool(true));
            }
            let mut patch = Map::new();
            patch.insert("memberGroupIds".to_string(), Value::Object(set));
            if let Err(reason) = self.update(id, patch).await? {
                return Ok(Err(reason));
            }
        }
        Ok(Ok(()))
    }

    async fn change_group(
        &self,
        id: Id,
        group: &GroupAccount,
        change: GroupChange,
    ) -> trc::Result<HttpResponse> {
        let users = self.users().await?;
        let known: BTreeSet<String> = users.iter().map(|(id, _)| id.to_string()).collect();
        if change
            .set
            .iter()
            .flatten()
            .chain(&change.add)
            .any(|member| !known.contains(member))
        {
            return error(
                StatusCode::BAD_REQUEST,
                "That member is not on this domain.",
            );
        }
        let mut target: BTreeSet<String> = match &change.set {
            Some(members) => members.iter().cloned().collect(),
            None => users
                .iter()
                .filter(|(_, user)| user.member_group_ids.iter().any(|member| *member == id))
                .map(|(member, _)| member.to_string())
                .collect(),
        };
        target.extend(change.add.iter().cloned());
        for member in &change.remove {
            target.remove(member);
        }
        if let Err(reason) = self.set_members(id, &target).await? {
            return error(StatusCode::BAD_REQUEST, reason);
        }
        if let Some(display) = &change.display {
            let mut patch = Map::new();
            patch.insert("description".to_string(), Value::from(display.trim()));
            if let Err(reason) = self.update(id, patch).await? {
                return error(StatusCode::BAD_REQUEST, reason);
            }
        }
        if let Some(external) = &change.external {
            scim_state::set_external_id(self.server, id.document_id(), Some(external)).await?;
        }
        let _ = group;
        match self.group(&id.to_string()).await? {
            Some((id, group)) => scim(StatusCode::OK, self.group_json(id, &group).await?),
            None => not_found(),
        }
    }

    async fn destroy(&self, id: Id) -> trc::Result<HttpResponse> {
        let key = id.to_string();
        let response = self
            .call("x:Account/set", json!({ "destroy": [key] }))
            .await?;
        match set_destroyed(&response, &key) {
            Ok(()) => Ok(HttpResponse::new(StatusCode::NO_CONTENT).with_no_store()),
            Err(reason) => error(StatusCode::BAD_REQUEST, reason),
        }
    }

    async fn list(
        &self,
        params: &UrlParams<'_>,
        resources: Vec<Value>,
    ) -> trc::Result<HttpResponse> {
        let start = params.parse::<usize>("startIndex").unwrap_or(1).max(1);
        let count = params
            .parse::<usize>("count")
            .unwrap_or(MAX_RESULTS)
            .min(MAX_RESULTS);
        let total = resources.len();
        let page: Vec<Value> = resources.into_iter().skip(start - 1).take(count).collect();
        scim(
            StatusCode::OK,
            json!({
                "schemas": [LIST_SCHEMA],
                "totalResults": total,
                "startIndex": start,
                "itemsPerPage": page.len(),
                "Resources": page,
            }),
        )
    }

    async fn create_user(&self, resource: &Value) -> trc::Result<HttpResponse> {
        let user_name = resource
            .get("userName")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_lowercase();
        let Some((local, domain)) = user_name.split_once('@') else {
            return error(
                StatusCode::BAD_REQUEST,
                "userName must be an email address.",
            );
        };
        if domain != self.domain {
            return error(StatusCode::FORBIDDEN, "That address is not on this domain.");
        }
        let Some(local) = normalize_local_part(local) else {
            return error(StatusCode::BAD_REQUEST, "That address is not valid.");
        };
        let users = self.users().await?;
        if users.iter().any(|(_, user)| user.name == local) {
            return error(StatusCode::CONFLICT, "That person already exists.");
        }
        let mut quotas = json!({});
        if let Some(org) = self.org().await? {
            if users.len() >= org.max_people as usize {
                return error(StatusCode::FORBIDDEN, "This organisation is full.");
            }
            if org.max_storage > 0 {
                let held = users
                    .iter()
                    .filter_map(|(_, user)| user.quotas.get(&StorageQuota::MaxDiskQuota).copied())
                    .fold(0u64, u64::saturating_add);
                if !org.storage_fits(held, Some(CAPPED_DEFAULT_STORAGE)) {
                    return error(
                        StatusCode::FORBIDDEN,
                        "This organisation has no storage left.",
                    );
                }
                quotas = json!({ "maxDiskQuota": CAPPED_DEFAULT_STORAGE });
            }
        }
        let change = UserChange::from_resource(resource);
        let password = match &change.password {
            Some(password) => {
                if let Err(reason) = acceptable_password(password) {
                    return error(StatusCode::BAD_REQUEST, reason);
                }
                password.clone()
            }
            None => random_password(),
        };
        let mut account = json!({
            "@type": "User",
            "name": local,
            "domainId": self.domain_id.to_string(),
            "credentials": { "0": { "@type": "Password", "secret": password } },
            "roles": { "@type": "User" },
            "quotas": quotas,
        });
        if let Some(display) = change
            .display
            .as_deref()
            .map(str::trim)
            .filter(|text| !text.is_empty())
        {
            account["description"] = Value::from(display);
        }
        let response = self
            .call("x:Account/set", json!({ "create": { "a": account } }))
            .await?;
        let created = match set_created(&response, "a") {
            Ok(created) => created,
            Err(reason) => return error(StatusCode::BAD_REQUEST, reason),
        };
        let Some(id) = created
            .get("id")
            .and_then(Value::as_str)
            .and_then(|id| id.parse::<Id>().ok())
        else {
            return error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "The account was not created.",
            );
        };
        if let Some(external) = &change.external {
            scim_state::set_external_id(self.server, id.document_id(), Some(external)).await?;
        }
        if change.active == Some(false) {
            scim_state::set_inactive(self.server, id.document_id(), true).await?;
        }
        match self.user(&id.to_string()).await? {
            Some((id, user)) => scim(StatusCode::CREATED, self.user_json(id, &user).await?),
            None => not_found(),
        }
    }

    async fn create_group(&self, resource: &Value) -> trc::Result<HttpResponse> {
        let change = GroupChange::from_resource(resource);
        let Some(display) = change.display.clone() else {
            return error(StatusCode::BAD_REQUEST, "displayName is required.");
        };
        let Some(name) = group_name(&display) else {
            return error(StatusCode::BAD_REQUEST, "That group name is not valid.");
        };
        if self
            .groups()
            .await?
            .iter()
            .any(|(_, group)| group.name == name)
        {
            return error(StatusCode::CONFLICT, "That group already exists.");
        }
        let response = self
            .call(
                "x:Account/set",
                json!({ "create": { "a": {
                    "@type": "Group",
                    "name": name,
                    "domainId": self.domain_id.to_string(),
                    "description": display.trim(),
                } } }),
            )
            .await?;
        let created = match set_created(&response, "a") {
            Ok(created) => created,
            Err(reason) => return error(StatusCode::BAD_REQUEST, reason),
        };
        let Some((id, group)) = (match created.get("id").and_then(Value::as_str) {
            Some(id) => self.group(id).await?,
            None => None,
        }) else {
            return error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "The group was not created.",
            );
        };
        let members = change.set.clone().unwrap_or_default();
        let result = self
            .change_group(
                id,
                &group,
                GroupChange {
                    set: Some(members),
                    external: change.external,
                    ..GroupChange::default()
                },
            )
            .await?;
        if result.status() != StatusCode::OK {
            return Ok(result);
        }
        match self.group(&id.to_string()).await? {
            Some((id, group)) => scim(StatusCode::CREATED, self.group_json(id, &group).await?),
            None => not_found(),
        }
    }
}

fn service_config() -> Value {
    json!({
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
        "patch": { "supported": true },
        "bulk": { "supported": false, "maxOperations": 0, "maxPayloadSize": 0 },
        "filter": { "supported": true, "maxResults": MAX_RESULTS },
        "changePassword": { "supported": false },
        "sort": { "supported": false },
        "etag": { "supported": false },
        "authenticationSchemes": [{
            "type": "oauthbearertoken",
            "name": "Bearer token",
            "description": "The token made for this domain in shippin.tech",
        }],
    })
}

fn resource_types() -> Value {
    json!({
        "schemas": [LIST_SCHEMA],
        "totalResults": 2,
        "Resources": [
            { "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"], "id": "User", "name": "User", "endpoint": "/Users", "schema": USER_SCHEMA },
            { "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"], "id": "Group", "name": "Group", "endpoint": "/Groups", "schema": GROUP_SCHEMA },
        ],
    })
}

pub trait ProvisioningApi: Sync + Send {
    fn handle_provisioning_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        path: &[&str],
        body: Option<Vec<u8>>,
    ) -> impl Future<Output = trc::Result<HttpResponse>> + Send;
}

impl ProvisioningApi for Server {
    async fn handle_provisioning_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        path: &[&str],
        body: Option<Vec<u8>>,
    ) -> trc::Result<HttpResponse> {
        // Settings, for whoever manages the domain.
        if let ["settings", name] = path {
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
            let base = format!(
                "{}/api/scim/v2",
                self.core.network.http.url_https.trim_end_matches('/')
            );
            return match req.method() {
                &Method::GET => reply(json!({
                    "hasToken": scim_state::has_token(self, domain.id).await?,
                    "endpoint": base,
                })),
                &Method::POST => reply(json!({
                    "token": scim_state::issue_token(self, domain.id).await?,
                    "endpoint": base,
                })),
                &Method::DELETE => {
                    scim_state::revoke_token(self, domain.id).await?;
                    reply(json!({ "revoked": name }))
                }
                _ => Err(trc::ResourceEvent::NotFound.into_err()),
            };
        }

        let ["v2", rest @ ..] = path else {
            return not_found();
        };

        let token = req
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| {
                value
                    .strip_prefix("Bearer ")
                    .or_else(|| value.strip_prefix("bearer "))
            })
            .map(str::trim);
        let domain_id = match token {
            Some(token) => scim_state::domain_for_token(self, token).await?,
            None => None,
        };
        let Some(domain_id) = domain_id else {
            return error(
                StatusCode::UNAUTHORIZED,
                "A valid bearer token is required.",
            );
        };
        let Some(domain) = self.domain_by_id(domain_id).await? else {
            return error(
                StatusCode::UNAUTHORIZED,
                "A valid bearer token is required.",
            );
        };
        let Some(name) = domain.names.first() else {
            return error(
                StatusCode::UNAUTHORIZED,
                "A valid bearer token is required.",
            );
        };
        let scope = Scope {
            server: self,
            session,
            domain_id: Id::from(domain_id),
            domain: name.to_string(),
        };

        let resource: Value = body
            .as_deref()
            .and_then(|bytes| serde_json::from_slice(bytes).ok())
            .unwrap_or(Value::Null);
        let operations = resource
            .get("Operations")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let params = UrlParams::new(req.uri().query());
        let filter = params.get("filter").and_then(parse_filter);

        match (rest, req.method()) {
            (["ServiceProviderConfig"], &Method::GET) => scim(StatusCode::OK, service_config()),
            (["ResourceTypes"], &Method::GET) => scim(StatusCode::OK, resource_types()),
            (["Schemas"], &Method::GET) => scim(
                StatusCode::OK,
                json!({ "schemas": [LIST_SCHEMA], "totalResults": 0, "Resources": [] }),
            ),

            (["Users"], &Method::GET) => {
                let mut found = Vec::new();
                for (id, user) in scope.users().await? {
                    let resource = scope.user_json(id, &user).await?;
                    let wanted = match &filter {
                        Some((attribute, value)) => {
                            let field = match attribute.to_ascii_lowercase().as_str() {
                                "username" => "userName",
                                "externalid" => "externalId",
                                "id" => "id",
                                _ => "",
                            };
                            resource
                                .get(field)
                                .and_then(Value::as_str)
                                .is_some_and(|text| text.eq_ignore_ascii_case(value))
                        }
                        None => true,
                    };
                    if wanted {
                        found.push(resource);
                    }
                }
                scope.list(&params, found).await
            }
            (["Users"], &Method::POST) => scope.create_user(&resource).await,
            (["Users", id], method) => {
                let Some((id, user)) = scope.user(id).await? else {
                    return not_found();
                };
                match method {
                    &Method::GET => scim(StatusCode::OK, scope.user_json(id, &user).await?),
                    &Method::PUT => {
                        scope
                            .change_user(id, &user, UserChange::from_resource(&resource))
                            .await
                    }
                    &Method::PATCH => {
                        scope
                            .change_user(id, &user, UserChange::from_patch(&operations))
                            .await
                    }
                    &Method::DELETE => {
                        if scope.is_protected(id).await? {
                            return error(
                                StatusCode::FORBIDDEN,
                                "Server administrators cannot be managed from here.",
                            );
                        }
                        scope.destroy(id).await
                    }
                    _ => not_found(),
                }
            }

            (["Groups"], &Method::GET) => {
                let mut found = Vec::new();
                for (id, group) in scope.groups().await? {
                    let resource = scope.group_json(id, &group).await?;
                    let wanted = match &filter {
                        Some((attribute, value)) => {
                            let field = match attribute.to_ascii_lowercase().as_str() {
                                "displayname" => "displayName",
                                "externalid" => "externalId",
                                "id" => "id",
                                _ => "",
                            };
                            resource
                                .get(field)
                                .and_then(Value::as_str)
                                .is_some_and(|text| text.eq_ignore_ascii_case(value))
                        }
                        None => true,
                    };
                    if wanted {
                        found.push(resource);
                    }
                }
                scope.list(&params, found).await
            }
            (["Groups"], &Method::POST) => scope.create_group(&resource).await,
            (["Groups", id], method) => {
                let Some((id, group)) = scope.group(id).await? else {
                    return not_found();
                };
                match method {
                    &Method::GET => scim(StatusCode::OK, scope.group_json(id, &group).await?),
                    &Method::PUT => {
                        let mut change = GroupChange::from_resource(&resource);
                        if change.set.is_none() {
                            change.set = Some(Vec::new());
                        }
                        scope.change_group(id, &group, change).await
                    }
                    &Method::PATCH => {
                        scope
                            .change_group(id, &group, GroupChange::from_patch(&operations))
                            .await
                    }
                    &Method::DELETE => {
                        let empty = BTreeSet::new();
                        if let Err(reason) = scope.set_members(id, &empty).await? {
                            return error(StatusCode::BAD_REQUEST, reason);
                        }
                        scope.destroy(id).await
                    }
                    _ => not_found(),
                }
            }
            _ => not_found(),
        }
    }
}
