//! Live tracing, written for shippin.tech: our own open code, no licence key.
//!
//! `GET /api/trace/token` gives an administrator (the `liveTracing` permission)
//! a 60-second token, because a browser cannot send headers on an event stream.
//! `GET /api/trace/live?token=…` then streams the server's events as server-sent
//! `trace` events. Optional filters: `level` (trace, debug, info, warn, error;
//! default debug, which leaves out only raw traffic), `filter` (a word to find in the event name or any value) and
//! any `key=value` pair, where the key is an event key such as `accountName` or
//! `remoteIp`. The stream subscribes to the open event bus (`trc`) and
//! unsubscribes when the browser goes away.

use crate::auth::authenticate::Authenticator;
use common::{
    Server,
    auth::oauth::GrantType,
    trace_history::{event_json, list_traces, trace_events, value_text},
};
use http_body_util::{StreamBody, combinators::BoxBody};
use http_proto::{HttpRequest, HttpResponse, HttpSessionData, JsonResponse, ToHttpResponse};
use hyper::{
    StatusCode,
    body::{Bytes, Frame},
};
use registry::schema::enums::Permission;
use serde_json::{Value as Json, json};
use std::{
    str::FromStr,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use trc::{
    Collector, Event, EventDetails, EventType, Level,
    ipc::subscriber::{Interests, SubscriberBuilder},
};
use utils::url_params::UrlParams;

const TOKEN_SECONDS: u64 = 60;
const KEEPALIVE: Duration = Duration::from_secs(15);
const MAX_EVENTS_PER_FRAME: usize = 500;

static NEXT_STREAM: AtomicU64 = AtomicU64::new(1);

pub trait TraceApi: Sync + Send {
    fn handle_trace_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        action: &str,
        detail: Option<&str>,
    ) -> impl Future<Output = trc::Result<HttpResponse>> + Send;
}

/// What the viewer asked to see.
#[derive(Debug, Clone, PartialEq)]
pub struct TraceQuery {
    pub level: Level,
    pub keyword: Option<String>,
    pub pairs: Vec<(String, String)>,
}

