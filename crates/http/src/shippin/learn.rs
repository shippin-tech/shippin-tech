//! MCPL lesson progress, kept on the server per person.
//!
//! Lessons (`ui/src/lib/mcpl/lessons/*.json`) teach people as they use the
//! product; each step finishes on a real app event in the browser. This keeps
//! what each person has finished, so their progress follows them to every
//! device.
//!
//! - `GET /api/learn/progress`: `{ "lessons": { "<lesson>": { "done": [..], "dismissed": bool } } }`
//! - `POST /api/learn/progress/<lesson>` with `{ "done": [..], "dismissed": bool }`:
//!   adds the steps (finished steps are never taken away by another device) and
//!   sets `dismissed`; answers with the merged progress.
//! - `DELETE /api/learn/progress/<lesson>`: start the lesson over.

use crate::auth::authenticate::Authenticator;
use common::Server;
use http_proto::{HttpRequest, HttpResponse, HttpSessionData, JsonResponse, ToHttpResponse};
use hyper::{Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use store::{
    IterateParams, ValueKey,
    write::{BatchBuilder, InMemoryClass, Operation, ValueClass, ValueOp},
};
use trc::AddContext;

/// In-memory key prefix for lesson progress (next to `common::KV_*` and stats' 41).
pub const KV_LEARN: u8 = 42;
const MAX_LESSONS: usize = 32;
const MAX_STEPS: usize = 64;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Progress {
    #[serde(default)]
    pub done: Vec<String>,
    #[serde(default)]
    pub dismissed: bool,
}

impl Progress {
    /// Steps finished anywhere stay finished; `dismissed` follows the latest word.
    pub fn merge(&self, incoming: &Progress) -> Progress {
        let mut done = self.done.clone();
        for step in &incoming.done {
            if !done.contains(step) {
                done.push(step.clone());
            }
        }
        Progress {
            done,
            dismissed: incoming.dismissed,
        }
    }

    pub fn is_valid(&self) -> bool {
        self.done.len() <= MAX_STEPS && self.done.iter().all(|step| valid_id(step))
    }
}

/// Lesson and step ids: lowercase letters, digits and dashes, 1 to 64 long.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && !id.starts_with('-')
}

fn progress_key(account_id: u32, lesson: &str) -> Vec<u8> {
    let mut key = Vec::with_capacity(5 + lesson.len());
    key.push(KV_LEARN);
    key.extend_from_slice(&account_id.to_be_bytes());
    key.extend_from_slice(lesson.as_bytes());
    key
}

/// Stored value: the never-expires marker the in-memory purge understands, then JSON.
fn encode(progress: &Progress) -> Vec<u8> {
    let mut value = u64::MAX.to_be_bytes().to_vec();
    value.extend_from_slice(&serde_json::to_vec(progress).unwrap_or_default());
    value
}

fn decode(value: &[u8]) -> Option<Progress> {
    serde_json::from_slice(value.get(8..)?).ok()
}

fn reply(status: StatusCode, value: Value) -> trc::Result<HttpResponse> {
    Ok(JsonResponse::with_status(status, value)
        .no_cache()
        .into_http_response())
}

async fn load_all(server: &Server, account_id: u32) -> trc::Result<BTreeMap<String, Progress>> {
    let mut lessons = BTreeMap::new();
    let mut from = vec![KV_LEARN];
    from.extend_from_slice(&account_id.to_be_bytes());
    let mut to = from.clone();
    to.extend_from_slice(&[u8::MAX; 65]);
    server
        .store()
        .iterate(
            IterateParams::new(
                ValueKey::from(ValueClass::InMemory(InMemoryClass::Key(from))),
                ValueKey::from(ValueClass::InMemory(InMemoryClass::Key(to))),
            ),
            |key, value| {
                if let (Some(lesson), Some(progress)) = (
                    key.get(5..)
                        .and_then(|bytes| std::str::from_utf8(bytes).ok()),
                    decode(value),
                ) {
                    lessons.insert(lesson.to_string(), progress);
                }
                Ok(true)
            },
        )
        .await
        .caused_by(trc::location!())?;
    Ok(lessons)
}

async fn write(
    server: &Server,
    account_id: u32,
    lesson: &str,
    progress: Option<&Progress>,
) -> trc::Result<()> {
    let mut batch = BatchBuilder::new();
    batch.any_op(Operation::Value {
        class: ValueClass::InMemory(InMemoryClass::Key(progress_key(account_id, lesson))),
        op: match progress {
            Some(progress) => ValueOp::Set(encode(progress)),
            None => ValueOp::Clear,
        },
    });
    server
        .store()
        .write(batch.build_all())
        .await
        .caused_by(trc::location!())
        .map(|_| ())
}

