//! SQLite implementation of `UsageRepo`.
//!
//! Two read paths:
//!   * `amounts_for_pace` — minimal `(amount, created_at)` projection used
//!     by `lifecycle::derive`. Keeps the hot read narrow.
//!   * `list` — full row for the API response.

use std::collections::HashMap;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::SqlitePool;

use crate::db::repo::{UsageRepo, UsageRow};
use crate::domain::lifecycle::UsageInput;
use crate::error::AppError;

pub struct SqliteUsageRepo {
    pool: SqlitePool,
}

impl SqliteUsageRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl UsageRepo for SqliteUsageRepo {
    async fn any_for_subscription(&self, subscription_id: &str) -> Result<bool, AppError> {
        let row: Option<(i64,)> =
            sqlx::query_as(r#"SELECT 1 FROM usages WHERE subscription_id = ?1 LIMIT 1"#)
                .bind(subscription_id)
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.is_some())
    }

    async fn amounts_for_pace(&self, subscription_id: &str) -> Result<Vec<UsageInput>, AppError> {
        let rows: Vec<(f64, DateTime<Utc>)> = sqlx::query_as(
            r#"
            SELECT amount, created_at
            FROM usages
            WHERE subscription_id = ?1
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

    /// Batched version of `amounts_for_pace` for the list endpoint. Single
    /// query regardless of subscription count — avoids N+1 on the home list.
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
            "SELECT subscription_id, amount, created_at \
             FROM usages WHERE subscription_id IN ({placeholders})"
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

    async fn list(&self, subscription_id: &str) -> Result<Vec<UsageRow>, AppError> {
        let rows = sqlx::query_as::<_, UsageRow>(
            r#"
            SELECT id, subscription_id, amount, debited_by, notes, created_at
            FROM usages
            WHERE subscription_id = ?1
            ORDER BY created_at DESC, id DESC
            "#,
        )
        .bind(subscription_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows)
    }

    async fn insert(
        &self,
        id: &str,
        subscription_id: &str,
        amount: f64,
        notes: Option<&str>,
    ) -> Result<UsageRow, AppError> {
        sqlx::query(
            r#"
            INSERT INTO usages (id, subscription_id, amount, notes)
            VALUES (?1, ?2, ?3, ?4)
            "#,
        )
        .bind(id)
        .bind(subscription_id)
        .bind(amount)
        .bind(notes)
        .execute(&self.pool)
        .await?;

        let row = sqlx::query_as::<_, UsageRow>(
            r#"
            SELECT id, subscription_id, amount, debited_by, notes, created_at
            FROM usages
            WHERE id = ?1
            "#,
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await?;

        Ok(row)
    }

    async fn update(
        &self,
        subscription_id: &str,
        usage_id: &str,
        amount: f64,
        notes: Option<&str>,
    ) -> Result<UsageRow, AppError> {
        let result = sqlx::query(
            r#"
            UPDATE usages
            SET amount = ?3, notes = ?4
            WHERE id = ?1 AND subscription_id = ?2
            "#,
        )
        .bind(usage_id)
        .bind(subscription_id)
        .bind(amount)
        .bind(notes)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }

        let row = sqlx::query_as::<_, UsageRow>(
            r#"
            SELECT id, subscription_id, amount, debited_by, notes, created_at
            FROM usages
            WHERE id = ?1
            "#,
        )
        .bind(usage_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(row)
    }

    async fn delete(&self, subscription_id: &str, usage_id: &str) -> Result<(), AppError> {
        let result = sqlx::query(r#"DELETE FROM usages WHERE id = ?1 AND subscription_id = ?2"#)
            .bind(usage_id)
            .bind(subscription_id)
            .execute(&self.pool)
            .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }
}
