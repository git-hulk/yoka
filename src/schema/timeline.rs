//! Wire types for user-authored timeline events.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

/// Create or replace shape. `title` is required and non-blank; `notes` is
/// trimmed and empty-collapsed server-side.
#[derive(Debug, Deserialize)]
pub struct TimelineEventInput {
    pub title: String,
    pub occurred_on: NaiveDate,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TimelineEventResponse {
    pub id: String,
    pub title: String,
    pub occurred_on: NaiveDate,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
