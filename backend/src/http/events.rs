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
    Extension, Json,
};
use chrono::NaiveDate;
use uuid::Uuid;

use crate::{
    auth::{CurrentMember, Role},
    db::repo::{EventRow, EventStatus, EventWithSubscriptionRow, EventWrite},
    domain::lifecycle::TrackingMode,
    domain::recurrence::validate as validate_recurrence,
    error::AppError,
    http::AppState,
    schema::events::{EventInRangeResponse, EventInput, EventRangeQuery, EventResponse},
};

pub async fn list_in_range(
    State(state): State<AppState>,
    Extension(me): Extension<CurrentMember>,
    Query(q): Query<EventRangeQuery>,
) -> Result<Json<Vec<EventInRangeResponse>>, AppError> {
    me.require_role(Role::Viewer)?;
    if q.from >= q.to {
        return Err(AppError::BadRequest("range_invalid"));
    }
    let rows = state.events.list_in_range(&me.group_id, q.from, q.to).await?;
    Ok(Json(rows.into_iter().map(in_range_response).collect()))
}

pub async fn list_for_subscription(
    State(state): State<AppState>,
    Extension(me): Extension<CurrentMember>,
    Path(id): Path<String>,
) -> Result<Json<Vec<EventResponse>>, AppError> {
    me.require_role(Role::Viewer)?;
    if !state.subscriptions.exists(&me.group_id, &id).await? {
        return Err(AppError::NotFound);
    }
    let rows = state.events.list_for_subscription(&me.group_id, &id).await?;
    Ok(Json(rows.into_iter().map(event_response).collect()))
}

pub async fn get_one(
    State(state): State<AppState>,
    Extension(me): Extension<CurrentMember>,
    Path(id): Path<String>,
) -> Result<Json<EventResponse>, AppError> {
    me.require_role(Role::Viewer)?;
    if let Some((parent_id, instance_date)) = parse_composite(&id) {
        return fetch_virtual_instance(&state, &me, parent_id, instance_date)
            .await
            .map(|r| Json(event_response(r)));
    }
    let row = state.events.fetch(&me.group_id, &id).await?;
    Ok(Json(event_response(row)))
}

pub async fn create(
    State(state): State<AppState>,
    Extension(me): Extension<CurrentMember>,
    Json(body): Json<EventInput>,
) -> Result<(StatusCode, Json<EventResponse>), AppError> {
    me.require_role(Role::Editor)?;
    let write = validate(&state, &me, &body).await?;
    let id = Uuid::new_v4().to_string();
    let row = state.events.insert(&me.group_id, &id, write).await?;
    Ok((StatusCode::CREATED, Json(event_response(row))))
}

pub async fn update(
    State(state): State<AppState>,
    Extension(me): Extension<CurrentMember>,
    Path(id): Path<String>,
    Json(body): Json<EventInput>,
) -> Result<Json<EventResponse>, AppError> {
    me.require_role(Role::Editor)?;
    if parse_composite(&id).is_some() {
        return Err(AppError::BadRequest("per_instance_edit_not_supported"));
    }
    let write = validate(&state, &me, &body).await?;
    let row = state.events.update(&me.group_id, &id, write).await?;
    Ok(Json(event_response(row)))
}

