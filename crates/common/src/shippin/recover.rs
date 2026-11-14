//! Deleted accounts and messages, kept for a while so an administrator can bring them
//! back. Our own open code.
//!
//! `shippin.tech_KEEP_DELETED_DAYS` sets how long (30 by default, 0 keeps nothing). A
//! removed account's registry object is saved here and its data stays where it is until
//! the destroy task comes due. If the account is restored first, that task finds the
//! account back in place and does nothing.

use crate::Server;
use registry::schema::{
    enums::AccountType,
    prelude::{Object, ObjectInner, ObjectType},
    structs::{Account, Task, TaskDestroyAccount, TaskStatus},
};
use registry::types::{EnumImpl, id::ObjectId};
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;
use store::{
    Deserialize as StoreDeserialize, IterateParams, ValueKey,
    registry::write::{RegistryWrite, RegistryWriteResult},
    write::{BatchBuilder, InMemoryClass, Operation, ValueClass, ValueOp, now},
};
use trc::AddContext;
use types::id::Id;

pub const KV_RECOVER: u8 = 47;
const TAG_ACCOUNT: u8 = b'a';
const TAG_MESSAGE: u8 = b'm';
const DAY: u64 = 86400;

fn parse_days(value: Option<&str>) -> u64 {
    match value.and_then(|value| value.trim().parse::<u64>().ok()) {
        Some(days) => days.min(3650),
        None => 30,
    }
}

static KEEP_DAYS: LazyLock<u64> = LazyLock::new(|| {
    parse_days(
        std::env::var("shippin.tech_KEEP_DELETED_DAYS")
            .ok()
            .as_deref(),
    )
});

pub fn keep_days() -> u64 {
    *KEEP_DAYS
}

pub fn keep_seconds() -> u64 {
    keep_days() * DAY
}

/// A stored value, exactly as written.
pub struct RawValue(pub Vec<u8>);

impl StoreDeserialize for RawValue {
    fn deserialize(bytes: &[u8]) -> trc::Result<Self> {
        Ok(RawValue(bytes.to_vec()))
    }
}

/// A key in our part of the in-memory key space.
pub fn value_key(key: Vec<u8>) -> ValueKey<ValueClass> {
    ValueKey::from(ValueClass::InMemory(InMemoryClass::Key(key)))
}

pub fn set_value(batch: &mut BatchBuilder, key: Vec<u8>, value: Vec<u8>) {
    batch.any_op(Operation::Value {
        class: ValueClass::InMemory(InMemoryClass::Key(key)),
        op: ValueOp::Set(value),
    });
}

pub fn clear_value(batch: &mut BatchBuilder, key: Vec<u8>) {
    batch.any_op(Operation::Value {
        class: ValueClass::InMemory(InMemoryClass::Key(key)),
        op: ValueOp::Clear,
    });
}

/// `[47, 'm', account, deleted_at, document]`
pub fn message_key(account_id: u32, deleted_at: u64, document_id: u32) -> Vec<u8> {
    let mut key = Vec::with_capacity(18);
    key.push(KV_RECOVER);
    key.push(TAG_MESSAGE);
    key.extend_from_slice(&account_id.to_be_bytes());
    key.extend_from_slice(&deleted_at.to_be_bytes());
    key.extend_from_slice(&document_id.to_be_bytes());
    key
}

