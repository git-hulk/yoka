//! Wire types for the packages resource.
//!
//! `snake_case` everywhere — JS frontends can read it directly, no rename
//! pass. Dates are ISO-8601: `expires_at` is `YYYY-MM-DD`, timestamps are
//! UTC with `Z` suffix.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

use crate::domain::lifecycle::Status;

/// Wire shape for create and update. Update reuses the same fields — the
/// form is small enough that PUT-style "send everything" is simpler than
/// per-field PATCH semantics with `Option<Option<T>>` for nullables.
#[derive(Debug, Deserialize)]
pub struct PackageInput {
    pub name:        String,
    pub quantity:    f64,
    pub time_known:  bool,
    pub start_date:  NaiveDate,
    pub expires_at:  NaiveDate,
    pub notes:       Option<String>,
    pub category:    Option<String>,
    pub price_cents: Option<i64>,
    pub currency:    String,        // ISO-4217: USD | SGD | CNY | JPY
}

#[derive(Debug, Serialize)]
pub struct PackageResponse {
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

    // Derived — never persisted.
    pub consumed:              f64,
    pub remaining:             f64,
    pub days_until_expiry:     i64,
    pub required_pace_per_day: Option<f64>,
    pub status:                Status,
}

#[derive(Debug, Serialize)]
pub struct UsageResponse {
    pub id:         String,
    pub package_id: String,
    pub amount:     f64,
    pub debited_by: Option<String>,
    pub notes:      Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Wire input for adding a usage. `notes` is optional.
#[derive(Debug, Deserialize)]
pub struct UsageInputBody {
    pub amount: f64,
    pub notes:  Option<String>,
}
