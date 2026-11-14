//! Stored traces, written for shippin.tech: our own open code, no licence key.
//!
//! A background task listens on the event bus and keeps one record for each SMTP
//! session and delivery attempt that handled mail, so an administrator can look up
//! what happened to a message afterwards. Records are stored compressed and kept for
//! `shippin.tech_TRACE_DAYS` days (7 by default).
//!
//! Keys, in the data store's in-memory value space:
//! `[KV_TRACE, 'i', started u64, span u64]` holds the summary a list needs,
//! `[KV_TRACE, 'd', started u64, span u64]` the events. Newest-first listing and
//! expiry are then plain range operations.

use crate::{BuildServer, Inner, Server};
use ahash::AHashMap;
use mail_parser::DateTime;
use serde::{Deserialize, Serialize};
use serde_json::{Value as Json, json};
use std::{sync::Arc, time::Duration};
use store::{
    IterateParams, ValueKey,
    write::{BatchBuilder, InMemoryClass, Operation, ValueClass, ValueOp, now},
};
use trc::{
    AddContext, Collector, DeliveryEvent, Event, EventDetails, EventType, Key, Level, SmtpEvent,
    Value,
    ipc::subscriber::{Interests, SubscriberBuilder},
};

pub const KV_TRACE: u8 = 44;
const TAG_INDEX: u8 = b'i';
const TAG_DETAIL: u8 = b'd';
const MAX_EVENTS: usize = 500;
const MAX_OPEN: usize = 20_000;
const STALE_SECONDS: u64 = 3600;
const TICK: Duration = Duration::from_secs(60);
const DAY: u64 = 86400;

/// The families of events a mail trace is made of.
const FAMILIES: &[&str] = &[
    "smtp",
    "delivery",
    "queue",
    "message-ingest",
    "spam",
    "dkim",
    "spf",
    "dmarc",
    "iprev",
    "arc",
    "mail-auth",
    "mta-hook",
    "milter",
    "sieve",
    "auth",
    "security",
    "limit",
    "tls-rpt",
    "mta-sts",
    "dane",
    "tls",
    "incoming-report",
];

// ---------------------------------------------------------------------------
// Events as JSON, in the shape the portal's trace screens read.

/// A value as plain text, for searching.
pub fn value_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.to_string(),
        Value::UInt(number) => number.to_string(),
        Value::Int(number) => number.to_string(),
        Value::Float(number) => number.to_string(),
        Value::Timestamp(at) => DateTime::from_timestamp(*at as i64).to_rfc3339(),
        Value::Duration(ms) => ms.to_string(),
        Value::Bytes(bytes) => String::from_utf8_lossy(&bytes[..bytes.len().min(256)]).into_owned(),
        Value::Bool(flag) => flag.to_string(),
        Value::Ipv4(ip) => ip.to_string(),
        Value::Ipv6(ip) => ip.to_string(),
        Value::Event(error) => error.event_type().as_str().to_string(),
        Value::Array(values) => values.iter().map(value_text).collect::<Vec<_>>().join(", "),
        Value::None => String::new(),
    }
}

pub fn value_json(value: &Value) -> Json {
    match value {
        Value::String(text) => json!({ "@type": "String", "value": text.as_str() }),
        Value::UInt(number) => json!({ "@type": "UnsignedInt", "value": number }),
        Value::Int(number) => json!({ "@type": "Integer", "value": number }),
        Value::Float(number) => json!({ "@type": "Float", "value": number }),
        Value::Timestamp(at) => json!({
            "@type": "UTCDateTime",
            "value": DateTime::from_timestamp(*at as i64).to_rfc3339(),
        }),
        Value::Duration(ms) => json!({ "@type": "Duration", "value": ms }),
        Value::Bool(flag) => json!({ "@type": "Boolean", "value": flag }),
        Value::Ipv4(ip) => json!({ "@type": "IpAddr", "value": ip.to_string() }),
        Value::Ipv6(ip) => json!({ "@type": "IpAddr", "value": ip.to_string() }),
        Value::Event(error) => json!({ "@type": "Event", "event": error.event_type().as_str() }),
        Value::Bytes(_) | Value::Array(_) => {
            json!({ "@type": "String", "value": value_text(value) })
        }
        Value::None => json!({ "@type": "Null" }),
    }
}

