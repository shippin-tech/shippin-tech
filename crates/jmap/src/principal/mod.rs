

pub mod availability;
pub mod get;
pub mod query;

use common::{Server, auth::AccessToken};
use registry::schema::prelude::{ObjectType, Permission, Property};
use store::{registry::RegistryQuery, roaring::RoaringBitmap};
use trc::AddContext;

/// Who this person may look up. Administrators see every account in their tenant.
/// Everyone else sees people on their own domains, the accounts that share with
/// them, and themselves, so one customer of a server never sees another's list.
pub(crate) async fn visible_principals(
    server: &Server,
    access_token: &AccessToken,
) -> trc::Result<RoaringBitmap> {
    let everyone = server
        .registry()
        .query::<RoaringBitmap>(
            RegistryQuery::new(ObjectType::Account).with_tenant(access_token.tenant_id()),
        )
        .await
        .caused_by(trc::location!())?;
    if access_token.has_permission(Permission::SysAccountQuery) {
        return Ok(everyone);
    }

    let account = server
        .account(access_token.account_id())
        .await
        .caused_by(trc::location!())?;
    let mut domains = account
        .addresses
        .iter()
        .map(|address| address.domain_id)
        .collect::<Vec<_>>();
    domains.sort_unstable();
    domains.dedup();

    let mut visible = RoaringBitmap::new();
    for domain_id in domains {
        visible |= server
            .registry()
            .query::<RoaringBitmap>(
                RegistryQuery::new(ObjectType::Account).equal(Property::DomainId, domain_id),
            )
            .await
            .caused_by(trc::location!())?;
    }
    visible.insert(access_token.account_id());
    visible.extend(access_token.secondary_ids().copied());
    visible &= everyone;
    Ok(visible)
}
