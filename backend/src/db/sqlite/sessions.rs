//! SQLite implementation of `SessionRepo`.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::SqlitePool;

use crate::db::repo::{SessionMember, SessionRepo};
use crate::error::AppError;

pub struct SqliteSessionRepo {
    pool: SqlitePool,
}

impl SqliteSessionRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl SessionRepo for SqliteSessionRepo {
    async fn create(
        &self,
        id: &str,
        user_id: &str,
        active_group_id: &str,
        expires_at: DateTime<Utc>,
    ) -> Result<(), AppError> {
        sqlx::query(
            r#"INSERT INTO sessions (id, user_id, active_group_id, expires_at)
               VALUES (?1, ?2, ?3, ?4)"#,
        )
        .bind(id)
        .bind(user_id)
        .bind(active_group_id)
        .bind(expires_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn delete(&self, id: &str) -> Result<(), AppError> {
        sqlx::query(r#"DELETE FROM sessions WHERE id = ?1"#)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn get_with_member(&self, id: &str) -> Result<Option<SessionMember>, AppError> {
        // Join to group_members so we can hand back the user's role in their
        // active group atomically. Filters expired sessions and sessions whose
        // active group the user is no longer a member of.
        let row: Option<(String, String, String)> = sqlx::query_as(
            r#"SELECT s.user_id, s.active_group_id, gm.role
               FROM sessions s
               JOIN group_members gm
                 ON gm.group_id = s.active_group_id
                AND gm.user_id  = s.user_id
               WHERE s.id = ?1
                 AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|(user_id, group_id, role)| SessionMember {
            user_id,
            group_id,
            role,
        }))
    }

    async fn set_active_group(
        &self,
        session_id: &str,
        user_id: &str,
        group_id: &str,
    ) -> Result<(), AppError> {
        // Guard: only update if the user is actually a member of `group_id`.
        // We don't trust the session's user_id alone — the membership join
        // protects against a stale group id.
        let res = sqlx::query(
            r#"UPDATE sessions
               SET active_group_id = ?3
               WHERE id = ?1
                 AND user_id = ?2
                 AND EXISTS (
                   SELECT 1 FROM group_members
                   WHERE group_id = ?3 AND user_id = ?2
                 )"#,
        )
        .bind(session_id)
        .bind(user_id)
        .bind(group_id)
        .execute(&self.pool)
        .await?;
        if res.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    async fn touch_expiry(&self, id: &str, expires_at: DateTime<Utc>) -> Result<(), AppError> {
        sqlx::query(r#"UPDATE sessions SET expires_at = ?2 WHERE id = ?1"#)
            .bind(id)
            .bind(expires_at)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete_for_user(&self, user_id: &str) -> Result<(), AppError> {
        sqlx::query(r#"DELETE FROM sessions WHERE user_id = ?1"#)
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
