//! HTTP layer. Owns the router; handlers live in submodules.
//!
//! Handlers are deliberately thin: extract args, call domain/db, shape the
//! response. Anything more interesting belongs in `domain::`.

use std::sync::Arc;

use axum::{
    routing::{get, patch, post},
    Router,
};
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::db::{Repos, SubscriptionRepo, UsageRepo};

pub mod subscriptions;

/// Shared state passed to every handler.
///
/// Holds trait objects rather than a concrete pool so handlers don't know
/// (or care) which storage backend is running underneath. `Arc` clones are
/// cheap — handlers receive a fresh `AppState` per request.
#[derive(Clone)]
pub struct AppState {
    pub subscriptions: Arc<dyn SubscriptionRepo>,
    pub usages: Arc<dyn UsageRepo>,
}

impl From<Repos> for AppState {
    fn from(repos: Repos) -> Self {
        Self {
            subscriptions: repos.subscriptions,
            usages: repos.usages,
        }
    }
}

pub fn router(state: AppState) -> Router {
    // Permissive CORS in v1 — single-user, served on localhost alongside the
    // frontend dev server. Tighten before exposing externally.
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/categories", get(subscriptions::list_categories))
        .route(
            "/subscriptions",
            get(subscriptions::list).post(subscriptions::create),
        )
        .route(
            "/subscriptions/:id",
            get(subscriptions::get_one)
                .patch(subscriptions::update)
                .delete(subscriptions::delete),
        )
        .route("/subscriptions/:id/archive", post(subscriptions::archive))
        .route(
            "/subscriptions/:id/usages",
            get(subscriptions::list_usages).post(subscriptions::create_usage),
        )
        .route(
            "/subscriptions/:id/usages/:usage_id",
            patch(subscriptions::update_usage).delete(subscriptions::delete_usage),
        )
        .with_state(state)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
}
