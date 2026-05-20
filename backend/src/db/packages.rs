//! Package queries.

use chrono::{DateTime, NaiveDate, Utc};
use sqlx::SqlitePool;

use crate::error::AppError;

/// Row as stored. Kept private to the db layer; handlers convert to the
/// wire type after combining with derived pace values.
#[derive(Debug, sqlx::FromRow)]
pub struct PackageRow {
    pub id:          String,
    pub name:        String,
    pub quantity:    f64,
    pub time_known:  bool,
    pub start_date:  NaiveDate,
    pub expires_at:  NaiveDate,
    pub notes:       Option<String>,
    pub category:    Option<String>,
    pub price_cents: Option<i64>,
    pub currency:    String,
    pub archived_at: Option<DateTime<Utc>>,
    pub created_at:  DateTime<Utc>,
    pub updated_at:  DateTime<Utc>,
}

/// All columns of the packages table, in `PackageRow` order. Reused in
/// every SELECT so the FromRow derive's column ordering stays correct.
const PACKAGE_COLUMNS: &str = "id, name, quantity, time_known, start_date, expires_at, \
                               notes, category, price_cents, currency, \
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
    let row: Option<(i64,)> = sqlx::query_as(
        r#"SELECT 1 FROM packages WHERE id = ?1"#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row.is_some())
}

/// Fields a caller may set on insert/update. Mirrors the wire input, but
/// kept here so the db layer doesn't depend on `schema::`.
pub struct PackageWrite<'a> {
    pub name:        &'a str,
    pub quantity:    f64,
    pub time_known:  bool,
    pub start_date:  NaiveDate,
    pub expires_at:  NaiveDate,
    pub notes:       Option<&'a str>,
    pub category:    Option<&'a str>,
    pub price_cents: Option<i64>,
    pub currency:    &'a str,
}

/// Insert a new package. The caller supplies the id (typically a fresh UUID)
/// so the handler can return a 201 Location header in the future without
/// a second round-trip.
pub async fn insert(
    pool:  &SqlitePool,
    id:    &str,
    input: PackageWrite<'_>,
) -> Result<PackageRow, AppError> {
    sqlx::query(
        r#"
        INSERT INTO packages (
            id, name, quantity, time_known, start_date, expires_at,
            notes, category, price_cents, currency
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        "#,
    )
    .bind(id)
    .bind(input.name)
    .bind(input.quantity)
    .bind(input.time_known)
    .bind(input.start_date)
    .bind(input.expires_at)
    .bind(input.notes)
    .bind(input.category)
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
    pool:  &SqlitePool,
    id:    &str,
    input: PackageWrite<'_>,
) -> Result<PackageRow, AppError> {
    let result = sqlx::query(
        r#"
        UPDATE packages
        SET name        = ?2,
            quantity    = ?3,
            time_known  = ?4,
            start_date  = ?5,
            expires_at  = ?6,
            notes       = ?7,
            category    = ?8,
            price_cents = ?9,
            currency    = ?10,
            updated_at  = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?1
        "#,
    )
    .bind(id)
    .bind(input.name)
    .bind(input.quantity)
    .bind(input.time_known)
    .bind(input.start_date)
    .bind(input.expires_at)
    .bind(input.notes)
    .bind(input.category)
    .bind(input.price_cents)
    .bind(input.currency)
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    fetch(pool, id).await
}

/// All active (non-archived) packages, newest first.
pub async fn list_active(pool: &SqlitePool) -> Result<Vec<PackageRow>, AppError> {
    let sql = format!(
        "SELECT {PACKAGE_COLUMNS} FROM packages \
         WHERE archived_at IS NULL \
         ORDER BY created_at DESC, id DESC"
    );
    let rows = sqlx::query_as::<_, PackageRow>(&sql).fetch_all(pool).await?;
    Ok(rows)
}
