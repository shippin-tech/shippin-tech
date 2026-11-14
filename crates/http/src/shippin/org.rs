//! Organisations (`common::orgs`).
//!
//! `/api/orgs` is for the server's administrators: list, save and remove organisations.
//! `/api/org` is for an organisation's own administrators, and only ever reaches the
//! people on that organisation's domains. Writes run through the normal management
//! handlers, as the free-plan panel's do.

use crate::{
    auth::authenticate::Authenticator,
    panel::{
        acceptable_password, input, internal_call, management_token, normalize_local_part, problem,
        reply, set_created, set_destroyed, set_updated, text,
    },
};
use common::{
    Server, masks,
    orgs::{self, Organisation, is_server_admin},
};
use http_proto::{HttpRequest, HttpResponse, HttpSessionData};
use hyper::{Method, StatusCode};
use registry::{
    schema::{
        enums::{AccountType, Permission, StorageQuota},
        prelude::{ObjectType, Property},
        structs::{Account, Credential, Domain, GroupAccount, UserAccount},
    },
    types::EnumImpl,
};
use serde_json::{Map, Value, json};
use store::registry::RegistryQuery;
use types::id::Id;

const GB: u64 = 1024 * 1024 * 1024;
const MAX_ALIASES: usize = 50;

fn limit_of(user: &UserAccount) -> Option<u64> {
    user.quotas
        .get(&StorageQuota::MaxDiskQuota)
        .copied()
        .filter(|limit| *limit > 0)
}

fn limit_from(body: &Value) -> Result<Option<u64>, ()> {
    match body.get("limitGb") {
        None | Some(Value::Null) => Ok(None),
        Some(value) => match value.as_f64() {
            Some(gb) if gb.is_finite() && gb > 0.0 && gb <= 1_000_000.0 => {
                Ok(Some((gb * GB as f64) as u64))
            }
            _ => Err(()),
        },
    }
}

async fn domain_name(server: &Server, id: Id) -> trc::Result<Option<String>> {
    Ok(server
        .registry()
        .object::<Domain>(id)
        .await?
        .map(|domain| domain.name))
}

pub(crate) async fn people_of(
    server: &Server,
    org: &Organisation,
) -> trc::Result<Vec<(Id, UserAccount)>> {
    let mut people = Vec::new();
    for domain in org.domains.iter().filter_map(|id| id.parse::<Id>().ok()) {
        for id in server
            .registry()
            .query::<Vec<Id>>(
                RegistryQuery::new(ObjectType::Account)
                    .equal(Property::DomainId, domain.document_id())
                    .equal(Property::Type, AccountType::User.to_id()),
            )
            .await?
        {
            if let Some(Account::User(user)) = server.registry().object::<Account>(id).await?
                && user.domain_id == domain
            {
                people.push((id, user));
            }
        }
    }
    people.sort_by(|a, b| a.1.name.cmp(&b.1.name));
    Ok(people)
}

async fn person_in(
    server: &Server,
    org: &Organisation,
    id: &str,
) -> trc::Result<Option<(Id, UserAccount)>> {
    let Ok(id) = id.parse::<Id>() else {
        return Ok(None);
    };
    Ok(match server.registry().object::<Account>(id).await? {
        Some(Account::User(user))
            if org.has_domain(&user.domain_id.to_string())
                && !is_server_admin(server, id.document_id()).await? =>
        {
            Some((id, user))
        }
        _ => None,
    })
}

async fn teams_of(server: &Server, org: &Organisation) -> trc::Result<Vec<(Id, GroupAccount)>> {
    let mut teams = Vec::new();
    for domain in org.domains.iter().filter_map(|id| id.parse::<Id>().ok()) {
        for id in server
            .registry()
            .query::<Vec<Id>>(
                RegistryQuery::new(ObjectType::Account)
                    .equal(Property::DomainId, domain.document_id())
                    .equal(Property::Type, AccountType::Group.to_id()),
            )
            .await?
        {
            if let Some(Account::Group(team)) = server.registry().object::<Account>(id).await?
                && team.domain_id == domain
            {
                teams.push((id, team));
            }
        }
    }
    teams.sort_by(|a, b| a.1.name.cmp(&b.1.name));
    Ok(teams)
}

