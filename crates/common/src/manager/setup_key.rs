//! First-run install key (a bootstrap token, in Kubernetes' words).
//!
//! A new server has no administrator. Unless RECOVERY_ADMIN is set, it keeps a
//! one-time key next to its settings file (in the data volume), prints it, and
//! accepts it for the user "admin". Its one job is to let that person create the
//! real administrator, after which the key is deleted and stops working.
//!
//! It is ephemeral (OWASP ASVS 5.0, 6.4.1): it also stops working once it is older
//! than `shippin.tech_SETUP_KEY_HOURS` (24 by default), counted from when it was made.
//! Restarting the server after that makes a new one, so only someone who can restart
//! the server can get in. Until then the same key is reused across restarts.

use registry::{
    schema::{
        enums::AccountType,
        prelude::{ObjectType, Property},
        structs::{Account, UserRoles},
    },
    types::EnumImpl,
};
use store::{
    RegistryStore,
    rand::{RngExt, distr::Alphanumeric, rng},
    registry::RegistryQuery,
};
use types::id::Id;

/// Whether any user account holds an administrator role.
pub async fn has_admin_account(registry: &RegistryStore, admin_role_ids: &[Id]) -> trc::Result<bool> {
    let ids = registry
        .query::<Vec<Id>>(
            RegistryQuery::new(ObjectType::Account).equal(Property::Type, AccountType::User.to_id()),
        )
        .await?;
    for id in ids {
        if let Some(Account::User(user)) = registry.object::<Account>(id).await? {
            match &user.roles {
                UserRoles::Admin => return Ok(true),
                UserRoles::Custom(custom)
                    if custom.role_ids.iter().any(|role| admin_role_ids.contains(role)) =>
                {
                    return Ok(true);
                }
                _ => {}
            }
        }
    }
    Ok(false)
}

/// Turns the first-run key off and removes it from disk.
pub fn retire_setup_key(registry: &RegistryStore) {
    registry.set_setup_key(None);
    let _ = std::fs::remove_file(registry.setup_key_path());
}

fn write_private(path: &std::path::Path, key: &str) -> std::io::Result<()> {
    std::fs::write(path, format!("{key}\n"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

const HOUR: u64 = 3600;

/// How long an install key lasts: `SETUP_KEY_HOURS`, from 1 hour to 30 days, 24 by default.
pub fn lifetime(hours: Option<&str>) -> u64 {
    hours
        .and_then(|hours| hours.trim().parse::<u64>().ok())
        .filter(|hours| (1..=720).contains(hours))
        .unwrap_or(24)
        * HOUR
}

pub fn still_valid(made: u64, now: u64, lifetime: u64) -> bool {
    now < made.saturating_add(lifetime)
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| since.as_secs())
}

/// When the saved key was made: the file's last change.
fn made_at(path: &std::path::Path) -> Option<u64> {
    std::fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|since| since.as_secs())
}

/// Called once at startup on a configured server.
pub async fn prepare_setup_key(registry: &RegistryStore, admin_role_ids: &[Id]) {
    if registry.is_bootstrap_mode() || registry.has_env_recovery_admin() {
        return;
    }
    match has_admin_account(registry, admin_role_ids).await {
        Ok(true) => {
            retire_setup_key(registry);
            return;
        }
        Ok(false) => {}
        Err(err) => {
            trc::error!(err.details("Could not check for an administrator account"));
            return;
        }
    }
    let path = registry.setup_key_path();
    let lifetime = lifetime(std::env::var("shippin.tech_SETUP_KEY_HOURS").ok().as_deref());
    let now = unix_now();
    let saved = std::fs::read_to_string(&path)
        .ok()
        .map(|text| text.trim().to_string())
        .filter(|key| key.len() >= 16)
        .zip(made_at(&path))
        .filter(|(_, made)| still_valid(*made, now, lifetime));
    let (key, made) = match saved {
        Some(saved) => saved,
        None => {
            let key = rng()
                .sample_iter(Alphanumeric)
                .take(24)
                .map(char::from)
                .collect::<String>();
            if let Err(err) = write_private(&path, &key) {
                eprintln!("Could not save the setup key to {}: {err}", path.display());
            }
            (key, now)
        }
    };
    let until = made.saturating_add(lifetime);
    registry.set_setup_key(Some((key.clone(), until)));
    eprintln!();
    eprintln!("════════════════════════════════════════════════════════════");
    eprintln!("🔑 shippin.tech first-run setup key");
    eprintln!();
    eprintln!("   Open /login on this server and sign in as:");
    eprintln!("     username: admin");
    eprintln!("     key:      {key}");
    eprintln!();
    eprintln!("   You will be asked to create your own administrator.");
    eprintln!("   After that this key stops working. It also stops working");
    eprintln!("   {} hours after it was made; restart the server then for a", lifetime / 3600);
    eprintln!("   new one. It is saved in {}.", path.display());
    eprintln!("════════════════════════════════════════════════════════════");
    eprintln!();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_install_key_lasts_24_hours_unless_told_otherwise() {
        assert_eq!(lifetime(None), 24 * HOUR);
        assert_eq!(lifetime(Some("2")), 2 * HOUR);
        assert_eq!(lifetime(Some(" 48 ")), 48 * HOUR);
        assert_eq!(lifetime(Some("0")), 24 * HOUR);
        assert_eq!(lifetime(Some("100000")), 24 * HOUR);
        assert_eq!(lifetime(Some("soon")), 24 * HOUR);
    }

    #[test]
    fn an_install_key_stops_working_when_it_runs_out() {
        let made = 1_000_000;
        assert!(still_valid(made, made, HOUR));
        assert!(still_valid(made, made + HOUR - 1, HOUR));
        assert!(!still_valid(made, made + HOUR, HOUR));
    }
}
