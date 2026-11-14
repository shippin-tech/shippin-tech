//! Alerts on the server's own statistics, written for shippin.tech: our own open code.
//!
//! A rule watches one metric over the last hour or day and, when it crosses a
//! threshold, sends an email, calls a webhook, or both. Each rule waits out a cooldown
//! before firing again, so one problem does not become a flood. Rules are checked
//! every five minutes on the node that calculates metrics.

use common::{
    Server,
    stats::{Range, query},
};
use mail_builder::{MessageBuilder, headers::address::Address};
use serde::{Deserialize, Serialize};
use serde_json::json;
use smtp::reporting::send::MtaReportSend;
use std::time::Duration;
use store::{
    IterateParams, ValueKey,
    rand::{RngExt, distr::Alphanumeric, rng},
    write::{BatchBuilder, InMemoryClass, Operation, ValueClass, ValueOp, now},
};
use trc::{AddContext, MetricType};

pub const KV_ALERT: u8 = 45;
pub const CHECK_INTERVAL: Duration = Duration::from_secs(5 * 60);
const MAX_RULES: usize = 100;
const MAX_RECIPIENTS: usize = 20;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertRule {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub metric: String,
    /// `1h` or `24h`.
    pub window: String,
    /// True to fire above the threshold, false to fire below it.
    pub above: bool,
    pub threshold: f64,
    #[serde(default)]
    pub email: Vec<String>,
    #[serde(default)]
    pub webhook: Option<String>,
    #[serde(default = "enabled_default")]
    pub enabled: bool,
    #[serde(default = "cooldown_default")]
    pub cooldown_minutes: u64,
    #[serde(default)]
    pub last_fired: Option<u64>,
    #[serde(default)]
    pub last_value: Option<f64>,
}

fn enabled_default() -> bool {
    true
}

fn cooldown_default() -> u64 {
    60
}

impl AlertRule {
    /// What is wrong with a rule, in words for the person writing it.
    pub fn problem(&self) -> Option<&'static str> {
        if self.name.trim().is_empty() || self.name.len() > 120 {
            return Some("Give the alert a name of up to 120 characters.");
        }
        if MetricType::parse(&self.metric).is_none() {
            return Some("Choose a metric from the list.");
        }
        if !matches!(self.window.as_str(), "1h" | "24h") {
            return Some("Choose the last hour or the last day.");
        }
        if !self.threshold.is_finite() || self.threshold < 0.0 {
            return Some("The threshold must be zero or more.");
        }
        if self.cooldown_minutes == 0 || self.cooldown_minutes > 10080 {
            return Some("Wait between 1 minute and 7 days before alerting again.");
        }
        let webhook = self.webhook.as_deref().filter(|url| !url.is_empty());
        if self.email.is_empty() && webhook.is_none() {
            return Some("Add an email address or a webhook to send the alert to.");
        }
        if self.email.len() > MAX_RECIPIENTS
            || self.email.iter().any(|address| !valid_email(address))
        {
            return Some("Use valid email addresses, up to 20.");
        }
        if webhook.is_some_and(|url| !url.starts_with("https://") && !url.starts_with("http://")) {
            return Some("A webhook address starts with https:// or http://.");
        }
        None
    }

    pub fn crossed(&self, value: f64) -> bool {
        if self.above {
            value > self.threshold
        } else {
            value < self.threshold
        }
    }

    pub fn cooled_down(&self, now: u64) -> bool {
        self.last_fired
            .is_none_or(|fired| now.saturating_sub(fired) >= self.cooldown_minutes * 60)
    }

    pub fn window_seconds(&self) -> u64 {
        if self.window == "24h" { 86400 } else { 3600 }
    }

    pub fn summary(&self, value: f64) -> String {
        format!(
            "{} is {} ({} the threshold of {}) over the last {}.",
            self.metric,
            value,
            if self.above { "above" } else { "below" },
            self.threshold,
            if self.window == "24h" { "day" } else { "hour" },
        )
    }
}

fn valid_email(address: &str) -> bool {
    match address.split_once('@') {
        Some((local, domain)) => {
            !local.is_empty()
                && domain.contains('.')
                && !address
                    .contains(|c: char| c.is_whitespace() || c == '<' || c == '>' || c == ',')
        }
        None => false,
    }
}

fn rule_key(id: &str) -> Vec<u8> {
    let mut key = vec![KV_ALERT];
    key.extend_from_slice(id.as_bytes());
    key
}

fn value_key(key: Vec<u8>) -> ValueKey<ValueClass> {
    ValueKey::from(ValueClass::InMemory(InMemoryClass::Key(key)))
}