/// One event: its name, when it happened, its keys, and the span it belongs to.
pub fn event_json(event: &Event<EventDetails>) -> Json {
    let mut key_values = event
        .keys
        .iter()
        .map(|(key, value)| json!({ "key": key.as_str(), "value": value_json(value) }))
        .collect::<Vec<_>>();
    if let Some(span) = &event.inner.span {
        key_values.push(json!({
            "key": "span",
            "value": { "@type": "Event", "event": span.inner.typ.as_str() },
        }));
        if let Some((_, id)) = span.keys.iter().find(|(key, _)| *key == Key::SpanId) {
            key_values.push(json!({ "key": "spanId", "value": value_json(id) }));
        }
    }
    json!({
        "event": event.inner.typ.as_str(),
        "level": event.inner.level.as_str(),
        "timestamp": DateTime::from_timestamp(event.inner.timestamp as i64).to_rfc3339(),
        "keyValues": key_values,
    })
}

// ---------------------------------------------------------------------------
// Assembling a record.

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Summary {
    pub id: String,
    pub kind: String,
    pub started: u64,
    pub ended: u64,
    pub ip: String,
    pub from: Vec<String>,
    pub to: Vec<String>,
    pub problems: u32,
    pub events: u32,
}

#[derive(Default)]
struct Open {
    kind: &'static str,
    span: u64,
    started: u64,
    last: u64,
    ip: String,
    from: Vec<String>,
    to: Vec<String>,
    problems: u32,
    /// Whether it handled a message or a sign-in, rather than a scan of the port.
    relevant: bool,
    events: Vec<Json>,
    dropped: u32,
}

fn push_unique(list: &mut Vec<String>, value: String) {
    if !value.is_empty() && list.len() < 50 && !list.contains(&value) {
        list.push(value);
    }
}

fn is_problem(event: &Event<EventDetails>) -> bool {
    if event.inner.level as usize >= Level::Warn as usize {
        return true;
    }
    let name = event.inner.typ.as_str();
    name.contains("failed")
        || name.contains("rejected")
        || name.contains("-error")
        || name.contains(".error")
}

fn root_kind(typ: EventType) -> Option<&'static str> {
    match typ {
        EventType::Smtp(SmtpEvent::ConnectionStart) => Some("smtp"),
        EventType::Delivery(DeliveryEvent::AttemptStart) => Some("delivery"),
        _ => None,
    }
}

impl Open {
    fn add(&mut self, event: &Event<EventDetails>) {
        self.last = event.inner.timestamp;
        if is_problem(event) {
            self.problems += 1;
        }
        for (key, value) in &event.keys {
            match key {
                Key::RemoteIp if self.ip.is_empty() => self.ip = value_text(value),
                Key::From => {
                    push_unique(&mut self.from, value_text(value));
                    self.relevant = true;
                }
                Key::To => {
                    push_unique(&mut self.to, value_text(value));
                    self.relevant = true;
                }
                _ => {}
            }
        }
        if matches!(event.inner.typ, EventType::Auth(_)) {
            self.relevant = true;
        }
        if self.events.len() < MAX_EVENTS {
            self.events.push(event_json(event));
        } else {
            self.dropped += 1;
        }
    }

    fn summary(&self) -> Summary {
        Summary {
            id: format!("{}-{}", self.started, self.span),
            kind: self.kind.to_string(),
            started: self.started,
            ended: self.last,
            ip: self.ip.clone(),
            from: self.from.clone(),
            to: self.to.clone(),
            problems: self.problems,
            events: self.events.len() as u32 + self.dropped,
        }
    }
}

