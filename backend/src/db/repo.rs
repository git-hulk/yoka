//! Storage abstraction.
//!
//! `SubscriptionRepo` and `EventRepo` are the seam between HTTP handlers and the
//! concrete storage engine. Handlers hold `Arc<dyn …>`, so the underlying
//! backend (SQLite today, Postgres later) is interchangeable behind the same
//! method shapes.
//!
//! Row and write types live here too, so the trait surface is self-contained:
//! a new backend pulls in this one module and implements the two traits.

use std::collections::HashMap;

use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::types::Json;

use crate::domain::lifecycle::{TrackingMode, UsageInput};
use crate::error::AppError;

/// Row as stored. Returned by repo reads; handlers convert to the wire type
/// after combining with derived pace values. `categories` is stored as a
/// JSON array regardless of backend, so a sqlx `Json` wrapper works for both
/// SQLite (TEXT) and Postgres (JSONB).
#[derive(Debug, sqlx::FromRow)]
pub struct SubscriptionRow {
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

/// Fields a caller may set on insert/update. Mirrors the wire input, but
/// kept here so the db layer doesn't depend on `schema::`.
pub struct SubscriptionWrite<'a> {
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

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/// Status lifecycle for a calendar event. Only `Accepted` events that also
/// carry a `subscription_id` count toward pace calculations — see
/// `EventRepo::amounts_for_pace`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "lowercase")]
#[sqlx(rename_all = "lowercase")]
#[sqlx(type_name = "TEXT")]
pub enum EventStatus {
    Pending,
    Accepted,
    Declined,
}

#[derive(Debug, sqlx::FromRow)]
pub struct EventRow {
    pub id: String,
    pub title: Option<String>,
    pub start_at: DateTime<Utc>,
    pub end_at: Option<DateTime<Utc>>,
    pub status: EventStatus,
    pub subscription_id: Option<String>,
    pub amount: Option<f64>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// `EventRow` plus the linked subscription's name + tracking_mode (when
/// linked). Returned from the calendar's range query so the frontend can
/// render chips without an N+1 lookup.
#[derive(Debug, sqlx::FromRow)]
pub struct EventWithSubscriptionRow {
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
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Fields a caller may set on event insert/update.
///
/// `(subscription_id, amount)` must agree: both `Some` or both `None`. The
/// HTTP layer validates this before calling the repo so the DB CHECK
/// constraint never fires as a fallback.
pub struct EventWrite<'a> {
    pub title: Option<&'a str>,
    pub start_at: DateTime<Utc>,
    pub end_at: Option<DateTime<Utc>>,
    pub status: EventStatus,
    pub subscription_id: Option<&'a str>,
    pub amount: Option<f64>,
    pub notes: Option<&'a str>,
}

// ---------------------------------------------------------------------------

/// Subscription aggregate. One method per current db function — signatures match
/// the old free functions one-for-one so the HTTP layer rewrites mechanically.
#[async_trait]
pub trait SubscriptionRepo: Send + Sync + 'static {
    async fn fetch(&self, id: &str) -> Result<SubscriptionRow, AppError>;
    async fn exists(&self, id: &str) -> Result<bool, AppError>;
    async fn insert(
        &self,
        id: &str,
        input: SubscriptionWrite<'_>,
    ) -> Result<SubscriptionRow, AppError>;
    async fn update(
        &self,
        id: &str,
        input: SubscriptionWrite<'_>,
    ) -> Result<SubscriptionRow, AppError>;
    /// Hard-delete: removes child events then the subscription, in a transaction.
    /// Backends own the transaction so callers don't see a split surface.
    async fn delete(&self, id: &str) -> Result<(), AppError>;
    /// Soft-delete: stamp `archived_at`. Idempotent on already-archived rows
    /// only at the SQL level — backends return `NotFound` if no row matched,
    /// which the UI treats as "nothing to do".
    async fn archive(&self, id: &str) -> Result<(), AppError>;
    async fn list_active(&self) -> Result<Vec<SubscriptionRow>, AppError>;
    async fn list_categories(&self) -> Result<Vec<String>, AppError>;
}

/// Event aggregate. Replaces the old `UsageRepo` — events generalize usages
/// (they can stand alone with no subscription link, and they carry a
/// pending/accepted/declined lifecycle).
#[async_trait]
pub trait EventRepo: Send + Sync + 'static {
    /// Does the given subscription have *any* event linked to it, regardless
    /// of status? Used to lock `tracking_mode` on the subscription PATCH.
    async fn any_for_subscription(&self, subscription_id: &str) -> Result<bool, AppError>;

    /// Pace inputs for one subscription: only `accepted` events with a
    /// non-null `amount` count.
    async fn amounts_for_pace(&self, subscription_id: &str) -> Result<Vec<UsageInput>, AppError>;

    /// Batched pace inputs for many subscriptions. Single query — avoids N+1
    /// on the home list.
    async fn amounts_for_pace_many(
        &self,
        subscription_ids: &[String],
    ) -> Result<HashMap<String, Vec<UsageInput>>, AppError>;

    /// Every event linked to a subscription, newest-first. Status-agnostic —
    /// the detail page renders pending/accepted/declined alike.
    async fn list_for_subscription(&self, subscription_id: &str)
        -> Result<Vec<EventRow>, AppError>;

    /// Cross-subscription range query for the calendar. Half-open
    /// `[from, to)`. Includes archived subscriptions' events so historical
    /// days still render. Includes standalone events (subscription_id NULL).
    async fn list_in_range(
        &self,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<Vec<EventWithSubscriptionRow>, AppError>;

    async fn fetch(&self, id: &str) -> Result<EventRow, AppError>;
    async fn insert(&self, id: &str, input: EventWrite<'_>) -> Result<EventRow, AppError>;
    async fn update(&self, id: &str, input: EventWrite<'_>) -> Result<EventRow, AppError>;

    /// Quick status mutation for the accept/decline buttons. Returns the
    /// updated row so the caller doesn't need a follow-up fetch.
    async fn set_status(&self, id: &str, status: EventStatus) -> Result<EventRow, AppError>;

    async fn delete(&self, id: &str) -> Result<(), AppError>;
}
