//! Event handlers.
//!
//! Events generalize what used to be "usages": a calendar item that may or
//! may not link to a subscription, and that carries an
//! pending/accepted/declined lifecycle. Only accepted events with a linked
//! subscription burn the package — non-accepted events live on the
//! calendar without affecting pace.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use uuid::Uuid;

use crate::{
    db::repo::{EventRow, EventStatus, EventWithSubscriptionRow, EventWrite},
    domain::lifecycle::TrackingMode,
    error::AppError,
    http::AppState,
    schema::events::{
        EventInRangeResponse, EventInput, EventRangeQuery, EventResponse,
    },
};

pub async fn list_in_range(
    State(state): State<AppState>,
    Query(q): Query<EventRangeQuery>,
) -> Result<Json<Vec<EventInRangeResponse>>, AppError> {
    if q.from >= q.to {
        return Err(AppError::BadRequest("range_invalid"));
    }
    let rows = state.events.list_in_range(q.from, q.to).await?;
    Ok(Json(rows.into_iter().map(in_range_response).collect()))
}

pub async fn list_for_subscription(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<EventResponse>>, AppError> {
    // 404 distinguishes "no such subscription" from "subscription exists but
    // has no events" (which returns []).
    if !state.subscriptions.exists(&id).await? {
        return Err(AppError::NotFound);
    }
    let rows = state.events.list_for_subscription(&id).await?;
    Ok(Json(rows.into_iter().map(event_response).collect()))
}

pub async fn get_one(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<EventResponse>, AppError> {
    let row = state.events.fetch(&id).await?;
    Ok(Json(event_response(row)))
}

pub async fn create(
    State(state): State<AppState>,
    Json(body): Json<EventInput>,
) -> Result<(StatusCode, Json<EventResponse>), AppError> {
    let write = validate(&state, &body).await?;
    let id = Uuid::new_v4().to_string();
    let row = state.events.insert(&id, write).await?;
    Ok((StatusCode::CREATED, Json(event_response(row))))
}

pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<EventInput>,
) -> Result<Json<EventResponse>, AppError> {
    let write = validate(&state, &body).await?;
    let row = state.events.update(&id, write).await?;
    Ok(Json(event_response(row)))
}

pub async fn delete(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    state.events.delete(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn accept(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<EventResponse>, AppError> {
    // Accepting requires a linked subscription — a standalone calendar event
    // has nothing to burn, so "accepted" is meaningless for it.
    let current = state.events.fetch(&id).await?;
    if current.subscription_id.is_none() {
        return Err(AppError::BadRequest("accept_requires_subscription"));
    }
    let row = state.events.set_status(&id, EventStatus::Accepted).await?;
    Ok(Json(event_response(row)))
}

pub async fn decline(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<EventResponse>, AppError> {
    let row = state.events.set_status(&id, EventStatus::Declined).await?;
    Ok(Json(event_response(row)))
}

// ---------------------------------------------------------------------------

/// Validate an event input and project it into the db-layer write shape.
///
/// The invariants:
///   * `(subscription_id, amount)` agree: both present or both absent.
///   * `amount > 0` when present.
///   * `end_at > start_at` when both present.
///   * If linked, the subscription exists and is not in `duration` mode.
///
/// `status` defaults to `pending` when the client doesn't supply one.
async fn validate<'a>(
    state: &AppState,
    body: &'a EventInput,
) -> Result<EventWrite<'a>, AppError> {
    // (subscription_id, amount) must agree.
    let (subscription_id, amount) = match (body.subscription_id.as_deref(), body.amount) {
        (Some(sid), Some(a)) => {
            if !a.is_finite() || a <= 0.0 {
                return Err(AppError::BadRequest("amount_must_be_positive"));
            }
            let sub = state.subscriptions.fetch(sid).await?;
            if sub.tracking_mode == TrackingMode::Duration {
                return Err(AppError::BadRequest("events_forbidden_for_duration"));
            }
            (Some(sid), Some(a))
        }
        (None, None) => (None, None),
        _ => return Err(AppError::BadRequest("subscription_amount_mismatch")),
    };

    if let Some(end) = body.end_at {
        if end <= body.start_at {
            return Err(AppError::BadRequest("end_before_start"));
        }
    }

    let title = body
        .title
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let notes = body
        .notes
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let status = body.status.unwrap_or(EventStatus::Pending);

    Ok(EventWrite {
        title,
        start_at: body.start_at,
        end_at: body.end_at,
        status,
        subscription_id,
        amount,
        notes,
    })
}

fn event_response(row: EventRow) -> EventResponse {
    EventResponse {
        id: row.id,
        title: row.title,
        start_at: row.start_at,
        end_at: row.end_at,
        status: row.status,
        subscription_id: row.subscription_id,
        amount: row.amount,
        notes: row.notes,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn in_range_response(row: EventWithSubscriptionRow) -> EventInRangeResponse {
    EventInRangeResponse {
        id: row.id,
        title: row.title,
        start_at: row.start_at,
        end_at: row.end_at,
        status: row.status,
        subscription_id: row.subscription_id,
        subscription_name: row.subscription_name,
        tracking_mode: row.tracking_mode,
        amount: row.amount,
        notes: row.notes,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}
