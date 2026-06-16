//! SQLite implementation of `InvitationRepo`.

use async_trait::async_trait;
use sqlx::SqlitePool;

use crate::db::repo::{InvitationRepo, InvitationRow, InvitationWrite};
use crate::error::AppError;

const INVITATION_COLUMNS: &str = "id, group_id, email, role, token, invited_by, \
                                  expires_at, accepted_at, revoked_at, created_at";

pub struct SqliteInvitationRepo {
    pool: SqlitePool,
}

impl SqliteInvitationRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl InvitationRepo for SqliteInvitationRepo {
    async fn create(
        &self,
        id: &str,
        write: InvitationWrite<'_>,
    ) -> Result<InvitationRow, AppError> {
        sqlx::query(
            r#"INSERT INTO invitations
                 (id, group_id, email, role, token, invited_by, expires_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
        )
        .bind(id)
        .bind(write.group_id)
        .bind(write.email)
        .bind(write.role)
        .bind(write.token)
        .bind(write.invited_by)
        .bind(write.expires_at)
        .execute(&self.pool)
        .await?;
        self.get_by_id(id).await?.ok_or(AppError::NotFound)
    }

    async fn get_by_id(&self, id: &str) -> Result<Option<InvitationRow>, AppError> {
        let sql = format!("SELECT {INVITATION_COLUMNS} FROM invitations WHERE id = ?1");
        Ok(sqlx::query_as::<_, InvitationRow>(&sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await?)
    }

    async fn get_by_token(&self, token: &str) -> Result<Option<InvitationRow>, AppError> {
        let sql = format!("SELECT {INVITATION_COLUMNS} FROM invitations WHERE token = ?1");
        Ok(sqlx::query_as::<_, InvitationRow>(&sql)
            .bind(token)
            .fetch_optional(&self.pool)
            .await?)
    }

    async fn list_pending(&self, group_id: &str) -> Result<Vec<InvitationRow>, AppError> {
        let sql = format!(
            "SELECT {INVITATION_COLUMNS} FROM invitations \
             WHERE group_id = ?1 AND accepted_at IS NULL AND revoked_at IS NULL \
             ORDER BY created_at DESC"
        );
        Ok(sqlx::query_as::<_, InvitationRow>(&sql)
            .bind(group_id)
            .fetch_all(&self.pool)
            .await?)
    }

    async fn mark_accepted(&self, id: &str) -> Result<(), AppError> {
        let res = sqlx::query(
            r#"UPDATE invitations
               SET accepted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
               WHERE id = ?1 AND accepted_at IS NULL AND revoked_at IS NULL"#,
        )
        .bind(id)
        .execute(&self.pool)
        .await?;
        if res.rows_affected() == 0 {
            // Either gone, already accepted, or revoked.
            return Err(AppError::Conflict("invite_already_redeemed"));
        }
        Ok(())
    }

    async fn revoke(&self, id: &str) -> Result<(), AppError> {
        let res = sqlx::query(
            r#"UPDATE invitations
               SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
               WHERE id = ?1 AND accepted_at IS NULL AND revoked_at IS NULL"#,
        )
        .bind(id)
        .execute(&self.pool)
        .await?;
        if res.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }
}