fn record_key(tag: u8, started: u64, span: u64) -> Vec<u8> {
    let mut key = Vec::with_capacity(18);
    key.push(KV_TRACE);
    key.push(tag);
    key.extend_from_slice(&started.to_be_bytes());
    key.extend_from_slice(&span.to_be_bytes());
    key
}

fn value_key(key: Vec<u8>) -> ValueKey<ValueClass> {
    ValueKey::from(ValueClass::InMemory(InMemoryClass::Key(key)))
}

pub fn parse_id(id: &str) -> Option<(u64, u64)> {
    let (started, span) = id.split_once('-')?;
    Some((started.parse().ok()?, span.parse().ok()?))
}

fn retention_days() -> u64 {
    std::env::var("shippin.tech_TRACE_DAYS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|days| *days > 0)
        .unwrap_or(7)
}

fn with_expiry(expires: u64, value: &[u8]) -> Vec<u8> {
    let mut out = expires.to_be_bytes().to_vec();
    out.extend_from_slice(value);
    out
}

fn compress(value: &[u8]) -> Vec<u8> {
    lz4_flex::compress_prepend_size(value)
}

fn decompress(value: &[u8]) -> Option<Vec<u8>> {
    lz4_flex::decompress_size_prepended(value).ok()
}

async fn store_records(server: &Server, records: Vec<Open>) -> trc::Result<()> {
    if records.is_empty() {
        return Ok(());
    }
    let expires = now() + retention_days() * DAY;
    let mut batch = BatchBuilder::new();
    for record in records {
        let summary = serde_json::to_vec(&record.summary()).unwrap_or_default();
        let events = serde_json::to_vec(&record.events).unwrap_or_default();
        for (tag, value) in [(TAG_INDEX, summary), (TAG_DETAIL, compress(&events))] {
            batch.any_op(Operation::Value {
                class: ValueClass::InMemory(InMemoryClass::Key(record_key(
                    tag,
                    record.started,
                    record.span,
                ))),
                op: ValueOp::Set(with_expiry(expires, &value)),
            });
        }
        if batch.is_large_batch() {
            server
                .store()
                .write(batch.build_all())
                .await
                .caused_by(trc::location!())?;
            batch = BatchBuilder::new();
        }
    }
    if !batch.is_empty() {
        server
            .store()
            .write(batch.build_all())
            .await
            .caused_by(trc::location!())?;
    }
    Ok(())
}

async fn purge(server: &Server) -> trc::Result<()> {
    let cutoff = now().saturating_sub(retention_days() * DAY);
    for tag in [TAG_INDEX, TAG_DETAIL] {
        server
            .store()
            .delete_range(
                value_key(record_key(tag, 0, 0)),
                value_key(record_key(tag, cutoff, 0)),
            )
            .await
            .caused_by(trc::location!())?;
    }
    Ok(())
}

fn interests() -> Interests {
    let mut interests = Interests::default();
    for event in EventType::variants() {
        let family = event.as_str().split('.').next().unwrap_or_default();
        if FAMILIES.contains(&family)
            && event.level() as usize >= Level::Debug as usize
            && !event.is_raw_io()
        {
            interests.set(*event);
        }
    }
    interests
}

/// Starts the task that records traces. Call once at startup.
pub fn spawn_trace_history(inner: Arc<Inner>) {
    tokio::spawn(async move {
        let wanted = interests();
        Collector::union_interests(wanted.clone());
        let (_tx, mut rx) = SubscriberBuilder::new("shippin-trace-history".to_string())
            .with_interests(wanted.clone())
            .with_lossy(true)
            .register();
        let mut open: AHashMap<u64, Open> = AHashMap::new();
        let mut tick = tokio::time::interval(TICK);
        let mut purged_at = 0u64;

        loop {
            let mut finished = Vec::new();
            tokio::select! {
                batch = rx.recv() => {
                    let Some(batch) = batch else { break };
                    for event in batch.iter() {
                        let Some(span) = event
                            .inner
                            .span
                            .as_ref()
                            .and_then(|root| root.span_id())
                            .or_else(|| event.span_id())
                        else {
                            continue;
                        };
                        if let Some(kind) = root_kind(event.inner.typ) {
                            if open.len() < MAX_OPEN {
                                open.insert(span, Open { kind, span, started: event.inner.timestamp, ..Default::default() });
                            }
                        }
                        let Some(record) = open.get_mut(&span) else { continue };
                        record.add(event);
                        if event.inner.typ.is_span_end() {
                            if let Some(record) = open.remove(&span).filter(|record| record.relevant) {
                                finished.push(record);
                            }
                        }
                    }
                }
                _ = tick.tick() => {
                    // A settings reload resets what the bus collects; ask again.
                    Collector::union_interests(wanted.clone());
                    let cutoff = now().saturating_sub(STALE_SECONDS);
                    let stale = open.iter().filter(|(_, record)| record.last < cutoff).map(|(id, _)| *id).collect::<Vec<_>>();
                    for id in stale {
                        if let Some(record) = open.remove(&id).filter(|record| record.relevant) {
                            finished.push(record);
                        }
                    }
                    let server = inner.build_server();
                    if now().saturating_sub(purged_at) >= DAY {
                        purged_at = now();
                        if let Err(err) = purge(&server).await {
                            trc::error!(err.details("Trace history: failed to remove old traces"));
                        }
                    }
                }
            }
            if !finished.is_empty() {
                let server = inner.build_server();
                if let Err(err) = store_records(&server, finished).await {
                    trc::error!(err.details("Trace history: failed to store traces"));
                }
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Reading.

/// Whether a record matches a search of its addresses, IP, kind or id.
pub fn matches_search(summary: &Summary, words: &[String]) -> bool {
    let haystack = format!(
        "{} {} {} {} {}",
        summary.kind,
        summary.ip,
        summary.from.join(" "),
        summary.to.join(" "),
        summary.id
    )
    .to_lowercase();
    words.iter().all(|word| haystack.contains(word.as_str()))
}

/// Newest first, up to `limit`, optionally older than `before` (seconds since 1970).
pub async fn list_traces(
    server: &Server,
    search: &str,
    kind: Option<&str>,
    only_problems: bool,
    before: Option<u64>,
    limit: usize,
) -> trc::Result<Vec<Summary>> {
    let words = search
        .split_whitespace()
        .map(str::to_lowercase)
        .collect::<Vec<_>>();
    let mut found = Vec::new();
    let current = now();
    server
        .store()
        .iterate(
            IterateParams::new(
                value_key(record_key(TAG_INDEX, 0, 0)),
                value_key(record_key(TAG_INDEX, before.unwrap_or(u64::MAX), u64::MAX)),
            )
            .descending(),
            |_, value| {
                let live = value
                    .get(..8)
                    .and_then(|bytes| bytes.try_into().ok())
                    .map(u64::from_be_bytes)
                    .is_some_and(|expires| expires > current);
                if live
                    && let Ok(summary) = serde_json::from_slice::<Summary>(&value[8..])
                    && kind.is_none_or(|kind| kind == summary.kind)
                    && (!only_problems || summary.problems > 0)
                    && matches_search(&summary, &words)
                {
                    found.push(summary);
                }
                Ok(found.len() < limit)
            },
        )
        .await
        .caused_by(trc::location!())?;
    Ok(found)
}

/// One record's events.
pub async fn trace_events(server: &Server, id: &str) -> trc::Result<Option<Json>> {
    let Some((started, span)) = parse_id(id) else {
        return Ok(None);
    };
    let key = record_key(TAG_DETAIL, started, span);
    let mut found = None;
    server
        .store()
        .iterate(
            IterateParams::new(value_key(key.clone()), value_key(key)).only_first(),
            |_, value| {
                found = value.get(8..).and_then(decompress);
                Ok(false)
            },
        )
        .await
        .caused_by(trc::location!())?;
    Ok(found.and_then(|bytes| serde_json::from_slice(&bytes).ok()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use trc::AuthEvent;

    fn event(typ: EventType, keys: Vec<(Key, Value)>) -> Event<EventDetails> {
        Event {
            inner: EventDetails {
                typ,
                timestamp: 1_762_800_000,
                level: typ.level(),
                span: None,
            },
            keys,
        }
    }

    #[test]
    fn a_record_collects_who_and_what_went_wrong() {
        let mut record = Open {
            kind: "smtp",
            span: 7,
            started: 100,
            ..Default::default()
        };
        record.add(&event(
            EventType::Smtp(SmtpEvent::ConnectionStart),
            vec![(Key::RemoteIp, Value::Ipv4("10.0.0.9".parse().unwrap()))],
        ));
        assert!(!record.relevant, "a bare connection is not worth keeping");
        record.add(&event(
            EventType::Smtp(SmtpEvent::MailFrom),
            vec![(Key::From, Value::String("a@x.test".into()))],
        ));
        record.add(&event(
            EventType::Smtp(SmtpEvent::RcptTo),
            vec![(Key::To, Value::String("b@y.test".into()))],
        ));
        record.add(&event(EventType::Auth(AuthEvent::Failed), vec![]));
        assert!(record.relevant);
        let summary = record.summary();
        assert_eq!(summary.id, "100-7");
        assert_eq!(summary.ip, "10.0.0.9");
        assert_eq!(summary.from, vec!["a@x.test".to_string()]);
        assert_eq!(summary.to, vec!["b@y.test".to_string()]);
        assert_eq!(summary.problems, 1);
        assert_eq!(summary.events, 4);
    }

    #[test]
    fn long_traces_are_capped_but_counted() {
        let mut record = Open::default();
        for _ in 0..(MAX_EVENTS + 5) {
            record.add(&event(EventType::Smtp(SmtpEvent::Ehlo), vec![]));
        }
        assert_eq!(record.events.len(), MAX_EVENTS);
        assert_eq!(record.summary().events, (MAX_EVENTS + 5) as u32);
    }

    #[test]
    fn keys_sort_by_time_and_ids_round_trip() {
        assert!(record_key(TAG_INDEX, 10, u64::MAX) < record_key(TAG_INDEX, 11, 0));
        assert_eq!(parse_id("100-7"), Some((100, 7)));
        assert_eq!(parse_id("nonsense"), None);
    }

    #[test]
    fn search_covers_addresses_and_ip() {
        let summary = Summary {
            id: "1-2".into(),
            kind: "delivery".into(),
            started: 1,
            ended: 2,
            ip: "10.0.0.9".into(),
            from: vec!["ada@x.test".into()],
            to: vec!["grace@y.test".into()],
            problems: 0,
            events: 3,
        };
        assert!(matches_search(&summary, &[]));
        assert!(matches_search(
            &summary,
            &["grace@y".to_string(), "10.0.0".to_string()]
        ));
        assert!(!matches_search(&summary, &["nobody".to_string()]));
    }

    #[test]
    fn only_mail_events_are_collected() {
        let wanted = interests();
        assert!(wanted.get(EventType::Smtp(SmtpEvent::MailFrom)));
        assert!(wanted.get(EventType::Auth(AuthEvent::Failed)));
        assert!(!wanted.get(EventType::Store(trc::StoreEvent::DataWrite)));
    }

    #[test]
    fn compression_round_trips() {
        let data = br#"[{"event":"smtp.ehlo"}]"#;
        assert_eq!(decompress(&compress(data)).as_deref(), Some(&data[..]));
    }
}
