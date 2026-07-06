//! SQLite implementation of `SubscriptionRepo`.

use async_trait::async_trait;
use chrono::NaiveDate;
use sqlx::types::Json;
use sqlx::SqlitePool;

use crate::db::repo::{SubscriptionRepo, SubscriptionRow, SubscriptionWrite};
use crate::error::AppError;

/// All columns of the subscriptions table, in `SubscriptionRow` order. Reused in
/// every SELECT so the FromRow derive's column ordering stays correct.
const SUBSCRIPTION_COLUMNS: &str = "id, name, quantity, tracking_mode, start_date, expires_at, \
                                    notes, categories, price_cents, currency, \
                                    archived_at, created_at, updated_at";

pub struct SqliteSubscriptionRepo {
    pool: SqlitePool,
}

impl SqliteSubscriptionRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl SubscriptionRepo for SqliteSubscriptionRepo {
    async fn fetch(&self, group_id: &str, id: &str) -> Result<SubscriptionRow, AppError> {
        let sql = format!(
            "SELECT {SUBSCRIPTION_COLUMNS} FROM subscriptions \
             WHERE id = ?1 AND group_id = ?2"
        );
        sqlx::query_as::<_, SubscriptionRow>(&sql)
            .bind(id)
            .bind(group_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(AppError::NotFound)
    }

    async fn exists(&self, group_id: &str, id: &str) -> Result<bool, AppError> {
        let row: Option<(i64,)> = sqlx::query_as(
            r#"SELECT 1 FROM subscriptions WHERE id = ?1 AND group_id = ?2"#,
        )
        .bind(id)
        .bind(group_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.is_some())
    }

    async fn insert(
        &self,
        group_id: &str,
        id: &str,
        input: SubscriptionWrite<'_>,
    ) -> Result<SubscriptionRow, AppError> {
        sqlx::query(
            r#"
            INSERT INTO subscriptions (
                id, name, quantity, tracking_mode, start_date, expires_at,
                notes, categories, price_cents, currency, group_id
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            "#,
        )
        .bind(id)
        .bind(input.name)
        .bind(input.quantity)
        .bind(input.tracking_mode)
        .bind(input.start_date)
        .bind(input.expires_at)
        .bind(input.notes)
        .bind(Json(input.categories))
        .bind(input.price_cents)
        .bind(input.currency)
        .bind(group_id)
        .execute(&self.pool)
        .await?;

        self.fetch(group_id, id).await
    }

    async fn update(
        &self,
        group_id: &str,
        id: &str,
        input: SubscriptionWrite<'_>,
    ) -> Result<SubscriptionRow, AppError> {
        let result = sqlx::query(
            r#"
            UPDATE subscriptions
            SET name          = ?3,
                quantity      = ?4,
                tracking_mode = ?5,
                start_date    = ?6,
                expires_at    = ?7,
                notes         = ?8,
                categories    = ?9,
                price_cents   = ?10,
                currency      = ?11,
                updated_at    = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1 AND group_id = ?2
            "#,
        )
        .bind(id)
        .bind(group_id)
        .bind(input.name)
        .bind(input.quantity)
        .bind(input.tracking_mode)
        .bind(input.start_date)
        .bind(input.expires_at)
        .bind(input.notes)
        .bind(Json(input.categories))
        .bind(input.price_cents)
        .bind(input.currency)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        self.fetch(group_id, id).await
    }

    /// Hard-delete a subscription and every event that references it, in one
    /// transaction. The `events.subscription_id` FK is `ON DELETE RESTRICT`, so a
    /// bare `DELETE FROM subscriptions` would fail; we wipe the children first.
    async fn delete(&self, group_id: &str, id: &str) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM events WHERE subscription_id = ?1 AND group_id = ?2")
            .bind(id)
            .bind(group_id)
            .execute(&mut *tx)
            .await?;
        let result = sqlx::query(
            "DELETE FROM subscriptions WHERE id = ?1 AND group_id = ?2",
        )
        .bind(id)
        .bind(group_id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        tx.commit().await?;
        Ok(())
    }

    async fn archive(&self, group_id: &str, id: &str) -> Result<(), AppError> {
        let result = sqlx::query(
            r#"
            UPDATE subscriptions
            SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1 AND group_id = ?2 AND archived_at IS NULL
            "#,
        )
        .bind(id)
        .bind(group_id)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    /// Distinct, non-empty categories from active subscriptions, sorted
    /// case-insensitively. Unpacks the JSON-array `categories` column via
    /// SQLite's `json_each` virtual table. Postgres would use
    /// `jsonb_array_elements_text`.
    async fn list_categories(&self, group_id: &str) -> Result<Vec<String>, AppError> {
        let rows: Vec<(String,)> = sqlx::query_as(
            r#"
            SELECT DISTINCT value
            FROM subscriptions, json_each(subscriptions.categories)
            WHERE subscriptions.archived_at IS NULL
              AND subscriptions.group_id = ?1
              AND TRIM(value) <> ''
            ORDER BY LOWER(value)
            "#,
        )
        .bind(group_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(|(c,)| c).collect())
    }

    async fn list_active(
        &self,
        group_id: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<SubscriptionRow>, i64), AppError> {
        let sql = format!(
            "SELECT {SUBSCRIPTION_COLUMNS} FROM subscriptions \
             WHERE archived_at IS NULL AND group_id = ?1 \
             ORDER BY created_at DESC, id DESC \
             LIMIT ?2 OFFSET ?3"
        );
        let rows = sqlx::query_as::<_, SubscriptionRow>(&sql)
            .bind(group_id)
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await?;
        let (total,): (i64,) = sqlx::query_as(
            r#"SELECT COUNT(*) FROM subscriptions
               WHERE archived_at IS NULL AND group_id = ?1"#,
        )
        .bind(group_id)
        .fetch_one(&self.pool)
        .await?;
        Ok((rows, total))
    }

    async fn list_in_range(
        &self,
        group_id: &str,
        first_day: NaiveDate,
        last_day: NaiveDate,
    ) -> Result<Vec<SubscriptionRow>, AppError> {
        let sql = format!(
            "SELECT {SUBSCRIPTION_COLUMNS} FROM subscriptions \
             WHERE start_date BETWEEN ?2 AND ?3 AND group_id = ?1 \
             ORDER BY start_date, id"
        );
        let rows = sqlx::query_as::<_, SubscriptionRow>(&sql)
            .bind(group_id)
            .bind(first_day)
            .bind(last_day)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows)
    }
}
