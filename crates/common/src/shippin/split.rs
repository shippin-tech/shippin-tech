//! Domains shared with another mail system, such as Google Workspace.
//!
//! `shippin.tech_SPLIT_DOMAINS` lists them. Some people on such a domain live here and
//! the rest live elsewhere. Mail a signed-in person sends to an address this server
//! does not hold is delivered to the domain's real MX, which is the other system.
//! Mail from the internet to such an address is still refused, so the two systems
//! can never pass a message back and forth.

use crate::config::smtp::queue::{HostOrIp, IpStr, RelayConfig, RoutingStrategy};
use std::sync::LazyLock;

pub struct SplitDomains {
    domains: Vec<String>,
    /// Sends to this host instead of looking up the MX.
    relay: Option<RoutingStrategy>,
}

fn parse_relay(value: &str) -> Option<RoutingStrategy> {
    let (host, port) = value.trim().rsplit_once(':')?;
    let port = port.parse::<u16>().ok()?;
    if host.is_empty() {
        return None;
    }
    Some(RoutingStrategy::Relay(RelayConfig {
        address: match host.parse() {
            Ok(ip) => HostOrIp::Ip(IpStr {
                ip,
                ip_str: host.into(),
            }),
            Err(_) => HostOrIp::Host(host.into()),
        },
        port,
        protocol: crate::config::server::ServerProtocol::Smtp,
        auth: None,
        tls_implicit: false,
        tls_allow_invalid_certs: false,
    }))
}

impl SplitDomains {
    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Self {
        SplitDomains {
            domains: get("shippin.tech_SPLIT_DOMAINS")
                .unwrap_or_default()
                .split(',')
                .map(|domain| domain.trim().trim_end_matches('.').to_lowercase())
                .filter(|domain| !domain.is_empty())
                .collect(),
            relay: get("shippin.tech_SPLIT_RELAY").and_then(|value| parse_relay(&value)),
        }
    }

    pub fn contains(&self, domain: &str) -> bool {
        !self.domains.is_empty()
            && self
                .domains
                .iter()
                .any(|item| item.eq_ignore_ascii_case(domain.trim_end_matches('.')))
    }

    pub fn relay(&self) -> Option<&RoutingStrategy> {
        self.relay.as_ref()
    }
}

pub static SPLIT: LazyLock<SplitDomains> =
    LazyLock::new(|| SplitDomains::from_lookup(|key| std::env::var(key).ok()));

#[cfg(test)]
mod tests {
    use super::*;

    fn split(domains: &'static str, relay: &'static str) -> SplitDomains {
        SplitDomains::from_lookup(move |key| match key {
            "shippin.tech_SPLIT_DOMAINS" => Some(domains.to_string()),
            "shippin.tech_SPLIT_RELAY" => Some(relay.to_string()),
            _ => None,
        })
    }

    #[test]
    fn lists_domains_without_caring_about_case_or_spaces() {
        let domains = split(" Angrygaming.org, other.test. ,", "");
        assert!(domains.contains("angrygaming.org"));
        assert!(domains.contains("ANGRYGAMING.ORG"));
        assert!(domains.contains("other.test"));
        assert!(!domains.contains("example.org"));
        assert!(!split("", "").contains("angrygaming.org"));
    }

    #[test]
    fn a_relay_is_a_host_and_port() {
        assert!(matches!(
            split("", "host.example:2525").relay(),
            Some(RoutingStrategy::Relay(_))
        ));
        assert!(split("", "no-port").relay().is_none());
        assert!(split("", ":25").relay().is_none());
        assert!(split("", "").relay().is_none());
    }
}
