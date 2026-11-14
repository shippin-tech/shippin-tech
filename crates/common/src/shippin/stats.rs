//! Dashboard statistics for the portal, written for shippin.tech.
//!
//! This is our own open code and needs no licence key. Once a minute each node
//! turns the counters, timings and gauges that `trc::Collector` already keeps in
//! memory into hourly and daily totals in the data store. `query` reads them back
//! for `GET /api/stats`, and the portal dashboard draws them.
//!
//! History keys live in the data store's in-memory counter space:
//! `[KV_STATS, grain, bucket u32, metric u16, field u8, node u16]`. `grain` is
//! `h` (hour) or `d` (day), `metric` is `MetricType::to_id`, `field` says what is
//! counted, and `node` is the writing node, so the dashboard can show one node or
//! add all of them up. Each node also keeps one short-lived "live" key with its
//! hostname and its own gauges (memory, connections).

use crate::Server;
use serde::Serialize;
use std::{
    collections::{BTreeMap, HashMap},
    sync::Mutex,
    time::Duration,
};
use store::{
    IterateParams, Store, ValueKey,
    write::{BatchBuilder, InMemoryClass, Operation, ValueClass, ValueOp, now},
};
use trc::{AddContext, Collector, MetricType};

/// In-memory key prefix for dashboard statistics (next to `crate::KV_*`).
pub const KV_STATS: u8 = 41;

/// How often the scheduler calls `sample`.
pub const SAMPLE_INTERVAL: Duration = Duration::from_secs(60);

const HOUR: u64 = 3600;
const DAY: u64 = 86400;
/// Hourly buckets are kept long enough for "7 days" plus the week before it.
const KEEP_HOURS: u64 = 15 * 24;
/// Daily buckets are kept long enough for "90 days" plus the quarter before it.
const KEEP_DAYS: u64 = 400;
/// Gauges are sampled on every fifth run (five minutes).
const GAUGE_EVERY: u32 = 5;
/// A node's live key expires when the node stops sampling.
const LIVE_TTL: u64 = 3 * 60;

const FIELD_COUNT: u8 = 0;
const FIELD_SUM: u8 = 1;
const FIELD_SAMPLES: u8 = 2;

const TAG_HOUR: u8 = b'h';
const TAG_DAY: u8 = b'd';
const TAG_LIVE: u8 = b'L';

/// Gauges each node reports live; the dashboard adds them up across nodes.
pub const LIVE_GAUGES: &[MetricType] = &[
    MetricType::ServerMemory,
    MetricType::SmtpActiveConnections,
    MetricType::ImapActiveConnections,
    MetricType::Pop3ActiveConnections,
    MetricType::HttpActiveConnections,
    MetricType::SieveActiveConnections,
    MetricType::DeliveryActiveConnections,
];

/// Cluster-wide gauges the dashboard counts from the stores on request.
pub const COUNTED_GAUGES: &[MetricType] = &[
    MetricType::UserCount,
    MetricType::DomainCount,
    MetricType::QueueCount,
];

// ---------------------------------------------------------------------------
// Keys

pub fn bucket_key(tag: u8, bucket: u32, metric: u16, field: u8, node: u16) -> Vec<u8> {
    let mut key = Vec::with_capacity(11);
    key.push(KV_STATS);
    key.push(tag);
    key.extend_from_slice(&bucket.to_be_bytes());
    key.extend_from_slice(&metric.to_be_bytes());
    key.push(field);
    key.extend_from_slice(&node.to_be_bytes());
    key
}

/// One stored total: `(bucket, metric, field, node, value)`.
pub type Row = (u32, u16, u8, u16, i64);

pub fn parse_bucket_key(key: &[u8], tag: u8) -> Option<(u32, u16, u8, u16)> {
    if key.len() != 11 || key[0] != KV_STATS || key[1] != tag {
        return None;
    }
    Some((
        u32::from_be_bytes(key[2..6].try_into().ok()?),
        u16::from_be_bytes(key[6..8].try_into().ok()?),
        key[8],
        u16::from_be_bytes(key[9..11].try_into().ok()?),
    ))
}

