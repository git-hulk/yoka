//! HTTP layer. Owns the router; handlers live in submodules.
//!
//! Handlers are deliberately thin: extract args, call domain/db, shape the
//! response. Anything more interesting belongs in `domain::`.

use axum::{
    routing::{get, patch},
    Router,
};
use sqlx::SqlitePool;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

pub mod packages;

/// Shared state passed to every handler.
#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
}

pub fn router(state: AppState) -> Router {
    // Permissive CORS in v1 — single-user, served on localhost alongside the
    // frontend dev server. Tighten before exposing externally.
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/packages",            get(packages::list).post(packages::create))
        .route("/packages/:id",        get(packages::get_one).patch(packages::update))
        .route(
            "/packages/:id/usages",
            get(packages::list_usages).post(packages::create_usage),
        )
        .route(
            "/packages/:id/usages/:usage_id",
            patch(packages::update_usage).delete(packages::delete_usage),
        )
        .with_state(state)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
}
