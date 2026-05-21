//! Lifecycle derivation for a subscription.
//!
//! Pure functions, no DB, no async. Given a subscription's tracking mode,
//! optional quantity, usage history, start/expiry dates, and the current
//! time, derive everything the UI shows: how much is left, how many days
//! remain, the daily pace required to consume the rest by expiry, and a
//! lifecycle status label.
//!
//! Three tracking modes:
//!   * `Units`    — countable items (e.g. "10 classes"). Progress = sum of usage amounts.
//!   * `Hours`    — time-valued amounts (e.g. "20 coaching hours"). Same math as `Units`;
//!     the distinction is purely presentational.
//!   * `Duration` — no quantity, no usages. Progress is the elapsed fraction of the
//!     start → expiry window. "Consumed" and "remaining" are in days.
//!
//! All time is UTC. The caller passes `now` so tests are deterministic and
//! the same code answers "what does this subscription look like next Monday".

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

/// How a subscription's progress is measured.
///
/// Persisted as TEXT in SQLite and serialized as lowercase on the wire
/// (`"units" | "hours" | "duration"`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(rename_all = "lowercase")]
pub enum TrackingMode {
    Units,
    Hours,
    Duration,
}

/// One past usage projected to the inputs the derivation needs.
#[derive(Debug, Clone, Copy)]
pub struct UsageInput {
    pub amount: f64,
    pub created_at: DateTime<Utc>,
}

/// Lifecycle status. Never persisted — always recomputed on read.
///
/// Priority (highest first), so a subscription matching multiple conditions
/// gets the most informative label:
///   1. `Done`     — quantity fully consumed (or, for duration, window fully elapsed)
///   2. `Expired`  — past `expires_at` with quantity remaining (units/hours only)
///   3. `NotStart` — `start_date` is in the future
///   4. `Active`   — otherwise
///
/// Duration mode never produces `Expired`: a duration pack that runs its
/// course is `Done`, not wasted.
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
    pub consumed: f64,
    pub remaining: f64,
    pub days_until_expiry: i64,
    /// `None` when expired, done, due today, or in duration mode.
    pub required_pace_per_day: Option<f64>,
    pub status: Status,
}

/// Float-equality epsilon for "remaining is zero". Guards against drift when
/// many usages exactly equal quantity.
const DONE_EPS: f64 = 1e-9;

pub fn derive(
    tracking_mode: TrackingMode,
    quantity: Option<f64>,
    usages: &[UsageInput],
    start_date: NaiveDate,
    expires_at: NaiveDate,
    now: DateTime<Utc>,
) -> Derived {
    let today = now.date_naive();
    let days_until_expiry = (expires_at - today).num_days();

    match tracking_mode {
        TrackingMode::Units | TrackingMode::Hours => {
            // Units and hours share the same derivation — the distinction is
            // purely how the UI labels the amounts.
            let quantity = quantity.unwrap_or(0.0);
            let consumed: f64 = usages.iter().map(|u| u.amount).sum();
            let remaining = (quantity - consumed).max(0.0);

            let required_pace_per_day = if remaining <= DONE_EPS || days_until_expiry <= 0 {
                None
            } else {
                Some(remaining / days_until_expiry as f64)
            };

            let status = derive_status_units(remaining, today, start_date, expires_at);

            Derived {
                consumed,
                remaining,
                days_until_expiry,
                required_pace_per_day,
                status,
            }
        }
        TrackingMode::Duration => {
            // Duration: progress is elapsed-days / total-days. No usages, no pace.
            let total_days = (expires_at - start_date).num_days().max(0) as f64;
            let elapsed_days = (today - start_date).num_days().max(0) as f64;
            let consumed = elapsed_days.min(total_days);
            let remaining = (total_days - consumed).max(0.0);

            let status = derive_status_duration(today, start_date, expires_at);

            Derived {
                consumed,
                remaining,
                days_until_expiry,
                required_pace_per_day: None,
                status,
            }
        }
    }
}

