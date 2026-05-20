//! Library entry point.
//!
//! Exposes everything `main.rs` and the integration tests need to build a
//! running application: the modules, the router constructor, and a
//! migration runner.

pub mod db;
pub mod domain;
pub mod error;
pub mod http;
pub mod schema;

use sqlx::{Executor, Row, SqlitePool};

/// SQL for all migrations, applied in order on startup.
///
/// Tracking lives in SQLite's built-in `user_version` pragma — each
/// migration's index (1-based) becomes the new `user_version` after it
/// applies. Cheap, no extra table, easy to reset by clearing the file.
/// Swap to `sqlx::migrate!` when there's a real need for naming or
/// down-migrations.
const MIGRATIONS: &[(&str, &str)] = &[
    (
        "20260519_000001_initial",
        include_str!("../migrations/20260519_000001_initial.sql"),
    ),
    (
        "20260519_000002_category_and_price",
        include_str!("../migrations/20260519_000002_category_and_price.sql"),
    ),
    (
        "20260519_000003_currency",
        include_str!("../migrations/20260519_000003_currency.sql"),
    ),
    (
        "20260520_000001_start_date",
        include_str!("../migrations/20260520_000001_start_date.sql"),
    ),
    (
        "20260520_000002_tracking_mode",
        include_str!("../migrations/20260520_000002_tracking_mode.sql"),
    ),
    (
        "20260520_000003_categories",
        include_str!("../migrations/20260520_000003_categories.sql"),
    ),
];

pub async fn migrate(pool: &SqlitePool) -> anyhow::Result<()> {
    // `PRAGMA user_version` always exists, defaults to 0.
    let row = sqlx::query("PRAGMA user_version").fetch_one(pool).await?;
    let mut current: i32 = row.try_get(0)?;

    for (i, (name, sql)) in MIGRATIONS.iter().enumerate() {
        let version = (i + 1) as i32;
        if version <= current {
            tracing::debug!(migration = name, "already applied, skipping");
            continue;
        }
        tracing::info!(migration = name, "applying");
        pool.execute(*sql).await?;
        // PRAGMA doesn't accept parameter binding; version is i32 so safe to interpolate.
        pool.execute(format!("PRAGMA user_version = {version}").as_str())
            .await?;
        current = version;
    }
    Ok(())
}