pub trait LearnApi: Sync + Send {
    fn handle_learn_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        path: &[&str],
        body: Option<Vec<u8>>,
    ) -> impl Future<Output = trc::Result<HttpResponse>> + Send;
}

impl LearnApi for Server {
    async fn handle_learn_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        path: &[&str],
        body: Option<Vec<u8>>,
    ) -> trc::Result<HttpResponse> {
        let (_in_flight, access_token) = self.authenticate_headers(req, session).await?;
        let account_id = access_token.account_id();

        match (path, req.method()) {
            (["progress"] | ["progress", ""], &Method::GET) => reply(
                StatusCode::OK,
                json!({ "lessons": load_all(self, account_id).await? }),
            ),
            (["progress", lesson], method)
                if *method == Method::POST || *method == Method::DELETE =>
            {
                if !valid_id(lesson) {
                    return reply(
                        StatusCode::BAD_REQUEST,
                        json!({ "error": "invalidLesson", "message": "Lesson ids are lowercase words joined by dashes." }),
                    );
                }
                if *method == Method::DELETE {
                    write(self, account_id, lesson, None).await?;
                    return reply(StatusCode::OK, json!(Progress::default()));
                }
                let incoming = body
                    .as_deref()
                    .and_then(|bytes| serde_json::from_slice::<Progress>(bytes).ok())
                    .filter(Progress::is_valid);
                let Some(incoming) = incoming else {
                    return reply(
                        StatusCode::BAD_REQUEST,
                        json!({ "error": "invalidProgress", "message": "Send { done: [step ids], dismissed: true|false }." }),
                    );
                };
                let mut all = load_all(self, account_id).await?;
                if !all.contains_key(*lesson) && all.len() >= MAX_LESSONS {
                    return reply(
                        StatusCode::BAD_REQUEST,
                        json!({ "error": "tooManyLessons", "message": "Too many lessons for one account." }),
                    );
                }
                let merged = all.remove(*lesson).unwrap_or_default().merge(&incoming);
                if !merged.is_valid() {
                    return reply(
                        StatusCode::BAD_REQUEST,
                        json!({ "error": "invalidProgress", "message": "Too many steps." }),
                    );
                }
                write(self, account_id, lesson, Some(&merged)).await?;
                reply(StatusCode::OK, json!(merged))
            }
            _ => Err(trc::ResourceEvent::NotFound.into_err()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn progress(done: &[&str], dismissed: bool) -> Progress {
        Progress {
            done: done.iter().map(|step| step.to_string()).collect(),
            dismissed,
        }
    }

    #[test]
    fn finished_steps_are_never_taken_away() {
        let phone = progress(&["publish-dns", "add-mailbox"], false);
        let laptop = progress(&["send-first-message"], true);
        assert_eq!(
            phone.merge(&laptop),
            progress(&["publish-dns", "add-mailbox", "send-first-message"], true)
        );
        assert_eq!(
            laptop.merge(&progress(&[], false)),
            progress(&["send-first-message"], false)
        );
    }

    #[test]
    fn ids_and_sizes_are_checked() {
        assert!(valid_id("set-up-your-domain"));
        assert!(!valid_id(""));
        assert!(!valid_id("-x"));
        assert!(!valid_id("Upper"));
        assert!(!valid_id("../etc"));
        assert!(!valid_id(&"a".repeat(65)));
        assert!(progress(&["publish-dns"], false).is_valid());
        assert!(!progress(&["no spaces"], false).is_valid());
        let many = (0..65).map(|n| format!("s{n}")).collect::<Vec<_>>();
        assert!(
            !Progress {
                done: many,
                dismissed: false
            }
            .is_valid()
        );
    }

    #[test]
    fn stored_values_round_trip_and_never_expire() {
        let saved = progress(&["publish-dns"], true);
        let value = encode(&saved);
        assert_eq!(&value[..8], &u64::MAX.to_be_bytes());
        assert_eq!(decode(&value), Some(saved));
        assert_eq!(decode(b"short"), None);
        assert_eq!(progress_key(7, "x"), vec![KV_LEARN, 0, 0, 0, 7, b'x']);
    }
}
