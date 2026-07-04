//! Handlers for user-authored timeline events.
//!
//! Thin by design: extract, validate, call the repo, map to wire types. The
//! Timeline page's other event source (subscription pay dates) is derived
//! client-side from `GET /subscriptions`; only the user-authored rows need a
//! resource of their own.

use axum::extract::{Extension, Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::NaiveDate;
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::{CurrentMember, Role};
use crate::db::repo::{TimelineEventRow, TimelineEventWrite};
use crate::error::AppError;
use crate::http::AppState;
use crate::schema::timeline::{TimelineEventInput, TimelineEventResponse};

const MAX_TITLE_LEN: usize = 200;

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    /// Four-digit year, e.g. `2026`.
    pub year: i32,
}

pub async fn list(
    State(state): State<AppState>,
    Extension(me): Extension<CurrentMember>,
    Query(q): Query<ListQuery>,
) -> Result<Json<Vec<TimelineEventResponse>>, AppError> {
    me.require_role(Role::Viewer)?;
    let first = NaiveDate::from_ymd_opt(q.year, 1, 1).ok_or(AppError::BadRequest("bad_year"))?;
    let last = NaiveDate::from_ymd_opt(q.year, 12, 31).ok_or(AppError::BadRequest("bad_year"))?;
    let rows = state
        .timeline_events
        .list_in_range(&me.group_id, first, last)
        .await?;
    Ok(Json(rows.into_iter().map(response).collect()))
}

pub async fn create(
    State(state): State<AppState>,
    Extension(me): Extension<CurrentMember>,
    Json(body): Json<TimelineEventInput>,
) -> Result<(StatusCode, Json<TimelineEventResponse>), AppError> {
    me.require_role(Role::Editor)?;
    let write = validate(&body)?;
    let id = Uuid::new_v4().to_string();
    let row = state.timeline_events.insert(&me.group_id, &id, write).await?;
    Ok((StatusCode::CREATED, Json(response(row))))
}

pub async fn update(
    State(state): State<AppState>,
    Extension(me): Extension<CurrentMember>,
    Path(id): Path<String>,
    Json(body): Json<TimelineEventInput>,
) -> Result<Json<TimelineEventResponse>, AppError> {
    me.require_role(Role::Editor)?;
    let write = validate(&body)?;
    let row = state.timeline_events.update(&me.group_id, &id, write).await?;
    Ok(Json(response(row)))
}

pub async fn delete(
    State(state): State<AppState>,
    Extension(me): Extension<CurrentMember>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    me.require_role(Role::Editor)?;
    state.timeline_events.delete(&me.group_id, &id).await?;
    Ok(StatusCode::NO_CONTENT)
}

fn validate(body: &TimelineEventInput) -> Result<TimelineEventWrite<'_>, AppError> {
    let title = body.title.trim();
    if title.is_empty() {
        return Err(AppError::BadRequest("title_required"));
    }
    if title.chars().count() > MAX_TITLE_LEN {
        return Err(AppError::BadRequest("title_too_long"));
    }
    let notes = body
        .notes
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    Ok(TimelineEventWrite {
        title,
        occurred_on: body.occurred_on,
        notes,
    })
}

fn response(row: TimelineEventRow) -> TimelineEventResponse {
    TimelineEventResponse {
        id: row.id,
        title: row.title,
        occurred_on: row.occurred_on,
        notes: row.notes,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}
