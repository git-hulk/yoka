//! Monthly finance ledger projection.
//!
//! Pure functions. Given a target month and the raw inputs from each of the
//! three sources, `project_month` flattens them into a unified list of
//! `LedgerEntry`s and rolls up per-(category, currency) totals.
//!
//! Three sources feed the ledger:
//!   * **Subscriptions** — each one a single outflow on its `start_date`,
//!     for `price_cents` in its `currency`. Multi-category subscriptions
//!     attribute to their *first* category (the rest are surfaced as
//!     `extra_categories` for UI tooltips).
//!   * **Expenses** — one-off, materialized as-is.
//!   * **Recurring expenses** — rules that emit at most one entry per month,
//!     respecting `cadence`, `start_date`, and optional `end_date`. The
//!     monthly cadence **clamps day-of-month** when the target month is
//!     shorter than the rule's day (e.g. a rule on the 31st emits Feb 28/29).
//!     This deliberately differs from `domain::recurrence` (which skips):
//!     bills are expected to land somewhere in the month they're due, not
//!     vanish.
//!
//! The caller decides which subscriptions to feed in — typically only
//! non-archived ones — same convention as `domain::lifecycle::derive`.

use chrono::{Datelike, NaiveDate};
use serde::Serialize;

/// Which feeder produced a ledger entry. Serialized snake_case so the UI
/// can switch on it directly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LedgerSource {
    Subscription,
    Expense,
    Recurring,
}

/// How often a recurring-expense rule fires.
///
/// Persisted as TEXT in SQLite and serialized lowercase on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize, sqlx::Type)]
#[serde(rename_all = "lowercase")]
#[sqlx(rename_all = "lowercase")]
pub enum Cadence {
    Monthly,
    Yearly,
}

/// Year + 1-based month. The page navigates by month, so this is the only
/// time-grain the projection cares about.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct YearMonth {
    pub year: i32,
    pub month: u32,
}

impl YearMonth {
    pub fn new(year: i32, month: u32) -> Self {
        debug_assert!((1..=12).contains(&month));
        Self { year, month }
    }

    /// First calendar day of the month.
    pub fn first_day(self) -> NaiveDate {
        NaiveDate::from_ymd_opt(self.year, self.month, 1).expect("valid month")
    }

    /// Last calendar day of the month (28..=31).
    pub fn last_day(self) -> NaiveDate {
        // Step into the next month at day 1, subtract one day. Wrap year at
        // December so we don't pass month=13 to chrono.
        let (ny, nm) = if self.month == 12 {
            (self.year + 1, 1)
        } else {
            (self.year, self.month + 1)
        };
        NaiveDate::from_ymd_opt(ny, nm, 1)
            .expect("valid next month")
            .pred_opt()
            .expect("at least one day in month")
    }

    pub fn contains(self, d: NaiveDate) -> bool {
        d.year() == self.year && d.month() == self.month
    }
}

/// Minimal projection of a subscription row for the ledger. The full
/// `SubscriptionRow` lives in `db::repo`; this trimmed shape lets the domain
/// layer stay free of `chrono::DateTime<Utc>`-vs-`NaiveDate` storage choices.
#[derive(Debug, Clone)]
pub struct SubscriptionLedgerInput {
    pub id: String,
    pub name: String,
    pub start_date: NaiveDate,
    pub price_cents: Option<i64>,
    pub currency: String,
    /// Multi-tag set from the subscription. The first non-empty value drives
    /// budget attribution; the rest are surfaced as `extra_categories`.
    pub categories: Vec<String>,
}

/// One-off expense row, projected for the ledger.
#[derive(Debug, Clone)]
pub struct ExpenseLedgerInput {
    pub id: String,
    pub occurred_on: NaiveDate,
    pub amount_cents: i64,
    pub currency: String,
    pub category: String,
    pub notes: Option<String>,
}

/// Recurring-expense rule, projected for the ledger.
#[derive(Debug, Clone)]
pub struct RecurringLedgerInput {
    pub id: String,
    pub name: String,
    pub amount_cents: i64,
    pub currency: String,
    pub category: String,
    pub cadence: Cadence,
    pub start_date: NaiveDate,
    /// Inclusive last-eligible date. `None` = open-ended.
    pub end_date: Option<NaiveDate>,
    pub notes: Option<String>,
}

