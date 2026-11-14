

#![warn(clippy::large_futures)]

pub mod shippin;
pub use shippin::{alerts, brand, calendar_templates, google, learn, masked, org, panel, product, provisioning, recover, sso, stats, trace};
pub mod api;
pub mod auth;
pub mod form;
pub mod portal;
pub mod request;
pub mod setup;

use common::Inner;
use std::sync::Arc;

#[derive(Clone)]
pub struct HttpSessionManager {
    pub inner: Arc<Inner>,
}

impl HttpSessionManager {
    pub fn new(inner: Arc<Inner>) -> Self {
        Self { inner }
    }
}
