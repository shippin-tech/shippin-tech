

use crate::{
    RegistryStore, RegistryStoreInner, Store, backend::ephemeral::EphemeralStore,
    registry::local::RegistryInit,
};
use rand::{RngExt, distr::Alphanumeric, rng};
use std::path::PathBuf;

impl RegistryStore {
    pub async fn init(local: PathBuf, acquire_node_id: bool) -> Result<Self, String> {
        // Create inner store
        let mut inner = RegistryStoreInner::new(local);

        // Build store
        inner.store = match inner.read_data_store().await {
            RegistryInit::Ok(data_store) => Store::build(data_store).await?,
            RegistryInit::Err(err) => return Err(err),
            RegistryInit::Bootstrap => {
                inner.env_recovery_mode = true;

                if inner.env_recovery_admin.is_none() {
                    let password = rng()
                        .sample_iter(Alphanumeric)
                        .take(16)
                        .map(char::from)
                        .collect::<String>();
                    eprintln!();
                    eprintln!("════════════════════════════════════════════════════════════");
                    eprintln!("🔑 shippin.tech bootstrap mode - temporary administrator account");
                    eprintln!();
                    eprintln!("   username: admin");
                    eprintln!("   password: {password}");
                    eprintln!();
                    eprintln!("Use these credentials to complete the initial setup at the");
                    eprintln!("/admin web UI. Once setup is done, shippin.tech will provision a");
                    eprintln!("permanent administrator and this temporary account will no");
                    eprintln!("longer apply.");
                    eprintln!();
                    eprintln!("This password is shown only once. To pin a credential");
                    eprintln!("instead, set shippin.tech_RECOVERY_ADMIN=admin:<password> in the");
                    eprintln!("env file.");
                    eprintln!("════════════════════════════════════════════════════════════");
                    eprintln!();
                    inner.env_recovery_admin = Some(("admin".to_string(), password));
                }

                EphemeralStore::open()
            }
        };

        Self::from_inner(inner, acquire_node_id).await
    }

    pub fn from_inner_bootstrapped(inner: RegistryStoreInner) -> Self {
        Self(inner.into())
    }

    pub async fn from_inner(
        mut inner: RegistryStoreInner,
        acquire_node_id: bool,
    ) -> Result<Self, String> {
        // Create tables (SQL only)
        inner
            .store
            .create_tables()
            .await
            .map_err(|err| format!("Failed to create tables: {err}"))?;

        if acquire_node_id {
            inner.acquire_node_id().await?;
        }

        Ok(Self(inner.into()))
    }

    #[inline(always)]
    /// The break-glass login: RECOVERY_ADMIN from the environment, or else the
    /// first-run setup key for "admin" while the server has no administrator.
    pub fn recovery_admin(&self) -> Option<(String, String)> {
        self.0
            .env_recovery_admin
            .clone()
            .or_else(|| self.setup_key().map(|key| ("admin".to_string(), key)))
    }

    pub fn has_env_recovery_admin(&self) -> bool {
        self.0.env_recovery_admin.is_some()
    }

    /// The install key, while it has not run out.
    pub fn setup_key(&self) -> Option<String> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |since| since.as_secs());
        self.0
            .setup_key
            .read()
            .ok()
            .and_then(|key| key.clone())
            .filter(|(_, until)| now < *until)
            .map(|(key, _)| key)
    }

    /// Sets the install key and the UNIX time it stops working, or clears it.
    pub fn set_setup_key(&self, key: Option<(String, u64)>) {
        if let Ok(mut slot) = self.0.setup_key.write() {
            *slot = key;
        }
    }

    /// Kept next to the settings file, which lives in the data volume.
    pub fn setup_key_path(&self) -> PathBuf {
        self.0.local_path.with_file_name("setup-key")
    }

    #[inline(always)]
    pub fn cluster_role(&self) -> Option<&str> {
        self.0.env_cluster_role.as_deref()
    }

    #[inline(always)]
    pub fn cluster_push_shard(&self) -> u32 {
        self.0.env_push_shard_id
    }

    #[inline(always)]
    pub fn local_hostname(&self) -> &str {
        &self.0.env_hostname
    }

    #[inline(always)]
    pub fn public_url(&self) -> Option<&str> {
        self.0.env_public_url.as_deref()
    }

    #[inline(always)]
    pub fn is_recovery_mode(&self) -> bool {
        self.0.env_recovery_mode
    }

    #[inline(always)]
    pub fn is_bootstrap_mode(&self) -> bool {
        self.0.store.is_ephemeral()
    }

    #[inline(always)]
    pub fn path(&self) -> &PathBuf {
        &self.0.local_path
    }

    #[inline(always)]
    pub fn store(&self) -> &Store {
        &self.0.store
    }

    pub fn initialize_inner(&self, store: Store) -> RegistryStoreInner {
        let mut inner = self.0.as_ref().clone();
        inner.store = store;
        inner
    }

    #[cfg(feature = "test_mode")]
    pub fn clone_with_public_url(&self, url: String) -> Self {
        let mut inner = self.0.as_ref().clone();
        inner.env_public_url = Some(url);
        Self(inner.into())
    }

    #[cfg(feature = "test_mode")]
    pub async fn new(
        path: &str,
        store: Store,
        hostname: String,
        push_shard_id: u32,
        cluster_role: Option<String>,
    ) -> Self {
        Self::from_inner(
            RegistryStoreInner {
                local_path: PathBuf::from(path),
                store,
                node_id: 0,
                env_recovery_mode: false,
                env_recovery_admin: Some(("admin".to_string(), "popolna_zapora".to_string())),
                setup_key: Default::default(),
                env_cluster_role: cluster_role,
                env_push_shard_id: push_shard_id,
                env_hostname: hostname,
                env_public_url: None,
                id_generator: utils::snowflake::SnowflakeIdGenerator::new(),
            },
            true,
        )
        .await
        .unwrap()
    }
}