pub async fn list_rules(server: &Server) -> trc::Result<Vec<AlertRule>> {
    let mut rules = Vec::new();
    let mut to = vec![KV_ALERT];
    to.extend_from_slice(&[u8::MAX; 32]);
    server
        .store()
        .iterate(
            IterateParams::new(value_key(vec![KV_ALERT]), value_key(to)),
            |_, value| {
                if let Some(rule) = value
                    .get(8..)
                    .and_then(|json| serde_json::from_slice::<AlertRule>(json).ok())
                {
                    rules.push(rule);
                }
                Ok(true)
            },
        )
        .await
        .caused_by(trc::location!())?;
    rules.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(rules)
}

async fn put(server: &Server, id: &str, rule: Option<&AlertRule>) -> trc::Result<()> {
    let mut batch = BatchBuilder::new();
    batch.any_op(Operation::Value {
        class: ValueClass::InMemory(InMemoryClass::Key(rule_key(id))),
        op: match rule {
            Some(rule) => {
                let mut value = u64::MAX.to_be_bytes().to_vec();
                value.extend_from_slice(&serde_json::to_vec(rule).unwrap_or_default());
                ValueOp::Set(value)
            }
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

/// Creates or replaces a rule. The inner error says why a rule cannot be saved.
pub async fn save_rule(
    server: &Server,
    mut rule: AlertRule,
) -> trc::Result<Result<AlertRule, &'static str>> {
    if let Some(problem) = rule.problem() {
        return Ok(Err(problem));
    }
    let existing = list_rules(server).await?;
    if let Some(current) = existing
        .iter()
        .find(|item| !rule.id.is_empty() && item.id == rule.id)
    {
        rule.last_fired = current.last_fired;
        rule.last_value = current.last_value;
    } else {
        if existing.len() >= MAX_RULES {
            return Ok(Err("There can be up to 100 alerts."));
        }
        rule.id = rng()
            .sample_iter(Alphanumeric)
            .take(16)
            .map(char::from)
            .collect::<String>()
            .to_lowercase();
        rule.last_fired = None;
        rule.last_value = None;
    }
    rule.name = rule.name.trim().to_string();
    rule.webhook = rule.webhook.filter(|url| !url.is_empty());
    put(server, &rule.id, Some(&rule)).await?;
    Ok(Ok(rule))
}

pub async fn delete_rule(server: &Server, id: &str) -> trc::Result<()> {
    put(server, id, None).await
}

async fn metric_value(server: &Server, rule: &AlertRule) -> trc::Result<Option<f64>> {
    let now = now();
    let range = Range::Custom {
        from: now.saturating_sub(rule.window_seconds()),
        to: now,
    };
    let Ok(stats) = query(server, range, None).await? else {
        return Ok(None);
    };
    Ok(
        match stats.history.iter().find(|(name, _)| **name == rule.metric) {
            Some((_, series)) => series.total,
            None => match stats.live.iter().find(|(name, _)| **name == rule.metric) {
                Some((_, value)) => Some(*value),
                // A counter with no history has counted nothing yet.
                None => Some(0.0),
            },
        },
    )
}

async fn send_webhook(url: &str, rule: &AlertRule, value: f64, host: &str) {
    let body = json!({
        "alert": rule.name,
        "metric": rule.metric,
        "value": value,
        "threshold": rule.threshold,
        "above": rule.above,
        "window": rule.window,
        "server": host,
        "at": now(),
    });
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build();
    let outcome = match client {
        Ok(client) => client
            .post(url)
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .send()
            .await
            .map(|response| response.status().is_success())
            .unwrap_or(false),
        Err(_) => false,
    };
    if !outcome {
        trc::event!(
            Telemetry(trc::TelemetryEvent::WebhookError),
            Details = format!("Alert webhook failed: {}", rule.name)
        );
    }
}

async fn send_email(server: &Server, rule: &AlertRule, value: f64) {
    let from = format!("postmaster@{}", server.core.email.default_domain_name);
    let subject = format!("Alert: {}", rule.name);
    let text = format!(
        "{}\n\nThis came from an alert on {}. Change it under Alerts in the portal.\n",
        rule.summary(value),
        server.core.network.server_name
    );
    let Ok(raw) = MessageBuilder::new()
        .from(Address::new_address(
            "shippin.tech alerts".into(),
            from.as_str(),
        ))
        .to(rule
            .email
            .iter()
            .map(|address| Address::new_address(None::<&str>, address.as_str()))
            .collect::<Vec<_>>())
        .subject(subject)
        .text_body(text)
        .write_to_vec()
    else {
        return;
    };
    server
        .send_autogenerated(from.as_str(), rule.email.iter(), raw, None, 0)
        .await;
}

#[derive(Debug, Serialize)]
pub struct CheckResult {
    pub id: String,
    pub value: Option<f64>,
    pub fired: bool,
}

/// Checks every enabled rule and sends what is due.
pub async fn check_alerts(server: &Server) -> trc::Result<Vec<CheckResult>> {
    let mut results = Vec::new();
    let current = now();
    for mut rule in list_rules(server)
        .await?
        .into_iter()
        .filter(|rule| rule.enabled)
    {
        let value = metric_value(server, &rule).await?;
        let due = value.is_some_and(|value| rule.crossed(value)) && rule.cooled_down(current);
        rule.last_value = value;
        if let (true, Some(value)) = (due, value) {
            rule.last_fired = Some(current);
            if !rule.email.is_empty() {
                send_email(server, &rule, value).await;
            }
            if let Some(url) = &rule.webhook {
                send_webhook(url, &rule, value, &server.core.network.server_name).await;
            }
        }
        put(server, &rule.id, Some(&rule)).await?;
        results.push(CheckResult {
            id: rule.id,
            value,
            fired: due,
        });
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule() -> AlertRule {
        AlertRule {
            id: String::new(),
            name: "Too many failed sign-ins".into(),
            metric: "auth.failed".into(),
            window: "1h".into(),
            above: true,
            threshold: 10.0,
            email: vec!["ops@example.org".into()],
            webhook: None,
            enabled: true,
            cooldown_minutes: 60,
            last_fired: None,
            last_value: None,
        }
    }

    #[test]
    fn rules_are_checked_before_saving() {
        assert_eq!(rule().problem(), None);
        assert!(
            AlertRule {
                name: " ".into(),
                ..rule()
            }
            .problem()
            .is_some()
        );
        assert!(
            AlertRule {
                metric: "not.a-metric".into(),
                ..rule()
            }
            .problem()
            .is_some()
        );
        assert!(
            AlertRule {
                window: "2h".into(),
                ..rule()
            }
            .problem()
            .is_some()
        );
        assert!(
            AlertRule {
                threshold: -1.0,
                ..rule()
            }
            .problem()
            .is_some()
        );
        assert!(
            AlertRule {
                threshold: f64::NAN,
                ..rule()
            }
            .problem()
            .is_some()
        );
        assert!(
            AlertRule {
                cooldown_minutes: 0,
                ..rule()
            }
            .problem()
            .is_some()
        );
        assert!(
            AlertRule {
                email: vec![],
                ..rule()
            }
            .problem()
            .is_some()
        );
        assert!(
            AlertRule {
                email: vec!["nope".into()],
                ..rule()
            }
            .problem()
            .is_some()
        );
        assert_eq!(
            AlertRule {
                email: vec![],
                webhook: Some("https://x.test/h".into()),
                ..rule()
            }
            .problem(),
            None
        );
        assert!(
            AlertRule {
                webhook: Some("ftp://x".into()),
                ..rule()
            }
            .problem()
            .is_some()
        );
    }

    #[test]
    fn a_rule_fires_on_the_right_side_of_its_threshold() {
        assert!(rule().crossed(11.0));
        assert!(!rule().crossed(10.0));
        let below = AlertRule {
            above: false,
            ..rule()
        };
        assert!(below.crossed(9.0));
        assert!(!below.crossed(10.0));
    }

    #[test]
    fn a_rule_waits_out_its_cooldown() {
        assert!(rule().cooled_down(1000));
        let fired = AlertRule {
            last_fired: Some(1000),
            ..rule()
        };
        assert!(!fired.cooled_down(1000 + 3599));
        assert!(fired.cooled_down(1000 + 3600));
    }

    #[test]
    fn the_message_says_what_happened() {
        assert_eq!(
            rule().summary(12.0),
            "auth.failed is 12 (above the threshold of 10) over the last hour."
        );
    }

    #[test]
    fn rule_json_uses_camel_case_and_defaults() {
        let parsed: AlertRule = serde_json::from_str(
            r#"{"name":"n","metric":"auth.failed","window":"1h","above":true,"threshold":1,"email":["a@b.co"]}"#,
        )
        .unwrap();
        assert!(parsed.enabled);
        assert_eq!(parsed.cooldown_minutes, 60);
        assert!(
            serde_json::to_string(&parsed)
                .unwrap()
                .contains("cooldownMinutes")
        );
    }
}
