//! A domain's own logo, written for shippin.tech: our own open code.
//!
//! Raster images only. An SVG can carry scripts, and these are served from the same
//! origin as webmail. The type comes from the file's own bytes, never from what the
//! uploader claims.

use crate::Server;
use store::{
    Deserialize as StoreDeserialize, ValueKey,
    write::{BatchBuilder, InMemoryClass, Operation, ValueClass, ValueOp},
};
use trc::AddContext;

pub const KV_BRAND: u8 = 50;
/// Under the 100 KB a single value may take in FoundationDB.
pub const MAX_LOGO: usize = 90_000;

const KINDS: [&str; 3] = ["image/png", "image/jpeg", "image/webp"];

struct Raw(Vec<u8>);

impl StoreDeserialize for Raw {
    fn deserialize(bytes: &[u8]) -> trc::Result<Self> {
        Ok(Raw(bytes.to_vec()))
    }
}

fn kind_index(bytes: &[u8]) -> Option<u8> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(0)
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some(1)
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(2)
    } else {
        None
    }
}

/// Why this file cannot be a logo, in words for the person uploading it.
pub fn logo_problem(bytes: &[u8]) -> Option<&'static str> {
    if bytes.is_empty() || bytes.len() > MAX_LOGO || kind_index(bytes).is_none() {
        Some("Use a PNG, JPEG or WebP image under 90 KB.")
    } else {
        None
    }
}

fn key(domain_id: u32) -> Vec<u8> {
    let mut key = vec![KV_BRAND];
    key.extend_from_slice(&domain_id.to_be_bytes());
    key
}

fn class(domain_id: u32) -> ValueClass {
    ValueClass::InMemory(InMemoryClass::Key(key(domain_id)))
}

pub async fn logo(server: &Server, domain_id: u32) -> trc::Result<Option<(&'static str, Vec<u8>)>> {
    let Some(value) = server
        .store()
        .get_value::<Raw>(ValueKey::from(class(domain_id)))
        .await
        .caused_by(trc::location!())?
    else {
        return Ok(None);
    };
    Ok(value.0.get(9..).and_then(|bytes| {
        KINDS
            .get(*value.0.get(8)? as usize)
            .map(|kind| (*kind, bytes.to_vec()))
    }))
}

pub async fn set_logo(server: &Server, domain_id: u32, bytes: &[u8]) -> trc::Result<()> {
    let mut value = u64::MAX.to_be_bytes().to_vec();
    value.push(kind_index(bytes).unwrap_or_default());
    value.extend_from_slice(bytes);
    write(server, domain_id, ValueOp::Set(value)).await
}

pub async fn clear_logo(server: &Server, domain_id: u32) -> trc::Result<()> {
    write(server, domain_id, ValueOp::Clear).await
}

async fn write(server: &Server, domain_id: u32, op: ValueOp) -> trc::Result<()> {
    let mut batch = BatchBuilder::new();
    batch.any_op(Operation::Value {
        class: class(domain_id),
        op,
    });
    server
        .store()
        .write(batch.build_all())
        .await
        .caused_by(trc::location!())
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_type_comes_from_the_bytes() {
        assert_eq!(kind_index(b"\x89PNG\r\n\x1a\nrest"), Some(0));
        assert_eq!(kind_index(&[0xff, 0xd8, 0xff, 0xe0]), Some(1));
        assert_eq!(kind_index(b"RIFF\0\0\0\0WEBPVP8 "), Some(2));
        assert_eq!(kind_index(b"<svg xmlns='x'/>"), None);
        assert_eq!(kind_index(b"RIFF\0\0\0\0WAVE    "), None);
    }

    #[test]
    fn logos_are_checked_for_type_and_size() {
        let png = b"\x89PNG\r\n\x1a\nrest";
        assert_eq!(logo_problem(png), None);
        assert!(logo_problem(b"").is_some());
        assert!(logo_problem(b"<svg/>").is_some());
        let mut big = png.to_vec();
        big.resize(MAX_LOGO + 1, 0);
        assert!(logo_problem(&big).is_some());
        big.truncate(MAX_LOGO);
        assert_eq!(logo_problem(&big), None);
    }
}