fn live_key(node: u16) -> Vec<u8> {
    let mut key = vec![KV_STATS, TAG_LIVE];
    key.extend_from_slice(&node.to_be_bytes());
    key
}

fn counter_key(key: Vec<u8>) -> ValueKey<ValueClass> {
    ValueKey::from(ValueClass::InMemory(InMemoryClass::Counter(key)))
}

fn value_key(key: Vec<u8>) -> ValueKey<ValueClass> {
    ValueKey::from(ValueClass::InMemory(InMemoryClass::Key(key)))
}

/// A node's live gauges: expiry first (big-endian seconds, the layout the
/// in-memory store's purge expects), the hostname, then `(metric, value)` pairs.
pub fn encode_live(expires: u64, hostname: &str, values: &[(u16, u64)]) -> Vec<u8> {
    let hostname = &hostname.as_bytes()[..hostname.len().min(255)];
    let mut out = Vec::with_capacity(9 + hostname.len() + values.len() * 10);
    out.extend_from_slice(&expires.to_be_bytes());
    out.push(hostname.len() as u8);
    out.extend_from_slice(hostname);
    for (metric, value) in values {
        out.extend_from_slice(&metric.to_be_bytes());
        out.extend_from_slice(&value.to_be_bytes());
    }
    out
}

pub fn decode_live(value: &[u8], now: u64) -> Option<(String, Vec<(u16, u64)>)> {
    let expires = u64::from_be_bytes(value.get(..8)?.try_into().ok()?);
    let len = *value.get(8)? as usize;
    let hostname = std::str::from_utf8(value.get(9..9 + len)?)
        .ok()?
        .to_string();
    let pairs = value.get(9 + len..)?;
    if expires <= now || pairs.len() % 10 != 0 {
        return None;
    }
    Some((
        hostname,
        pairs
            .chunks_exact(10)
            .map(|pair| {
                (
                    u16::from_be_bytes([pair[0], pair[1]]),
                    u64::from_be_bytes(pair[2..10].try_into().unwrap_or_default()),
                )
            })
            .collect(),
    ))
}

// ---------------------------------------------------------------------------
// Sampling

#[derive(Default)]
struct Sampler {
    counters: HashMap<u16, u32>,
    histograms: HashMap<u16, (u64, u64)>,
    runs: u32,
    cleaned_at: u64,
}

static SAMPLER: Mutex<Option<Sampler>> = Mutex::new(None);

struct Taken {
    deltas: Vec<(u16, u8, i64)>,
    gauges: bool,
    cleanup: bool,
}

/// What changed since the last run, taken under the lock so overlapping runs
/// never count the same events twice.
fn take(now: u64) -> Taken {
    let mut guard = SAMPLER.lock().unwrap_or_else(|err| err.into_inner());
    let state = guard.get_or_insert_with(Sampler::default);
    let mut deltas = Vec::new();

    for metric in MetricType::variants() {
        let id = metric.to_id();
        let event_id = metric.event_id();
        if event_id != usize::MAX {
            let value = Collector::read_metric_counter(event_id);
            let last = state.counters.insert(id, value).unwrap_or(0);
            let delta = value.wrapping_sub(last);
            if delta > 0 {
                deltas.push((id, FIELD_COUNT, delta as i64));
            }
        } else if let Some((count, sum)) = Collector::histogram_totals(*metric) {
            let (last_count, last_sum) =
                state.histograms.insert(id, (count, sum)).unwrap_or((0, 0));
            let (count, sum) = if count >= last_count && sum >= last_sum {
                (count - last_count, sum - last_sum)
            } else {
                (count, sum)
            };
            if count > 0 {
                deltas.push((id, FIELD_SAMPLES, count as i64));
                deltas.push((id, FIELD_SUM, sum.min(i64::MAX as u64) as i64));
            }
        }
    }

    let gauges = state.runs % GAUGE_EVERY == 0;
    state.runs = state.runs.wrapping_add(1);
    let cleanup = now.saturating_sub(state.cleaned_at) >= DAY;
    if cleanup {
        state.cleaned_at = now;
    }

    Taken {
        deltas,
        gauges,
        cleanup,
    }
}

