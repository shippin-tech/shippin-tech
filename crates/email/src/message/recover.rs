//! Keeps a deleted message for a while so an administrator can bring it back.
//! Our own open code; `common::recover` holds the settings and keys.

use super::{
    ingest::{EmailIngest, IngestEmail, IngestSource},
    metadata::{MESSAGE_RECEIVED_MASK, MessageMetadata},
};
use crate::mailbox::INBOX_ID;
use common::{
    Server,
    auth::BuildAccessToken,
    recover::{RawValue, clear_value, keep_seconds, message_key, set_value, value_key},
};
use mail_parser::MessageParser;
use serde::{Deserialize, Serialize};
use store::roaring::RoaringBitmap;
use store::{
    IterateParams, ValueKey,
    write::{AlignedBytes, Archive, BatchBuilder, BlobLink, BlobOp, now},
};
use trc::AddContext;
use types::{blob_hash::BlobHash, collection::Collection, field::EmailField};

const HASH_LEN: usize = 32;
pub const KEPT_PAGE: usize = 100;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeptMessage {
    #[serde(default)]
    pub id: String,
    pub subject: String,
    pub from: String,
    pub received_at: u64,
    pub deleted_at: u64,
    pub until: u64,
    pub size: u32,
}

/// `[expiry][blob hash][json]`
fn encode_kept(until: u64, hash: &[u8], kept: &KeptMessage) -> Vec<u8> {
    let json = serde_json::to_vec(kept).unwrap_or_default();
    let mut value = Vec::with_capacity(8 + HASH_LEN + json.len());
    value.extend_from_slice(&until.to_be_bytes());
    value.extend_from_slice(hash);
    value.extend_from_slice(&json);
    value
}

fn decode_kept(value: &[u8]) -> Option<(&[u8], KeptMessage)> {
    let hash = value.get(8..8 + HASH_LEN)?;
    let kept = serde_json::from_slice(value.get(8 + HASH_LEN..)?).ok()?;
    Some((hash, kept))
}

fn kept_id(deleted_at: u64, document_id: u32) -> String {
    format!("{deleted_at}-{document_id}")
}

fn parse_kept_id(id: &str) -> Option<(u64, u32)> {
    let (deleted_at, document_id) = id.split_once('-')?;
    Some((deleted_at.parse().ok()?, document_id.parse().ok()?))
}

fn first_line(text: &str) -> String {
    text.chars().take(200).collect()
}

/// Adds to `batch` a record of each message about to be deleted, and holds its blob.
pub async fn keep_deleted(
    server: &Server,
    account_id: u32,
    batch: &mut BatchBuilder,
    document_ids: &RoaringBitmap,
    sizes: &[(u32, u32)],
) -> trc::Result<()> {
    let seconds = keep_seconds();
    if seconds == 0 {
        return Ok(());
    }
    let deleted_at = now();
    let until = deleted_at + seconds;
    for document_id in document_ids {
        let Some(metadata) = server
            .store()
            .get_value::<Archive<AlignedBytes>>(ValueKey::property(
                account_id,
                Collection::Email,
                document_id,
                EmailField::Metadata,
            ))
            .await
            .caused_by(trc::location!())?
        else {
            continue;
        };
        let metadata = metadata
            .deserialize::<MessageMetadata>()
            .caused_by(trc::location!())?;
        let headers = MessageParser::default().parse_headers(metadata.raw_headers.as_ref());
        let subject = headers
            .as_ref()
            .and_then(|message| message.subject())
            .map(first_line)
            .unwrap_or_default();
        let from = headers
            .as_ref()
            .and_then(|message| message.from())
            .and_then(|from| from.first())
            .and_then(|from| from.address())
            .map(first_line)
            .unwrap_or_default();
        let size = sizes
            .iter()
            .find(|(id, _)| *id == document_id)
            .map(|(_, size)| *size)
            .unwrap_or_default();
        let kept = KeptMessage {
            id: String::new(),
            subject,
            from,
            received_at: metadata.rcvd_attach & MESSAGE_RECEIVED_MASK,
            deleted_at,
            until,
            size,
        };
        set_value(
            batch,
            message_key(account_id, deleted_at, document_id),
            encode_kept(until, metadata.blob_hash.as_slice(), &kept),
        );
        batch.with_account_id(account_id).set(
            BlobOp::Link {
                hash: metadata.blob_hash.clone(),
                to: BlobLink::Temporary { until },
            },
            vec![],
        );
    }
    Ok(())
}

