//! Our own HTTP API for the Shippin product. Every area here is listed in
//! `resources/product/api.json`, which `GET /api` reports; the tests below hold the
//! dispatch table and that document together.

pub mod alerts;
pub mod assistant;
pub mod brand;
pub mod calendar_templates;
pub mod google;
pub mod keys;
pub mod learn;
pub mod masked;
pub mod mcp;
pub mod org;
pub mod panel;
pub mod product;
pub mod provisioning;
pub mod recover;
pub mod resources;
pub mod sso;
pub mod stats;
pub mod trace;

/// The first path segment after `/api/` of each of our own areas.
pub const API_AREAS: &[&str] = &[
    "ai",
    "alerts",
    "assistant",
    "brand",
    "calendar-templates",
    "google",
    "keys",
    "learn",
    "masked",
    "mcp",
    "org",
    "orgs",
    "panel",
    "recover",
    "resources",
    "scim",
    "sso",
    "stats",
    "trace",
];

#[cfg(test)]
mod tests {
    use super::API_AREAS;
    use serde_json::Value;

    const DISPATCH: &str = include_str!("../api/mod.rs");
    const PRODUCT: &str = include_str!("../../../../resources/product/api.json");
    /// Documented, but served by the engine rather than by this folder.
    const ENGINE: &[&str] = &["account", "schema", "setup"];

    fn documented() -> Vec<String> {
        let doc: Value = serde_json::from_str(PRODUCT).expect("api.json parses");
        doc["areas"]
            .as_array()
            .expect("areas")
            .iter()
            .flat_map(|area| area["api"].as_array().cloned().unwrap_or_default())
            .filter_map(|call| {
                call["path"]
                    .as_str()?
                    .strip_prefix("/api/")
                    .map(str::to_string)
            })
            .collect()
    }

    #[test]
    fn every_area_is_served_and_documented() {
        let paths = documented();
        for area in API_AREAS {
            assert!(
                DISPATCH.contains(&format!("\"{area}\"")),
                "{area} is not dispatched"
            );
            assert!(
                paths
                    .iter()
                    .any(|path| path == area || path.starts_with(&format!("{area}/"))),
                "{area} is missing from api.json"
            );
        }
    }

    #[test]
    fn nothing_is_documented_that_is_not_ours_to_serve() {
        for path in documented() {
            let area = path.split(['/', '?']).next().unwrap_or_default();
            assert!(
                API_AREAS.contains(&area) || ENGINE.contains(&area),
                "/api/{path} belongs to no known area"
            );
        }
    }
}