pub async fn delete(
    State(state): State<AppState>,
    Extension(me): Extension<CurrentMember>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    me.require_role(Role::Editor)?;
    if parse_composite(&id).is_some() {
        return Err(AppError::BadRequest("per_instance_delete_not_supported"));
    }
    state.events.delete(&me.group_id, &id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn accept(
    State(state): State<AppState>,
    Extension(me): Extension<CurrentMember>,
    Path(id): Path<String>,
) -> Result<Json<EventResponse>, AppError> {
    me.require_role(Role::Editor)?;
    if let Some((parent_id, instance_date)) = parse_composite(&id) {
        return accept_or_decline_instance(
            &state,
            &me,
            parent_id,
            instance_date,
            EventStatus::Accepted,
        )
        .await
        .map(|r| Json(event_response(r)));
    }
    let current = state.events.fetch(&me.group_id, &id).await?;
    if current.subscription_id.is_none() {
        return Err(AppError::BadRequest("accept_requires_subscription"));
    }
    let row = state
        .events
        .set_status(&me.group_id, &id, EventStatus::Accepted)
        .await?;
    Ok(Json(event_response(row)))
}

pub async fn decline(
    State(state): State<AppState>,
    Extension(me): Extension<CurrentMember>,
    Path(id): Path<String>,
) -> Result<Json<EventResponse>, AppError> {
    me.require_role(Role::Editor)?;
    if let Some((parent_id, instance_date)) = parse_composite(&id) {
        return accept_or_decline_instance(
            &state,
            &me,
            parent_id,
            instance_date,
            EventStatus::Declined,
        )
        .await
        .map(|r| Json(event_response(r)));
    }
    let row = state
        .events
        .set_status(&me.group_id, &id, EventStatus::Declined)
        .await?;
    Ok(Json(event_response(row)))
}

// ---------------------------------------------------------------------------
// Composite id (recurring instance) helpers
// ---------------------------------------------------------------------------

fn parse_composite(id: &str) -> Option<(&str, NaiveDate)> {
    let (parent, date) = id.rsplit_once(':')?;
    let date = NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()?;
    Some((parent, date))
}

async fn fetch_virtual_instance(
    state: &AppState,
    me: &CurrentMember,
    parent_id: &str,
    instance_date: NaiveDate,
) -> Result<EventRow, AppError> {
    let parent = state.events.fetch(&me.group_id, parent_id).await?;
    let rule = parent
        .recurrence_rule
        .as_ref()
        .ok_or(AppError::BadRequest("instance_requires_recurring_parent"))?;
    let instance_start = chrono::TimeZone::from_utc_datetime(
        &chrono::Utc,
        &instance_date.and_time(parent.start_at.time()),
    );
    let next_day = instance_start + chrono::Duration::days(1);
    let candidates =
        crate::domain::recurrence::expand_range(parent.start_at, &rule.0, instance_start, next_day);
    if !candidates.iter().any(|c| c.date_naive() == instance_date) {
        return Err(AppError::NotFound);
    }
    let exception = state
        .events
        .fetch_exception(&me.group_id, parent_id, instance_date)
        .await?;
    let status = exception.map(|e| e.status).unwrap_or(parent.status);
    let end_at = parent
        .end_at
        .map(|e| e + (instance_start - parent.start_at));
    Ok(EventRow {
        id: format!("{parent_id}:{instance_date}"),
        title: parent.title,
        start_at: instance_start,
        end_at,
        status,
        subscription_id: parent.subscription_id,
        amount: parent.amount,
        notes: parent.notes,
        recurrence_rule: parent.recurrence_rule,
        created_at: parent.created_at,
        updated_at: parent.updated_at,
    })
}

async fn accept_or_decline_instance(
    state: &AppState,
    me: &CurrentMember,
    parent_id: &str,
    instance_date: NaiveDate,
    new_status: EventStatus,
) -> Result<EventRow, AppError> {
    let parent = state.events.fetch(&me.group_id, parent_id).await?;
    if matches!(new_status, EventStatus::Accepted) && parent.subscription_id.is_none() {
        return Err(AppError::BadRequest("accept_requires_subscription"));
    }
    state
        .events
        .upsert_exception(&me.group_id, parent_id, instance_date, new_status)
        .await?;
    fetch_virtual_instance(state, me, parent_id, instance_date).await
}

// ---------------------------------------------------------------------------

async fn validate<'a>(
    state: &AppState,
    me: &CurrentMember,
    body: &'a EventInput,
) -> Result<EventWrite<'a>, AppError> {
    let (subscription_id, amount) = match (body.subscription_id.as_deref(), body.amount) {
        (Some(sid), Some(a)) => {
            if !a.is_finite() || a <= 0.0 {
                return Err(AppError::BadRequest("amount_must_be_positive"));
            }
            let sub = state.subscriptions.fetch(&me.group_id, sid).await?;
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

    if let Some(rule) = &body.recurrence_rule {
        validate_recurrence(rule).map_err(AppError::BadRequest)?;
    }

    Ok(EventWrite {
        title,
        start_at: body.start_at,
        end_at: body.end_at,
        status,
        subscription_id,
        amount,
        notes,
        recurrence_rule: body.recurrence_rule.clone(),
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
        recurrence_rule: row.recurrence_rule.map(|j| j.0),
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
        recurrence_rule: row.recurrence_rule.map(|j| j.0),
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}