fn push_gauge(deltas: &mut Vec<(u16, u8, i64)>, metric: MetricType, value: u64) {
    deltas.push((metric.to_id(), FIELD_SAMPLES, 1));
    deltas.push((metric.to_id(), FIELD_SUM, value.min(i64::MAX as u64) as i64));
}

/// Called by the task scheduler every `SAMPLE_INTERVAL` on every node.
pub async fn sample(server: &Server) {
    let now = now();
    let Taken {
        mut deltas,
        gauges,
        cleanup,
    } = take(now);

    if gauges {
        let memory = Collector::read_metric(MetricType::ServerMemory);
        if memory > 0.0 {
            push_gauge(&mut deltas, MetricType::ServerMemory, memory as u64);
        }
        if server.core.network.roles.metrics_calculate {
            match server.total_queued_messages().await {
                Ok(total) => push_gauge(&mut deltas, MetricType::QueueCount, total),
                Err(err) => {
                    trc::error!(err.details("Dashboard statistics: queue size"));
                }
            }
        }
    }

    if let Err(err) = write_buckets(server.store(), now, server.registry().node_id(), &deltas).await
    {
        trc::error!(err.details("Dashboard statistics: failed to store totals"));
    }
    if let Err(err) = write_live(server, now).await {
        trc::error!(err.details("Dashboard statistics: failed to store live gauges"));
    }
    if cleanup && let Err(err) = purge(server.store(), now).await {
        trc::error!(err.details("Dashboard statistics: failed to remove old totals"));
    }
}

async fn write_buckets(
    store: &Store,
    now: u64,
    node: u16,
    deltas: &[(u16, u8, i64)],
) -> trc::Result<()> {
    if deltas.is_empty() {
        return Ok(());
    }
    let hour = (now / HOUR) as u32;
    let day = (now / DAY) as u32;
    let mut batch = BatchBuilder::new();
    for &(metric, field, value) in deltas {
        for key in [
            bucket_key(TAG_HOUR, hour, metric, field, node),
            bucket_key(TAG_DAY, day, metric, field, node),
        ] {
            batch.any_op(Operation::Value {
                class: ValueClass::InMemory(InMemoryClass::Counter(key)),
                op: ValueOp::AtomicAdd(value),
            });
        }
        if batch.is_large_batch() {
            store
                .write(batch.build_all())
                .await
                .caused_by(trc::location!())?;
            batch = BatchBuilder::new();
        }
    }
    if !batch.is_empty() {
        store
            .write(batch.build_all())
            .await
            .caused_by(trc::location!())?;
    }
    Ok(())
}

async fn write_live(server: &Server, now: u64) -> trc::Result<()> {
    let values = LIVE_GAUGES
        .iter()
        .map(|metric| {
            (
                metric.to_id(),
                Collector::read_metric(*metric).max(0.0) as u64,
            )
        })
        .collect::<Vec<_>>();
    let mut batch = BatchBuilder::new();
    batch.any_op(Operation::Value {
        class: ValueClass::InMemory(InMemoryClass::Key(live_key(server.registry().node_id()))),
        op: ValueOp::Set(encode_live(
            now + LIVE_TTL,
            &server.core.network.server_name,
            &values,
        )),
    });
    server
        .store()
        .write(batch.build_all())
        .await
        .caused_by(trc::location!())
        .map(|_| ())
}