async fn team_in(
    server: &Server,
    org: &Organisation,
    id: &str,
) -> trc::Result<Option<(Id, GroupAccount)>> {
    let Ok(id) = id.parse::<Id>() else {
        return Ok(None);
    };
    Ok(match server.registry().object::<Account>(id).await? {
        Some(Account::Group(team)) if org.has_domain(&team.domain_id.to_string()) => {
            Some((id, team))
        }
        _ => None,
    })
}

/// Whoever is on a team, as a set of teams for one person with `team` added or taken away.
fn membership(user: &UserAccount, team: Id, member: bool) -> Value {
    let mut set: Map<String, Value> = user
        .member_group_ids
        .iter()
        .filter(|id| **id != team)
        .map(|id| (id.to_string(), Value::Bool(true)))
        .collect();
    if member {
        set.insert(team.to_string(), Value::Bool(true));
    }
    Value::Object(set)
}

async fn patch_account(
    server: &Server,
    account_id: u32,
    session: &HttpSessionData,
    id: Id,
    patch: Map<String, Value>,
) -> trc::Result<Result<(), String>> {
    let key = id.to_string();
    let mut update = Map::new();
    update.insert(key.clone(), Value::Object(patch));
    let response = internal_call(
        server,
        &management_token(server, account_id).await?,
        session,
        "x:Account/set",
        json!({ "update": update }),
    )
    .await?;
    Ok(set_updated(&response, &key))
}

pub(crate) fn storage_held(people: &[(Id, UserAccount)], except: Option<Id>) -> u64 {
    people
        .iter()
        .filter(|(id, _)| Some(*id) != except)
        .filter_map(|(_, user)| limit_of(user))
        .fold(0u64, u64::saturating_add)
}

/// Addresses for ids, and ids for addresses, so people deal in email addresses.
async fn admin_emails(server: &Server, org: &Organisation) -> trc::Result<Vec<String>> {
    let mut emails = Vec::with_capacity(org.admins.len());
    for id in org.admins.iter().filter_map(|id| id.parse::<Id>().ok()) {
        if let Some((email, _)) = masks::primary_address(server, id.document_id()).await? {
            emails.push(email);
        }
    }
    Ok(emails)
}

async fn org_json(server: &Server, org: &Organisation) -> trc::Result<Value> {
    let people = people_of(server, org).await?;
    Ok(json!({
        "id": org.id,
        "name": org.name,
        "domains": org.domains,
        "admins": admin_emails(server, org).await?,
        "maxPeople": org.max_people,
        "maxStorage": org.max_storage,
        "createdAt": org.created_at,
        "people": people.len(),
        "storageHeld": storage_held(&people, None),
    }))
}

pub trait OrgApi: Sync + Send {
    fn handle_orgs_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        path: &[&str],
        body: Option<Vec<u8>>,
    ) -> impl Future<Output = trc::Result<HttpResponse>> + Send;

    fn handle_org_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        path: &[&str],
        body: Option<Vec<u8>>,
    ) -> impl Future<Output = trc::Result<HttpResponse>> + Send;
}

