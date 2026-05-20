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
    domain::lifecycle::{self, UsageInput},
    error::AppError,
    http::AppState,
    schema::packages::{PackageInput, PackageResponse, UsageInputBody, UsageResponse},
};

const SUPPORTED_CURRENCIES: &[&str] = &["USD", "SGD", "CNY", "JPY"];

pub async fn list(
    State(state): State<AppState>,
) -> Result<Json<Vec<PackageResponse>>, AppError> {
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

pub async fn get_one(
    State(state):  State<AppState>,
    Path(id):      Path<String>,
) -> Result<Json<PackageResponse>, AppError> {
    let row    = db::packages::fetch(&state.pool, &id).await?;
    let usages = db::usages::amounts_for_pace(&state.pool, &id).await?;
    Ok(Json(to_response(row, &usages, Utc::now())))
}

pub async fn create(
    State(state): State<AppState>,
    Json(body):   Json<PackageInput>,
) -> Result<(StatusCode, Json<PackageResponse>), AppError> {
    let write = validate(&body)?;
    let id    = Uuid::new_v4().to_string();
    let row   = db::packages::insert(&state.pool, &id, write).await?;
    Ok((StatusCode::CREATED, Json(to_response(row, &[], Utc::now()))))
}

pub async fn update(
    State(state): State<AppState>,
    Path(id):     Path<String>,
    Json(body):   Json<PackageInput>,
) -> Result<Json<PackageResponse>, AppError> {
    let write = validate(&body)?;

    // Lock `time_known` once any usage has been recorded — flipping it
    // would silently re-interpret historical amounts (units ↔ hours).
    let current = db::packages::fetch(&state.pool, &id).await?;
    if write.time_known != current.time_known
        && db::usages::any_for_package(&state.pool, &id).await?
    {
        return Err(AppError::BadRequest("time_known_locked"));
    }

    let row    = db::packages::update(&state.pool, &id, write).await?;
    let usages = db::usages::amounts_for_pace(&state.pool, &id).await?;
    Ok(Json(to_response(row, &usages, Utc::now())))
}

pub async fn list_usages(
    State(state):  State<AppState>,
    Path(id):      Path<String>,
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
            id:         r.id,
            package_id: r.package_id,
            amount:     r.amount,
            debited_by: r.debited_by,
            notes:      r.notes,
            created_at: r.created_at,
        })
        .collect();

    Ok(Json(body))
}

pub async fn create_usage(
    State(state):  State<AppState>,
    Path(id):      Path<String>,
    Json(body):    Json<UsageInputBody>,
) -> Result<(StatusCode, Json<UsageResponse>), AppError> {
    if !body.amount.is_finite() || body.amount <= 0.0 {
        return Err(AppError::BadRequest("amount_must_be_positive"));
    }
    if !db::packages::exists(&state.pool, &id).await? {
        return Err(AppError::NotFound);
    }
    let notes = body
        .notes
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let usage_id = Uuid::new_v4().to_string();
    let row = db::usages::insert(
        &state.pool,
        &usage_id,
        &id,
        body.amount,
        notes,
    )
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(UsageResponse {
            id:         row.id,
            package_id: row.package_id,
            amount:     row.amount,
            debited_by: row.debited_by,
            notes:      row.notes,
            created_at: row.created_at,
        }),
    ))
}

pub async fn update_usage(
    State(state):         State<AppState>,
    Path((id, usage_id)): Path<(String, String)>,
    Json(body):           Json<UsageInputBody>,
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
        id:         row.id,
        package_id: row.package_id,
        amount:     row.amount,
        debited_by: row.debited_by,
        notes:      row.notes,
        created_at: row.created_at,
    }))
}

pub async fn delete_usage(
    State(state):       State<AppState>,
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
/// non-positive quantities, the notes normalization (blank → None so
/// `notes` is either meaningful text or absent), and currency code.
fn validate(body: &PackageInput) -> Result<PackageWrite<'_>, AppError> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name_required"));
    }
    if !body.quantity.is_finite() || body.quantity <= 0.0 {
        return Err(AppError::BadRequest("quantity_must_be_positive"));
    }
    if !SUPPORTED_CURRENCIES.contains(&body.currency.as_str()) {
        return Err(AppError::BadRequest("currency_unsupported"));
    }
    let notes = body
        .notes
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let category = body
        .category
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    if let Some(price) = body.price_cents {
        if price < 0 {
            return Err(AppError::BadRequest("price_cents_must_be_nonnegative"));
        }
    }

    if body.start_date > body.expires_at {
        return Err(AppError::BadRequest("start_date_after_expires_at"));
    }

    Ok(PackageWrite {
        name,
        quantity:    body.quantity,
        time_known:  body.time_known,
        start_date:  body.start_date,
        expires_at:  body.expires_at,
        notes,
        category,
        price_cents: body.price_cents,
        currency:    body.currency.as_str(),
    })
}

fn to_response(row: PackageRow, usages: &[UsageInput], now: DateTime<Utc>) -> PackageResponse {
    let derived = lifecycle::derive(row.quantity, usages, row.start_date, row.expires_at, now);
    PackageResponse {
        id:          row.id,
        name:        row.name,
        quantity:    row.quantity,
        time_known:  row.time_known,
        start_date:  row.start_date,
        expires_at:  row.expires_at,
        notes:       row.notes,
        category:    row.category,
        price_cents: row.price_cents,
        currency:    row.currency,
        archived_at: row.archived_at,
        created_at:  row.created_at,
        updated_at:  row.updated_at,

        consumed:              derived.consumed,
        remaining:             derived.remaining,
        days_until_expiry:     derived.days_until_expiry,
        required_pace_per_day: derived.required_pace_per_day,
        status:                derived.status,
    }
}
