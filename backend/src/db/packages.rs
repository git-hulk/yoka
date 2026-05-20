//! Package queries.

use chrono::{DateTime, NaiveDate, Utc};
use sqlx::types::Json;
use sqlx::SqlitePool;

use crate::domain::lifecycle::TrackingMode;
use crate::error::AppError;

/// Row as stored. Kept private to the db layer; handlers convert to the
/// wire type after combining with derived pace values. `categories` is
/// stored as a JSON array in a TEXT column.
#[derive(Debug, sqlx::FromRow)]
pub struct PackageRow {
    pub id: String,
    pub name: String,
    pub quantity: Option<f64>,
    pub tracking_mode: TrackingMode,
    pub start_date: NaiveDate,
    pub expires_at: NaiveDate,
    pub notes: Option<String>,
    pub categories: Json<Vec<String>>,
    pub price_cents: Option<i64>,
    pub currency: String,
    pub archived_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// All columns of the packages table, in `PackageRow` order. Reused in
/// every SELECT so the FromRow derive's column ordering stays correct.
const PACKAGE_COLUMNS: &str = "id, name, quantity, tracking_mode, start_date, expires_at, \
                               notes, categories, price_cents, currency, \
                               archived_at, created_at, updated_at";

/// Fetch one package by id. Returns `AppError::NotFound` if absent.
pub async fn fetch(pool: &SqlitePool, id: &str) -> Result<PackageRow, AppError> {
    let sql = format!("SELECT {PACKAGE_COLUMNS} FROM packages WHERE id = ?1");
    sqlx::query_as::<_, PackageRow>(&sql)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

/// Existence check without pulling the whole row. Used before listing usages.
pub async fn exists(pool: &SqlitePool, id: &str) -> Result<bool, AppError> {
    let row: Option<(i64,)> = sqlx::query_as(r#"SELECT 1 FROM packages WHERE id = ?1"#)
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row.is_some())
}

/// Fields a caller may set on insert/update. Mirrors the wire input, but
/// kept here so the db layer doesn't depend on `schema::`.
pub struct PackageWrite<'a> {
    pub name: &'a str,
    pub quantity: Option<f64>,
    pub tracking_mode: TrackingMode,
    pub start_date: NaiveDate,
    pub expires_at: NaiveDate,
    pub notes: Option<&'a str>,
    /// Trimmed, deduped, capped (≤3). Owned because the handler builds it
    /// from a `Vec<String>` after normalization.
    pub categories: Vec<String>,
    pub price_cents: i64,
    pub currency: &'a str,
}

/// Insert a new package. The caller supplies the id (typically a fresh UUID)
/// so the handler can return a 201 Location header in the future without
/// a second round-trip.
pub async fn insert(
    pool: &SqlitePool,
    id: &str,
    input: PackageWrite<'_>,
) -> Result<PackageRow, AppError> {
    sqlx::query(
        r#"
        INSERT INTO packages (
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
    .execute(pool)
    .await?;

    fetch(pool, id).await
}

/// Update an existing package. Returns `NotFound` if no row matched.
/// `updated_at` is refreshed by the writer (the schema default only fires
/// on insert).
pub async fn update(
    pool: &SqlitePool,
    id: &str,
    input: PackageWrite<'_>,
) -> Result<PackageRow, AppError> {
    let result = sqlx::query(
        r#"
        UPDATE packages
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
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    fetch(pool, id).await
}

/// Hard-delete a package and every usage that references it, in one
/// transaction. The `usages.package_id` FK is `ON DELETE RESTRICT`, so a
/// bare `DELETE FROM packages` would fail; we wipe the children first.
/// The user is choosing "gone forever" — prefer `archive` for routine
/// "this pack is done" cases that should preserve history.
pub async fn delete(pool: &SqlitePool, id: &str) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM usages WHERE package_id = ?1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let result = sqlx::query("DELETE FROM packages WHERE id = ?1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    tx.commit().await?;
    Ok(())
}

/// Soft-delete: stamp `archived_at` with `now`. Filtered out of
/// `list_active`, but the row (and any usages) survive for history.
pub async fn archive(pool: &SqlitePool, id: &str) -> Result<(), AppError> {
    let result = sqlx::query(
        r#"
        UPDATE packages
        SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?1 AND archived_at IS NULL
        "#,
    )
    .bind(id)
    .execute(pool)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Distinct, non-empty categories from active packages, sorted
/// case-insensitively. Feeds the form's category dropdown. Unpacks the
/// JSON-array `categories` column via SQLite's `json_each` virtual table.
pub async fn list_categories(pool: &SqlitePool) -> Result<Vec<String>, AppError> {
    let rows: Vec<(String,)> = sqlx::query_as(
        r#"
        SELECT DISTINCT value
        FROM packages, json_each(packages.categories)
        WHERE packages.archived_at IS NULL
          AND TRIM(value) <> ''
        ORDER BY LOWER(value)
        "#,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(c,)| c).collect())
}

/// All active (non-archived) packages, newest first.
pub async fn list_active(pool: &SqlitePool) -> Result<Vec<PackageRow>, AppError> {
    let sql = format!(
        "SELECT {PACKAGE_COLUMNS} FROM packages \
         WHERE archived_at IS NULL \
         ORDER BY created_at DESC, id DESC"
    );
    let rows = sqlx::query_as::<_, PackageRow>(&sql)
        .fetch_all(pool)
        .await?;
    Ok(rows)
}
