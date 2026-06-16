//! SQLite implementation of `UserRepo`.

use async_trait::async_trait;
use sqlx::SqlitePool;

use crate::db::repo::{UserRepo, UserRow};
use crate::error::AppError;

const USER_COLUMNS: &str = "id, email, password_hash, created_at, updated_at";

pub struct SqliteUserRepo {
    pool: SqlitePool,
}

impl SqliteUserRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl UserRepo for SqliteUserRepo {
    async fn create(
        &self,
        id: &str,
        email: &str,
        password_hash: &str,
    ) -> Result<UserRow, AppError> {
        // Map sqlx's UNIQUE-violation error to a stable code so the HTTP layer
        // doesn't have to inspect raw error text.
        let res = sqlx::query(
            r#"INSERT INTO users (id, email, password_hash) VALUES (?1, ?2, ?3)"#,
        )
        .bind(id)
        .bind(email)
        .bind(password_hash)
        .execute(&self.pool)
        .await;

        if let Err(sqlx::Error::Database(db_err)) = &res {
            if db_err.message().contains("UNIQUE") {
                return Err(AppError::Conflict("email_taken"));
            }
        }
        res?;
        self.get_by_id(id).await
    }

    async fn get_by_id(&self, id: &str) -> Result<UserRow, AppError> {
        let sql = format!("SELECT {USER_COLUMNS} FROM users WHERE id = ?1");
        sqlx::query_as::<_, UserRow>(&sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(AppError::NotFound)
    }

    async fn get_by_email(&self, email: &str) -> Result<Option<UserRow>, AppError> {
        let sql = format!("SELECT {USER_COLUMNS} FROM users WHERE email = ?1");
        let row = sqlx::query_as::<_, UserRow>(&sql)
            .bind(email)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row)
    }
}
