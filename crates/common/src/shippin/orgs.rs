//! Organisations, written for shippin.tech: our own open code.
//!
//! An organisation groups domains on one server under its own administrators and
//! limits. Its administrators manage the people on those domains and nothing else.
//! This is the base for hosting separate customers later. A domain belongs to one
//! organisation at most, and a person administers one at most.

use crate::{Server, auth::BuildAccessToken};
use registry::schema::enums::Permission;
use serde::{Deserialize, Serialize};
use store::{
    IterateParams, ValueKey,
    rand::{RngExt, distr::Alphanumeric, rng},
    write::{BatchBuilder, InMemoryClass, Operation, ValueClass, ValueOp, now},
};
use trc::AddContext;

pub const KV_ORG: u8 = 49;
const MAX_ORGS: usize = 1000;
const MAX_NAME: usize = 120;
const MAX_PEOPLE: u32 = 100_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Organisation {
    #[serde(default)]
    pub id: String,
    pub name: String,
    /// Domain ids.
    pub domains: Vec<String>,
    /// Account ids of its administrators.
    pub admins: Vec<String>,
    pub max_people: u32,
    /// Bytes shared between its people. Zero means no limit.
    #[serde(default)]
    pub max_storage: u64,
    #[serde(default)]
    pub created_at: u64,
}

impl Organisation {
    pub fn problem(&self) -> Option<&'static str> {
        if self.name.trim().is_empty() || self.name.len() > MAX_NAME {
            return Some("Give the organisation a name of up to 120 characters.");
        }
        if self.domains.is_empty() {
            return Some("Choose at least one domain.");
        }
        if self.admins.is_empty() {
            return Some("Name at least one administrator.");
        }
        if self.max_people == 0 || self.max_people > MAX_PEOPLE {
            return Some("Allow between 1 and 100,000 people.");
        }
        None
    }

    pub fn has_domain(&self, domain_id: &str) -> bool {
        self.domains.iter().any(|id| id == domain_id)
    }

    pub fn is_admin(&self, account_id: &str) -> bool {
        self.admins.iter().any(|id| id == account_id)
    }

    /// Whether one person can have `requested` bytes when the others hold `others`.
    pub fn storage_fits(&self, others: u64, requested: Option<u64>) -> bool {
        if self.max_storage == 0 {
            return true;
        }
        match requested {
            Some(requested) => others.saturating_add(requested) <= self.max_storage,
            None => false,
        }
    }
}

/// Whether this account can run the whole server. Whoever manages one domain, and any
/// identity provider that domain trusts, must never be able to change such an account.
pub async fn is_server_admin(server: &Server, account_id: u32) -> trc::Result<bool> {
    let token = server
        .access_token(account_id)
        .await
        .caused_by(trc::location!())?
        .build();
    Ok([
        Permission::SysDomainUpdate,
        Permission::SysAccountUpdate,
        Permission::Impersonate,
    ]
    .iter()
    .any(|permission| token.has_permission(*permission)))
}

/// Why this organisation clashes with the ones already saved, if it does.
pub fn clash(org: &Organisation, others: &[Organisation]) -> Option<&'static str> {
    for other in others.iter().filter(|other| other.id != org.id) {
        if org.domains.iter().any(|domain| other.has_domain(domain)) {
            return Some("One of those domains already belongs to another organisation.");
        }
        if org.admins.iter().any(|admin| other.is_admin(admin)) {
            return Some("That person already runs another organisation.");
        }
    }
    None
}

fn key(id: &str) -> Vec<u8> {
    let mut key = Vec::with_capacity(1 + id.len());
    key.push(KV_ORG);
    key.extend_from_slice(id.as_bytes());
    key
}

fn value_key(key: Vec<u8>) -> ValueKey<ValueClass> {
    ValueKey::from(ValueClass::InMemory(InMemoryClass::Key(key)))
}

pub async fn list_orgs(server: &Server) -> trc::Result<Vec<Organisation>> {
    let mut orgs = Vec::new();
    let mut to = vec![KV_ORG];
    to.extend_from_slice(&[u8::MAX; 32]);
    server
        .store()
        .iterate(
            IterateParams::new(value_key(vec![KV_ORG]), value_key(to)),
            |_, value| {
                if let Some(org) = value
                    .get(8..)
                    .and_then(|json| serde_json::from_slice::<Organisation>(json).ok())
                {
                    orgs.push(org);
                }
                Ok(true)
            },
        )
        .await
        .caused_by(trc::location!())?;
    orgs.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(orgs)
}

