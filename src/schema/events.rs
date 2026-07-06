//! Wire types for the events resource.
//!
//! Events generalize the old "usage" entity: they may stand alone (no
//! subscription link) and they carry a `pending`/`accepted`/`declined`
//! lifecycle. Only accepted events with a linked subscription count toward
//! the subscription's pace.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::db::repo::EventStatus;
use crate::domain::lifecycle::TrackingMode;
use crate::domain::recurrence::RecurrenceRule;

/// Wire input for create and update. Update reuses the same fields —
/// PUT-style — so the frontend can hand the whole form back without
/// per-field PATCH semantics.
///
/// Invariants enforced by the handler before hitting the DB:
///   * `(subscription_id, amount)` are both `Some` or both `None`.
///   * `amount > 0` when present.
///   * `end_at` (if present) is strictly after `start_at`.
///   * The linked subscription is not in `duration` tracking mode.
///   * `start_at` is not implausibly far in the future (skew tolerance).
#[derive(Debug, Deserialize)]
pub struct EventInput {
    pub title: Option<String>,
    pub start_at: DateTime<Utc>,
    pub end_at: Option<DateTime<Utc>>,
    /// Defaults to `pending` if omitted.
    #[serde(default)]
    pub status: Option<EventStatus>,
    pub subscription_id: Option<String>,
    pub amount: Option<f64>,
    pub notes: Option<String>,
    /// When set, the event is a recurring series. Subsequent occurrences are
    /// computed at read time. Per-instance status overrides live in a
    /// separate exceptions table; this field defines the template only.
    #[serde(default)]
    pub recurrence_rule: Option<RecurrenceRule>,
}

#[derive(Debug, Serialize)]
pub struct EventResponse {
    pub id: String,
    pub title: Option<String>,
    pub start_at: DateTime<Utc>,
    pub end_at: Option<DateTime<Utc>>,
    pub status: EventStatus,
    pub subscription_id: Option<String>,
    pub amount: Option<f64>,
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recurrence_rule: Option<RecurrenceRule>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Query for `GET /events` — half-open `[from, to)` UTC datetime range.
/// Returned rows carry their (optional) parent subscription's name and
/// tracking_mode so the calendar can render chips without an N+1 lookup.
#[derive(Debug, Deserialize)]
pub struct EventRangeQuery {
    pub from: DateTime<Utc>,
    pub to: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct EventInRangeResponse {
    pub id: String,
    pub title: Option<String>,
    pub start_at: DateTime<Utc>,
    pub end_at: Option<DateTime<Utc>>,
    pub status: EventStatus,
    pub subscription_id: Option<String>,
    pub subscription_name: Option<String>,
    pub tracking_mode: Option<TrackingMode>,
    pub amount: Option<f64>,
    pub notes: Option<String>,
    /// Present only on the series root row; virtual instances have this set
    /// to `None` and identify themselves via a composite id (`<parent>:date`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recurrence_rule: Option<RecurrenceRule>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
