//! SQLite implementations of the finance repositories: expenses, recurring
//! expenses, budgets. Every method is group-scoped; the budget UNIQUE
//! constraint is (month, category, currency) per group via the SQL layer's
//! existing UNIQUE — combined with `group_id` filtering in queries.

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
    async fn fetch(&self, group_id: &str, id: &str) -> Result<ExpenseRow, AppError> {
        let sql = format!(
            "SELECT {EXPENSE_COLUMNS} FROM expenses WHERE id = ?1 AND group_id = ?2"
        );
        sqlx::query_as::<_, ExpenseRow>(&sql)
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
        input: ExpenseWrite<'_>,
    ) -> Result<ExpenseRow, AppError> {
        sqlx::query(
            r#"
            INSERT INTO expenses (id, occurred_on, amount_cents, currency, category, notes, group_id)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#,
        )
        .bind(id)
        .bind(input.occurred_on)
        .bind(input.amount_cents)
        .bind(input.currency)
        .bind(input.category)
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
        input: ExpenseWrite<'_>,
    ) -> Result<ExpenseRow, AppError> {
        let result = sqlx::query(
            r#"
            UPDATE expenses
            SET occurred_on  = ?3,
                amount_cents = ?4,
                currency     = ?5,
                category     = ?6,
                notes        = ?7,
                updated_at   = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1 AND group_id = ?2
            "#,
        )
        .bind(id)
        .bind(group_id)
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
        self.fetch(group_id, id).await
    }

    async fn delete(&self, group_id: &str, id: &str) -> Result<(), AppError> {
        let result = sqlx::query("DELETE FROM expenses WHERE id = ?1 AND group_id = ?2")
            .bind(id)
            .bind(group_id)
            .execute(&self.pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    async fn list_paginated(
        &self,
        group_id: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<ExpenseRow>, i64), AppError> {
        let sql = format!(
            "SELECT {EXPENSE_COLUMNS} FROM expenses \
             WHERE group_id = ?1 \
             ORDER BY occurred_on DESC, created_at DESC, id DESC \
             LIMIT ?2 OFFSET ?3"
        );
        let rows = sqlx::query_as::<_, ExpenseRow>(&sql)
            .bind(group_id)
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await?;
        let (total,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM expenses WHERE group_id = ?1")
                .bind(group_id)
                .fetch_one(&self.pool)
                .await?;
        Ok((rows, total))
    }

    async fn list_in_month(
        &self,
        group_id: &str,
        first_day: NaiveDate,
        last_day: NaiveDate,
    ) -> Result<Vec<ExpenseRow>, AppError> {
        let sql = format!(
            "SELECT {EXPENSE_COLUMNS} FROM expenses \
             WHERE occurred_on >= ?2 AND occurred_on <= ?3 AND group_id = ?1 \
             ORDER BY occurred_on ASC, created_at ASC"
        );
        let rows = sqlx::query_as::<_, ExpenseRow>(&sql)
            .bind(group_id)
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
    async fn fetch(&self, group_id: &str, id: &str) -> Result<RecurringExpenseRow, AppError> {
        let sql = format!(
            "SELECT {RECURRING_COLUMNS} FROM recurring_expenses \
             WHERE id = ?1 AND group_id = ?2"
        );
        sqlx::query_as::<_, RecurringExpenseRow>(&sql)
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
        input: RecurringExpenseWrite<'_>,
    ) -> Result<RecurringExpenseRow, AppError> {
        sqlx::query(
            r#"
            INSERT INTO recurring_expenses (
                id, name, amount_cents, currency, category,
                cadence, start_date, end_date, notes, group_id
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
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
        .bind(group_id)
        .execute(&self.pool)
        .await?;
        self.fetch(group_id, id).await
    }

    async fn update(
        &self,
        group_id: &str,
        id: &str,
        input: RecurringExpenseWrite<'_>,
    ) -> Result<RecurringExpenseRow, AppError> {
        let result = sqlx::query(
            r#"
            UPDATE recurring_expenses
            SET name         = ?3,
                amount_cents = ?4,
                currency     = ?5,
                category     = ?6,
                cadence      = ?7,
                start_date   = ?8,
                end_date     = ?9,
                notes        = ?10,
                updated_at   = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1 AND group_id = ?2
            "#,
        )
        .bind(id)
        .bind(group_id)
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
        self.fetch(group_id, id).await
    }

    async fn delete(&self, group_id: &str, id: &str) -> Result<(), AppError> {
        let result =
            sqlx::query("DELETE FROM recurring_expenses WHERE id = ?1 AND group_id = ?2")
                .bind(id)
                .bind(group_id)
                .execute(&self.pool)
                .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    async fn archive(&self, group_id: &str, id: &str) -> Result<(), AppError> {
        let result = sqlx::query(
            r#"
            UPDATE recurring_expenses
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

    async fn list_active(&self, group_id: &str) -> Result<Vec<RecurringExpenseRow>, AppError> {
        let sql = format!(
            "SELECT {RECURRING_COLUMNS} FROM recurring_expenses \
             WHERE archived_at IS NULL AND group_id = ?1 \
             ORDER BY name ASC, id ASC"
        );
        let rows = sqlx::query_as::<_, RecurringExpenseRow>(&sql)
            .bind(group_id)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows)
    }

    async fn list_all(&self, group_id: &str) -> Result<Vec<RecurringExpenseRow>, AppError> {
        let sql = format!(
            "SELECT {RECURRING_COLUMNS} FROM recurring_expenses \
             WHERE group_id = ?1 \
             ORDER BY archived_at IS NOT NULL, name ASC, id ASC"
        );
        let rows = sqlx::query_as::<_, RecurringExpenseRow>(&sql)
            .bind(group_id)
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
    async fn fetch(&self, group_id: &str, id: &str) -> Result<BudgetRow, AppError> {
        let sql = format!(
            "SELECT {BUDGET_COLUMNS} FROM budgets WHERE id = ?1 AND group_id = ?2"
        );
        sqlx::query_as::<_, BudgetRow>(&sql)
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
        input: BudgetWrite<'_>,
    ) -> Result<BudgetRow, AppError> {
        let res = sqlx::query(
            r#"
            INSERT INTO budgets (id, month, category, currency, amount_cents, notes, group_id)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#,
        )
        .bind(id)
        .bind(input.month)
        .bind(input.category)
        .bind(input.currency)
        .bind(input.amount_cents)
        .bind(input.notes)
        .bind(group_id)
        .execute(&self.pool)
        .await;
        if let Err(e) = res {
            return Err(map_unique_violation(e));
        }
        self.fetch(group_id, id).await
    }

    async fn update(
        &self,
        group_id: &str,
        id: &str,
        input: BudgetWrite<'_>,
    ) -> Result<BudgetRow, AppError> {
        let res = sqlx::query(
            r#"
            UPDATE budgets
            SET month        = ?3,
                category     = ?4,
                currency     = ?5,
                amount_cents = ?6,
                notes        = ?7,
                updated_at   = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1 AND group_id = ?2
            "#,
        )
        .bind(id)
        .bind(group_id)
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
        self.fetch(group_id, id).await
    }

    async fn delete(&self, group_id: &str, id: &str) -> Result<(), AppError> {
        let result = sqlx::query("DELETE FROM budgets WHERE id = ?1 AND group_id = ?2")
            .bind(id)
            .bind(group_id)
            .execute(&self.pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    async fn list_for_month(
        &self,
        group_id: &str,
        month: &str,
    ) -> Result<Vec<BudgetRow>, AppError> {
        let sql = format!(
            "SELECT {BUDGET_COLUMNS} FROM budgets \
             WHERE month = ?1 AND group_id = ?2 \
             ORDER BY LOWER(category), currency"
        );
        let rows = sqlx::query_as::<_, BudgetRow>(&sql)
            .bind(month)
            .bind(group_id)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows)
    }

    async fn list_for_year(
        &self,
        group_id: &str,
        year: &str,
    ) -> Result<Vec<BudgetRow>, AppError> {
        let pattern = format!("{year}-%");
        let sql = format!(
            "SELECT {BUDGET_COLUMNS} FROM budgets \
             WHERE month LIKE ?1 AND group_id = ?2 \
             ORDER BY month, LOWER(category), currency"
        );
        let rows = sqlx::query_as::<_, BudgetRow>(&sql)
            .bind(pattern)
            .bind(group_id)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows)
    }
}

fn map_unique_violation(err: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(ref db_err) = err {
        if db_err.message().contains("UNIQUE constraint failed") {
            return AppError::BadRequest("budget_conflict");
        }
    }
    AppError::Database(err)
}
