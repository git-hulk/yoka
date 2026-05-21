//! SQLite implementation of `EventRepo`.
//!
//! Two read paths into the same table:
//!   * `amounts_for_pace[_many]` — minimal `(amount, start_at)` projection,
//!     filtered to `status='accepted'` AND `subscription_id` matches. This is
//!     what feeds `lifecycle::derive`; non-accepted events do not burn the
//!     subscription.
//!   * `list_for_subscription` / `list_in_range` / `fetch` — full rows for the
//!     API, status-agnostic.

use std::collections::HashMap;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::SqlitePool;

use crate::db::repo::{
    EventRepo, EventRow, EventStatus, EventWithSubscriptionRow, EventWrite,
};
use crate::domain::lifecycle::UsageInput;
use crate::error::AppError;

/// All columns of the events table, in `EventRow` order. Reused in every
/// SELECT so the FromRow derive's column ordering stays correct.
const EVENT_COLUMNS: &str = "id, title, start_at, end_at, status, subscription_id, \
                              amount, notes, created_at, updated_at";

pub struct SqliteEventRepo {
    pool: SqlitePool,
}

impl SqliteEventRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl EventRepo for SqliteEventRepo {
    async fn any_for_subscription(&self, subscription_id: &str) -> Result<bool, AppError> {
        let row: Option<(i64,)> =
            sqlx::query_as(r#"SELECT 1 FROM events WHERE subscription_id = ?1 LIMIT 1"#)
                .bind(subscription_id)
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.is_some())
    }

    async fn amounts_for_pace(&self, subscription_id: &str) -> Result<Vec<UsageInput>, AppError> {
        let rows: Vec<(f64, DateTime<Utc>)> = sqlx::query_as(
            r#"
            SELECT amount, start_at
            FROM events
            WHERE subscription_id = ?1
              AND status = 'accepted'
              AND amount IS NOT NULL
            "#,
        )
        .bind(subscription_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|(amount, created_at)| UsageInput { amount, created_at })
            .collect())
    }

    async fn amounts_for_pace_many(
        &self,
        subscription_ids: &[String],
    ) -> Result<HashMap<String, Vec<UsageInput>>, AppError> {
        let mut out: HashMap<String, Vec<UsageInput>> =
            HashMap::with_capacity(subscription_ids.len());
        for id in subscription_ids {
            out.insert(id.clone(), Vec::new());
        }
        if subscription_ids.is_empty() {
            return Ok(out);
        }

        let placeholders = std::iter::repeat_n("?", subscription_ids.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT subscription_id, amount, start_at \
             FROM events \
             WHERE status = 'accepted' \
               AND amount IS NOT NULL \
               AND subscription_id IN ({placeholders})"
        );

        let mut q = sqlx::query_as::<_, (String, f64, DateTime<Utc>)>(&sql);
        for id in subscription_ids {
            q = q.bind(id);
        }

        for (sid, amount, created_at) in q.fetch_all(&self.pool).await? {
            out.entry(sid)
                .or_default()
                .push(UsageInput { amount, created_at });
        }
        Ok(out)
    }

    async fn list_for_subscription(
        &self,
        subscription_id: &str,
    ) -> Result<Vec<EventRow>, AppError> {
        let sql = format!(
            "SELECT {EVENT_COLUMNS} FROM events \
             WHERE subscription_id = ?1 \
             ORDER BY start_at DESC, id DESC"
        );
        let rows = sqlx::query_as::<_, EventRow>(&sql)
            .bind(subscription_id)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows)
    }

    /// Calendar range query. Left-joins `subscriptions` so each row carries
    /// the (optional) parent's name and tracking_mode in one round trip.
    /// Range is half-open: `from <= start_at < to`. Standalone events
    /// (subscription_id IS NULL) are included.
    async fn list_in_range(
        &self,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<Vec<EventWithSubscriptionRow>, AppError> {
        let rows = sqlx::query_as::<_, EventWithSubscriptionRow>(
            r#"
            SELECT e.id              AS id,
                   e.title           AS title,
                   e.start_at        AS start_at,
                   e.end_at          AS end_at,
                   e.status          AS status,
                   e.subscription_id AS subscription_id,
                   s.name            AS subscription_name,
                   s.tracking_mode   AS tracking_mode,
                   e.amount          AS amount,
                   e.notes           AS notes,
                   e.created_at      AS created_at,
                   e.updated_at      AS updated_at
            FROM events AS e
            LEFT JOIN subscriptions AS s ON s.id = e.subscription_id
            WHERE e.start_at >= ?1 AND e.start_at < ?2
            ORDER BY e.start_at ASC, e.id ASC
            "#,
        )
        .bind(from)
        .bind(to)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows)
    }

    async fn fetch(&self, id: &str) -> Result<EventRow, AppError> {
        let sql = format!("SELECT {EVENT_COLUMNS} FROM events WHERE id = ?1");
        sqlx::query_as::<_, EventRow>(&sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(AppError::NotFound)
    }

    async fn insert(&self, id: &str, input: EventWrite<'_>) -> Result<EventRow, AppError> {
        sqlx::query(
            r#"
            INSERT INTO events (
                id, title, start_at, end_at, status, subscription_id, amount, notes
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
        )
        .bind(id)
        .bind(input.title)
        .bind(input.start_at)
        .bind(input.end_at)
        .bind(input.status)
        .bind(input.subscription_id)
        .bind(input.amount)
        .bind(input.notes)
        .execute(&self.pool)
        .await?;

        self.fetch(id).await
    }

    async fn update(&self, id: &str, input: EventWrite<'_>) -> Result<EventRow, AppError> {
        let result = sqlx::query(
            r#"
            UPDATE events
            SET title           = ?2,
                start_at        = ?3,
                end_at          = ?4,
                status          = ?5,
                subscription_id = ?6,
                amount          = ?7,
                notes           = ?8,
                updated_at      = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1
            "#,
        )
        .bind(id)
        .bind(input.title)
        .bind(input.start_at)
        .bind(input.end_at)
        .bind(input.status)
        .bind(input.subscription_id)
        .bind(input.amount)
        .bind(input.notes)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        self.fetch(id).await
    }

    async fn set_status(&self, id: &str, status: EventStatus) -> Result<EventRow, AppError> {
        let result = sqlx::query(
            r#"
            UPDATE events
            SET status     = ?2,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1
            "#,
        )
        .bind(id)
        .bind(status)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        self.fetch(id).await
    }

    async fn delete(&self, id: &str) -> Result<(), AppError> {
        let result = sqlx::query(r#"DELETE FROM events WHERE id = ?1"#)
            .bind(id)
            .execute(&self.pool)
            .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }
}