/// One entry in the rendered monthly ledger.
#[derive(Debug, Clone, Serialize)]
pub struct LedgerEntry {
    pub date: NaiveDate,
    pub amount_cents: i64,
    pub currency: String,
    /// Category used for budget attribution. `""` = Uncategorized.
    pub category: String,
    pub source_kind: LedgerSource,
    /// Stable id back to the feeder row. For recurring entries this is
    /// `"<rule_id>:YYYY-MM-DD"` to disambiguate cycles, matching the
    /// composite-id convention used by `domain::recurrence`.
    pub source_ref_id: String,
    pub name: String,
    pub notes: Option<String>,
    /// Other tags from a multi-category subscription. Empty for expense and
    /// recurring sources. Surfaced in the UI as a tooltip.
    pub extra_categories: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CategoryTotal {
    pub category: String,
    pub currency: String,
    pub spent_cents: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MonthlyLedger {
    pub entries: Vec<LedgerEntry>,
    pub totals: Vec<CategoryTotal>,
}

/// One (month, currency) total — fed to the yearly dashboard's trend chart.
/// `month` is 1..=12. Months with no spend in a currency are emitted as 0
/// so the chart always has 12 data points.
#[derive(Debug, Clone, Serialize)]
pub struct MonthlyTotal {
    pub month: u32,
    pub currency: String,
    pub spent_cents: i64,
}

/// Aggregate result of `project_year`. Both views are sorted deterministically
/// (BTreeMap-derived).
#[derive(Debug, Clone, Serialize)]
pub struct YearlyTotals {
    pub by_category: Vec<CategoryTotal>,
    pub by_month: Vec<MonthlyTotal>,
}

/// Build the unified monthly ledger from raw feeder rows.
///
/// `subs` should already be filtered to non-archived rows by the caller —
/// the projection doesn't second-guess archival policy (same convention as
/// `domain::lifecycle::derive`).
pub fn project_month(
    month: YearMonth,
    subs: &[SubscriptionLedgerInput],
    expenses: &[ExpenseLedgerInput],
    rules: &[RecurringLedgerInput],
) -> MonthlyLedger {
    let mut entries: Vec<LedgerEntry> = Vec::new();

    // ----- Subscriptions: emit only those purchased in the target month. ----
    for s in subs {
        let Some(price) = s.price_cents else {
            continue;
        };
        if !month.contains(s.start_date) {
            continue;
        }
        let (category, extras) = split_categories(&s.categories);
        entries.push(LedgerEntry {
            date: s.start_date,
            amount_cents: price,
            currency: s.currency.clone(),
            category,
            source_kind: LedgerSource::Subscription,
            source_ref_id: s.id.clone(),
            name: s.name.clone(),
            notes: None,
            extra_categories: extras,
        });
    }

    // ----- One-off expenses: occurred_on in target month. ------------------
    for e in expenses {
        if !month.contains(e.occurred_on) {
            continue;
        }
        entries.push(LedgerEntry {
            date: e.occurred_on,
            amount_cents: e.amount_cents,
            currency: e.currency.clone(),
            category: e.category.clone(),
            source_kind: LedgerSource::Expense,
            source_ref_id: e.id.clone(),
            name: name_from_notes(e.notes.as_deref()),
            notes: e.notes.clone(),
            extra_categories: Vec::new(),
        });
    }

    // ----- Recurring rules: at most one occurrence per rule per month. -----
    for r in rules {
        let Some(date) = occurrence_in_month(r, month) else {
            continue;
        };
        entries.push(LedgerEntry {
            date,
            amount_cents: r.amount_cents,
            currency: r.currency.clone(),
            category: r.category.clone(),
            source_kind: LedgerSource::Recurring,
            source_ref_id: format!("{}:{}", r.id, date),
            name: r.name.clone(),
            notes: r.notes.clone(),
            extra_categories: Vec::new(),
        });
    }

    // Sort: date asc, then source kind (subs first, then recurring, then
    // expenses — bills tend to repeat at month start; loose expenses fill
    // in), then name for determinism.
    entries.sort_by(|a, b| {
        a.date
            .cmp(&b.date)
            .then_with(|| source_order(a.source_kind).cmp(&source_order(b.source_kind)))
            .then_with(|| a.name.cmp(&b.name))
    });

    let totals = rollup_totals(&entries);
    MonthlyLedger { entries, totals }
}

/// Aggregate every month of `year` into per-(category, currency) totals plus
/// per-(month, currency) totals.
///
/// Internally runs `project_month` for all 12 months and sums in two ways
/// in a single pass. For every currency that appears anywhere in the year,
/// the by-month view is dense — months with no spend get a 0 row — so the
/// trend chart always has 12 data points per currency.
pub fn project_year(
    year: i32,
    subs: &[SubscriptionLedgerInput],
    expenses: &[ExpenseLedgerInput],
    rules: &[RecurringLedgerInput],
) -> YearlyTotals {
    use std::collections::{BTreeMap, BTreeSet};

    let mut by_cat: BTreeMap<(String, String), i64> = BTreeMap::new();
    let mut by_month: BTreeMap<(u32, String), i64> = BTreeMap::new();
    let mut currencies: BTreeSet<String> = BTreeSet::new();

    for m in 1..=12u32 {
        let ml = project_month(YearMonth::new(year, m), subs, expenses, rules);
        for t in ml.totals {
            currencies.insert(t.currency.clone());
            *by_cat
                .entry((t.category.clone(), t.currency.clone()))
                .or_insert(0) += t.spent_cents;
            *by_month.entry((m, t.currency.clone())).or_insert(0) += t.spent_cents;
        }
    }

    // Densify by_month: every currency present anywhere in the year gets all
    // 12 months represented, even if zero — keeps the trend chart honest
    // about gaps instead of skipping them silently.
    for c in &currencies {
        for m in 1..=12u32 {
            by_month.entry((m, c.clone())).or_insert(0);
        }
    }

    YearlyTotals {
        by_category: by_cat
            .into_iter()
            .map(|((category, currency), spent_cents)| CategoryTotal {
                category,
                currency,
                spent_cents,
            })
            .collect(),
        by_month: by_month
            .into_iter()
            .map(|((month, currency), spent_cents)| MonthlyTotal {
                month,
                currency,
                spent_cents,
            })
            .collect(),
    }
}

/// Pluck the first non-empty category as the budget-attribution key.
/// Trailing tags (also non-empty) are returned for UI display.
fn split_categories(cats: &[String]) -> (String, Vec<String>) {
    let mut primary: Option<String> = None;
    let mut extras: Vec<String> = Vec::new();
    for c in cats {
        let t = c.trim();
        if t.is_empty() {
            continue;
        }
        if primary.is_none() {
            primary = Some(t.to_string());
        } else {
            extras.push(t.to_string());
        }
    }
    (primary.unwrap_or_default(), extras)
}

/// Cheap display label for a one-off expense. Expenses have no `name`
/// column — the first line of `notes`, trimmed, is good enough; if that's
/// empty we fall back to a generic placeholder so the UI never renders an
/// empty row title.
fn name_from_notes(notes: Option<&str>) -> String {
    notes
        .and_then(|n| n.lines().next())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "Expense".to_string())
}

/// At what date in `month` does rule `r` fire, if at all? Returns `None`
/// when the rule has no occurrence in the month.
///
/// Monthly: the rule's `start_date.day()` clamped to the target month's
/// last day (so day-31 rules fall on Feb 28/29 etc.).
/// Yearly: only fires when `month.month` matches `start_date.month()`;
/// same clamp for Feb-29 rules in non-leap years.
fn occurrence_in_month(r: &RecurringLedgerInput, month: YearMonth) -> Option<NaiveDate> {
    let last = month.last_day();
    let first = month.first_day();

    // Cheap reject: a rule that hasn't started yet by month-end can't fire,
    // and one whose end is before month-start can't fire either.
    if r.start_date > last {
        return None;
    }
    if let Some(end) = r.end_date {
        if end < first {
            return None;
        }
    }

    let candidate = match r.cadence {
        Cadence::Monthly => {
            let day = r.start_date.day().min(last.day());
            NaiveDate::from_ymd_opt(month.year, month.month, day)?
        }
        Cadence::Yearly => {
            if r.start_date.month() != month.month {
                return None;
            }
            let day = r.start_date.day().min(last.day());
            NaiveDate::from_ymd_opt(month.year, month.month, day)?
        }
    };

    // Don't emit before the rule's own start_date (a rule starting Jan 15
    // shouldn't emit on Jan 1 of the same month).
    if candidate < r.start_date {
        return None;
    }
    if let Some(end) = r.end_date {
        if candidate > end {
            return None;
        }
    }
    Some(candidate)
}

fn source_order(s: LedgerSource) -> u8 {
    match s {
        LedgerSource::Subscription => 0,
        LedgerSource::Recurring => 1,
        LedgerSource::Expense => 2,
    }
}

fn rollup_totals(entries: &[LedgerEntry]) -> Vec<CategoryTotal> {
    use std::collections::BTreeMap;
    // BTreeMap so the order is deterministic without an explicit sort pass.
    let mut acc: BTreeMap<(String, String), i64> = BTreeMap::new();
    for e in entries {
        let key = (e.category.clone(), e.currency.clone());
        *acc.entry(key).or_insert(0) += e.amount_cents;
    }
    acc.into_iter()
        .map(|((category, currency), spent_cents)| CategoryTotal {
            category,
            currency,
            spent_cents,
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    fn sub(
        id: &str,
        name: &str,
        start: &str,
        price: Option<i64>,
        currency: &str,
        categories: &[&str],
    ) -> SubscriptionLedgerInput {
        SubscriptionLedgerInput {
            id: id.to_string(),
            name: name.to_string(),
            start_date: d(start),
            price_cents: price,
            currency: currency.to_string(),
            categories: categories.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn exp(id: &str, on: &str, cents: i64, currency: &str, category: &str) -> ExpenseLedgerInput {
        ExpenseLedgerInput {
            id: id.to_string(),
            occurred_on: d(on),
            amount_cents: cents,
            currency: currency.to_string(),
            category: category.to_string(),
            notes: None,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn rule(
        id: &str,
        name: &str,
        cents: i64,
        currency: &str,
        category: &str,
        cadence: Cadence,
        start: &str,
        end: Option<&str>,
    ) -> RecurringLedgerInput {
        RecurringLedgerInput {
            id: id.to_string(),
            name: name.to_string(),
            amount_cents: cents,
            currency: currency.to_string(),
            category: category.to_string(),
            cadence,
            start_date: d(start),
            end_date: end.map(d),
            notes: None,
        }
    }

    #[test]
    fn subscription_emitted_only_in_start_month() {
        let s = sub(
            "s1",
            "Yoga 10x",
            "2026-05-15",
            Some(18000),
            "SGD",
            &["Yoga"],
        );
        let ml = project_month(YearMonth::new(2026, 5), std::slice::from_ref(&s), &[], &[]);
        assert_eq!(ml.entries.len(), 1);
        assert_eq!(ml.entries[0].amount_cents, 18000);
        assert_eq!(ml.entries[0].category, "Yoga");

        // Different month — empty.
        let ml = project_month(YearMonth::new(2026, 6), &[s], &[], &[]);
        assert!(ml.entries.is_empty());
        assert!(ml.totals.is_empty());
    }

    #[test]
    fn subscription_without_price_is_skipped() {
        let s = sub("s1", "Free Trial", "2026-05-15", None, "SGD", &["Yoga"]);
        let ml = project_month(YearMonth::new(2026, 5), &[s], &[], &[]);
        assert!(ml.entries.is_empty());
    }

    #[test]
    fn multi_category_subscription_uses_first_and_surfaces_extras() {
        let s = sub(
            "s1",
            "Combo",
            "2026-05-15",
            Some(20000),
            "SGD",
            &["Yoga", "Wellness", "Membership"],
        );
        let ml = project_month(YearMonth::new(2026, 5), &[s], &[], &[]);
        assert_eq!(ml.entries[0].category, "Yoga");
        assert_eq!(
            ml.entries[0].extra_categories,
            vec!["Wellness".to_string(), "Membership".to_string()]
        );
    }

    #[test]
    fn empty_category_subscription_falls_back_to_uncategorized() {
        let s = sub(
            "s1",
            "Generic",
            "2026-05-15",
            Some(5000),
            "SGD",
            &["", "  "],
        );
        let ml = project_month(YearMonth::new(2026, 5), &[s], &[], &[]);
        assert_eq!(ml.entries[0].category, "");
        assert!(ml.entries[0].extra_categories.is_empty());
    }

    #[test]
    fn monthly_recurring_emits_one_per_month_and_respects_end_date() {
        let r = rule(
            "r1",
            "Rent",
            300000,
            "SGD",
            "Housing",
            Cadence::Monthly,
            "2026-01-01",
            Some("2026-06-30"),
        );
        for m in 1..=6 {
            let ml = project_month(YearMonth::new(2026, m), &[], &[], std::slice::from_ref(&r));
            assert_eq!(ml.entries.len(), 1, "month {m} should emit");
            assert_eq!(ml.entries[0].amount_cents, 300000);
        }
        // July is past end_date.
        let ml = project_month(YearMonth::new(2026, 7), &[], &[], &[r]);
        assert!(ml.entries.is_empty());
    }

    #[test]
    fn monthly_rule_clamps_day_31_into_february() {
        // Rule on Jan 31; Feb 2026 has 28 days. Should emit Feb 28, not skip.
        let r = rule(
            "r1",
            "Mortgage",
            100000,
            "USD",
            "Housing",
            Cadence::Monthly,
            "2026-01-31",
            None,
        );
        let ml = project_month(YearMonth::new(2026, 2), &[], &[], std::slice::from_ref(&r));
        assert_eq!(ml.entries.len(), 1);
        assert_eq!(ml.entries[0].date, d("2026-02-28"));

        // Leap year (2028) - Feb 29.
        let ml = project_month(YearMonth::new(2028, 2), &[], &[], &[r]);
        assert_eq!(ml.entries[0].date, d("2028-02-29"));
    }

    #[test]
    fn monthly_rule_does_not_emit_before_start_date_in_start_month() {
        // Rule starts mid-month: the start month emits on `start_date.day()`,
        // not on day-1.
        let r = rule(
            "r1",
            "Streaming",
            999,
            "USD",
            "Media",
            Cadence::Monthly,
            "2026-05-15",
            None,
        );
        let ml = project_month(YearMonth::new(2026, 5), &[], &[], std::slice::from_ref(&r));
        assert_eq!(ml.entries.len(), 1);
        assert_eq!(ml.entries[0].date, d("2026-05-15"));

        // April (before start) — empty.
        let ml = project_month(YearMonth::new(2026, 4), &[], &[], &[r]);
        assert!(ml.entries.is_empty());
    }

    #[test]
    fn yearly_rule_only_fires_in_matching_month() {
        let r = rule(
            "r1",
            "Insurance",
            120000,
            "SGD",
            "Insurance",
            Cadence::Yearly,
            "2026-03-15",
            None,
        );
        // Matches in March of any year ≥ 2026.
        for y in [2026, 2027, 2030] {
            let ml = project_month(YearMonth::new(y, 3), &[], &[], std::slice::from_ref(&r));
            assert_eq!(ml.entries.len(), 1, "year {y}");
            assert_eq!(ml.entries[0].date, d(&format!("{y}-03-15")));
        }
        // Other months silent.
        for m in [1, 2, 4, 12] {
            let ml = project_month(YearMonth::new(2026, m), &[], &[], std::slice::from_ref(&r));
            assert!(ml.entries.is_empty(), "month {m}");
        }
    }

    #[test]
    fn yearly_feb_29_rule_clamps_in_non_leap_year() {
        let r = rule(
            "r1",
            "Quirky",
            500,
            "USD",
            "Misc",
            Cadence::Yearly,
            "2028-02-29", // leap-year start
            None,
        );
        // 2029 is not a leap year — should clamp to Feb 28.
        let ml = project_month(YearMonth::new(2029, 2), &[], &[], &[r]);
        assert_eq!(ml.entries.len(), 1);
        assert_eq!(ml.entries[0].date, d("2029-02-28"));
    }

    #[test]
    fn expenses_outside_month_are_filtered() {
        let in_may = exp("e1", "2026-05-05", 1000, "SGD", "Food");
        let in_jun = exp("e2", "2026-06-05", 2000, "SGD", "Food");
        let ml = project_month(YearMonth::new(2026, 5), &[], &[in_may.clone(), in_jun], &[]);
        assert_eq!(ml.entries.len(), 1);
        assert_eq!(ml.entries[0].source_ref_id, "e1");
    }

    #[test]
    fn jpy_uses_yen_as_unit_no_minor_division() {
        // For JPY, amount_cents is yen — 18000 means ¥18,000. Projection
        // is currency-agnostic; this is purely a documentation test that
        // the integer arithmetic doesn't accidentally apply a 100-divisor.
        let s = sub(
            "s1",
            "Japan trip",
            "2026-05-15",
            Some(18000),
            "JPY",
            &["Travel"],
        );
        let ml = project_month(YearMonth::new(2026, 5), &[s], &[], &[]);
        assert_eq!(ml.entries[0].amount_cents, 18000);
        assert_eq!(ml.entries[0].currency, "JPY");
        assert_eq!(ml.totals[0].spent_cents, 18000);
    }

    #[test]
    fn totals_are_grouped_by_category_and_currency() {
        let s_sgd = sub(
            "s1",
            "Yoga",
            "2026-05-01",
            Some(18000),
            "SGD",
            &["Wellness"],
        );
        let r_sgd = rule(
            "r1",
            "Gym",
            5000,
            "SGD",
            "Wellness",
            Cadence::Monthly,
            "2026-01-01",
            None,
        );
        let e_usd = exp("e1", "2026-05-10", 4500, "USD", "Wellness");
        let e_food = exp("e2", "2026-05-15", 3000, "SGD", "Food");
        let ml = project_month(
            YearMonth::new(2026, 5),
            &[s_sgd],
            &[e_usd, e_food],
            &[r_sgd],
        );

        // Pull totals into a lookup to assert without ordering coupling.
        let mut by_key: std::collections::HashMap<(String, String), i64> =
            std::collections::HashMap::new();
        for t in &ml.totals {
            by_key.insert((t.category.clone(), t.currency.clone()), t.spent_cents);
        }
        assert_eq!(by_key[&("Wellness".to_string(), "SGD".to_string())], 23000);
        assert_eq!(by_key[&("Wellness".to_string(), "USD".to_string())], 4500);
        assert_eq!(by_key[&("Food".to_string(), "SGD".to_string())], 3000);
        // Exactly the three buckets above.
        assert_eq!(by_key.len(), 3);
    }

    #[test]
    fn recurring_with_end_inside_month_emits_only_if_due_date_is_on_or_before_end() {
        // Rule fires on the 20th. End is the 15th of that month — must skip.
        let r = rule(
            "r1",
            "Trial",
            100,
            "USD",
            "Misc",
            Cadence::Monthly,
            "2026-01-20",
            Some("2026-05-15"),
        );
        let ml = project_month(YearMonth::new(2026, 5), &[], &[], &[r]);
        assert!(ml.entries.is_empty());
    }

    #[test]
    fn yearly_aggregates_recurring_monthly_into_twelve_x_amount() {
        // Monthly rule active all year → 12× the amount in yearly totals,
        // and one entry per month in by_month (each = the monthly amount).
        let r = rule(
            "r1",
            "Rent",
            300_000,
            "SGD",
            "Housing",
            Cadence::Monthly,
            "2026-01-01",
            None,
        );
        let totals = project_year(2026, &[], &[], std::slice::from_ref(&r));
        assert_eq!(totals.by_category.len(), 1);
        assert_eq!(totals.by_category[0].category, "Housing");
        assert_eq!(totals.by_category[0].currency, "SGD");
        assert_eq!(totals.by_category[0].spent_cents, 300_000 * 12);

        // 12 by_month rows, each 300_000.
        assert_eq!(totals.by_month.len(), 12);
        for row in &totals.by_month {
            assert_eq!(row.currency, "SGD");
            assert_eq!(row.spent_cents, 300_000);
        }
    }

    #[test]
    fn yearly_subscription_counts_once_in_year_of_start_only() {
        let s = sub(
            "s1",
            "Yoga",
            "2026-05-15",
            Some(18_000),
            "SGD",
            &["Wellness"],
        );
        let totals = project_year(2026, std::slice::from_ref(&s), &[], &[]);
        assert_eq!(totals.by_category.len(), 1);
        assert_eq!(totals.by_category[0].spent_cents, 18_000);
        // by_month is dense for SGD (all 12 months emitted), but only May has
        // a non-zero figure.
        assert_eq!(totals.by_month.len(), 12);
        for row in &totals.by_month {
            let expected = if row.month == 5 { 18_000 } else { 0 };
            assert_eq!(row.spent_cents, expected, "month {}", row.month);
        }

        // Different year — both views empty.
        let totals = project_year(2025, std::slice::from_ref(&s), &[], &[]);
        assert!(totals.by_category.is_empty());
        assert!(totals.by_month.is_empty());
    }

    #[test]
    fn yearly_groups_by_currency_and_category() {
        let s_sgd = sub(
            "s1",
            "Yoga",
            "2026-05-01",
            Some(18_000),
            "SGD",
            &["Wellness"],
        );
        let s_usd = sub(
            "s2",
            "Coach",
            "2026-07-01",
            Some(40_000),
            "USD",
            &["Coaching"],
        );
        let e_food = exp("e1", "2026-02-15", 3_000, "SGD", "Food");
        let totals = project_year(2026, &[s_sgd, s_usd], &[e_food], &[]);
        let mut by_key: std::collections::HashMap<(String, String), i64> =
            std::collections::HashMap::new();
        for t in &totals.by_category {
            by_key.insert((t.category.clone(), t.currency.clone()), t.spent_cents);
        }
        assert_eq!(by_key[&("Wellness".to_string(), "SGD".to_string())], 18_000);
        assert_eq!(by_key[&("Coaching".to_string(), "USD".to_string())], 40_000);
        assert_eq!(by_key[&("Food".to_string(), "SGD".to_string())], 3_000);
        assert_eq!(by_key.len(), 3);

        // Both currencies should be densely represented across 12 months.
        let sgd_months: Vec<&MonthlyTotal> = totals
            .by_month
            .iter()
            .filter(|m| m.currency == "SGD")
            .collect();
        let usd_months: Vec<&MonthlyTotal> = totals
            .by_month
            .iter()
            .filter(|m| m.currency == "USD")
            .collect();
        assert_eq!(sgd_months.len(), 12);
        assert_eq!(usd_months.len(), 12);

        // SGD monthly shape: Feb = 3_000 (Food), May = 18_000 (sub). Rest zero.
        let sgd_by_month: std::collections::HashMap<u32, i64> = sgd_months
            .iter()
            .map(|m| (m.month, m.spent_cents))
            .collect();
        assert_eq!(sgd_by_month[&2], 3_000);
        assert_eq!(sgd_by_month[&5], 18_000);
        assert_eq!(sgd_by_month[&1], 0);
        assert_eq!(sgd_by_month[&12], 0);
    }

    #[test]
    fn entries_sorted_by_date_then_source() {
        let s = sub(
            "s1",
            "Sub on the 10th",
            "2026-05-10",
            Some(1000),
            "USD",
            &[],
        );
        let r = rule(
            "r1",
            "Rule on the 10th",
            500,
            "USD",
            "",
            Cadence::Monthly,
            "2026-05-10",
            None,
        );
        let e = exp("e1", "2026-05-10", 200, "USD", "");
        let ml = project_month(YearMonth::new(2026, 5), &[s], &[e], &[r]);
        // All three on the 10th — subscription, recurring, expense.
        assert_eq!(ml.entries[0].source_kind, LedgerSource::Subscription);
        assert_eq!(ml.entries[1].source_kind, LedgerSource::Recurring);
        assert_eq!(ml.entries[2].source_kind, LedgerSource::Expense);
    }
}