async fn purge(store: &Store, now: u64) -> trc::Result<()> {
    for (tag, keep_from) in [
        (TAG_HOUR, (now / HOUR).saturating_sub(KEEP_HOURS)),
        (TAG_DAY, (now / DAY).saturating_sub(KEEP_DAYS)),
    ] {
        store
            .delete_range(
                counter_key(bucket_key(tag, 0, 0, 0, 0)),
                counter_key(bucket_key(tag, keep_from as u32, 0, 0, 0)),
            )
            .await
            .caused_by(trc::location!())?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Reading

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Period {
    Day,
    Week,
    Month,
    Quarter,
}

impl Period {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "24h" => Some(Period::Day),
            "7d" => Some(Period::Week),
            "30d" => Some(Period::Month),
            "90d" => Some(Period::Quarter),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Period::Day => "24h",
            Period::Week => "7d",
            Period::Month => "30d",
            Period::Quarter => "90d",
        }
    }

    /// Seconds per bar.
    fn step(self) -> u64 {
        match self {
            Period::Day => HOUR,
            Period::Week => 6 * HOUR,
            Period::Month | Period::Quarter => DAY,
        }
    }

    fn points(self) -> u64 {
        match self {
            Period::Day => 24,
            Period::Week => 28,
            Period::Month => 30,
            Period::Quarter => 90,
        }
    }
}

/// What the dashboard asked for: a preset period ending now, or any range.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Range {
    Preset(Period),
    Custom { from: u64, to: u64 },
}

impl Range {
    pub fn label(&self) -> &'static str {
        match self {
            Range::Preset(period) => period.as_str(),
            Range::Custom { .. } => "custom",
        }
    }

    /// The bars to draw, or why the range cannot be shown.
    pub fn window(&self, now: u64) -> Result<Window, &'static str> {
        match *self {
            Range::Preset(period) => {
                let step = period.step();
                let points = period.points();
                let end = (now / step + 1) * step;
                Ok(Window {
                    start: end - step * points,
                    step,
                    points,
                })
            }
            Range::Custom { from, to } => {
                let to = to.min(now);
                if from >= to {
                    return Err("The range must start before it ends, and not in the future.");
                }
                if from < now.saturating_sub(KEEP_DAYS * DAY) {
                    return Err("Statistics are kept for 400 days.");
                }
                let hourly = from >= now.saturating_sub(KEEP_HOURS * HOUR);
                let span = to - from;
                let step = if hourly && span <= 2 * DAY {
                    HOUR
                } else if hourly && span <= 14 * DAY {
                    6 * HOUR
                } else {
                    DAY
                };
                let start = from / step * step;
                let end = to.div_ceil(step) * step;
                Ok(Window {
                    start,
                    step,
                    points: ((end - start) / step).max(1),
                })
            }
        }
    }
}

/// The bars of a range, in UTC.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub struct Window {
    pub start: u64,
    pub step: u64,
    pub points: u64,
}

#[derive(Debug, PartialEq, Eq)]
enum Place {
    Bar(usize),
    Previous,
    Outside,
}

impl Window {
    pub fn end(&self) -> u64 {
        self.start + self.step * self.points
    }

    pub fn previous_start(&self) -> u64 {
        self.start.saturating_sub(self.step * self.points)
    }

    /// Stored bucket kind and its length: hours for bars shorter than a day,
    /// days otherwise.
    fn grain(&self) -> (u8, u64) {
        if self.step < DAY {
            (TAG_HOUR, HOUR)
        } else {
            (TAG_DAY, DAY)
        }
    }

    fn place(&self, at: u64) -> Place {
        if at >= self.end() {
            Place::Outside
        } else if at >= self.start {
            Place::Bar(((at - self.start) / self.step) as usize)
        } else if at >= self.previous_start() {
            Place::Previous
        } else {
            Place::Outside
        }
    }
}

/// One metric over the range. Counts are totals per bar; averages are the
/// mean of what was observed in each bar, or `None` where nothing was.
#[derive(Serialize, Debug, PartialEq)]
pub struct Series {
    pub kind: &'static str,
    pub values: Vec<Option<f64>>,
    pub total: Option<f64>,
    pub previous: Option<f64>,
}

#[derive(Default)]
struct Totals {
    bars: Vec<[f64; 3]>,
    previous: [f64; 3],
    seen: [bool; 3],
}

