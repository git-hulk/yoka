//! Package handlers.
//!
//! Read-side only in this slice. Thin: extract path arg, call db + domain,
//! return a wire type.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::{
    db,
    db::packages::{PackageRow, PackageWrite},
    domain::lifecycle::{self, TrackingMode, UsageInput},
    error::AppError,
    http::AppState,
    schema::packages::{PackageInput, PackageResponse, UsageInputBody, UsageResponse},
};

const SUPPORTED_CURRENCIES: &[&str] = &["USD", "SGD", "CNY", "JPY"];
const MAX_CATEGORIES: usize = 3;

pub async fn list(State(state): State<AppState>) -> Result<Json<Vec<PackageResponse>>, AppError> {
    let rows = db::packages::list_active(&state.pool).await?;
    if rows.is_empty() {
        return Ok(Json(Vec::new()));
    }

    let ids: Vec<String> = rows.iter().map(|r| r.id.clone()).collect();
    let by_pkg = db::usages::amounts_for_pace_many(&state.pool, &ids).await?;
    let now = Utc::now();

    let body = rows
        .into_iter()
        .map(|row| {
            let usages = by_pkg.get(&row.id).cloned().unwrap_or_default();
            to_response(row, &usages, now)
        })
        .collect();

    Ok(Json(body))
}

pub async fn list_categories(
    State(state): State<AppState>,
) -> Result<Json<Vec<String>>, AppError> {
    let categories = db::packages::list_categories(&state.pool).await?;
    Ok(Json(categories))
}

pub async fn get_one(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<PackageResponse>, AppError> {
    let row = db::packages::fetch(&state.pool, &id).await?;
    let usages = db::usages::amounts_for_pace(&state.pool, &id).await?;
    Ok(Json(to_response(row, &usages, Utc::now())))
}

pub async fn create(
    State(state): State<AppState>,
    Json(body): Json<PackageInput>,
) -> Result<(StatusCode, Json<PackageResponse>), AppError> {
    let write = validate(&body)?;
    let id = Uuid::new_v4().to_string();
    let row = db::packages::insert(&state.pool, &id, write).await?;
    Ok((StatusCode::CREATED, Json(to_response(row, &[], Utc::now()))))
}

pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<PackageInput>,
) -> Result<Json<PackageResponse>, AppError> {
    let write = validate(&body)?;

    // Lock `tracking_mode` once any usage has been recorded — flipping it
    // would silently re-interpret historical amounts (units ↔ hours), or
    // strand usages on a now-duration package.
    let current = db::packages::fetch(&state.pool, &id).await?;
    if write.tracking_mode != current.tracking_mode
        && db::usages::any_for_package(&state.pool, &id).await?
    {
        return Err(AppError::BadRequest("tracking_mode_locked"));
    }

    let row = db::packages::update(&state.pool, &id, write).await?;
    let usages = db::usages::amounts_for_pace(&state.pool, &id).await?;
    Ok(Json(to_response(row, &usages, Utc::now())))
}

