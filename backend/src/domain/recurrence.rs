//! Recurrence rule expansion. Pure, no DB, no async.
//!
//! Given a series root (a recurring event's `start_at` + `RecurrenceRule`),
//! `expand_range` yields the UTC datetimes of every instance whose start_at
//! falls in a half-open `[from, to)` window. The first instance is always the
//! root's `start_at` itself.
//!
//! Scope is deliberately MVP:
//!   * `freq` = daily | weekly | monthly. Interval is implicitly 1.
//!   * `byweekday` limits weekly recurrence to the listed UTC weekdays.
//!     Defaults to "the same weekday as `start_at`" when omitted.
//!   * Termination via `until` (exclusive UTC date) or `count` (inclusive of
//!     the root). At most one may be set.
//!
//! Weekdays and dates are interpreted in UTC. Time-of-day is carried verbatim
//! from `start_at`. No timezone or DST handling — instances align to the
//! root's UTC clock.

use chrono::{DateTime, Datelike, Duration, NaiveDate, TimeZone, Timelike, Utc, Weekday};
use serde::{Deserialize, Serialize};

/// How often a series repeats. Interval is always 1 in the MVP.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Freq {
    Daily,
    Weekly,
    Monthly,
}

/// Days-of-week selector for weekly recurrence. Serialized as ISO two-letter
/// codes for cross-language readability.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Weekly {
    #[serde(rename = "MO")]
    Mo,
    #[serde(rename = "TU")]
    Tu,
    #[serde(rename = "WE")]
    We,
    #[serde(rename = "TH")]
    Th,
    #[serde(rename = "FR")]
    Fr,
    #[serde(rename = "SA")]
    Sa,
    #[serde(rename = "SU")]
    Su,
}