fn ratio(sum: f64, samples: f64) -> Option<f64> {
    (samples > 0.0).then(|| sum / samples)
}

/// Folds stored rows into one series per metric, for one node or all of them.
pub fn aggregate(
    window: &Window,
    grain: u64,
    node: Option<u16>,
    rows: impl IntoIterator<Item = Row>,
) -> BTreeMap<u16, Series> {
    let mut totals: BTreeMap<u16, Totals> = BTreeMap::new();
    for (bucket, metric, field, row_node, value) in rows {
        let field = field as usize;
        if field > 2 || node.is_some_and(|node| node != row_node) {
            continue;
        }
        let slot = match window.place(bucket as u64 * grain) {
            Place::Bar(bar) => bar,
            Place::Previous => usize::MAX,
            Place::Outside => continue,
        };
        let entry = totals.entry(metric).or_insert_with(|| Totals {
            bars: vec![[0.0; 3]; window.points as usize],
            ..Default::default()
        });
        entry.seen[field] = true;
        if slot == usize::MAX {
            entry.previous[field] += value as f64;
        } else if let Some(bar) = entry.bars.get_mut(slot) {
            bar[field] += value as f64;
        }
    }

    totals
        .into_iter()
        .map(|(metric, totals)| {
            let series = if totals.seen[FIELD_COUNT as usize] {
                let values = totals
                    .bars
                    .iter()
                    .map(|bar| Some(bar[0]))
                    .collect::<Vec<_>>();
                Series {
                    kind: "count",
                    total: Some(values.iter().flatten().sum()),
                    values,
                    previous: Some(totals.previous[0]),
                }
            } else {
                let (sum, samples) = totals
                    .bars
                    .iter()
                    .fold((0.0, 0.0), |(s, n), bar| (s + bar[1], n + bar[2]));
                Series {
                    kind: "average",
                    values: totals
                        .bars
                        .iter()
                        .map(|bar| ratio(bar[1], bar[2]))
                        .collect(),
                    total: ratio(sum, samples),
                    previous: ratio(totals.previous[1], totals.previous[2]),
                }
            };
            (metric, series)
        })
        .collect()
}

