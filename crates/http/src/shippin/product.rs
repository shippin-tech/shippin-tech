//! `GET /api`: what shippin.tech offers, by product area.
//!
//! Each area (mail, calendars, contacts, Drive, Docs, the Google link, MCPL
//! lessons, the free plan, the account, running the server) lists its web page,
//! its endpoints and an honest status: live, partial or planned. The description
//! lives in `resources/product/api.json`, so it grows with the product without
//! code changes; the tests below keep it well formed.

use http_proto::{HttpResponse, JsonResponse, ToHttpResponse};
use serde_json::{Value, json};

static PRODUCT_JSON: &str = include_str!("../../../../resources/product/api.json");

pub fn product_document() -> Value {
    serde_json::from_str(PRODUCT_JSON)
        .unwrap_or_else(|_| json!({ "product": "shippin.tech", "areas": [] }))
}

pub fn handle_product_request() -> trc::Result<HttpResponse> {
    Ok(JsonResponse::new(product_document())
        .no_cache()
        .into_http_response())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn the_product_description_is_well_formed_and_honest() {
        let doc: Value = serde_json::from_str(PRODUCT_JSON).expect("api.json parses");
        assert_eq!(doc["product"], "shippin.tech");
        assert_eq!(doc["prerelease"], true);
        let statuses = doc["statuses"].as_object().expect("statuses");
        let areas = doc["areas"].as_array().expect("areas");
        let mut ids = HashSet::new();
        for area in areas {
            let id = area["id"].as_str().expect("area id");
            assert!(ids.insert(id), "duplicate area {id}");
            assert!(
                area["name"].as_str().is_some_and(|name| !name.is_empty()),
                "{id} name"
            );
            let status = area["status"].as_str().expect("status");
            assert!(
                statuses.contains_key(status),
                "{id} has unknown status {status}"
            );
            match status {
                "live" => assert!(area["proof"].is_string(), "{id} is live but names no proof"),
                _ => assert!(
                    area["missing"].is_string(),
                    "{id} is {status} but says nothing about what is missing"
                ),
            }
            for call in area["api"].as_array().expect("api list") {
                for field in ["method", "path", "auth", "does"] {
                    assert!(
                        call[field].as_str().is_some_and(|value| !value.is_empty()),
                        "{id}: {field}"
                    );
                }
                assert!(
                    call["path"].as_str().unwrap().starts_with('/'),
                    "{id}: path"
                );
            }
        }
        for wanted in [
            "mail", "calendar", "contacts", "drive", "docs", "google", "learn", "admin",
        ] {
            assert!(ids.contains(wanted), "missing area {wanted}");
        }
        assert_eq!(product_document(), doc);
    }
}
