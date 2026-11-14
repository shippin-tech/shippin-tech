//! `GET /api/resources`: the server, and how much each organisation is using.
//! For the server's administrators.

use crate::{
    auth::authenticate::Authenticator,
    org::{people_of, storage_held},
    panel::reply,
};
use common::{
    Server,
    orgs::list_orgs,
    resources::{DATA_PATH, disk, level},
    stats::{Range, query},
};
use http_proto::{HttpRequest, HttpResponse, HttpSessionData};
use registry::{
    schema::{
        enums::{AccountType, Permission},
        prelude::{ObjectType, Property},
        structs::{Account, Domain},
    },
    types::EnumImpl,
};
use serde_json::json;
use std::collections::HashSet;
use store::{registry::RegistryQuery, write::now};
use trc::MetricType;
use types::id::Id;

pub trait ResourcesApi: Sync + Send {
    fn handle_resources_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
    ) -> impl Future<Output = trc::Result<HttpResponse>> + Send;
}

impl ResourcesApi for Server {
    async fn handle_resources_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
    ) -> trc::Result<HttpResponse> {
        let (_in_flight, access_token) = self.authenticate_headers(req, session).await?;
        access_token.enforce_permission(Permission::LiveMetrics)?;
        access_token.enforce_permission(Permission::SysAccountGet)?;

        let end = now();
        let live = query(
            self,
            Range::Custom {
                from: end.saturating_sub(3600),
                to: end,
            },
            None,
        )
        .await?
        .ok()
        .map(|stats| stats.live)
        .unwrap_or_default();
        let gauge = |metric: MetricType| live.get(metric.as_str()).copied().unwrap_or_default();

        let orgs = list_orgs(self).await?;
        let mut in_orgs = HashSet::new();
        let mut rows = Vec::with_capacity(orgs.len());
        for org in &orgs {
            let people = people_of(self, org).await?;
            let mut used = 0u64;
            for (id, _) in &people {
                used = used.saturating_add(
                    self.get_used_quota_account(id.document_id()).await?.max(0) as u64,
                );
            }
            let mut domains = Vec::with_capacity(org.domains.len());
            for id in org.domains.iter().filter_map(|id| id.parse::<Id>().ok()) {
                in_orgs.insert(id);
                if let Some(domain) = self.registry().object::<Domain>(id).await? {
                    domains.push(domain.name);
                }
            }
            rows.push(json!({
                "id": org.id,
                "name": org.name,
                "domains": domains,
                "people": people.len(),
                "maxPeople": org.max_people,
                "peopleLevel": level(people.len() as u64, u64::from(org.max_people)),
                "storageUsed": used,
                "storageHeld": storage_held(&people, None),
                "maxStorage": org.max_storage,
                "storageLevel": level(used, org.max_storage),
            }));
        }

        // Everything not in an organisation, such as free-plan domains.
        let mut other_domains = 0usize;
        let mut other_people = 0usize;
        let mut other_used = 0u64;
        for domain in self
            .registry()
            .query::<Vec<Id>>(RegistryQuery::new(ObjectType::Domain))
            .await?
        {
            if in_orgs.contains(&domain) {
                continue;
            }
            other_domains += 1;
            for id in self
                .registry()
                .query::<Vec<Id>>(
                    RegistryQuery::new(ObjectType::Account)
                        .equal(Property::DomainId, domain.document_id())
                        .equal(Property::Type, AccountType::User.to_id()),
                )
                .await?
            {
                if matches!(
                    self.registry().object::<Account>(id).await?,
                    Some(Account::User(_))
                ) {
                    other_people += 1;
                    other_used = other_used.saturating_add(
                        self.get_used_quota_account(id.document_id()).await?.max(0) as u64,
                    );
                }
            }
        }

        reply(json!({
            "server": {
                "host": self.core.network.server_name,
                "memory": gauge(MetricType::ServerMemory),
                "disk": disk(DATA_PATH),
                "people": gauge(MetricType::UserCount),
                "domains": gauge(MetricType::DomainCount),
                "queue": gauge(MetricType::QueueCount),
            },
            "orgs": rows,
            "other": {
                "domains": other_domains,
                "people": other_people,
                "storageUsed": other_used,
            },
        }))
    }
}
