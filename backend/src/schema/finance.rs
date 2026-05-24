//! Wire types for the finance resource.
//!
//! `snake_case` everywhere so the React frontend can consume the JSON
//! directly. Dates are ISO-8601 `YYYY-MM-DD`; timestamps are UTC with `Z`.
//! Currency is ISO-4217 (USD | SGD | CNY | JPY) — same set as
//! `schema::subscriptions`.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

use crate::domain::ledger::{Cadence, LedgerSource};

// ---------------------------------------------------------------------------
// Query envelopes
// ---------------------------------------------------------------------------

/// `?month=YYYY-MM` query for ledger and budget reads.
#[derive(Debug, Deserialize)]
pub struct MonthQuery {
    pub month: String,
}

/// `?year=YYYY` query for the yearly dashboard.
#[derive(Debug, Deserialize)]
pub struct YearQuery {
    pub year: String,
}

/// Paginated list query for raw expense rows (used by the manage page).
#[derive(Debug, Deserialize)]
pub struct ListExpensesQuery {
    pub page: Option<u32>,
    pub per_page: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct ListExpensesResponse {
    pub items: Vec<ExpenseResponse>,
    pub total: i64,
    pub page: u32,
    pub per_page: u32,
}

// ---------------------------------------------------------------------------
// Expense
// ---------------------------------------------------------------------------

/// Create or replace shape for one-off expenses.
#[derive(Debug, Deserialize)]
pub struct ExpenseInput {
    pub occurred_on: NaiveDate,
    pub amount_cents: i64,
    pub currency: String,
    /// `""` permitted — rendered as "Uncategorized" in the UI.
    #[serde(default)]
    pub category: String,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ExpenseResponse {
    pub id: String,
    pub occurred_on: NaiveDate,
    pub amount_cents: i64,
    pub currency: String,
    pub category: String,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Recurring expense
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct RecurringExpenseInput {
    pub name: String,
    pub amount_cents: i64,
    pub currency: String,
    #[serde(default)]
    pub category: String,
    pub cadence: Cadence,
    pub start_date: NaiveDate,
    /// `None` = open-ended.
    pub end_date: Option<NaiveDate>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RecurringExpenseResponse {
    pub id: String,
    pub name: String,
    pub amount_cents: i64,
    pub currency: String,
    pub category: String,
    pub cadence: Cadence,
    pub start_date: NaiveDate,
    pub end_date: Option<NaiveDate>,
    pub notes: Option<String>,
    pub archived_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct BudgetInput {
    /// `YYYY-MM`. Validated in the handler.
    pub month: String,
    #[serde(default)]
    pub category: String,
    pub currency: String,
    pub amount_cents: i64,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BudgetResponse {
    pub id: String,
    pub month: String,
    pub category: String,
    pub currency: String,
    pub amount_cents: i64,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Monthly ledger (the workhorse response shape)
// ---------------------------------------------------------------------------

/// Reference to the upstream row a ledger entry came from. The UI links
/// `subscription` entries back to `/subscriptions/:id`; `expense` and
/// `recurring` entries open inline edit forms.
#[derive(Debug, Serialize)]
pub struct LedgerSourceRef {
    pub kind: LedgerSource,
    pub ref_id: String,
}

#[derive(Debug, Serialize)]
pub struct LedgerEntryResponse {
    pub date: NaiveDate,
    pub amount_cents: i64,
    pub currency: String,
    pub category: String,
    pub source: LedgerSourceRef,
    pub name: String,
    pub notes: Option<String>,
    pub extra_categories: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct CategoryTotalResponse {
    pub category: String,
    pub currency: String,
    pub spent_cents: i64,
}

/// Pre-joined "budget bar" — one row per `(category, currency)` that either
/// has a budget set or has any spending. Saves the UI an outer-join pass.
#[derive(Debug, Serialize)]
pub struct BudgetBarResponse {
    pub category: String,
    pub currency: String,
    pub budget_cents: Option<i64>,
    pub spent_cents: i64,
}

#[derive(Debug, Serialize)]
pub struct MonthlyLedgerResponse {
    pub month: String,
    pub entries: Vec<LedgerEntryResponse>,
    pub totals: Vec<CategoryTotalResponse>,
    pub bars: Vec<BudgetBarResponse>,
    /// Distinct currencies appearing in `entries` or `bars`. The UI groups
    /// the page into one section per currency in this order.
    pub currencies: Vec<String>,
}

/// One bar in the yearly trend chart — per-(month, currency) spend.
/// `month` is 1..=12; rows are dense, so a currency with no spend in a given
/// month still appears with `spent_cents = 0`.
#[derive(Debug, Serialize)]
pub struct MonthlyTotalResponse {
    pub month: u32,
    pub currency: String,
    pub spent_cents: i64,
}

/// Yearly dashboard payload. No per-entry list — summary-only. `bars` aggregate
/// the 12 monthly budgets per (category, currency); a category whose 12 months
/// have no budget gets `budget_cents = None`. `monthly_totals` drives the
/// trend chart and is densely populated across every (month, currency) seen.
#[derive(Debug, Serialize)]
pub struct YearlyLedgerResponse {
    pub year: String,
    pub bars: Vec<BudgetBarResponse>,
    pub monthly_totals: Vec<MonthlyTotalResponse>,
    pub currencies: Vec<String>,
}