impl OrgApi for Server {
    async fn handle_orgs_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        path: &[&str],
        body: Option<Vec<u8>>,
    ) -> trc::Result<HttpResponse> {
        let (_in_flight, access_token) = self.authenticate_headers(req, session).await?;
        access_token.enforce_permission(Permission::SysDomainUpdate)?;
        access_token.enforce_permission(Permission::SysAccountUpdate)?;
        let body = input(&body);

        match (path, req.method()) {
            ([] | [""], &Method::GET) => {
                let mut list = Vec::new();
                for org in orgs::list_orgs(self).await? {
                    list.push(org_json(self, &org).await?);
                }
                let mut domains = Vec::new();
                for id in self
                    .registry()
                    .query::<Vec<Id>>(RegistryQuery::new(ObjectType::Domain))
                    .await?
                {
                    if let Some(name) = domain_name(self, id).await? {
                        domains.push(json!({ "id": id.to_string(), "name": name }));
                    }
                }
                reply(json!({ "orgs": list, "domains": domains }))
            }
            ([] | [""], &Method::POST) => {
                let domains: Vec<String> = body
                    .get("domains")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .collect()
                    })
                    .unwrap_or_default();
                let mut admins = Vec::new();
                for email in body
                    .get("admins")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                {
                    let Some(account_id) = self.account_id_from_email(email, false).await? else {
                        return problem(
                            StatusCode::BAD_REQUEST,
                            "unknownAdmin",
                            format!("There is no account for {email}."),
                        );
                    };
                    let id = Id::from(account_id);
                    match self.registry().object::<Account>(id).await? {
                        Some(Account::User(user))
                            if domains.contains(&user.domain_id.to_string()) =>
                        {
                            admins.push(id.to_string());
                        }
                        _ => {
                            return problem(
                                StatusCode::BAD_REQUEST,
                                "adminOutside",
                                format!("{email} is not on one of this organisation's domains."),
                            );
                        }
                    }
                }
                let org = Organisation {
                    id: text(&body, "id").to_string(),
                    name: text(&body, "name").to_string(),
                    domains,
                    admins,
                    max_people: body
                        .get("maxPeople")
                        .and_then(Value::as_u64)
                        .unwrap_or_default()
                        .min(u32::MAX as u64) as u32,
                    max_storage: body
                        .get("maxStorageGb")
                        .and_then(Value::as_u64)
                        .unwrap_or_default()
                        .saturating_mul(GB),
                    created_at: 0,
                };
                match orgs::save_org(self, org).await? {
                    Ok(org) => reply(org_json(self, &org).await?),
                    Err(message) => problem(StatusCode::BAD_REQUEST, "invalid", message),
                }
            }
            ([id], &Method::DELETE) => {
                orgs::delete_org(self, id).await?;
                reply(json!({ "deleted": id }))
            }
            _ => Err(trc::ResourceEvent::NotFound.into_err()),
        }
    }

    async fn handle_org_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        path: &[&str],
        body: Option<Vec<u8>>,
    ) -> trc::Result<HttpResponse> {
        let (_in_flight, access_token) = self.authenticate_headers(req, session).await?;
        let account_id = access_token.account_id();
        let me = Id::from(account_id).to_string();
        let Some(org) = orgs::org_for_admin(self, &me).await? else {
            return problem(
                StatusCode::FORBIDDEN,
                "notOrgAdmin",
                "This account does not run an organisation.",
            );
        };
        let body = input(&body);

        match (path, req.method()) {
            ([] | [""], &Method::GET) => {
                let people = people_of(self, &org).await?;
                let mut domains = Vec::new();
                let mut names = Vec::new();
                for id in org.domains.iter().filter_map(|id| id.parse::<Id>().ok()) {
                    if let Some(name) = domain_name(self, id).await? {
                        domains.push(json!({ "id": id.to_string(), "name": name }));
                        names.push((id, name));
                    }
                }
                let mut list = Vec::with_capacity(people.len());
                let mut storage_used = 0u64;
                for (id, user) in &people {
                    let used = self.get_used_quota_account(id.document_id()).await?.max(0) as u64;
                    storage_used = storage_used.saturating_add(used);
                    let domain = names
                        .iter()
                        .find(|(domain, _)| *domain == user.domain_id)
                        .map_or("", |(_, name)| name.as_str());
                    list.push(json!({
                        "id": id.to_string(),
                        "name": user.name,
                        "email": format!("{}@{domain}", user.name),
                        "domainId": user.domain_id.to_string(),
                        "fullName": user.description.clone().unwrap_or_default(),
                        "limit": limit_of(user),
                        "used": used,
                        "aliases": user.aliases.iter().map(|alias| format!("{}@{domain}", alias.name)).collect::<Vec<_>>(),
                        "teamIds": user.member_group_ids.iter().map(|team| team.to_string()).collect::<Vec<_>>(),
                        "admin": org.is_admin(&id.to_string()),
                        "protected": is_server_admin(self, id.document_id()).await?,
                    }));
                }
                let mut teams = Vec::new();
                for (id, team) in teams_of(self, &org).await? {
                    let domain = names
                        .iter()
                        .find(|(domain, _)| *domain == team.domain_id)
                        .map_or("", |(_, name)| name.as_str());
                    teams.push(json!({
                        "id": id.to_string(),
                        "name": team.name,
                        "email": format!("{}@{domain}", team.name),
                        "domainId": team.domain_id.to_string(),
                        "description": team.description.clone().unwrap_or_default(),
                    }));
                }
                reply(json!({
                    "storageUsed": storage_used,
                    "teams": teams,
                    "name": org.name,
                    "maxPeople": org.max_people,
                    "maxStorage": org.max_storage,
                    "storageHeld": storage_held(&people, None),
                    "domains": domains,
                    "people": list,
                    "me": me,
                }))
            }
            (["people"], &Method::POST) => {
                let domain_id = text(&body, "domainId");
                if !org.has_domain(domain_id) {
                    return problem(
                        StatusCode::FORBIDDEN,
                        "notYourDomain",
                        "That domain is not part of your organisation.",
                    );
                }
                let Some(local) = normalize_local_part(text(&body, "name")) else {
                    return problem(
                        StatusCode::BAD_REQUEST,
                        "invalidName",
                        "Use letters, digits, dots, dashes or underscores for the address.",
                    );
                };
                let password = text(&body, "password");
                if let Err(reason) = acceptable_password(password) {
                    return problem(StatusCode::BAD_REQUEST, "weakPassword", reason);
                }
                let Ok(limit) = limit_from(&body) else {
                    return problem(
                        StatusCode::BAD_REQUEST,
                        "invalidLimit",
                        "Storage must be more than zero.",
                    );
                };
                let people = people_of(self, &org).await?;
                if people.len() >= org.max_people as usize {
                    return problem(
                        StatusCode::FORBIDDEN,
                        "peopleLimit",
                        format!("Your organisation can have {} people.", org.max_people),
                    );
                }
                if !org.storage_fits(storage_held(&people, None), limit) {
                    return problem(
                        StatusCode::FORBIDDEN,
                        "storageLimit",
                        "That is more storage than your organisation has left.",
                    );
                }
                let mut account = json!({
                    "@type": "User",
                    "name": local,
                    "domainId": domain_id,
                    "credentials": { "0": { "@type": "Password", "secret": password } },
                    "roles": { "@type": "User" },
                    "quotas": limit.map_or(json!({}), |limit| json!({ "maxDiskQuota": limit })),
                });
                let full_name = text(&body, "fullName").trim();
                if !full_name.is_empty() {
                    account["description"] = Value::from(full_name);
                }
                let response = internal_call(
                    self,
                    &management_token(self, account_id).await?,
                    session,
                    "x:Account/set",
                    json!({ "create": { "a": account } }),
                )
                .await?;
                match set_created(&response, "a") {
                    Ok(created) => reply(json!({ "id": created.get("id").cloned() })),
                    Err(reason) => problem(StatusCode::BAD_REQUEST, "rejected", reason),
                }
            }
            (["people", id], &Method::POST) => {
                let Some((id, user)) = person_in(self, &org, id).await? else {
                    return Err(trc::ResourceEvent::NotFound.into_err());
                };
                let mut patch = Map::new();
                let password = text(&body, "password");
                if !password.is_empty() {
                    if let Err(reason) = acceptable_password(password) {
                        return problem(StatusCode::BAD_REQUEST, "weakPassword", reason);
                    }
                    match user
                        .credentials
                        .0
                        .iter()
                        .find(|(_, credential)| matches!(credential, Credential::Password(_)))
                    {
                        Some((key, _)) => {
                            patch
                                .insert(format!("credentials/{key}/secret"), Value::from(password));
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
                if body.get("limitGb").is_some() {
                    let Ok(limit) = limit_from(&body) else {
                        return problem(
                            StatusCode::BAD_REQUEST,
                            "invalidLimit",
                            "Storage must be more than zero.",
                        );
                    };
                    let people = people_of(self, &org).await?;
                    if !org.storage_fits(storage_held(&people, Some(id)), limit) {
                        return problem(
                            StatusCode::FORBIDDEN,
                            "storageLimit",
                            "That is more storage than your organisation has left.",
                        );
                    }
                    patch.insert(
                        "quotas".to_string(),
                        limit.map_or(json!({}), |limit| json!({ "maxDiskQuota": limit })),
                    );
                }
                if body.get("fullName").is_some() {
                    let full_name = text(&body, "fullName").trim();
                    patch.insert(
                        "description".to_string(),
                        if full_name.is_empty() {
                            Value::Null
                        } else {
                            Value::from(full_name)
                        },
                    );
                }
                if patch.is_empty() {
                    return reply(json!({ "updated": id.to_string() }));
                }
                let key = id.to_string();
                let mut update = Map::new();
                update.insert(key.clone(), Value::Object(patch));
                let response = internal_call(
                    self,
                    &management_token(self, account_id).await?,
                    session,
                    "x:Account/set",
                    json!({ "update": update }),
                )
                .await?;
                match set_updated(&response, &key) {
                    Ok(()) => reply(json!({ "updated": key })),
                    Err(reason) => problem(StatusCode::BAD_REQUEST, "rejected", reason),
                }
            }
            (["people", id], &Method::DELETE) => {
                let Some((id, _)) = person_in(self, &org, id).await? else {
                    return Err(trc::ResourceEvent::NotFound.into_err());
                };
                if org.is_admin(&id.to_string()) {
                    return problem(
                        StatusCode::CONFLICT,
                        "isAdmin",
                        "An organisation's administrator cannot be removed from here.",
                    );
                }
                let key = id.to_string();
                let response = internal_call(
                    self,
                    &management_token(self, account_id).await?,
                    session,
                    "x:Account/set",
                    json!({ "destroy": [key] }),
                )
                .await?;
                match set_destroyed(&response, &key) {
                    Ok(()) => reply(json!({ "deleted": key })),
                    Err(reason) => problem(StatusCode::BAD_REQUEST, "rejected", reason),
                }
            }
            (["teams"], &Method::POST) => {
                let domain_id = text(&body, "domainId");
                if !org.has_domain(domain_id) {
                    return problem(
                        StatusCode::FORBIDDEN,
                        "notYourDomain",
                        "That domain is not part of your organisation.",
                    );
                }
                let Some(name) = normalize_local_part(text(&body, "name")) else {
                    return problem(
                        StatusCode::BAD_REQUEST,
                        "invalidName",
                        "Use letters, digits, dots, dashes or underscores for the team's address.",
                    );
                };
                let mut team = json!({ "@type": "Group", "name": name, "domainId": domain_id });
                let description = text(&body, "description").trim();
                if !description.is_empty() {
                    team["description"] = Value::from(description);
                }
                let response = internal_call(
                    self,
                    &management_token(self, account_id).await?,
                    session,
                    "x:Account/set",
                    json!({ "create": { "a": team } }),
                )
                .await?;
                match set_created(&response, "a") {
                    Ok(created) => reply(json!({ "id": created.get("id").cloned() })),
                    Err(reason) => problem(StatusCode::BAD_REQUEST, "rejected", reason),
                }
            }
            (["teams", id, "members"], &Method::POST) => {
                let Some((team, _)) = team_in(self, &org, id).await? else {
                    return Err(trc::ResourceEvent::NotFound.into_err());
                };
                let Some((person, user)) = person_in(self, &org, text(&body, "person")).await?
                else {
                    return Err(trc::ResourceEvent::NotFound.into_err());
                };
                let member = body.get("member").and_then(Value::as_bool).unwrap_or(false);
                let mut patch = Map::new();
                patch.insert(
                    "memberGroupIds".to_string(),
                    membership(&user, team, member),
                );
                match patch_account(self, account_id, session, person, patch).await? {
                    Ok(()) => reply(json!({ "member": member })),
                    Err(reason) => problem(StatusCode::BAD_REQUEST, "rejected", reason),
                }
            }
            (["teams", id], &Method::DELETE) => {
                let Some((team, _)) = team_in(self, &org, id).await? else {
                    return Err(trc::ResourceEvent::NotFound.into_err());
                };
                for (person, user) in people_of(self, &org).await? {
                    if user.member_group_ids.iter().any(|member| *member == team) {
                        let mut patch = Map::new();
                        patch.insert("memberGroupIds".to_string(), membership(&user, team, false));
                        if let Err(reason) =
                            patch_account(self, account_id, session, person, patch).await?
                        {
                            return problem(StatusCode::BAD_REQUEST, "rejected", reason);
                        }
                    }
                }
                let key = team.to_string();
                let response = internal_call(
                    self,
                    &management_token(self, account_id).await?,
                    session,
                    "x:Account/set",
                    json!({ "destroy": [key] }),
                )
                .await?;
                match set_destroyed(&response, &key) {
                    Ok(()) => reply(json!({ "deleted": key })),
                    Err(reason) => problem(StatusCode::BAD_REQUEST, "rejected", reason),
                }
            }
            (["people", id, "aliases"], &Method::POST) => {
                let Some((person, user)) = person_in(self, &org, id).await? else {
                    return Err(trc::ResourceEvent::NotFound.into_err());
                };
                let Some(alias) = normalize_local_part(text(&body, "alias")) else {
                    return problem(
                        StatusCode::BAD_REQUEST,
                        "invalidName",
                        "Use letters, digits, dots, dashes or underscores for the alias.",
                    );
                };
                if user.aliases.len() >= MAX_ALIASES {
                    return problem(
                        StatusCode::FORBIDDEN,
                        "aliasLimit",
                        format!("One person can have {MAX_ALIASES} aliases."),
                    );
                }
                if alias == user.name || user.aliases.iter().any(|item| item.name == alias) {
                    return problem(StatusCode::CONFLICT, "exists", "That alias already exists.");
                }
                let next = user
                    .aliases
                    .0
                    .iter()
                    .map(|(key, _)| key + 1)
                    .max()
                    .unwrap_or(0);
                let mut patch = Map::new();
                patch.insert(
                    format!("aliases/{next}"),
                    json!({ "enabled": true, "name": alias, "domainId": user.domain_id.to_string() }),
                );
                match patch_account(self, account_id, session, person, patch).await? {
                    Ok(()) => reply(json!({ "alias": alias })),
                    Err(reason) => problem(StatusCode::CONFLICT, "rejected", reason),
                }
            }
            (["people", id, "aliases", alias], &Method::DELETE) => {
                let Some((person, user)) = person_in(self, &org, id).await? else {
                    return Err(trc::ResourceEvent::NotFound.into_err());
                };
                let alias = alias.to_ascii_lowercase();
                let Some((key, _)) = user.aliases.0.iter().find(|(_, item)| item.name == alias)
                else {
                    return Err(trc::ResourceEvent::NotFound.into_err());
                };
                let mut patch = Map::new();
                patch.insert(format!("aliases/{key}"), Value::Null);
                match patch_account(self, account_id, session, person, patch).await? {
                    Ok(()) => reply(json!({ "removed": alias })),
                    Err(reason) => problem(StatusCode::BAD_REQUEST, "rejected", reason),
                }
            }
            (["domains", id, "dns"], &Method::GET) => {
                use common::network::dns::records::DnsRecordState;
                if !org.has_domain(id) {
                    return Err(trc::ResourceEvent::NotFound.into_err());
                }
                let Ok(domain_id) = id.parse::<Id>() else {
                    return Err(trc::ResourceEvent::NotFound.into_err());
                };
                let Some(domain) = self.registry().object::<Domain>(domain_id).await? else {
                    return Err(trc::ResourceEvent::NotFound.into_err());
                };
                let records = self
                    .check_dns_records(domain_id, &domain)
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
                let zone = self
                    .build_bind_dns_records(domain_id, &domain)
                    .await
                    .unwrap_or_default();
                reply(json!({ "domain": domain.name, "zone": zone, "records": records }))
            }
            _ => Err(trc::ResourceEvent::NotFound.into_err()),
        }
    }
}
