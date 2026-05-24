//! SQLite implementations of the finance repositories: expenses, recurring
//! expenses, budgets.
//!
//! Each repo owns the same `SqlitePool` clone — `SqlitePool` is internally
//! `Arc`-backed, so cloning is cheap. UNIQUE-constraint violations on the
//! `budgets` table are translated into a stable `budget_conflict` code so
//! the frontend can surface a useful message instead of "database error".

use async_trait::async_trait;
use chrono::NaiveDate;
use sqlx::SqlitePool;

use crate::db::repo::{
    BudgetRepo, BudgetRow, BudgetWrite, ExpenseRepo, ExpenseRow, ExpenseWrite,
    RecurringExpenseRepo, RecurringExpenseRow, RecurringExpenseWrite,
};
use crate::error::AppError;

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

const EXPENSE_COLUMNS: &str =
    "id, occurred_on, amount_cents, currency, category, notes, created_at, updated_at";

pub struct SqliteExpenseRepo {
    pool: SqlitePool,
}

impl SqliteExpenseRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ExpenseRepo for SqliteExpenseRepo {
    async fn fetch(&self, id: &str) -> Result<ExpenseRow, AppError> {
        let sql = format!("SELECT {EXPENSE_COLUMNS} FROM expenses WHERE id = ?1");
        sqlx::query_as::<_, ExpenseRow>(&sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(AppError::NotFound)
    }

    async fn insert(&self, id: &str, input: ExpenseWrite<'_>) -> Result<ExpenseRow, AppError> {
        sqlx::query(
            r#"
            INSERT INTO expenses (id, occurred_on, amount_cents, currency, category, notes)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            "#,
        )
        .bind(id)
        .bind(input.occurred_on)
        .bind(input.amount_cents)
        .bind(input.currency)
        .bind(input.category)
        .bind(input.notes)
        .execute(&self.pool)
        .await?;
        self.fetch(id).await
    }

    async fn update(&self, id: &str, input: ExpenseWrite<'_>) -> Result<ExpenseRow, AppError> {
        let result = sqlx::query(
            r#"
            UPDATE expenses
            SET occurred_on  = ?2,
                amount_cents = ?3,
                currency     = ?4,
                category     = ?5,
                notes        = ?6,
                updated_at   = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1
            "#,
        )
        .bind(id)
        .bind(input.occurred_on)
        .bind(input.amount_cents)
        .bind(input.currency)
        .bind(input.category)
        .bind(input.notes)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        self.fetch(id).await
    }

    async fn delete(&self, id: &str) -> Result<(), AppError> {
        let result = sqlx::query("DELETE FROM expenses WHERE id = ?1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    async fn list_paginated(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<ExpenseRow>, i64), AppError> {
        // Most recent first (by occurred_on), then created_at as a stable
        // tiebreaker so two expenses on the same day always order the same
        // way across pages.
        let sql = format!(
            "SELECT {EXPENSE_COLUMNS} FROM expenses \
             ORDER BY occurred_on DESC, created_at DESC, id DESC \
             LIMIT ?1 OFFSET ?2"
        );
        let rows = sqlx::query_as::<_, ExpenseRow>(&sql)
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await?;
        let (total,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM expenses")
            .fetch_one(&self.pool)
            .await?;
        Ok((rows, total))
    }

    async fn list_in_month(
        &self,
        first_day: NaiveDate,
        last_day: NaiveDate,
    ) -> Result<Vec<ExpenseRow>, AppError> {
        let sql = format!(
            "SELECT {EXPENSE_COLUMNS} FROM expenses \
             WHERE occurred_on >= ?1 AND occurred_on <= ?2 \
             ORDER BY occurred_on ASC, created_at ASC"
        );
        let rows = sqlx::query_as::<_, ExpenseRow>(&sql)
            .bind(first_day)
            .bind(last_day)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows)
    }
}

// ---------------------------------------------------------------------------
// Recurring expenses
// ---------------------------------------------------------------------------

const RECURRING_COLUMNS: &str =
    "id, name, amount_cents, currency, category, cadence, start_date, end_date, \
     notes, archived_at, created_at, updated_at";

pub struct SqliteRecurringExpenseRepo {
    pool: SqlitePool,
}

impl SqliteRecurringExpenseRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl RecurringExpenseRepo for SqliteRecurringExpenseRepo {
    async fn fetch(&self, id: &str) -> Result<RecurringExpenseRow, AppError> {
        let sql = format!("SELECT {RECURRING_COLUMNS} FROM recurring_expenses WHERE id = ?1");
        sqlx::query_as::<_, RecurringExpenseRow>(&sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(AppError::NotFound)
    }

    async fn insert(
        &self,
        id: &str,
        input: RecurringExpenseWrite<'_>,
    ) -> Result<RecurringExpenseRow, AppError> {
        sqlx::query(
            r#"
            INSERT INTO recurring_expenses (
                id, name, amount_cents, currency, category,
                cadence, start_date, end_date, notes
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            "#,
        )
        .bind(id)
        .bind(input.name)
        .bind(input.amount_cents)
        .bind(input.currency)
        .bind(input.category)
        .bind(input.cadence)
        .bind(input.start_date)
        .bind(input.end_date)
        .bind(input.notes)
        .execute(&self.pool)
        .await?;
        self.fetch(id).await
    }

    async fn update(
        &self,
        id: &str,
        input: RecurringExpenseWrite<'_>,
    ) -> Result<RecurringExpenseRow, AppError> {
        let result = sqlx::query(
            r#"
            UPDATE recurring_expenses
            SET name         = ?2,
                amount_cents = ?3,
                currency     = ?4,
                category     = ?5,
                cadence      = ?6,
                start_date   = ?7,
                end_date     = ?8,
                notes        = ?9,
                updated_at   = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1
            "#,
        )
        .bind(id)
        .bind(input.name)
        .bind(input.amount_cents)
        .bind(input.currency)
        .bind(input.category)
        .bind(input.cadence)
        .bind(input.start_date)
        .bind(input.end_date)
        .bind(input.notes)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        self.fetch(id).await
    }

    async fn delete(&self, id: &str) -> Result<(), AppError> {
        let result = sqlx::query("DELETE FROM recurring_expenses WHERE id = ?1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    async fn archive(&self, id: &str) -> Result<(), AppError> {
        let result = sqlx::query(
            r#"
            UPDATE recurring_expenses
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

    async fn list_active(&self) -> Result<Vec<RecurringExpenseRow>, AppError> {
        let sql = format!(
            "SELECT {RECURRING_COLUMNS} FROM recurring_expenses \
             WHERE archived_at IS NULL \
             ORDER BY name ASC, id ASC"
        );
        let rows = sqlx::query_as::<_, RecurringExpenseRow>(&sql)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows)
    }

    async fn list_all(&self) -> Result<Vec<RecurringExpenseRow>, AppError> {
        let sql = format!(
            "SELECT {RECURRING_COLUMNS} FROM recurring_expenses \
             ORDER BY archived_at IS NOT NULL, name ASC, id ASC"
        );
        let rows = sqlx::query_as::<_, RecurringExpenseRow>(&sql)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows)
    }
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

const BUDGET_COLUMNS: &str =
    "id, month, category, currency, amount_cents, notes, created_at, updated_at";

pub struct SqliteBudgetRepo {
    pool: SqlitePool,
}

impl SqliteBudgetRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl BudgetRepo for SqliteBudgetRepo {
    async fn fetch(&self, id: &str) -> Result<BudgetRow, AppError> {
        let sql = format!("SELECT {BUDGET_COLUMNS} FROM budgets WHERE id = ?1");
        sqlx::query_as::<_, BudgetRow>(&sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(AppError::NotFound)
    }

    async fn insert(&self, id: &str, input: BudgetWrite<'_>) -> Result<BudgetRow, AppError> {
        let res = sqlx::query(
            r#"
            INSERT INTO budgets (id, month, category, currency, amount_cents, notes)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            "#,
        )
        .bind(id)
        .bind(input.month)
        .bind(input.category)
        .bind(input.currency)
        .bind(input.amount_cents)
        .bind(input.notes)
        .execute(&self.pool)
        .await;
        if let Err(e) = res {
            return Err(map_unique_violation(e));
        }
        self.fetch(id).await
    }

    async fn update(&self, id: &str, input: BudgetWrite<'_>) -> Result<BudgetRow, AppError> {
        let res = sqlx::query(
            r#"
            UPDATE budgets
            SET month        = ?2,
                category     = ?3,
                currency     = ?4,
                amount_cents = ?5,
                notes        = ?6,
                updated_at   = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1
            "#,
        )
        .bind(id)
        .bind(input.month)
        .bind(input.category)
        .bind(input.currency)
        .bind(input.amount_cents)
        .bind(input.notes)
        .execute(&self.pool)
        .await;
        let result = match res {
            Ok(r) => r,
            Err(e) => return Err(map_unique_violation(e)),
        };
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        self.fetch(id).await
    }

    async fn delete(&self, id: &str) -> Result<(), AppError> {
        let result = sqlx::query("DELETE FROM budgets WHERE id = ?1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    async fn list_for_month(&self, month: &str) -> Result<Vec<BudgetRow>, AppError> {
        let sql = format!(
            "SELECT {BUDGET_COLUMNS} FROM budgets \
             WHERE month = ?1 \
             ORDER BY LOWER(category), currency"
        );
        let rows = sqlx::query_as::<_, BudgetRow>(&sql)
            .bind(month)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows)
    }

    async fn list_for_year(&self, year: &str) -> Result<Vec<BudgetRow>, AppError> {
        // Prefix match: 'YYYY-%' catches every monthly key in the year.
        let pattern = format!("{year}-%");
        let sql = format!(
            "SELECT {BUDGET_COLUMNS} FROM budgets \
             WHERE month LIKE ?1 \
             ORDER BY month, LOWER(category), currency"
        );
        let rows = sqlx::query_as::<_, BudgetRow>(&sql)
            .bind(pattern)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows)
    }
}

/// Translate the SQLite UNIQUE-constraint violation on `budgets` into a
/// stable error code. Other errors pass through as `Database`.
fn map_unique_violation(err: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(ref db_err) = err {
        // SQLite reports "UNIQUE constraint failed" in the message; the
        // SQLSTATE is "2067" / extended code 2067. Checking the substring
        // is the most portable signal across sqlx versions.
        if db_err.message().contains("UNIQUE constraint failed") {
            return AppError::BadRequest("budget_conflict");
        }
    }
    AppError::Database(err)
}
