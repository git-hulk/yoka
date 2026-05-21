//! Storage abstraction.
//!
//! `SubscriptionRepo` and `UsageRepo` are the seam between HTTP handlers and the
//! concrete storage engine. Handlers hold `Arc<dyn …>`, so the underlying
//! backend (SQLite today, Postgres later) is interchangeable behind the same
//! method shapes.
//!
//! Row and write types live here too, so the trait surface is self-contained:
//! a new backend pulls in this one module and implements the two traits.

use std::collections::HashMap;

use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
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

#[derive(Debug, sqlx::FromRow)]
pub struct UsageRow {
    pub id: String,
    pub subscription_id: String,
    pub amount: f64,
    pub debited_by: Option<String>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
}

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
    /// Hard-delete: removes child usages then the subscription, in a transaction.
    /// Backends own the transaction so callers don't see a split surface.
    async fn delete(&self, id: &str) -> Result<(), AppError>;
    /// Soft-delete: stamp `archived_at`. Idempotent on already-archived rows
    /// only at the SQL level — backends return `NotFound` if no row matched,
    /// which the UI treats as "nothing to do".
    async fn archive(&self, id: &str) -> Result<(), AppError>;
    async fn list_active(&self) -> Result<Vec<SubscriptionRow>, AppError>;
    async fn list_categories(&self) -> Result<Vec<String>, AppError>;
}

/// Usage aggregate.
#[async_trait]
pub trait UsageRepo: Send + Sync + 'static {
    async fn any_for_subscription(&self, subscription_id: &str) -> Result<bool, AppError>;
    async fn amounts_for_pace(&self, subscription_id: &str) -> Result<Vec<UsageInput>, AppError>;
    async fn amounts_for_pace_many(
        &self,
        subscription_ids: &[String],
    ) -> Result<HashMap<String, Vec<UsageInput>>, AppError>;
    async fn list(&self, subscription_id: &str) -> Result<Vec<UsageRow>, AppError>;
    async fn insert(
        &self,
        id: &str,
        subscription_id: &str,
        amount: f64,
        notes: Option<&str>,
    ) -> Result<UsageRow, AppError>;
    async fn update(
        &self,
        subscription_id: &str,
        usage_id: &str,
        amount: f64,
        notes: Option<&str>,
    ) -> Result<UsageRow, AppError>;
    async fn delete(&self, subscription_id: &str, usage_id: &str) -> Result<(), AppError>;
}
