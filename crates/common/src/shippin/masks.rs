//! Masked addresses, written for shippin.tech: our own open code.
//!
//! A person makes a random address on their own domain and gives it out instead of
//! their real one. Mail to it lands in their mailbox; switching it off refuses that
//! mail at the door. `shippin.tech_MASKED_LIMIT` caps how many one person can have
//! (50 by default).

use crate::Server;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;
use store::{
    Deserialize as StoreDeserialize, IterateParams, ValueKey,
    rand::{RngExt, rng},
    write::{BatchBuilder, InMemoryClass, Operation, ValueClass, ValueOp, now},
};
use trc::AddContext;

pub const KV_MASK: u8 = 48;
const TAG_ADDRESS: u8 = b'a';
const TAG_OWNER: u8 = b'u';
const LOCAL_LEN: usize = 12;
const MAX_LABEL: usize = 120;
/// Letters and digits that cannot be mistaken for one another when read aloud.
const ALPHABET: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";
const FOREVER: [u8; 8] = u64::MAX.to_be_bytes();

fn parse_limit(value: Option<&str>) -> usize {
    match value.and_then(|value| value.trim().parse::<usize>().ok()) {
        Some(limit) => limit.min(10_000),
        None => 50,
    }
}

static LIMIT: LazyLock<usize> =
    LazyLock::new(|| parse_limit(std::env::var("shippin.tech_MASKED_LIMIT").ok().as_deref()));

pub fn limit() -> usize {
    *LIMIT
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaskedAddress {
    pub address: String,
    pub account_id: u32,
    pub label: String,
    pub enabled: bool,
    pub created_at: u64,
}

#[derive(Debug, PartialEq)]
pub enum MaskLookup {
    NotMasked,
    Deliver(String),
    Refuse,
}

struct Raw(Vec<u8>);

impl StoreDeserialize for Raw {
    fn deserialize(bytes: &[u8]) -> trc::Result<Self> {
        Ok(Raw(bytes.to_vec()))
    }
}

fn address_key(address: &str) -> Vec<u8> {
    let mut key = Vec::with_capacity(2 + address.len());
    key.push(KV_MASK);
    key.push(TAG_ADDRESS);
    key.extend_from_slice(address.as_bytes());
    key
}

fn owner_key(account_id: u32, address: &str) -> Vec<u8> {
    let mut key = Vec::with_capacity(6 + address.len());
    key.push(KV_MASK);
    key.push(TAG_OWNER);
    key.extend_from_slice(&account_id.to_be_bytes());
    key.extend_from_slice(address.as_bytes());
    key
}

fn value_key(key: Vec<u8>) -> ValueKey<ValueClass> {
    ValueKey::from(ValueClass::InMemory(InMemoryClass::Key(key)))
}

fn encode(record: &MaskedAddress) -> Vec<u8> {
    let mut value = FOREVER.to_vec();
    value.extend_from_slice(&serde_json::to_vec(record).unwrap_or_default());
    value
}

fn decode(value: &[u8]) -> Option<MaskedAddress> {
    serde_json::from_slice(value.get(8..)?).ok()
}

fn set(batch: &mut BatchBuilder, key: Vec<u8>, value: Vec<u8>) {
    batch.any_op(Operation::Value {
        class: ValueClass::InMemory(InMemoryClass::Key(key)),
        op: ValueOp::Set(value),
    });
}

fn clear(batch: &mut BatchBuilder, key: Vec<u8>) {
    batch.any_op(Operation::Value {
        class: ValueClass::InMemory(InMemoryClass::Key(key)),
        op: ValueOp::Clear,
    });
}

/// Only addresses of this shape can be masked, so ordinary mail skips the lookup.
fn is_mask_shaped(address: &str) -> bool {
    address.split_once('@').is_some_and(|(local, _)| {
        local.len() == LOCAL_LEN && local.bytes().all(|byte| ALPHABET.contains(&byte))
    })
}

fn clean_label(label: &str) -> String {
    label.trim().chars().take(MAX_LABEL).collect()
}

fn random_local() -> String {
    let mut random = rng();
    (0..LOCAL_LEN)
        .map(|_| ALPHABET[random.random_range(0..ALPHABET.len())] as char)
        .collect()
}

async fn read(server: &Server, address: &str) -> trc::Result<Option<MaskedAddress>> {
    Ok(server
        .store()
        .get_value::<Raw>(value_key(address_key(address)))
        .await
        .caused_by(trc::location!())?
        .and_then(|value| decode(&value.0)))
}

async fn write(server: &Server, record: &MaskedAddress) -> trc::Result<()> {
    let mut batch = BatchBuilder::new();
    set(&mut batch, address_key(&record.address), encode(record));
    let mut owned = FOREVER.to_vec();
    owned.extend_from_slice(record.address.as_bytes());
    set(
        &mut batch,
        owner_key(record.account_id, &record.address),
        owned,
    );
    server
        .store()
        .write(batch.build_all())
        .await
        .caused_by(trc::location!())
        .map(|_| ())
}

/// What to do with mail to this address. It runs for each recipient of incoming mail.
pub async fn lookup(server: &Server, address: &str) -> trc::Result<MaskLookup> {
    if !is_mask_shaped(address) {
        return Ok(MaskLookup::NotMasked);
    }
    let Some(record) = read(server, address).await? else {
        return Ok(MaskLookup::NotMasked);
    };
    if !record.enabled {
        return Ok(MaskLookup::Refuse);
    }
    Ok(match primary_address(server, record.account_id).await? {
        Some((owner, _)) => MaskLookup::Deliver(owner),
        None => MaskLookup::Refuse,
    })
}

/// The account's main address and its domain, or nothing if the account has gone.
pub async fn primary_address(
    server: &Server,
    account_id: u32,
) -> trc::Result<Option<(String, String)>> {
    let Some(account) = server
        .try_account(account_id)
        .await
        .caused_by(trc::location!())?
    else {
        return Ok(None);
    };
    let Some(email) = account.addresses.first() else {
        return Ok(None);
    };
    let Some(domain) = server
        .domain_by_id(email.domain_id)
        .await
        .caused_by(trc::location!())?
    else {
        return Ok(None);
    };
    Ok(domain
        .names
        .first()
        .map(|name| (format!("{}@{name}", email.local_part), name.to_string())))
}

pub async fn list(server: &Server, account_id: u32) -> trc::Result<Vec<MaskedAddress>> {
    let mut addresses = Vec::new();
    let mut to = owner_key(account_id, "");
    to.extend_from_slice(&[u8::MAX; 8]);
    server
        .store()
        .iterate(
            IterateParams::new(value_key(owner_key(account_id, "")), value_key(to)),
            |_, value| {
                if let Some(address) = value
                    .get(8..)
                    .and_then(|bytes| std::str::from_utf8(bytes).ok())
                {
                    addresses.push(address.to_string());
                }
                Ok(true)
            },
        )
        .await
        .caused_by(trc::location!())?;

    let mut records = Vec::with_capacity(addresses.len());
    for address in addresses {
        if let Some(record) = read(server, &address).await?
            && record.account_id == account_id
        {
            records.push(record);
        }
    }
    records.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(records)
}

/// Makes a new address on the person's own domain. The inner error says why it cannot.
pub async fn create(
    server: &Server,
    account_id: u32,
    label: &str,
) -> trc::Result<Result<MaskedAddress, &'static str>> {
    if list(server, account_id).await?.len() >= limit() {
        return Ok(Err("You have reached the limit for masked addresses."));
    }
    let Some((_, domain)) = primary_address(server, account_id).await? else {
        return Ok(Err("This account has no address to mask."));
    };
    for _ in 0..5 {
        let address = format!("{}@{domain}", random_local());
        if read(server, &address).await?.is_none() {
            let record = MaskedAddress {
                address,
                account_id,
                label: clean_label(label),
                enabled: true,
                created_at: now(),
            };
            write(server, &record).await?;
            return Ok(Ok(record));
        }
    }
    Ok(Err("A new address could not be made. Try again."))
}