impl TraceQuery {
    pub fn from_params(params: &UrlParams<'_>) -> Result<Self, &'static str> {
        let level = match params.get("level") {
            None | Some("") => Level::Debug,
            Some(level) => {
                Level::from_str(level).map_err(|_| "level is trace, debug, info, warn or error.")?
            }
        };
        let keyword = params
            .get("filter")
            .map(|word| word.trim().to_lowercase())
            .filter(|word| !word.is_empty());
        let pairs = params
            .iter()
            .filter(|(key, _)| !matches!(*key, "token" | "filter" | "level"))
            .map(|(key, value)| (key.to_string(), value.trim().to_lowercase()))
            .filter(|(_, value)| !value.is_empty())
            .collect();
        Ok(TraceQuery {
            level,
            keyword,
            pairs,
        })
    }

    /// Every event type at or above the chosen level.
    pub fn interests(&self) -> Interests {
        let mut interests = Interests::default();
        for event in EventType::variants() {
            if event.level() as usize >= self.level as usize {
                interests.set(*event);
            }
        }
        interests
    }

    pub fn matches(&self, event: &Event<EventDetails>) -> bool {
        if (event.inner.level as usize) < (self.level as usize) {
            return false;
        }
        let keys = || {
            event.keys.iter().chain(
                event
                    .inner
                    .span
                    .as_ref()
                    .map(|span| span.keys.as_slice())
                    .unwrap_or_default(),
            )
        };
        if let Some(word) = &self.keyword
            && !event.inner.typ.as_str().contains(word.as_str())
            && !keys().any(|(_, value)| value_text(value).to_lowercase().contains(word.as_str()))
        {
            return false;
        }
        self.pairs.iter().all(|(name, wanted)| {
            keys().any(|(key, value)| {
                key.as_str().eq_ignore_ascii_case(name)
                    && value_text(value).to_lowercase().contains(wanted.as_str())
            })
        })
    }
}

fn frame(name: &str, data: &str) -> Frame<Bytes> {
    Frame::data(Bytes::from(format!("event: {name}\ndata: {data}\n\n")))
}

fn problem(status: StatusCode, code: &str, message: &str) -> trc::Result<HttpResponse> {
    Ok(
        JsonResponse::with_status(status, json!({ "error": code, "message": message }))
            .no_cache()
            .into_http_response(),
    )
}

/// Removes the stream's subscriber from the event bus when the stream ends.
struct Unsubscribe(String);

impl Drop for Unsubscribe {
    fn drop(&mut self) {
        Collector::remove_subscriber(std::mem::take(&mut self.0));
    }
}

impl TraceApi for Server {
    async fn handle_trace_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        action: &str,
        detail: Option<&str>,
    ) -> trc::Result<HttpResponse> {
        match action {
            "token" => {
                let (_in_flight, access_token) = self.authenticate_headers(req, session).await?;
                access_token.enforce_permission(Permission::LiveTracing)?;
                let account_id = access_token.account_id();
                let token = self
                    .encode_access_token(
                        GrantType::LiveTracing,
                        account_id,
                        self.account(account_id).await?.name(),
                        TOKEN_SECONDS,
                        None,
                        None,
                    )
                    .await?;
                Ok(HttpResponse::new(StatusCode::OK)
                    .with_no_cache()
                    .with_text_body(token))
            }
            "live" => {
                let params = UrlParams::new(req.uri().query());
                let Some(token) = params.get("token") else {
                    return problem(
                        StatusCode::UNAUTHORIZED,
                        "noToken",
                        "Get a token from /api/trace/token first.",
                    );
                };
                self.validate_access_token(GrantType::LiveTracing.into(), token)
                    .await?;
                let query = match TraceQuery::from_params(&params) {
                    Ok(query) => query,
                    Err(message) => {
                        return problem(StatusCode::BAD_REQUEST, "invalidFilter", message);
                    }
                };

                let interests = query.interests();
                Collector::union_interests(interests.clone());
                let id = format!(
                    "shippin-live-trace-{}",
                    NEXT_STREAM.fetch_add(1, Ordering::Relaxed)
                );
                let (_tx, mut rx) = SubscriberBuilder::new(id.clone())
                    .with_interests(interests)
                    .with_lossy(true)
                    .register();
                let query = Arc::new(query);

                Ok(HttpResponse::new(StatusCode::OK)
                    .with_content_type("text/event-stream")
                    .with_cache_control("no-store")
                    .with_stream_body(BoxBody::new(StreamBody::new(async_stream::stream! {
                        let _unsubscribe = Unsubscribe(id);
                        yield Ok(frame("ready", "{}"));
                        loop {
                            match tokio::time::timeout(KEEPALIVE, rx.recv()).await {
                                Ok(Some(batch)) => {
                                    let events = batch
                                        .iter()
                                        .filter(|event| query.matches(event))
                                        .map(|event| event_json(event))
                                        .collect::<Vec<_>>();
                                    for chunk in events.chunks(MAX_EVENTS_PER_FRAME) {
                                        yield Ok(frame("trace", &Json::Array(chunk.to_vec()).to_string()));
                                    }
                                }
                                Ok(None) => break,
                                Err(_) => yield Ok(Frame::data(Bytes::from_static(b": keepalive\n\n"))),
                            }
                        }
                    }))))
            }
            "history" => {
                let (_in_flight, access_token) = self.authenticate_headers(req, session).await?;
                access_token.enforce_permission(Permission::LiveTracing)?;
                if let Some(id) = detail {
                    return match trace_events(self, id).await? {
                        Some(events) => Ok(JsonResponse::new(json!({ "events": events }))
                            .no_cache()
                            .into_http_response()),
                        None => problem(
                            StatusCode::NOT_FOUND,
                            "notFound",
                            "That trace is no longer kept.",
                        ),
                    };
                }
                let params = UrlParams::new(req.uri().query());
                let limit = params.parse::<usize>("limit").unwrap_or(100).clamp(1, 500);
                let traces = list_traces(
                    self,
                    params.get("q").unwrap_or_default(),
                    params.get("kind").filter(|kind| !kind.is_empty()),
                    params.get("problems").is_some_and(|value| value == "1"),
                    params.parse::<u64>("before"),
                    limit,
                )
                .await?;
                Ok(JsonResponse::new(json!({ "traces": traces }))
                    .no_cache()
                    .into_http_response())
            }
            _ => Err(trc::ResourceEvent::NotFound.into_err()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use common::trace_history::value_json;
    use trc::{AuthEvent, Key, SmtpEvent, Value};

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

    fn query(pairs: &str) -> TraceQuery {
        TraceQuery::from_params(&UrlParams::new(Some(pairs))).unwrap()
    }

    #[test]
    fn filters_by_level_word_and_key() {
        let failed = event(
            EventType::Auth(AuthEvent::Failed),
            vec![
                (Key::AccountName, Value::String("bob@example.org".into())),
                (Key::RemoteIp, Value::Ipv4("10.0.0.7".parse().unwrap())),
            ],
        );
        assert!(query("").matches(&failed));
        assert!(query("filter=FAILED").matches(&failed));
        assert!(query("filter=example.org").matches(&failed));
        assert!(!query("filter=delivery").matches(&failed));
        assert!(query("accountName=Bob").matches(&failed));
        assert!(query("remoteIp=10.0.0").matches(&failed));
        assert!(!query("remoteIp=192.168").matches(&failed));
        assert!(!query("level=error").matches(&failed) || failed.inner.level == Level::Error);
        assert!(query("token=abc&level=trace").pairs.is_empty());
        assert!(TraceQuery::from_params(&UrlParams::new(Some("level=loud"))).is_err());
    }

    #[test]
    fn span_keys_count_for_matching_and_are_named() {
        let session = Arc::new(event(
            EventType::Smtp(SmtpEvent::ConnectionStart),
            vec![
                (Key::SpanId, Value::UInt(42)),
                (Key::RemoteIp, Value::Ipv4("203.0.113.9".parse().unwrap())),
            ],
        ));
        let mut child = event(EventType::Smtp(SmtpEvent::Ehlo), vec![]);
        child.inner.span = Some(session);
        assert!(query("remoteIp=203.0.113.9").matches(&child));
        let json = event_json(&child);
        assert_eq!(json["event"], "smtp.ehlo");
        assert_eq!(json["timestamp"], "2025-11-10T18:40:00Z");
        let keys = json["keyValues"].as_array().unwrap();
        assert!(keys.contains(&json!({ "key": "span", "value": { "@type": "Event", "event": "smtp.connection-start" } })));
        assert!(keys.contains(
            &json!({ "key": "spanId", "value": { "@type": "UnsignedInt", "value": 42 } })
        ));
    }

    #[test]
    fn values_have_the_types_the_portal_reads() {
        assert_eq!(
            common::trace_history::value_json(&Value::Duration(12))["@type"],
            "Duration"
        );
        assert_eq!(
            value_json(&Value::Ipv4("10.0.0.1".parse().unwrap()))["value"],
            "10.0.0.1"
        );
        assert_eq!(
            value_json(&Value::Timestamp(0))["value"],
            "1970-01-01T00:00:00Z"
        );
        assert_eq!(
            common::trace_history::value_json(&Value::None)["@type"],
            "Null"
        );
        assert_eq!(
            value_json(&Value::Array(vec![Value::UInt(1), Value::UInt(2)]))["value"],
            "1, 2"
        );
    }

    #[test]
    fn interests_follow_the_level() {
        let all = query("level=trace").interests();
        let errors = query("level=error").interests();
        let failed = EventType::Auth(AuthEvent::Failed);
        assert!(all.get(failed));
        assert_eq!(errors.get(failed), failed.level() == Level::Error);
    }
}