fn derive_status_units(
    remaining: f64,
    today: NaiveDate,
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

fn derive_status_duration(
    today: NaiveDate,
    start_date: NaiveDate,
    expires_at: NaiveDate,
) -> Status {
    // Done takes priority — a duration pack that runs past expiry has
    // simply finished. It never enters `Expired`.
    if today > expires_at {
        return Status::Done;
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
        UsageInput {
            amount,
            created_at: ts(at),
        }
    }

    // ---- units / hours ------------------------------------------------------

    #[test]
    fn done_when_remaining_zero() {
        let now = ts("2026-06-01T12:00:00Z");
        let r = derive(
            TrackingMode::Units,
            Some(10.0),
            &[u(10.0, "2026-05-01T00:00:00Z")],
            d("2026-01-01"),
            d("2026-12-31"),
            now,
        );
        assert_eq!(r.status, Status::Done);
        assert_eq!(r.remaining, 0.0);
        assert_eq!(r.required_pace_per_day, None);
    }

    #[test]
    fn done_takes_priority_over_expired() {
        let now = ts("2027-01-01T00:00:00Z");
        let r = derive(
            TrackingMode::Units,
            Some(5.0),
            &[u(5.0, "2026-06-01T00:00:00Z")],
            d("2026-01-01"),
            d("2026-12-31"),
            now,
        );
        assert_eq!(r.status, Status::Done);
    }

    #[test]
    fn expired_when_past_expiry_with_remaining() {
        let now = ts("2027-01-01T00:00:00Z");
        let r = derive(
            TrackingMode::Units,
            Some(10.0),
            &[u(2.0, "2026-06-01T00:00:00Z")],
            d("2026-01-01"),
            d("2026-12-31"),
            now,
        );
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
        let r = derive(
            TrackingMode::Units,
            Some(10.0),
            &[],
            d("2027-06-01"),
            d("2026-12-31"),
            now,
        );
        assert_eq!(r.status, Status::Expired);
    }

    #[test]
    fn not_start_when_today_before_start_date() {
        let now = ts("2026-06-01T00:00:00Z");
        let r = derive(
            TrackingMode::Units,
            Some(10.0),
            &[],
            d("2026-07-01"),
            d("2026-12-31"),
            now,
        );
        assert_eq!(r.status, Status::NotStart);
    }

    #[test]
    fn active_when_within_window_with_remaining() {
        let now = ts("2026-06-15T12:00:00Z");
        let r = derive(
            TrackingMode::Units,
            Some(14.0),
            &[u(2.0, "2026-06-10T00:00:00Z")],
            d("2026-06-01"),
            d("2026-06-29"),
            now,
        );
        assert_eq!(r.status, Status::Active);
        assert_eq!(r.remaining, 12.0);
    }

    #[test]
    fn active_on_start_date_exactly() {
        let now = ts("2026-06-01T08:00:00Z");
        let r = derive(
            TrackingMode::Units,
            Some(10.0),
            &[],
            d("2026-06-01"),
            d("2026-12-31"),
            now,
        );
        assert_eq!(r.status, Status::Active);
    }

    #[test]
    fn active_on_expiry_date_exactly() {
        // Last day of validity — still Active, not Expired.
        let now = ts("2026-06-30T08:00:00Z");
        let r = derive(
            TrackingMode::Units,
            Some(10.0),
            &[u(2.0, "2026-06-15T00:00:00Z")],
            d("2026-06-01"),
            d("2026-06-30"),
            now,
        );
        assert_eq!(r.status, Status::Active);
        assert_eq!(r.days_until_expiry, 0);
        assert_eq!(r.required_pace_per_day, None);
    }

    #[test]
    fn required_pace_when_remaining_and_days_positive() {
        let now = ts("2026-06-01T00:00:00Z");
        let r = derive(
            TrackingMode::Units,
            Some(14.0),
            &[],
            d("2026-06-01"),
            d("2026-06-15"),
            now,
        );
        assert_eq!(r.required_pace_per_day, Some(1.0));
    }

    #[test]
    fn fractional_quantity_and_amount_preserved() {
        let now = ts("2026-06-01T00:00:00Z");
        let r = derive(
            TrackingMode::Units,
            Some(7.5),
            &[u(2.5, "2026-05-15T00:00:00Z")],
            d("2026-01-01"),
            d("2027-01-01"),
            now,
        );
        assert_eq!(r.consumed, 2.5);
        assert_eq!(r.remaining, 5.0);
    }

    // ---- duration -----------------------------------------------------------

    #[test]
    fn duration_not_start_before_window() {
        let now = ts("2026-05-01T00:00:00Z");
        let r = derive(
            TrackingMode::Duration,
            None,
            &[],
            d("2026-06-01"),
            d("2026-08-30"),
            now,
        );
        assert_eq!(r.status, Status::NotStart);
        assert_eq!(r.consumed, 0.0);
        assert_eq!(r.required_pace_per_day, None);
    }

    #[test]
    fn duration_active_mid_window() {
        // 30 of 90 days elapsed.
        let now = ts("2026-07-01T12:00:00Z");
        let r = derive(
            TrackingMode::Duration,
            None,
            &[],
            d("2026-06-01"),
            d("2026-08-30"),
            now,
        );
        assert_eq!(r.status, Status::Active);
        assert_eq!(r.consumed, 30.0);
        assert_eq!(r.remaining, 60.0);
        assert_eq!(r.days_until_expiry, 60);
        assert_eq!(r.required_pace_per_day, None);
    }

    #[test]
    fn duration_done_after_window() {
        // Past expiry → Done (never Expired).
        let now = ts("2026-09-15T00:00:00Z");
        let r = derive(
            TrackingMode::Duration,
            None,
            &[],
            d("2026-06-01"),
            d("2026-08-30"),
            now,
        );
        assert_eq!(r.status, Status::Done);
        assert_eq!(r.remaining, 0.0);
        assert!(r.days_until_expiry < 0);
    }

    #[test]
    fn duration_zero_length_window_is_done_after() {
        // Same-day window. Before/on the day = active; after = done.
        let now = ts("2026-06-02T00:00:00Z");
        let r = derive(
            TrackingMode::Duration,
            None,
            &[],
            d("2026-06-01"),
            d("2026-06-01"),
            now,
        );
        assert_eq!(r.status, Status::Done);
    }

    #[test]
    fn duration_ignores_usages_input() {
        // Stray usages (shouldn't happen in practice — backend forbids it)
        // must not affect the derivation.
        let now = ts("2026-07-01T00:00:00Z");
        let r = derive(
            TrackingMode::Duration,
            None,
            &[u(99.0, "2026-06-15T00:00:00Z")],
            d("2026-06-01"),
            d("2026-08-30"),
            now,
        );
        assert_eq!(r.consumed, 30.0);
    }
}
