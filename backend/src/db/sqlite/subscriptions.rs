//! SQLite implementation of `SubscriptionRepo`.

use async_trait::async_trait;
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
    async fn fetch(&self, id: &str) -> Result<SubscriptionRow, AppError> {
        let sql = format!("SELECT {SUBSCRIPTION_COLUMNS} FROM subscriptions WHERE id = ?1");
        sqlx::query_as::<_, SubscriptionRow>(&sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(AppError::NotFound)
    }

    async fn exists(&self, id: &str) -> Result<bool, AppError> {
        let row: Option<(i64,)> = sqlx::query_as(r#"SELECT 1 FROM subscriptions WHERE id = ?1"#)
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.is_some())
    }

    async fn insert(
        &self,
        id: &str,
        input: SubscriptionWrite<'_>,
    ) -> Result<SubscriptionRow, AppError> {
        sqlx::query(
            r#"
            INSERT INTO subscriptions (
                id, name, quantity, tracking_mode, start_date, expires_at,
                notes, categories, price_cents, currency
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
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
        .execute(&self.pool)
        .await?;

        self.fetch(id).await
    }

    async fn update(
        &self,
        id: &str,
        input: SubscriptionWrite<'_>,
    ) -> Result<SubscriptionRow, AppError> {
        let result = sqlx::query(
            r#"
            UPDATE subscriptions
            SET name          = ?2,
                quantity      = ?3,
                tracking_mode = ?4,
                start_date    = ?5,
                expires_at    = ?6,
                notes         = ?7,
                categories    = ?8,
                price_cents   = ?9,
                currency      = ?10,
                updated_at    = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1
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
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        self.fetch(id).await
    }

    /// Hard-delete a subscription and every event that references it, in one
    /// transaction. The `events.subscription_id` FK is `ON DELETE RESTRICT`, so a
    /// bare `DELETE FROM subscriptions` would fail; we wipe the children first.
    async fn delete(&self, id: &str) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM events WHERE subscription_id = ?1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        let result = sqlx::query("DELETE FROM subscriptions WHERE id = ?1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        tx.commit().await?;
        Ok(())
    }

    async fn archive(&self, id: &str) -> Result<(), AppError> {
        let result = sqlx::query(
            r#"
            UPDATE subscriptions
            SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1 AND archived_at IS NULL
            "#,
        )
        .bind(id)
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
    async fn list_categories(&self) -> Result<Vec<String>, AppError> {
        let rows: Vec<(String,)> = sqlx::query_as(
            r#"
            SELECT DISTINCT value
            FROM subscriptions, json_each(subscriptions.categories)
            WHERE subscriptions.archived_at IS NULL
              AND TRIM(value) <> ''
            ORDER BY LOWER(value)
            "#,
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(|(c,)| c).collect())
    }

    async fn list_active(&self) -> Result<Vec<SubscriptionRow>, AppError> {
        let sql = format!(
            "SELECT {SUBSCRIPTION_COLUMNS} FROM subscriptions \
             WHERE archived_at IS NULL \
             ORDER BY created_at DESC, id DESC"
        );
        let rows = sqlx::query_as::<_, SubscriptionRow>(&sql)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows)
    }
}
