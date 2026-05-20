//! Lifecycle derivation for a package.
//!
//! Pure functions, no DB, no async. Given a package's quantity, its usage
//! history, a start date, an expiry date and the current time, derive
//! everything the UI shows: how much is left, how many days remain, the
//! daily pace required to consume the rest by expiry, and a lifecycle
//! status label.
//!
//! All time is UTC. The caller passes `now` so tests are deterministic and
//! the same code answers "what does this package look like next Monday".

use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;

/// One past usage projected to the inputs the derivation needs.
#[derive(Debug, Clone, Copy)]
pub struct UsageInput {
    pub amount:     f64,
    pub created_at: DateTime<Utc>,
}

/// Lifecycle status. Never persisted — always recomputed on read.
///
/// Priority (highest first), so a package matching multiple conditions
/// gets the most informative label:
///   1. `Done`     — quantity fully consumed (success, even if past expiry)
///   2. `Expired`  — past `expires_at` with quantity remaining
///   3. `NotStart` — `start_date` is in the future
///   4. `Active`   — otherwise
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Active,
    NotStart,
    Done,
    Expired,
}

#[derive(Debug, Clone, Serialize)]
pub struct Derived {
    pub consumed:              f64,
    pub remaining:             f64,
    pub days_until_expiry:     i64,
    /// `None` when expired, done, or due today.
    pub required_pace_per_day: Option<f64>,
    pub status:                Status,
}

/// Float-equality epsilon for "remaining is zero". Guards against drift when
/// many usages exactly equal quantity.
const DONE_EPS: f64 = 1e-9;

pub fn derive(
    quantity:   f64,
    usages:     &[UsageInput],
    start_date: NaiveDate,
    expires_at: NaiveDate,
    now:        DateTime<Utc>,
) -> Derived {
    let consumed:  f64 = usages.iter().map(|u| u.amount).sum();
    let remaining      = (quantity - consumed).max(0.0);

    let today             = now.date_naive();
    let days_until_expiry = (expires_at - today).num_days();

    let required_pace_per_day = if remaining <= DONE_EPS || days_until_expiry <= 0 {
        None
    } else {
        Some(remaining / days_until_expiry as f64)
    };

    let status = derive_status(remaining, today, start_date, expires_at);

    Derived {
        consumed,
        remaining,
        days_until_expiry,
        required_pace_per_day,
        status,
    }
}

fn derive_status(
    remaining:  f64,
    today:      NaiveDate,
    start_date: NaiveDate,
    expires_at: NaiveDate,
) -> Status {
    if remaining <= DONE_EPS {
        return Status::Done;
    }
    if today > expires_at {
        return Status::Expired;
    }
    if today < start_date {
        return Status::NotStart;
    }
    Status::Active
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn ts(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    fn u(amount: f64, at: &str) -> UsageInput {
        UsageInput { amount, created_at: ts(at) }
    }

    #[test]
    fn done_when_remaining_zero() {
        let now    = ts("2026-06-01T12:00:00Z");
        let r = derive(10.0, &[u(10.0, "2026-05-01T00:00:00Z")], d("2026-01-01"), d("2026-12-31"), now);
        assert_eq!(r.status, Status::Done);
        assert_eq!(r.remaining, 0.0);
        assert_eq!(r.required_pace_per_day, None);
    }

    #[test]
    fn done_takes_priority_over_expired() {
        let now = ts("2027-01-01T00:00:00Z");
        let r = derive(5.0, &[u(5.0, "2026-06-01T00:00:00Z")], d("2026-01-01"), d("2026-12-31"), now);
        assert_eq!(r.status, Status::Done);
    }

    #[test]
    fn expired_when_past_expiry_with_remaining() {
        let now = ts("2027-01-01T00:00:00Z");
        let r = derive(10.0, &[u(2.0, "2026-06-01T00:00:00Z")], d("2026-01-01"), d("2026-12-31"), now);
        assert_eq!(r.status, Status::Expired);
        assert_eq!(r.remaining, 8.0);
        assert_eq!(r.required_pace_per_day, None);
        assert!(r.days_until_expiry < 0);
    }

    #[test]
    fn expired_beats_not_start_when_misconfigured() {
        // Bad data: start_date after expires_at and today past expiry.
        // Expired is the more useful label — the window is closed.
        let now = ts("2027-01-01T00:00:00Z");
        let r = derive(10.0, &[], d("2027-06-01"), d("2026-12-31"), now);
        assert_eq!(r.status, Status::Expired);
    }

    #[test]
    fn not_start_when_today_before_start_date() {
        let now = ts("2026-06-01T00:00:00Z");
        let r = derive(10.0, &[], d("2026-07-01"), d("2026-12-31"), now);
        assert_eq!(r.status, Status::NotStart);
    }

    #[test]
    fn active_when_within_window_with_remaining() {
        let now = ts("2026-06-15T12:00:00Z");
        let r = derive(14.0, &[u(2.0, "2026-06-10T00:00:00Z")], d("2026-06-01"), d("2026-06-29"), now);
        assert_eq!(r.status, Status::Active);
        assert_eq!(r.remaining, 12.0);
    }

    #[test]
    fn active_on_start_date_exactly() {
        let now = ts("2026-06-01T08:00:00Z");
        let r = derive(10.0, &[], d("2026-06-01"), d("2026-12-31"), now);
        assert_eq!(r.status, Status::Active);
    }

    #[test]
    fn active_on_expiry_date_exactly() {
        // Last day of validity — still Active, not Expired.
        let now = ts("2026-06-30T08:00:00Z");
        let r = derive(10.0, &[u(2.0, "2026-06-15T00:00:00Z")], d("2026-06-01"), d("2026-06-30"), now);
        assert_eq!(r.status, Status::Active);
        assert_eq!(r.days_until_expiry, 0);
        assert_eq!(r.required_pace_per_day, None);
    }

    #[test]
    fn required_pace_when_remaining_and_days_positive() {
        let now = ts("2026-06-01T00:00:00Z");
        let r = derive(14.0, &[], d("2026-06-01"), d("2026-06-15"), now);
        assert_eq!(r.required_pace_per_day, Some(1.0));
    }

    #[test]
    fn fractional_quantity_and_amount_preserved() {
        let now = ts("2026-06-01T00:00:00Z");
        let r = derive(7.5, &[u(2.5, "2026-05-15T00:00:00Z")], d("2026-01-01"), d("2027-01-01"), now);
        assert_eq!(r.consumed, 2.5);
        assert_eq!(r.remaining, 5.0);
    }
}