fn local_of(address: &str) -> &str {
    address.split_once('@').map_or(address, |(local, _)| local)
}

/// One of this person's own addresses, by the part before the `@`.
pub async fn find(
    server: &Server,
    account_id: u32,
    local: &str,
) -> trc::Result<Option<MaskedAddress>> {
    Ok(list(server, account_id)
        .await?
        .into_iter()
        .find(|record| local_of(&record.address) == local))
}

pub async fn update(
    server: &Server,
    mut record: MaskedAddress,
    enabled: Option<bool>,
    label: Option<&str>,
) -> trc::Result<MaskedAddress> {
    if let Some(enabled) = enabled {
        record.enabled = enabled;
    }
    if let Some(label) = label {
        record.label = clean_label(label);
    }
    write(server, &record).await?;
    Ok(record)
}

pub async fn delete(server: &Server, record: &MaskedAddress) -> trc::Result<()> {
    let mut batch = BatchBuilder::new();
    clear(&mut batch, address_key(&record.address));
    clear(&mut batch, owner_key(record.account_id, &record.address));
    server
        .store()
        .write(batch.build_all())
        .await
        .caused_by(trc::location!())
        .map(|_| ())
}

/// Removes everything an account had, once its data has been destroyed.
pub async fn forget_account(server: &Server, account_id: u32) -> trc::Result<()> {
    for record in list(server, account_id).await? {
        delete(server, &record).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_right_shape_is_looked_up() {
        assert!(is_mask_shaped("abcdefghjkmn@example.org"));
        assert!(!is_mask_shaped("ada@example.org"));
        assert!(!is_mask_shaped("abcdefghjkm1@example.org"));
        assert!(!is_mask_shaped("abcdefghjkmn"));
    }

    #[test]
    fn made_addresses_have_that_shape() {
        for _ in 0..50 {
            assert!(is_mask_shaped(&format!("{}@x.test", random_local())));
        }
    }

    #[test]
    fn limits_default_and_cap() {
        assert_eq!(parse_limit(None), 50);
        assert_eq!(parse_limit(Some("x")), 50);
        assert_eq!(parse_limit(Some("3")), 3);
        assert_eq!(parse_limit(Some("99999999")), 10_000);
    }

    #[test]
    fn labels_are_trimmed_and_cut() {
        assert_eq!(clean_label("  Shops  "), "Shops");
        assert_eq!(clean_label(&"x".repeat(500)).len(), MAX_LABEL);
    }

    #[test]
    fn records_round_trip() {
        let record = MaskedAddress {
            address: "abcdefghjkmn@x.test".into(),
            account_id: 7,
            label: "Shops".into(),
            enabled: false,
            created_at: 5,
        };
        assert_eq!(decode(&encode(&record)), Some(record));
        assert_eq!(decode(b"short"), None);
    }

    #[test]
    fn the_local_part_is_found() {
        assert_eq!(local_of("abc@x.test"), "abc");
        assert_eq!(local_of("abc"), "abc");
    }
}