impl Weekly {
    pub fn to_chrono(self) -> Weekday {
        match self {
            Self::Mo => Weekday::Mon,
            Self::Tu => Weekday::Tue,
            Self::We => Weekday::Wed,
            Self::Th => Weekday::Thu,
            Self::Fr => Weekday::Fri,
            Self::Sa => Weekday::Sat,
            Self::Su => Weekday::Sun,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecurrenceRule {
    pub freq: Freq,
    /// Weekly only. When `None` for weekly recurrence, instances match the
    /// root's UTC weekday.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub byweekday: Option<Vec<Weekly>>,
    /// Exclusive end date (UTC). Series stops before this date.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub until: Option<NaiveDate>,
    /// Maximum number of instances including the root. Must be ≥ 1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub count: Option<u32>,
}

/// Rule validation. Centralized so handlers and tests share the same checks.
pub fn validate(rule: &RecurrenceRule) -> Result<(), &'static str> {
    if rule.until.is_some() && rule.count.is_some() {
        return Err("recurrence_until_count_mutually_exclusive");
    }
    if let Some(c) = rule.count {
        if c == 0 {
            return Err("recurrence_count_must_be_positive");
        }
        if c > 1000 {
            return Err("recurrence_count_too_large");
        }
    }
    if let Some(days) = &rule.byweekday {
        if rule.freq != Freq::Weekly {
            return Err("recurrence_byweekday_requires_weekly");
        }
        if days.is_empty() {
            return Err("recurrence_byweekday_empty");
        }
    }
    Ok(())
}

/// Generate the UTC start_at of every instance falling in `[from, to)`.
///
/// `start_at` of the root is included if it sits in the window. Generation
/// stops at `until` / `count` / `to`, whichever comes first.
///
/// A safety cap (`MAX_STEPS`) guards against pathological inputs.
pub fn expand_range(
    root_start: DateTime<Utc>,
    rule: &RecurrenceRule,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Vec<DateTime<Utc>> {
    if to <= from {
        return Vec::new();
    }
    let until_cutoff = rule
        .until
        .map(|d| Utc.from_utc_datetime(&d.and_hms_opt(0, 0, 0).unwrap()));
    let max_count = rule.count.unwrap_or(u32::MAX);
    // Hard cap: ~10 years of daily steps, more than enough for weekly/monthly.
    const MAX_STEPS: u32 = 4000;

    let mut out = Vec::new();
    let mut emitted: u32 = 0;
    let mut step: u32 = 0;

    while step < MAX_STEPS && emitted < max_count {
        let candidate = match nth_candidate(root_start, rule, step) {
            Some(c) => c,
            None => {
                // Day-of-month doesn't exist this iteration (e.g. Feb 31).
                // Skip this step without counting it against `emitted`.
                step += 1;
                continue;
            }
        };
        if let Some(cut) = until_cutoff {
            if candidate >= cut {
                break;
            }
        }
        if candidate >= to {
            break;
        }
        let matches = match rule.freq {
            Freq::Daily | Freq::Monthly => true,
            Freq::Weekly => weekly_matches(candidate, root_start, rule),
        };
        if matches {
            if candidate >= from {
                out.push(candidate);
            }
            emitted += 1;
        }
        step += 1;
    }
    out
}

/// Candidate datetime for the Nth step of the rule's natural period. Returns
/// `None` when the step lands on a non-existent day-of-month.
fn nth_candidate(root: DateTime<Utc>, rule: &RecurrenceRule, step: u32) -> Option<DateTime<Utc>> {
    match rule.freq {
        Freq::Daily | Freq::Weekly => Some(root + Duration::days(step as i64)),
        Freq::Monthly => {
            let total = root.month0() as i64 + step as i64;
            let years = total.div_euclid(12);
            let month0 = total.rem_euclid(12) as u32;
            let year = root.year() + years as i32;
            let day = root.day();
            let nd = NaiveDate::from_ymd_opt(year, month0 + 1, day)?;
            let naive = nd.and_hms_opt(root.hour(), root.minute(), root.second())?;
            Some(Utc.from_utc_datetime(&naive))
        }
    }
}

fn weekly_matches(candidate: DateTime<Utc>, root: DateTime<Utc>, rule: &RecurrenceRule) -> bool {
    let allowed: Vec<Weekday> = match &rule.byweekday {
        Some(days) => days.iter().map(|d| d.to_chrono()).collect(),
        None => vec![root.weekday()],
    };
    allowed.contains(&candidate.weekday())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dt(y: i32, m: u32, d: u32, hh: u32, mm: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(y, m, d, hh, mm, 0).unwrap()
    }

    #[test]
    fn daily_with_count() {
        let root = dt(2026, 5, 21, 9, 0);
        let rule = RecurrenceRule {
            freq: Freq::Daily,
            byweekday: None,
            until: None,
            count: Some(5),
        };
        let out = expand_range(root, &rule, dt(2026, 5, 1, 0, 0), dt(2026, 6, 1, 0, 0));
        assert_eq!(out.len(), 5);
        assert_eq!(out[0], dt(2026, 5, 21, 9, 0));
        assert_eq!(out[4], dt(2026, 5, 25, 9, 0));
    }

    #[test]
    fn weekly_with_byweekday() {
        // Root is Thursday May 21, 2026. Pick Mon + Wed.
        let root = dt(2026, 5, 21, 18, 0);
        let rule = RecurrenceRule {
            freq: Freq::Weekly,
            byweekday: Some(vec![Weekly::Mo, Weekly::We]),
            until: Some(NaiveDate::from_ymd_opt(2026, 6, 8).unwrap()),
            count: None,
        };
        let out = expand_range(root, &rule, dt(2026, 5, 21, 0, 0), dt(2026, 7, 1, 0, 0));
        // From May 21 (Thu, no match) to before June 8 (Mon, excluded):
        // Mondays:  May 25, Jun 1.
        // Wednesdays: May 27, Jun 3.
        assert_eq!(out.len(), 4);
        assert_eq!(out[0], dt(2026, 5, 25, 18, 0));
        assert_eq!(out[1], dt(2026, 5, 27, 18, 0));
        assert_eq!(out[2], dt(2026, 6, 1, 18, 0));
        assert_eq!(out[3], dt(2026, 6, 3, 18, 0));
    }

    #[test]
    fn monthly_steady_day() {
        // 15th of every month: Jan, Feb, Mar — all valid.
        let root = dt(2026, 1, 15, 8, 0);
        let rule = RecurrenceRule {
            freq: Freq::Monthly,
            byweekday: None,
            until: None,
            count: Some(3),
        };
        let out = expand_range(root, &rule, dt(2026, 1, 1, 0, 0), dt(2026, 12, 1, 0, 0));
        assert_eq!(out.len(), 3);
        assert_eq!(out[0], dt(2026, 1, 15, 8, 0));
        assert_eq!(out[1], dt(2026, 2, 15, 8, 0));
        assert_eq!(out[2], dt(2026, 3, 15, 8, 0));
    }

    #[test]
    fn monthly_skips_missing_day() {
        // Monthly on the 31st: months without a 31st are skipped.
        // count counts only emitted instances.
        let root = dt(2026, 1, 31, 8, 0);
        let rule = RecurrenceRule {
            freq: Freq::Monthly,
            byweekday: None,
            until: None,
            count: Some(3),
        };
        let out = expand_range(root, &rule, dt(2026, 1, 1, 0, 0), dt(2026, 12, 1, 0, 0));
        assert_eq!(out.len(), 3);
        assert_eq!(out[0], dt(2026, 1, 31, 8, 0));
        assert_eq!(out[1], dt(2026, 3, 31, 8, 0));
        assert_eq!(out[2], dt(2026, 5, 31, 8, 0));
    }

    #[test]
    fn range_filters_out_before_from() {
        let root = dt(2026, 1, 1, 12, 0);
        let rule = RecurrenceRule {
            freq: Freq::Daily,
            byweekday: None,
            until: None,
            count: Some(10),
        };
        let out = expand_range(root, &rule, dt(2026, 1, 5, 0, 0), dt(2026, 1, 8, 0, 0));
        // Days in window: Jan 5, 6, 7.
        assert_eq!(out.len(), 3);
        assert_eq!(out[0], dt(2026, 1, 5, 12, 0));
    }

    #[test]
    fn validation() {
        // byweekday requires weekly
        assert!(validate(&RecurrenceRule {
            freq: Freq::Daily,
            byweekday: Some(vec![Weekly::Mo]),
            until: None,
            count: None,
        })
        .is_err());

        // count and until mutually exclusive
        assert!(validate(&RecurrenceRule {
            freq: Freq::Daily,
            byweekday: None,
            until: Some(NaiveDate::from_ymd_opt(2026, 1, 1).unwrap()),
            count: Some(5),
        })
        .is_err());

        // count must be positive
        assert!(validate(&RecurrenceRule {
            freq: Freq::Daily,
            byweekday: None,
            until: None,
            count: Some(0),
        })
        .is_err());
    }
}
