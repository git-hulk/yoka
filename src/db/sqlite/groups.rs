//! SQLite implementation of `GroupRepo`.

use async_trait::async_trait;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::db::repo::{GroupForUserRow, GroupRepo, GroupRow, MemberRow};
use crate::error::AppError;

const GROUP_COLUMNS: &str = "id, name, created_at, updated_at";

pub struct SqliteGroupRepo {
    pool: SqlitePool,
}

impl SqliteGroupRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl GroupRepo for SqliteGroupRepo {
    async fn create(&self, id: &str, name: &str) -> Result<GroupRow, AppError> {
        sqlx::query(r#"INSERT INTO groups (id, name) VALUES (?1, ?2)"#)
            .bind(id)
            .bind(name)
            .execute(&self.pool)
            .await?;
        self.fetch(id).await
    }

    async fn fetch(&self, id: &str) -> Result<GroupRow, AppError> {
        let sql = format!("SELECT {GROUP_COLUMNS} FROM groups WHERE id = ?1");
        sqlx::query_as::<_, GroupRow>(&sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(AppError::NotFound)
    }

    async fn rename(&self, id: &str, name: &str) -> Result<GroupRow, AppError> {
        let res = sqlx::query(
            r#"UPDATE groups
               SET name = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
               WHERE id = ?1"#,
        )
        .bind(id)
        .bind(name)
        .execute(&self.pool)
        .await?;
        if res.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        self.fetch(id).await
    }

    async fn delete(&self, id: &str) -> Result<(), AppError> {
        // Cascades drop group_members, invitations, sessions; resource rows
        // tied to this group_id are NOT cascaded — the FK is ON DELETE
        // (default RESTRICT). We refuse to delete groups with resources; the
        // caller is expected to archive/move them first.
        let res = sqlx::query(r#"DELETE FROM groups WHERE id = ?1"#)
            .bind(id)
            .execute(&self.pool)
            .await;
        match res {
            Ok(r) if r.rows_affected() == 0 => Err(AppError::NotFound),
            Ok(_) => Ok(()),
            Err(sqlx::Error::Database(db_err)) if db_err.message().contains("FOREIGN KEY") => {
                Err(AppError::Conflict("group_has_resources"))
            }
            Err(e) => Err(AppError::from(e)),
        }
    }

    async fn list_for_user(&self, user_id: &str) -> Result<Vec<GroupForUserRow>, AppError> {
        let rows = sqlx::query_as::<_, GroupForUserRow>(
            r#"SELECT g.id, g.name, gm.role
               FROM groups g
               JOIN group_members gm ON gm.group_id = g.id
               WHERE gm.user_id = ?1
               ORDER BY g.created_at ASC"#,
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn list_members(&self, group_id: &str) -> Result<Vec<MemberRow>, AppError> {
        let rows = sqlx::query_as::<_, MemberRow>(
            r#"SELECT u.id AS user_id, u.email, gm.role, gm.created_at
               FROM group_members gm
               JOIN users u ON u.id = gm.user_id
               WHERE gm.group_id = ?1
               ORDER BY gm.created_at ASC"#,
        )
        .bind(group_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn add_member(
        &self,
        group_id: &str,
        user_id: &str,
        role: &str,
    ) -> Result<(), AppError> {
        let res = sqlx::query(
            r#"INSERT INTO group_members (id, group_id, user_id, role)
               VALUES (?1, ?2, ?3, ?4)"#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(group_id)
        .bind(user_id)
        .bind(role)
        .execute(&self.pool)
        .await;
        if let Err(sqlx::Error::Database(db_err)) = &res {
            if db_err.message().contains("UNIQUE") {
                // Could be the (group_id, user_id) UNIQUE or the partial-owner
                // unique index. Either way: already exists.
                return Err(AppError::Conflict("membership_exists"));
            }
        }
        res?;
        Ok(())
    }

    async fn get_member_role(
        &self,
        group_id: &str,
        user_id: &str,
    ) -> Result<Option<String>, AppError> {
        let row: Option<(String,)> = sqlx::query_as(
            r#"SELECT role FROM group_members WHERE group_id = ?1 AND user_id = ?2"#,
        )
        .bind(group_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|(r,)| r))
    }

    async fn update_member_role(
        &self,
        group_id: &str,
        user_id: &str,
        role: &str,
    ) -> Result<(), AppError> {
        let res = sqlx::query(
            r#"UPDATE group_members SET role = ?3
               WHERE group_id = ?1 AND user_id = ?2"#,
        )
        .bind(group_id)
        .bind(user_id)
        .bind(role)
        .execute(&self.pool)
        .await;
        match res {
            Ok(r) if r.rows_affected() == 0 => Err(AppError::NotFound),
            Ok(_) => Ok(()),
            Err(sqlx::Error::Database(db_err)) if db_err.message().contains("UNIQUE") => {
                // The partial-unique-owner index fires when promoting a second
                // member to owner. Force callers through `transfer_ownership`
                // for that flow.
                Err(AppError::Conflict("owner_already_exists"))
            }
            Err(e) => Err(AppError::from(e)),
        }
    }

    async fn remove_member(&self, group_id: &str, user_id: &str) -> Result<(), AppError> {
        let res = sqlx::query(
            r#"DELETE FROM group_members WHERE group_id = ?1 AND user_id = ?2"#,
        )
        .bind(group_id)
        .bind(user_id)
        .execute(&self.pool)
        .await?;
        if res.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    async fn transfer_ownership(
        &self,
        group_id: &str,
        current_owner_id: &str,
        new_owner_id: &str,
    ) -> Result<(), AppError> {
        // Two updates in one tx. We demote first so the partial-unique-owner
        // index never sees two owners.
        let mut tx = self.pool.begin().await?;

        let demote = sqlx::query(
            r#"UPDATE group_members SET role = 'admin'
               WHERE group_id = ?1 AND user_id = ?2 AND role = 'owner'"#,
        )
        .bind(group_id)
        .bind(current_owner_id)
        .execute(&mut *tx)
        .await?;
        if demote.rows_affected() == 0 {
            return Err(AppError::Conflict("not_current_owner"));
        }

        let promote = sqlx::query(
            r#"UPDATE group_members SET role = 'owner'
               WHERE group_id = ?1 AND user_id = ?2"#,
        )
        .bind(group_id)
        .bind(new_owner_id)
        .execute(&mut *tx)
        .await?;
        if promote.rows_affected() == 0 {
            // New owner isn't a member — tx rolls back.
            return Err(AppError::NotFound);
        }

        tx.commit().await?;
        Ok(())
    }

    async fn count_memberships(&self, user_id: &str) -> Result<i64, AppError> {
        let row: (i64,) = sqlx::query_as(
            r#"SELECT COUNT(*) FROM group_members WHERE user_id = ?1"#,
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.0)
    }
}
