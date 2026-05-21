//! SQLite backend.
//!
//! Owns the `SqlitePool`, the SQLite-flavored migration runner, and the
//! concrete `SubscriptionRepo` / `EventRepo` implementations. The rest of the
//! app sees only the traits in `db::repo`.

use std::str::FromStr;
use std::sync::Arc;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Executor, Row, SqlitePool};

use crate::db::Repos;

pub mod events;
pub mod subscriptions;

pub use events::SqliteEventRepo;
pub use subscriptions::SqliteSubscriptionRepo;

/// SQLite migrations, applied in order on startup.
///
/// Tracking lives in SQLite's built-in `user_version` pragma — each
/// migration's index (1-based) becomes the new `user_version` after it
/// applies. Cheap, no extra table, easy to reset by clearing the file. The
/// Postgres backend will define its own scheme (typically a `schema_migrations`
/// table) — that's why the runner lives here rather than in the shared layer.
const MIGRATIONS: &[(&str, &str)] = &[
    (
        "20260519_000001_initial",
        include_str!("../../../migrations/sqlite/20260519_000001_initial.sql"),
    ),
    (
        "20260519_000002_category_and_price",
        include_str!("../../../migrations/sqlite/20260519_000002_category_and_price.sql"),
    ),
    (
        "20260519_000003_currency",
        include_str!("../../../migrations/sqlite/20260519_000003_currency.sql"),
    ),
    (
        "20260520_000001_start_date",
        include_str!("../../../migrations/sqlite/20260520_000001_start_date.sql"),
    ),
    (
        "20260520_000002_tracking_mode",
        include_str!("../../../migrations/sqlite/20260520_000002_tracking_mode.sql"),
    ),
    (
        "20260520_000003_categories",
        include_str!("../../../migrations/sqlite/20260520_000003_categories.sql"),
    ),
    (
        "20260521_000001_rename_packages_to_subscriptions",
        include_str!(
            "../../../migrations/sqlite/20260521_000001_rename_packages_to_subscriptions.sql"
        ),
    ),
    (
        "20260521_000002_events",
        include_str!("../../../migrations/sqlite/20260521_000002_events.sql"),
    ),
];

/// SQLite backend handle: the connected pool plus accessors that produce
/// trait objects for the HTTP layer.
///
/// `pool` is `pub` so integration tests can seed rows with raw SQL
/// (controlling `created_at` for time-travel assertions, which the trait
/// surface deliberately doesn't expose).
#[derive(Clone)]
pub struct SqliteBackend {
    pub pool: SqlitePool,
}

impl SqliteBackend {
    /// Build a pool against the given SQLite URL, run migrations.
    ///
    /// `sqlite::memory:` is the convention for tests; a path like
    /// `sqlite://tracker.db?mode=rwc` is used in production.
    ///
    /// WAL + foreign keys are on. WAL gives concurrent readers during writes,
    /// which matters even for a single-user app once the frontend starts
    /// polling. Foreign keys must be enabled per-connection in SQLite.
    pub async fn connect(url: &str) -> anyhow::Result<Self> {
        let opts = SqliteConnectOptions::from_str(url)?
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
            .synchronous(sqlx::sqlite::SqliteSynchronous::Normal);

        let pool = SqlitePoolOptions::new()
            .max_connections(8)
            .connect_with(opts)
            .await?;

        let backend = Self { pool };
        backend.migrate().await?;
        Ok(backend)
    }

    /// Apply any migrations the database hasn't seen yet. Idempotent.
    pub async fn migrate(&self) -> anyhow::Result<()> {
        migrate(&self.pool).await
    }

    /// Hand out trait objects for the HTTP layer. Both repos share the pool
    /// — `SqlitePool` is internally `Arc`-backed so cloning is cheap.
    pub fn into_repos(self) -> Repos {
        let subscriptions: Arc<dyn crate::db::SubscriptionRepo> =
            Arc::new(SqliteSubscriptionRepo::new(self.pool.clone()));
        let events: Arc<dyn crate::db::EventRepo> = Arc::new(SqliteEventRepo::new(self.pool));
        Repos {
            subscriptions,
            events,
        }
    }
}

/// Free-standing migration runner. Also reachable via
/// `SqliteBackend::migrate`; exposed standalone for the integration tests
/// that build a bare pool and want to skip the URL plumbing.
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
