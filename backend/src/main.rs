//! Binary entry point.
//!
//! Loads config from env, sets up tracing, connects the pool, runs migrations,
//! and serves the router on `:3000` until SIGINT.

use std::env;
use std::net::SocketAddr;
use std::path::PathBuf;

use axum::response::Redirect;
use axum::routing::get;
use tower_http::services::{ServeDir, ServeFile};
use tracing_subscriber::EnvFilter;

use yoka::http::{router, AppState};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing();

    let db_url =
        env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://tracker.db?mode=rwc".to_string());
    let addr: SocketAddr = env::var("BIND_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:3000".to_string())
        .parse()?;

    tracing::info!(%db_url, "connecting to database");
    let repos = yoka::connect_and_migrate(&db_url).await?;

    let state = AppState::from(repos);

    // The API answers on both the bare paths (used by the Vite dev proxy,
    // which strips /api, and by the integration tests) and under /api (used
    // by the built UI, whose fetches are same-origin `/api/...`).
    let mut app = axum::Router::new()
        .nest("/api", router(state.clone()))
        .merge(router(state));

    // Serve the built UI at /web when the dist exists (`make build` produces
    // it). Unknown paths under /web fall back to index.html so the SPA's
    // client-side routes deep-link correctly.
    let web_dist = PathBuf::from(
        env::var("WEB_DIST").unwrap_or_else(|_| "../frontend/dist".to_string()),
    );
    if web_dist.join("index.html").is_file() {
        let spa = ServeDir::new(&web_dist)
            .fallback(ServeFile::new(web_dist.join("index.html")));
        app = app
            .nest_service("/web", spa)
            .route("/", get(|| async { Redirect::temporary("/web/") }));
        tracing::info!(dist = %web_dist.display(), "serving UI at /web");
    } else {
        tracing::info!(
            dist = %web_dist.display(),
            "UI dist not found — /web disabled (run `make build`, or set WEB_DIST)"
        );
    }

    tracing::info!(%addr, "listening");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("yoka=debug,tower_http=info,info"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .init();
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutdown signal received");
}
