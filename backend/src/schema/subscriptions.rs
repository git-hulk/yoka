//! Wire types for the subscriptions resource.
//!
//! `snake_case` everywhere — JS frontends can read it directly, no rename
//! pass. Dates are ISO-8601: `expires_at` is `YYYY-MM-DD`, timestamps are
//! UTC with `Z` suffix.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

use crate::domain::lifecycle::{Status, TrackingMode};

/// Query string for the paginated list endpoint. Both fields are optional —
/// the handler falls back to `page = 1, per_page = 10` and caps `per_page`
/// at 100 so a hostile caller can't ask for the whole table.
#[derive(Debug, Deserialize)]
pub struct ListSubscriptionsQuery {
    pub page: Option<u32>,
    pub per_page: Option<u32>,
}

/// Page envelope. `items` is the slice; `total` is the unpaginated count of
/// matching rows so the UI can render `start–end of total` and know when to
/// disable `next`.
#[derive(Debug, Serialize)]
pub struct ListSubscriptionsResponse {
    pub items: Vec<SubscriptionResponse>,
    pub total: i64,
    pub page: u32,
    pub per_page: u32,
}

/// Wire shape for create and update. Update reuses the same fields — the
/// form is small enough that PUT-style "send everything" is simpler than
/// per-field PATCH semantics with `Option<Option<T>>` for nullables.
///
/// `quantity` is `None` iff `tracking_mode == "duration"`; the handler
/// enforces that invariant.
#[derive(Debug, Deserialize)]
pub struct SubscriptionInput {
    pub name: String,
    pub quantity: Option<f64>,
    pub tracking_mode: TrackingMode,
    pub start_date: NaiveDate,
    pub expires_at: NaiveDate,
    pub notes: Option<String>,
    #[serde(default)]
    pub categories: Vec<String>,
    pub price_cents: Option<i64>,
    pub currency: String, // ISO-4217: USD | SGD | CNY | JPY
}

#[derive(Debug, Serialize)]
pub struct SubscriptionResponse {
    pub id: String,
    pub name: String,
    pub quantity: Option<f64>,
    pub tracking_mode: TrackingMode,
    pub start_date: NaiveDate,
    pub expires_at: NaiveDate,
    pub notes: Option<String>,
    pub categories: Vec<String>,
    pub price_cents: Option<i64>,
    pub currency: String,
    pub archived_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,

    // Derived — never persisted.
    pub consumed: f64,
    pub remaining: f64,
    pub days_until_expiry: i64,
    pub required_pace_per_day: Option<f64>,
    pub status: Status,
}

