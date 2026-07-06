//! SQLite implementation of the timeline-event repository. Every method is
//! group-scoped; the composite (group_id, occurred_on) index covers the one
//! read path (a year window).

use async_trait::async_trait;
use chrono::NaiveDate;
use sqlx::SqlitePool;

use crate::db::repo::{TimelineEventRepo, TimelineEventRow, TimelineEventWrite};
use crate::error::AppError;

const COLUMNS: &str = "id, title, occurred_on, notes, created_at, updated_at";

pub struct SqliteTimelineEventRepo {
    pool: SqlitePool,
}

impl SqliteTimelineEventRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl TimelineEventRepo for SqliteTimelineEventRepo {
    async fn fetch(&self, group_id: &str, id: &str) -> Result<TimelineEventRow, AppError> {
        let sql =
            format!("SELECT {COLUMNS} FROM timeline_events WHERE id = ?1 AND group_id = ?2");
        sqlx::query_as::<_, TimelineEventRow>(&sql)
            .bind(id)
            .bind(group_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(AppError::NotFound)
    }

    async fn insert(
        &self,
        group_id: &str,
        id: &str,
        input: TimelineEventWrite<'_>,
    ) -> Result<TimelineEventRow, AppError> {
        sqlx::query(
            r#"
            INSERT INTO timeline_events (id, title, occurred_on, notes, group_id)
            VALUES (?1, ?2, ?3, ?4, ?5)
            "#,
        )
        .bind(id)
        .bind(input.title)
        .bind(input.occurred_on)
        .bind(input.notes)
        .bind(group_id)
        .execute(&self.pool)
        .await?;
        self.fetch(group_id, id).await
    }

    async fn update(
        &self,
        group_id: &str,
        id: &str,
        input: TimelineEventWrite<'_>,
    ) -> Result<TimelineEventRow, AppError> {
        let result = sqlx::query(
            r#"
            UPDATE timeline_events
            SET title       = ?3,
                occurred_on = ?4,
                notes       = ?5,
                updated_at  = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1 AND group_id = ?2
            "#,
        )
        .bind(id)
        .bind(group_id)
        .bind(input.title)
        .bind(input.occurred_on)
        .bind(input.notes)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        self.fetch(group_id, id).await
    }

    async fn delete(&self, group_id: &str, id: &str) -> Result<(), AppError> {
        let result = sqlx::query("DELETE FROM timeline_events WHERE id = ?1 AND group_id = ?2")
            .bind(id)
            .bind(group_id)
            .execute(&self.pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    async fn list_in_range(
        &self,
        group_id: &str,
        first_day: NaiveDate,
        last_day: NaiveDate,
    ) -> Result<Vec<TimelineEventRow>, AppError> {
        let sql = format!(
            r#"
            SELECT {COLUMNS} FROM timeline_events
            WHERE group_id = ?1 AND occurred_on >= ?2 AND occurred_on <= ?3
            ORDER BY occurred_on ASC, created_at ASC
            "#
        );
        Ok(sqlx::query_as::<_, TimelineEventRow>(&sql)
            .bind(group_id)
            .bind(first_day)
            .bind(last_day)
            .fetch_all(&self.pool)
            .await?)
    }
}
