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

    // config.yaml supplies port + data_dir (path movable via YOKA_CONFIG);
    // the BIND_ADDR / DATABASE_URL env vars override it entirely.
    let config_path =
        PathBuf::from(env::var("YOKA_CONFIG").unwrap_or_else(|_| "config.yaml".to_string()));
    let cfg = yoka::config::resolve(
        yoka::config::FileConfig::load(&config_path)?,
        env::var("BIND_ADDR").ok(),
        env::var("DATABASE_URL").ok(),
    )?;
    if let Some(dir) = &cfg.data_dir {
        std::fs::create_dir_all(dir)
            .map_err(|e| anyhow::anyhow!("creating data_dir {}: {e}", dir.display()))?;
    }
    let db_url = cfg.database_url;
    let addr: SocketAddr = cfg.bind_addr;

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
        env::var("WEB_DIST").unwrap_or_else(|_| "web/dist".to_string()),
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