/// Hard-delete a package and all its usages. 204 on success.
pub async fn delete(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    db::packages::delete(&state.pool, &id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Soft-delete: stamp `archived_at`. The row and its usages survive,
/// but the package drops out of `list_active`. Idempotent on rows already
/// archived — `archive` returns `NotFound` in that case, which is the
/// right signal for the UI.
pub async fn archive(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    db::packages::archive(&state.pool, &id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_usages(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<UsageResponse>>, AppError> {
    // 404 if the package doesn't exist — distinguishes "no such package"
    // from "package exists but has no usages yet" (which returns []).
    if !db::packages::exists(&state.pool, &id).await? {
        return Err(AppError::NotFound);
    }

    let rows = db::usages::list(&state.pool, &id).await?;
    let body = rows
        .into_iter()
        .map(|r| UsageResponse {
            id: r.id,
            package_id: r.package_id,
            amount: r.amount,
            debited_by: r.debited_by,
            notes: r.notes,
            created_at: r.created_at,
        })
        .collect();

    Ok(Json(body))
}

pub async fn create_usage(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UsageInputBody>,
) -> Result<(StatusCode, Json<UsageResponse>), AppError> {
    if !body.amount.is_finite() || body.amount <= 0.0 {
        return Err(AppError::BadRequest("amount_must_be_positive"));
    }
    // Existence + tracking-mode check in one read. Duration packs are
    // date-only — they have no quantity to debit, so usages are forbidden.
    let pkg = db::packages::fetch(&state.pool, &id).await?;
    if pkg.tracking_mode == TrackingMode::Duration {
        return Err(AppError::BadRequest("usages_forbidden_for_duration"));
    }
    let notes = body
        .notes
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let usage_id = Uuid::new_v4().to_string();
    let row = db::usages::insert(&state.pool, &usage_id, &id, body.amount, notes).await?;

    Ok((
        StatusCode::CREATED,
        Json(UsageResponse {
            id: row.id,
            package_id: row.package_id,
            amount: row.amount,
            debited_by: row.debited_by,
            notes: row.notes,
            created_at: row.created_at,
        }),
    ))
}

pub async fn update_usage(
    State(state): State<AppState>,
    Path((id, usage_id)): Path<(String, String)>,
    Json(body): Json<UsageInputBody>,
) -> Result<Json<UsageResponse>, AppError> {
    if !body.amount.is_finite() || body.amount <= 0.0 {
        return Err(AppError::BadRequest("amount_must_be_positive"));
    }
    let notes = body
        .notes
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let row = db::usages::update(&state.pool, &id, &usage_id, body.amount, notes).await?;
    Ok(Json(UsageResponse {
        id: row.id,
        package_id: row.package_id,
        amount: row.amount,
        debited_by: row.debited_by,
        notes: row.notes,
        created_at: row.created_at,
    }))
}

pub async fn delete_usage(
    State(state): State<AppState>,
    Path((id, usage_id)): Path<(String, String)>,
) -> Result<StatusCode, AppError> {
    db::usages::delete(&state.pool, &id, &usage_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------

/// Validate a wire input and project it into the db-layer write shape.
///
/// Validation is intentionally minimal — the form already constrains types
/// (number, date). We only catch what the type system can't: empty names,
/// the mode↔quantity invariant, notes normalization (blank → None), and
/// currency code.
fn validate(body: &PackageInput) -> Result<PackageWrite<'_>, AppError> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name_required"));
    }

    // mode ↔ quantity invariant — mirrors the DB CHECK constraint so we
    // fail fast with a stable error code instead of a SQLite error.
    let quantity = match (body.tracking_mode, body.quantity) {
        (TrackingMode::Duration, Some(_)) => {
            return Err(AppError::BadRequest("quantity_forbidden_for_duration"));
        }
        (TrackingMode::Duration, None) => None,
        (TrackingMode::Units | TrackingMode::Hours, None) => {
            return Err(AppError::BadRequest("quantity_must_be_positive"));
        }
        (TrackingMode::Units | TrackingMode::Hours, Some(q)) => {
            if !q.is_finite() || q <= 0.0 {
                return Err(AppError::BadRequest("quantity_must_be_positive"));
            }
            Some(q)
        }
    };

    if !SUPPORTED_CURRENCIES.contains(&body.currency.as_str()) {
        return Err(AppError::BadRequest("currency_unsupported"));
    }
    let notes = body
        .notes
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    // Trim, drop empties, dedupe case-insensitively (keeping first-seen
    // casing). Cap enforced after dedup so "Yoga"/"yoga" duplicates don't
    // push the user over the limit unnecessarily.
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut categories: Vec<String> = Vec::new();
    for raw in &body.categories {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        if seen.insert(trimmed.to_lowercase()) {
            categories.push(trimmed.to_string());
        }
    }
    if categories.len() > MAX_CATEGORIES {
        return Err(AppError::BadRequest("categories_too_many"));
    }

    // Price is required on create and update. Legacy rows with NULL prices
    // (predate this requirement) still load fine — the DB column remains
    // nullable for backfill purposes — but every write must supply one.
    let price_cents = body
        .price_cents
        .ok_or(AppError::BadRequest("price_required"))?;
    if price_cents < 0 {
        return Err(AppError::BadRequest("price_cents_must_be_nonnegative"));
    }

    if body.start_date > body.expires_at {
        return Err(AppError::BadRequest("start_date_after_expires_at"));
    }

    Ok(PackageWrite {
        name,
        quantity,
        tracking_mode: body.tracking_mode,
        start_date: body.start_date,
        expires_at: body.expires_at,
        notes,
        categories,
        price_cents,
        currency: body.currency.as_str(),
    })
}

fn to_response(row: PackageRow, usages: &[UsageInput], now: DateTime<Utc>) -> PackageResponse {
    let derived = lifecycle::derive(
        row.tracking_mode,
        row.quantity,
        usages,
        row.start_date,
        row.expires_at,
        now,
    );
    PackageResponse {
        id: row.id,
        name: row.name,
        quantity: row.quantity,
        tracking_mode: row.tracking_mode,
        start_date: row.start_date,
        expires_at: row.expires_at,
        notes: row.notes,
        categories: row.categories.0,
        price_cents: row.price_cents,
        currency: row.currency,
        archived_at: row.archived_at,
        created_at: row.created_at,
        updated_at: row.updated_at,

        consumed: derived.consumed,
        remaining: derived.remaining,
        days_until_expiry: derived.days_until_expiry,
        required_pace_per_day: derived.required_pace_per_day,
        status: derived.status,
    }
}