/// Newest first. `before` is the id of the last message of the previous page.
pub async fn list_kept(
    server: &Server,
    account_id: u32,
    before: Option<&str>,
) -> trc::Result<Vec<KeptMessage>> {
    let end = before
        .and_then(parse_kept_id)
        .map(|(deleted_at, document_id)| {
            message_key(account_id, deleted_at, document_id.saturating_sub(1))
        })
        .unwrap_or_else(|| message_key(account_id, u64::MAX, u32::MAX));
    let current = now();
    let mut messages = Vec::new();
    server
        .store()
        .iterate(
            IterateParams::new(value_key(message_key(account_id, 0, 0)), value_key(end))
                .descending(),
            |key, value| {
                if let Some((_, mut kept)) = decode_kept(value)
                    && kept.until > current
                {
                    let document_id = key
                        .get(key.len().saturating_sub(4)..)
                        .and_then(|bytes| bytes.try_into().ok())
                        .map(u32::from_be_bytes)
                        .unwrap_or_default();
                    kept.id = kept_id(kept.deleted_at, document_id);
                    messages.push(kept);
                }
                Ok(messages.len() < KEPT_PAGE)
            },
        )
        .await
        .caused_by(trc::location!())?;
    Ok(messages)
}

/// Delivers a kept message back to the Inbox. The inner error says why it cannot be.
pub async fn restore_kept(
    server: &Server,
    account_id: u32,
    id: &str,
) -> trc::Result<Result<(), String>> {
    let gone = || Ok(Err("That message is no longer kept.".to_string()));
    let Some((deleted_at, document_id)) = parse_kept_id(id) else {
        return gone();
    };
    let key = message_key(account_id, deleted_at, document_id);
    let Some(value) = server
        .store()
        .get_value::<RawValue>(value_key(key.clone()))
        .await
        .caused_by(trc::location!())?
    else {
        return gone();
    };
    let Some((hash, kept)) = decode_kept(&value.0) else {
        return gone();
    };
    if kept.until <= now() {
        return gone();
    }
    let Ok(hash) = BlobHash::try_from_hash_slice(hash) else {
        return gone();
    };
    let Some(bytes) = server
        .blob_store()
        .get_blob(hash.as_slice(), 0..usize::MAX)
        .await
        .caused_by(trc::location!())?
    else {
        return gone();
    };
    let access_token = server
        .access_token(account_id)
        .await
        .caused_by(trc::location!())?;

    match server
        .email_ingest(IngestEmail {
            raw_message: &bytes,
            message: MessageParser::new().parse(&bytes),
            blob_hash: Some(&hash),
            access_token: &access_token.build(),
            mailbox_ids: vec![INBOX_ID],
            keywords: vec![],
            received_at: Some(kept.received_at),
            source: IngestSource::Restore,
            session_id: 0,
        })
        .await
    {
        Ok(_) => {}
        Err(mut err)
            if err.matches(trc::EventType::MessageIngest(
                trc::MessageIngestEvent::Error,
            )) =>
        {
            return Ok(Err(err
                .take_value(trc::Key::Reason)
                .and_then(|value| value.into_string())
                .map(|reason| reason.to_string())
                .unwrap_or_else(|| {
                    "The message could not be restored.".to_string()
                })));
        }
        Err(err) => return Err(err.caused_by(trc::location!())),
    }

    let mut batch = BatchBuilder::new();
    batch.with_account_id(account_id).clear(BlobOp::Link {
        hash,
        to: BlobLink::Temporary { until: kept.until },
    });
    clear_value(&mut batch, key);
    server
        .store()
        .write(batch.build_all())
        .await
        .caused_by(trc::location!())?;
    Ok(Ok(()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kept() -> KeptMessage {
        KeptMessage {
            id: String::new(),
            subject: "Invoice".into(),
            from: "a@b.co".into(),
            received_at: 10,
            deleted_at: 20,
            until: 30,
            size: 40,
        }
    }

    #[test]
    fn a_kept_message_round_trips() {
        let hash = [7u8; HASH_LEN];
        let value = encode_kept(30, &hash, &kept());
        assert_eq!(value[..8], 30u64.to_be_bytes());
        let (read, message) = decode_kept(&value).unwrap();
        assert_eq!(read, hash);
        assert_eq!(message, kept());
    }

    #[test]
    fn a_damaged_record_is_ignored() {
        assert!(decode_kept(&[0; 10]).is_none());
        assert!(decode_kept(&[0; 60]).is_none());
    }

    #[test]
    fn ids_are_read_back_or_refused() {
        assert_eq!(parse_kept_id(&kept_id(20, 3)), Some((20, 3)));
        assert_eq!(parse_kept_id("nope"), None);
        assert_eq!(parse_kept_id("1-x"), None);
    }

    #[test]
    fn long_subjects_are_cut() {
        assert_eq!(first_line(&"x".repeat(500)).len(), 200);
    }
}