fn account_key(id: u64) -> Vec<u8> {
    let mut key = Vec::with_capacity(10);
    key.push(KV_RECOVER);
    key.push(TAG_ACCOUNT);
    key.extend_from_slice(&id.to_be_bytes());
    key
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeldAccount {
    pub id: String,
    pub name: String,
    pub email: String,
    pub kind: String,
    pub deleted_at: u64,
    pub until: u64,
}

/// `[expiry][json length][json][the registry object]`
fn encode_held(held: &HeldAccount, object: &[u8]) -> Vec<u8> {
    let json = serde_json::to_vec(held).unwrap_or_default();
    let mut value = Vec::with_capacity(12 + json.len() + object.len());
    value.extend_from_slice(&(held.until + DAY).to_be_bytes());
    value.extend_from_slice(&(json.len() as u32).to_be_bytes());
    value.extend_from_slice(&json);
    value.extend_from_slice(object);
    value
}

fn decode_held(value: &[u8]) -> Option<(HeldAccount, &[u8])> {
    let length = u32::from_be_bytes(value.get(8..12)?.try_into().ok()?) as usize;
    let end = 12usize.checked_add(length)?;
    let held = serde_json::from_slice(value.get(12..end)?).ok()?;
    Some((held, value.get(end..)?))
}

fn destroy_task(id: Id, account: &Account, status: TaskStatus) -> Task {
    let (account_domain_id, account_name, account_type) = match account {
        Account::User(account) => (account.domain_id, account.name.clone(), AccountType::User),
        Account::Group(account) => (account.domain_id, account.name.clone(), AccountType::Group),
    };
    Task::DestroyAccount(TaskDestroyAccount {
        account_domain_id,
        account_id: id,
        account_name,
        account_type,
        status,
    })
}

/// Keeps a removed account and puts off destroying its data. False when nothing is kept
/// and the caller should destroy it the usual way.
pub async fn hold_account(
    server: &Server,
    id: Id,
    account: &Account,
    object: &Object,
) -> trc::Result<bool> {
    let seconds = keep_seconds();
    if seconds == 0 {
        return Ok(false);
    }
    let (domain_id, name, kind_name) = match account {
        Account::User(account) => (account.domain_id, account.name.clone(), "user"),
        Account::Group(account) => (account.domain_id, account.name.clone(), "team"),
    };
    let domain = server
        .registry()
        .get(ObjectId::new(ObjectType::Domain, domain_id))
        .await
        .caused_by(trc::location!())?;
    let email = match domain.as_ref().map(|domain| &domain.inner) {
        Some(ObjectInner::Domain(domain)) => format!("{name}@{}", domain.name),
        _ => name.clone(),
    };
    let deleted_at = now();
    let until = deleted_at + seconds;
    let held = HeldAccount {
        id: id.to_string(),
        name,
        email,
        kind: kind_name.to_string(),
        deleted_at,
        until,
    };

    let mut batch = BatchBuilder::new();
    set_value(
        &mut batch,
        account_key(id.id()),
        encode_held(&held, &object.inner.to_pickled_vec()),
    );
    batch.schedule_task(destroy_task(id, account, TaskStatus::at(until as i64)));
    server
        .store()
        .write(batch.build_all())
        .await
        .caused_by(trc::location!())?;
    server.notify_task_queue();
    Ok(true)
}

pub async fn list_held(server: &Server) -> trc::Result<Vec<HeldAccount>> {
    let mut accounts = Vec::new();
    let current = now();
    server
        .store()
        .iterate(
            IterateParams::new(value_key(account_key(0)), value_key(account_key(u64::MAX))),
            |_, value| {
                if let Some((held, _)) = decode_held(value)
                    && held.until > current
                {
                    accounts.push(held);
                }
                Ok(true)
            },
        )
        .await
        .caused_by(trc::location!())?;
    accounts.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
    Ok(accounts)
}

/// Puts a held account back. The inner error says why it cannot be, in words for the
/// administrator.
pub async fn restore_held(server: &Server, id: Id) -> trc::Result<Result<(), &'static str>> {
    let key = account_key(id.id());
    let Some(value) = server
        .store()
        .get_value::<RawValue>(value_key(key.clone()))
        .await
        .caused_by(trc::location!())?
    else {
        return Ok(Err("That account is no longer kept."));
    };
    let value = value.0;
    let Some((held, pickled)) = decode_held(&value) else {
        return Ok(Err("That account is no longer kept."));
    };
    if held.until <= now() {
        return Ok(Err("That account is no longer kept."));
    }
    let object = Object::deserialize_with_key(&ObjectType::Account.to_id().to_be_bytes(), pickled)
        .caused_by(trc::location!())?;

    match server
        .registry()
        .write(RegistryWrite::insert_with_id(id, &object))
        .await
        .caused_by(trc::location!())?
    {
        RegistryWriteResult::Success(_) => {}
        RegistryWriteResult::PrimaryKeyConflict { .. } => {
            return Ok(Err("Someone else has that address now."));
        }
        RegistryWriteResult::InvalidForeignKey { .. } => {
            return Ok(Err(
                "The domain or a team this account belonged to no longer exists.",
            ));
        }
        _ => return Ok(Err("The account could not be restored.")),
    }

    let mut batch = BatchBuilder::new();
    clear_value(&mut batch, key);
    server
        .store()
        .write(batch.build_all())
        .await
        .caused_by(trc::location!())?;
    server.invalidate_all_local_negative_caches();
    Ok(Ok(()))
}

