//! Database layer.
//!
//! Owns the connection pool and exposes query functions. Each query function
//! takes a `&SqlitePool` and returns either a row struct (kept local to this
//! module) or a domain-shaped value the handler can pass straight into
//! `lifecycle::derive`. No HTTP types in here.

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::str::FromStr;

pub mod packages;
pub mod usages;

/// Build a pool against the given SQLite URL.
///
/// `sqlite::memory:` is the convention for tests; a path like
/// `sqlite://tracker.db?mode=rwc` is used in production.
///
/// WAL + foreign keys are on. WAL gives concurrent readers during writes,
/// which matters even for a single-user app once the frontend starts
/// polling. Foreign keys must be enabled per-connection in SQLite.
pub async fn connect(url: &str) -> anyhow::Result<SqlitePool> {
    let opts = SqliteConnectOptions::from_str(url)?
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .synchronous(sqlx::sqlite::SqliteSynchronous::Normal);

    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(opts)
        .await?;

    Ok(pool)
}
