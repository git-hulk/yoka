//! Usage queries.
//!
//! Two read paths:
//!   * `amounts_for_pace` — minimal `(amount, created_at)` projection used
//!     by `lifecycle::derive`. Keeps the hot read narrow.
//!   * `list` — full row for the API response.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use sqlx::SqlitePool;

use crate::domain::lifecycle::UsageInput;
use crate::error::AppError;

#[derive(Debug, sqlx::FromRow)]
pub struct UsageRow {
    pub id:         String,
    pub package_id: String,
    pub amount:     f64,
    pub debited_by: Option<String>,
    pub notes:      Option<String>,
    pub created_at: DateTime<Utc>,
}

/// True iff at least one usage exists for the package. Cheap existence
/// check — used by the update handler to lock `time_known` once amounts
/// have been recorded.
pub async fn any_for_package(
    pool:       &SqlitePool,
    package_id: &str,
) -> Result<bool, AppError> {
    let row: Option<(i64,)> = sqlx::query_as(
        r#"SELECT 1 FROM usages WHERE package_id = ?1 LIMIT 1"#,
    )
    .bind(package_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.is_some())
}

/// Just the columns `lifecycle::derive` needs.
pub async fn amounts_for_pace(
    pool:       &SqlitePool,
    package_id: &str,
) -> Result<Vec<UsageInput>, AppError> {
    let rows: Vec<(f64, DateTime<Utc>)> = sqlx::query_as(
        r#"
        SELECT amount, created_at
        FROM usages
        WHERE package_id = ?1
        "#,
    )
    .bind(package_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(amount, created_at)| UsageInput { amount, created_at })
        .collect())
}

/// Batched version of `amounts_for_pace` for the list endpoint.
///
/// Returns a map keyed by `package_id` with one entry per input id (empty
/// vec if a package has no usages). Avoids N+1 when rendering the home
/// list — single query, regardless of package count.
pub async fn amounts_for_pace_many(
    pool:        &SqlitePool,
    package_ids: &[String],
) -> Result<HashMap<String, Vec<UsageInput>>, AppError> {
    let mut out: HashMap<String, Vec<UsageInput>> = HashMap::with_capacity(package_ids.len());
    for id in package_ids {
        out.insert(id.clone(), Vec::new());
    }
    if package_ids.is_empty() {
        return Ok(out);
    }

    let placeholders = std::iter::repeat("?")
        .take(package_ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT package_id, amount, created_at \
         FROM usages WHERE package_id IN ({placeholders})"
    );

    let mut q = sqlx::query_as::<_, (String, f64, DateTime<Utc>)>(&sql);
    for id in package_ids {
        q = q.bind(id);
    }

    for (pid, amount, created_at) in q.fetch_all(pool).await? {
        out.entry(pid)
            .or_default()
            .push(UsageInput { amount, created_at });
    }
    Ok(out)
}

/// Full usage rows for a package, newest first.
pub async fn list(
    pool:       &SqlitePool,
    package_id: &str,
) -> Result<Vec<UsageRow>, AppError> {
    let rows = sqlx::query_as::<_, UsageRow>(
        r#"
        SELECT id, package_id, amount, debited_by, notes, created_at
        FROM usages
        WHERE package_id = ?1
        ORDER BY created_at DESC, id DESC
        "#,
    )
    .bind(package_id)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

/// Insert a usage. Caller supplies the id; FK constraint enforces that
/// `package_id` references an existing row.
pub async fn insert(
    pool:       &SqlitePool,
    id:         &str,
    package_id: &str,
    amount:     f64,
    notes:      Option<&str>,
) -> Result<UsageRow, AppError> {
    sqlx::query(
        r#"
        INSERT INTO usages (id, package_id, amount, notes)
        VALUES (?1, ?2, ?3, ?4)
        "#,
    )
    .bind(id)
    .bind(package_id)
    .bind(amount)
    .bind(notes)
    .execute(pool)
    .await?;

    let row = sqlx::query_as::<_, UsageRow>(
        r#"
        SELECT id, package_id, amount, debited_by, notes, created_at
        FROM usages
        WHERE id = ?1
        "#,
    )
    .bind(id)
    .fetch_one(pool)
    .await?;

    Ok(row)
}

/// Update amount and notes on a usage. Scoped by `package_id` so a wrong
/// path can't touch somebody else's row. Returns `NotFound` if no row
/// matched.
pub async fn update(
    pool:       &SqlitePool,
    package_id: &str,
    usage_id:   &str,
    amount:     f64,
    notes:      Option<&str>,
) -> Result<UsageRow, AppError> {
    let result = sqlx::query(
        r#"
        UPDATE usages
        SET amount = ?3, notes = ?4
        WHERE id = ?1 AND package_id = ?2
        "#,
    )
    .bind(usage_id)
    .bind(package_id)
    .bind(amount)
    .bind(notes)
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }

    let row = sqlx::query_as::<_, UsageRow>(
        r#"
        SELECT id, package_id, amount, debited_by, notes, created_at
        FROM usages
        WHERE id = ?1
        "#,
    )
    .bind(usage_id)
    .fetch_one(pool)
    .await?;

    Ok(row)
}

/// Delete a usage by id, scoped to a package so a wrong path can't delete
/// somebody else's row. Returns `NotFound` if no row matched.
pub async fn delete(
    pool:       &SqlitePool,
    package_id: &str,
    usage_id:   &str,
) -> Result<(), AppError> {
    let result = sqlx::query(
        r#"DELETE FROM usages WHERE id = ?1 AND package_id = ?2"#,
    )
    .bind(usage_id)
    .bind(package_id)
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}
