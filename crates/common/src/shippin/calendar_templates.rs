//! Calendar emails an administrator can reword, written for shippin.tech: our own open code.
//!
//! A saved template replaces the built-in invitation or reminder email. Deleting it goes
//! back to the built-in one.

use crate::{Server, config::groupware::CalendarTemplateVariable};
use store::{
    Deserialize as StoreDeserialize, ValueKey,
    write::{BatchBuilder, InMemoryClass, Operation, ValueClass, ValueOp},
};
use trc::AddContext;
use utils::template::Template;

pub const KV_CALENDAR_TEMPLATE: u8 = 52;
/// Under the 100 KB a single value may take in FoundationDB.
pub const MAX_TEMPLATE: usize = 90_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TemplateKind {
    Invite,
    Alarm,
}

impl TemplateKind {
    pub const ALL: [TemplateKind; 2] = [TemplateKind::Invite, TemplateKind::Alarm];

    pub fn parse(id: &str) -> Option<Self> {
        match id {
            "invite" => Some(TemplateKind::Invite),
            "alarm" => Some(TemplateKind::Alarm),
            _ => None,
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            TemplateKind::Invite => "invite",
            TemplateKind::Alarm => "alarm",
        }
    }

    pub fn default_source(self) -> &'static str {
        match self {
            TemplateKind::Invite => include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../resources/html-templates/calendar-invite.html"
            )),
            TemplateKind::Alarm => include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../resources/html-templates/calendar-alarm.html"
            )),
        }
    }

    fn tag(self) -> u8 {
        match self {
            TemplateKind::Invite => b'i',
            TemplateKind::Alarm => b'a',
        }
    }
}

struct Raw(Vec<u8>);

impl StoreDeserialize for Raw {
    fn deserialize(bytes: &[u8]) -> trc::Result<Self> {
        Ok(Raw(bytes.to_vec()))
    }
}

fn class(kind: TemplateKind) -> ValueClass {
    ValueClass::InMemory(InMemoryClass::Key(vec![KV_CALENDAR_TEMPLATE, kind.tag()]))
}

/// Why this text cannot be used, in words for the person editing it.
pub fn template_problem(text: &str) -> Option<String> {
    if text.trim().is_empty() {
        return Some("The template is empty.".to_string());
    }
    if text.len() > MAX_TEMPLATE {
        return Some("Keep the template under 90 KB.".to_string());
    }
    Template::<CalendarTemplateVariable>::parse(text)
        .err()
        .map(|reason| format!("That template has a mistake: {reason}"))
}

/// The saved text, if an administrator has written one.
pub async fn saved(server: &Server, kind: TemplateKind) -> trc::Result<Option<String>> {
    let value = server
        .store()
        .get_value::<Raw>(ValueKey::from(class(kind)))
        .await
        .caused_by(trc::location!())?;
    Ok(value.and_then(|value| {
        value
            .0
            .get(8..)
            .and_then(|text| String::from_utf8(text.to_vec()).ok())
    }))
}

/// The saved template, ready to render. Nothing if the built-in one should be used.
pub async fn custom(
    server: &Server,
    kind: TemplateKind,
) -> trc::Result<Option<Template<CalendarTemplateVariable>>> {
    Ok(saved(server, kind)
        .await?
        .and_then(|text| Template::parse(&text).ok()))
}

pub async fn save(server: &Server, kind: TemplateKind, text: &str) -> trc::Result<()> {
    let mut value = u64::MAX.to_be_bytes().to_vec();
    value.extend_from_slice(text.as_bytes());
    write(server, kind, ValueOp::Set(value)).await
}

pub async fn reset(server: &Server, kind: TemplateKind) -> trc::Result<()> {
    write(server, kind, ValueOp::Clear).await
}

async fn write(server: &Server, kind: TemplateKind, op: ValueOp) -> trc::Result<()> {
    let mut batch = BatchBuilder::new();
    batch.any_op(Operation::Value {
        class: class(kind),
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
    fn the_built_in_templates_are_valid_starting_points() {
        for kind in TemplateKind::ALL {
            assert_eq!(
                template_problem(kind.default_source()),
                None,
                "{}",
                kind.id()
            );
        }
    }

    #[test]
    fn mistakes_are_explained() {
        assert!(template_problem("  ").is_some());
        assert!(
            template_problem("<p>{{no_such_variable}}</p>")
                .unwrap()
                .contains("mistake")
        );
        assert!(
            template_problem(&"x".repeat(MAX_TEMPLATE + 1))
                .unwrap()
                .contains("90 KB")
        );
        assert_eq!(template_problem("<p>{{page_title}}</p>"), None);
    }

    #[test]
    fn kinds_round_trip_and_unknown_ones_are_refused() {
        for kind in TemplateKind::ALL {
            assert_eq!(TemplateKind::parse(kind.id()), Some(kind));
        }
        assert_eq!(TemplateKind::parse("rsvp"), None);
    }
}