/// Destroys a held account's data now. For someone closing their own domain, who is
/// asking for it to be gone rather than kept.
pub async fn erase_held(server: &Server, id: Id) -> trc::Result<()> {
    let key = account_key(id.id());
    let Some(value) = server
        .store()
        .get_value::<RawValue>(value_key(key.clone()))
        .await
        .caused_by(trc::location!())?
    else {
        return Ok(());
    };
    let Some((_, pickled)) = decode_held(&value.0) else {
        return Ok(());
    };
    let object = Object::deserialize_with_key(&ObjectType::Account.to_id().to_be_bytes(), pickled)
        .caused_by(trc::location!())?;
    if let ObjectInner::Account(account) = &object.inner {
        let mut batch = BatchBuilder::new();
        clear_value(&mut batch, key);
        batch.schedule_task(destroy_task(id, account, TaskStatus::now()));
        server
            .store()
            .write(batch.build_all())
            .await
            .caused_by(trc::location!())?;
        server.notify_task_queue();
    }
    Ok(())
}

/// Drops what was kept for an account whose data has now been destroyed.
pub async fn forget_account(server: &Server, id: Id) -> trc::Result<()> {
    let account_id = id.document_id();
    let mut keys = vec![account_key(id.id())];
    server
        .store()
        .iterate(
            IterateParams::new(
                value_key(message_key(account_id, 0, 0)),
                value_key(message_key(account_id, u64::MAX, u32::MAX)),
            )
            .no_values(),
            |key, _| {
                // The last twelve bytes are the time and the document, however the
                // store frames the rest of the key.
                if let Some(tail) = key.len().checked_sub(12).and_then(|at| key.get(at..)) {
                    keys.push(message_key(
                        account_id,
                        u64::from_be_bytes(tail[..8].try_into().unwrap_or([0; 8])),
                        u32::from_be_bytes(tail[8..].try_into().unwrap_or([0; 4])),
                    ));
                }
                Ok(true)
            },
        )
        .await
        .caused_by(trc::location!())?;
    for chunk in keys.chunks(500) {
        let mut batch = BatchBuilder::new();
        for key in chunk {
            clear_value(&mut batch, key.clone());
        }
        server
            .store()
            .write(batch.build_all())
            .await
            .caused_by(trc::location!())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn held() -> HeldAccount {
        HeldAccount {
            id: "abc".into(),
            name: "ada".into(),
            email: "ada@example.org".into(),
            kind: "user".into(),
            deleted_at: 1000,
            until: 2000,
        }
    }

    #[test]
    fn days_default_to_a_month_and_are_capped() {
        assert_eq!(parse_days(None), 30);
        assert_eq!(parse_days(Some("nonsense")), 30);
        assert_eq!(parse_days(Some(" 7 ")), 7);
        assert_eq!(parse_days(Some("0")), 0);
        assert_eq!(parse_days(Some("999999")), 3650);
    }

    #[test]
    fn a_held_account_round_trips_and_outlives_its_deadline_by_a_day() {
        let value = encode_held(&held(), b"object bytes");
        assert_eq!(value[..8], (2000 + DAY).to_be_bytes());
        let (decoded, object) = decode_held(&value).unwrap();
        assert_eq!(decoded, held());
        assert_eq!(object, b"object bytes");
    }

    #[test]
    fn a_damaged_record_is_ignored() {
        assert!(decode_held(b"short").is_none());
        let mut value = encode_held(&held(), b"x");
        value[8..12].copy_from_slice(&u32::MAX.to_be_bytes());
        assert!(decode_held(&value).is_none());
    }

    #[test]
    fn message_keys_sort_by_account_then_time() {
        assert!(message_key(1, 9, 9) < message_key(2, 0, 0));
        assert!(message_key(1, 1, 9) < message_key(1, 2, 0));
        assert_eq!(message_key(1, 2, 3).len(), 18);
    }
}
