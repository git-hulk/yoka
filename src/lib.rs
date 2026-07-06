//! Library entry point.
//!
//! Exposes everything `main.rs` and the integration tests need to build a
//! running application: the modules, the router constructor, and a
//! storage-engine factory keyed off `DATABASE_URL`.

pub mod auth;
pub mod db;
pub mod domain;
pub mod error;
pub mod http;
pub mod schema;

/// Connect to the storage backend implied by the URL scheme and run that
/// backend's migrations. Returns trait-objectified repos ready to drop into
/// `AppState`.
///
/// `sqlite://…` and `sqlite::memory:` → SQLite backend.
/// `postgres://…` / `postgresql://…` → reserved; not yet implemented.
pub async fn connect_and_migrate(url: &str) -> anyhow::Result<db::Repos> {
    if url.starts_with("sqlite:") {
        let backend = db::sqlite::SqliteBackend::connect(url).await?;
        Ok(backend.into_repos())
    } else if url.starts_with("postgres:") || url.starts_with("postgresql:") {
        anyhow::bail!("postgres backend not yet implemented");
    } else {
        anyhow::bail!("unsupported DATABASE_URL scheme: {url}");
    }
}