/// The organisation this account runs, if any.
pub async fn org_for_admin(server: &Server, account_id: &str) -> trc::Result<Option<Organisation>> {
    Ok(list_orgs(server)
        .await?
        .into_iter()
        .find(|org| org.is_admin(account_id)))
}

async fn put(server: &Server, id: &str, org: Option<&Organisation>) -> trc::Result<()> {
    let mut batch = BatchBuilder::new();
    batch.any_op(Operation::Value {
        class: ValueClass::InMemory(InMemoryClass::Key(key(id))),
        op: match org {
            Some(org) => {
                let mut value = u64::MAX.to_be_bytes().to_vec();
                value.extend_from_slice(&serde_json::to_vec(org).unwrap_or_default());
                ValueOp::Set(value)
            }
            None => ValueOp::Clear,
        },
    });
    server
        .store()
        .write(batch.build_all())
        .await
        .caused_by(trc::location!())
        .map(|_| ())
}

/// Creates or replaces an organisation. The inner error says why it cannot be saved.
pub async fn save_org(
    server: &Server,
    mut org: Organisation,
) -> trc::Result<Result<Organisation, &'static str>> {
    if let Some(problem) = org.problem() {
        return Ok(Err(problem));
    }
    let existing = list_orgs(server).await?;
    if let Some(problem) = clash(&org, &existing) {
        return Ok(Err(problem));
    }
    match existing
        .iter()
        .find(|item| !org.id.is_empty() && item.id == org.id)
    {
        Some(current) => org.created_at = current.created_at,
        None => {
            if existing.len() >= MAX_ORGS {
                return Ok(Err("There can be up to 1,000 organisations."));
            }
            org.id = rng()
                .sample_iter(Alphanumeric)
                .take(16)
                .map(char::from)
                .collect::<String>()
                .to_lowercase();
            org.created_at = now();
        }
    }
    org.name = org.name.trim().to_string();
    put(server, &org.id, Some(&org)).await?;
    Ok(Ok(org))
}

/// Removes the organisation only. Its domains and people stay on the server.
pub async fn delete_org(server: &Server, id: &str) -> trc::Result<()> {
    put(server, id, None).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn org() -> Organisation {
        Organisation {
            id: "a".into(),
            name: "Hill Farm".into(),
            domains: vec!["d1".into()],
            admins: vec!["u1".into()],
            max_people: 5,
            max_storage: 100,
            created_at: 0,
        }
    }

    #[test]
    fn organisations_are_checked_before_saving() {
        assert_eq!(org().problem(), None);
        assert!(
            Organisation {
                name: " ".into(),
                ..org()
            }
            .problem()
            .is_some()
        );
        assert!(
            Organisation {
                domains: vec![],
                ..org()
            }
            .problem()
            .is_some()
        );
        assert!(
            Organisation {
                admins: vec![],
                ..org()
            }
            .problem()
            .is_some()
        );
        assert!(
            Organisation {
                max_people: 0,
                ..org()
            }
            .problem()
            .is_some()
        );
    }

    #[test]
    fn a_domain_or_an_administrator_belongs_to_one_organisation() {
        let other = Organisation {
            id: "b".into(),
            domains: vec!["d2".into()],
            admins: vec!["u2".into()],
            ..org()
        };
        assert_eq!(clash(&org(), std::slice::from_ref(&other)), None);
        let same_domain = Organisation {
            domains: vec!["d1".into()],
            ..other.clone()
        };
        assert!(
            clash(&org(), std::slice::from_ref(&same_domain))
                .unwrap()
                .contains("domains")
        );
        let same_admin = Organisation {
            admins: vec!["u1".into()],
            ..other
        };
        assert!(
            clash(&org(), std::slice::from_ref(&same_admin))
                .unwrap()
                .contains("runs")
        );
        // Saving over itself is not a clash.
        assert_eq!(clash(&org(), &[org()]), None);
    }

    #[test]
    fn storage_is_shared_between_people() {
        assert!(org().storage_fits(60, Some(40)));
        assert!(!org().storage_fits(60, Some(41)));
        // With a shared limit, everyone needs a limit of their own.
        assert!(!org().storage_fits(0, None));
        let open = Organisation {
            max_storage: 0,
            ..org()
        };
        assert!(open.storage_fits(u64::MAX, None));
    }

    #[test]
    fn membership_is_exact() {
        assert!(org().has_domain("d1"));
        assert!(!org().has_domain("d"));
        assert!(org().is_admin("u1"));
        assert!(!org().is_admin("u2"));
    }
}