/// Reads stored totals. Stores that keep counters as eight little-endian bytes
/// (FoundationDB, RocksDB) are read in one range scan; the others fall back
/// to one read per stored key.
async fn read_rows(
    store: &Store,
    tag: u8,
    from_bucket: u32,
    to_bucket: u32,
) -> trc::Result<Vec<Row>> {
    let from = || counter_key(bucket_key(tag, from_bucket, 0, 0, 0));
    let to = || counter_key(bucket_key(tag, to_bucket, u16::MAX, u8::MAX, u16::MAX));
    let mut rows = Vec::new();
    let mut raw = true;
    let scanned = store
        .iterate(IterateParams::new(from(), to()), |key, value| {
            let Some((bucket, metric, field, node)) = parse_bucket_key(key, tag) else {
                return Ok(true);
            };
            match <[u8; 8]>::try_from(value) {
                Ok(bytes) => {
                    rows.push((bucket, metric, field, node, i64::from_le_bytes(bytes)));
                    Ok(true)
                }
                Err(_) => {
                    raw = false;
                    Ok(false)
                }
            }
        })
        .await;
    if scanned.is_ok() && raw {
        return Ok(rows);
    }

    let mut keys = Vec::new();
    store
        .iterate(IterateParams::new(from(), to()).no_values(), |key, _| {
            keys.push(key.to_vec());
            Ok(true)
        })
        .await
        .caused_by(trc::location!())?;
    rows.clear();
    for key in keys {
        if let Some((bucket, metric, field, node)) = parse_bucket_key(&key, tag) {
            let value = store
                .get_counter(counter_key(key))
                .await
                .caused_by(trc::location!())?;
            rows.push((bucket, metric, field, node, value));
        }
    }
    Ok(rows)
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct NodeInfo {
    pub id: u16,
    pub hostname: String,
}

struct Live {
    nodes: Vec<NodeInfo>,
    sums: HashMap<u16, u64>,
}

async fn read_live(store: &Store, now: u64, only: Option<u16>) -> trc::Result<Live> {
    let mut live = Live {
        nodes: Vec::new(),
        sums: HashMap::new(),
    };
    store
        .iterate(
            IterateParams::new(
                value_key(vec![KV_STATS, TAG_LIVE, 0, 0]),
                value_key(vec![KV_STATS, TAG_LIVE, u8::MAX, u8::MAX]),
            ),
            |key, value| {
                let (Some(id), Some((hostname, values))) = (
                    key.get(2..4).map(|id| u16::from_be_bytes([id[0], id[1]])),
                    decode_live(value, now),
                ) else {
                    return Ok(true);
                };
                live.nodes.push(NodeInfo { id, hostname });
                if only.is_none_or(|only| only == id) {
                    for (metric, value) in values {
                        *live.sums.entry(metric).or_default() += value;
                    }
                }
                Ok(true)
            },
        )
        .await
        .caused_by(trc::location!())?;
    Ok(live)
}

#[derive(Serialize, Debug)]
pub struct Stats {
    /// `24h`, `7d`, `30d`, `90d` or `custom`.
    pub period: &'static str,
    /// Start of the first bar, in seconds since 1970 (UTC).
    pub start: u64,
    /// Seconds per bar.
    pub step: u64,
    pub points: u64,
    /// Start of the oldest stored bucket that was read, if any.
    pub since: Option<u64>,
    /// The node shown, or `None` for all of them.
    pub node: Option<u16>,
    /// Nodes that reported in the last few minutes (at least 1).
    pub nodes: usize,
    #[serde(rename = "nodeList")]
    pub node_list: Vec<NodeInfo>,
    pub live: BTreeMap<&'static str, f64>,
    pub history: BTreeMap<&'static str, Series>,
    pub descriptions: BTreeMap<&'static str, &'static str>,
}

/// The dashboard's data. The outer error is a storage failure; the inner one
/// says why a requested range cannot be drawn.
pub async fn query(
    server: &Server,
    range: Range,
    node: Option<u16>,
) -> trc::Result<Result<Stats, &'static str>> {
    let now = now();
    let window = match range.window(now) {
        Ok(window) => window,
        Err(reason) => return Ok(Err(reason)),
    };
    let (tag, grain) = window.grain();
    let rows = read_rows(
        server.store(),
        tag,
        (window.previous_start() / grain) as u32,
        ((window.end() - 1) / grain) as u32,
    )
    .await?;
    let since = rows
        .iter()
        .filter(|row| node.is_none_or(|node| node == row.3))
        .map(|row| row.0 as u64 * grain)
        .min();

    let mut history = BTreeMap::new();
    let mut descriptions = BTreeMap::new();
    for (id, series) in aggregate(&window, grain, node, rows) {
        if let Some(metric) = MetricType::from_id(id) {
            history.insert(metric.as_str(), series);
            descriptions.insert(metric.as_str(), metric.description());
        }
    }

    let local = server.registry().node_id();
    let Live { mut nodes, sums } = read_live(server.store(), now, node).await?;
    let reported = !nodes.is_empty();
    if !reported {
        nodes.push(NodeInfo {
            id: local,
            hostname: server.core.network.server_name.clone(),
        });
    }
    nodes.sort_by_key(|info| info.id);
    let mut live = BTreeMap::new();
    for metric in LIVE_GAUGES {
        let value = if !reported && node.is_none_or(|node| node == local) {
            Collector::read_metric(*metric).max(0.0)
        } else {
            sums.get(&metric.to_id()).copied().unwrap_or_default() as f64
        };
        live.insert(metric.as_str(), value);
    }
    match server.total_accounts().await {
        Ok(total) => {
            live.insert(MetricType::UserCount.as_str(), total as f64);
        }
        Err(err) => {
            trc::error!(err.details("Dashboard statistics: account count"));
        }
    }
    match server.total_domains().await {
        Ok(total) => {
            live.insert(MetricType::DomainCount.as_str(), total as f64);
        }
        Err(err) => {
            trc::error!(err.details("Dashboard statistics: domain count"));
        }
    }
    match server.total_queued_messages().await {
        Ok(total) => {
            live.insert(MetricType::QueueCount.as_str(), total as f64);
        }
        Err(err) => {
            trc::error!(err.details("Dashboard statistics: queue size"));
        }
    }
    for metric in LIVE_GAUGES.iter().chain(COUNTED_GAUGES) {
        descriptions.insert(metric.as_str(), metric.description());
    }

    Ok(Ok(Stats {
        period: range.label(),
        start: window.start,
        step: window.step,
        points: window.points,
        since,
        node,
        nodes: nodes.len(),
        node_list: nodes,
        live,
        history,
        descriptions,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bucket_keys_round_trip_and_sort_by_time() {
        let key = bucket_key(TAG_HOUR, 489_000, 412, FIELD_SUM, 3);
        assert_eq!(
            parse_bucket_key(&key, TAG_HOUR),
            Some((489_000, 412, FIELD_SUM, 3))
        );
        assert_eq!(parse_bucket_key(&key, TAG_DAY), None);
        assert!(
            bucket_key(TAG_HOUR, 10, u16::MAX, 2, u16::MAX) < bucket_key(TAG_HOUR, 11, 0, 0, 0)
        );
    }

    #[test]
    fn preset_windows_end_with_the_current_bar() {
        let now = 1_762_800_000 + 1234; // some time on 2025-11-10
        for (period, step, points) in [
            (Period::Day, HOUR, 24),
            (Period::Week, 6 * HOUR, 28),
            (Period::Month, DAY, 30),
            (Period::Quarter, DAY, 90),
        ] {
            let window = Range::Preset(period).window(now).unwrap();
            assert_eq!((window.step, window.points), (step, points));
            assert_eq!(window.start % step, 0);
            assert!(window.end() > now && window.end() - now <= step);
            assert_eq!(window.place(now), Place::Bar(points as usize - 1));
            assert_eq!(window.place(window.start - 1), Place::Previous);
            assert_eq!(window.place(window.previous_start() - 1), Place::Outside);
            assert_eq!(Period::parse(period.as_str()), Some(period));
        }
        assert_eq!(Period::parse("1y"), None);
    }

    #[test]
    fn custom_windows_pick_hours_six_hours_or_days() {
        let now = 1_762_800_000;
        let custom = |from: u64, to: u64| Range::Custom { from, to }.window(now);
        let hours = custom(now - 30 * HOUR, now).unwrap();
        assert_eq!(hours.step, HOUR);
        assert_eq!(hours.grain(), (TAG_HOUR, HOUR));
        assert!(hours.points >= 30 && hours.points <= 31);
        assert_eq!(custom(now - 10 * DAY, now).unwrap().step, 6 * HOUR);
        let midnight = now / DAY * DAY;
        let days = custom(midnight - 60 * DAY, midnight - 30 * DAY).unwrap();
        assert_eq!((days.step, days.grain()), (DAY, (TAG_DAY, DAY)));
        assert_eq!(days.points, 30);
        // Old hours are gone, so even a short old range is drawn by day.
        assert_eq!(custom(now - 40 * DAY, now - 39 * DAY).unwrap().step, DAY);
        assert!(custom(now, now - HOUR).is_err());
        assert!(custom(now + HOUR, now + 2 * HOUR).is_err());
        assert!(custom(now - 500 * DAY, now).is_err());
        assert_eq!(Range::Custom { from: 1, to: 2 }.label(), "custom");
    }

    #[test]
    fn counts_and_averages_fold_into_bars() {
        let window = Window {
            start: 10 * HOUR,
            step: 2 * HOUR,
            points: 3,
        };
        let rows = vec![
            // counter 7: hours 10, 11 (bar 0), 14 (bar 2), 8 (previous), 2 (outside)
            (10, 7, FIELD_COUNT, 1, 3),
            (11, 7, FIELD_COUNT, 2, 2),
            (14, 7, FIELD_COUNT, 1, 4),
            (8, 7, FIELD_COUNT, 1, 6),
            (2, 7, FIELD_COUNT, 1, 100),
            // timing 9: bar 1 has 2 samples totalling 300 ms
            (12, 9, FIELD_SUM, 1, 300),
            (12, 9, FIELD_SAMPLES, 1, 2),
            (9, 9, FIELD_SUM, 1, 50),
            (9, 9, FIELD_SAMPLES, 1, 1),
        ];
        let node_two = aggregate(&window, HOUR, Some(2), rows.clone());
        assert_eq!(node_two[&7].values, vec![Some(2.0), Some(0.0), Some(0.0)]);
        assert!(!node_two.contains_key(&9));
        let series = aggregate(&window, HOUR, None, rows);
        assert_eq!(
            series[&7],
            Series {
                kind: "count",
                values: vec![Some(5.0), Some(0.0), Some(4.0)],
                total: Some(9.0),
                previous: Some(6.0),
            }
        );
        assert_eq!(
            series[&9],
            Series {
                kind: "average",
                values: vec![None, Some(150.0), None],
                total: Some(150.0),
                previous: Some(50.0),
            }
        );
    }

    #[test]
    fn live_values_carry_the_hostname_and_expire() {
        let value = encode_live(1_000, "mail.example.org", &[(1, 5), (2, 7)]);
        assert_eq!(
            decode_live(&value, 999),
            Some(("mail.example.org".to_string(), vec![(1, 5), (2, 7)]))
        );
        assert_eq!(decode_live(&value, 1_000), None);
        assert_eq!(decode_live(&value[..value.len() - 3], 0), None);
        assert_eq!(decode_live(&value[..5], 0), None);
    }

    #[test]
    fn every_dashboard_metric_is_sampled() {
        // Every metric the portal dashboard names has a counter, a histogram,
        // or a gauge here, so no card or chart can depend on anything else.
        for name in [
            "queue.message-queued",
            "queue.authenticated-message-queued",
            "queue.dsn-queued",
            "queue.report-queued",
            "smtp.connection-start",
            "imap.connection-start",
            "pop3.connection-start",
            "http.connection-start",
            "manage-sieve.connection-start",
            "delivery.attempt-start",
            "security.ip-blocked",
            "security.authentication-ban",
            "security.abuse-ban",
            "security.scan-ban",
            "security.loiter-ban",
            "auth.failed",
            "message-ingest.spam",
            "message-ingest.ham",
            "incoming-report.dmarc-report-with-warnings",
            "incoming-report.tls-report-with-warnings",
        ] {
            let metric = MetricType::parse(name).unwrap_or_else(|| panic!("unknown {name}"));
            assert_ne!(metric.event_id(), usize::MAX, "{name} is not a counter");
        }
        for name in [
            "delivery.attempt-time",
            "delivery.total-time",
            "message-ingest.time",
            "message-ingest.index-time",
            "dns.lookup-time",
            "store.data-read-time",
            "store.data-write-time",
            "store.blob-read-time",
            "store.blob-write-time",
        ] {
            let metric = MetricType::parse(name).unwrap_or_else(|| panic!("unknown {name}"));
            assert!(
                Collector::histogram_totals(metric).is_some(),
                "{name} is not a histogram"
            );
        }
        for name in [
            "user.count",
            "domain.count",
            "server.memory",
            "queue.count",
            "smtp.active-connections",
            "imap.active-connections",
            "pop3.active-connections",
            "http.active-connections",
            "sieve.active-connections",
            "delivery.active-connections",
        ] {
            let metric = MetricType::parse(name).unwrap_or_else(|| panic!("unknown {name}"));
            assert!(
                LIVE_GAUGES.contains(&metric) || COUNTED_GAUGES.contains(&metric),
                "{name} is not a live gauge"
            );
        }
    }
}
