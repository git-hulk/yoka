//! Binary entry point.
//!
//! Loads config from env, sets up tracing, connects the pool, runs migrations,
//! and serves the router on `:3000` until SIGINT.

use std::env;
use std::net::SocketAddr;

use tracing_subscriber::EnvFilter;

use yoka::http::{router, AppState};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing();

    let db_url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "sqlite://tracker.db?mode=rwc".to_string());
    let addr: SocketAddr = env::var("BIND_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:3000".to_string())
        .parse()?;

    tracing::info!(%db_url, "connecting to database");
    let pool = yoka::db::connect(&db_url).await?;
    yoka::migrate(&pool).await?;

    let app = router(AppState { pool });

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
