//! Finance handlers.
//!
//! Thin: extract args, validate, call repos + the `domain::ledger`
//! projection, return wire shapes. The workhorse is `monthly_ledger`, which
//! the frontend hits once per month-view render — it pre-joins budgets to
//! spent totals so the page doesn't outer-join client-side.

use std::collections::BTreeSet;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use uuid::Uuid;

use crate::{
    db::repo::{
        BudgetRow, BudgetWrite, ExpenseRow, ExpenseWrite, RecurringExpenseRow,
        RecurringExpenseWrite,
    },
    domain::ledger::{self, ExpenseLedgerInput, RecurringLedgerInput, YearMonth},
    error::AppError,
    http::AppState,
    schema::finance::{
        BudgetBarResponse, BudgetInput, BudgetResponse, CategoryTotalResponse, ExpenseInput,
        ExpenseResponse, LedgerEntryResponse, LedgerSourceRef, ListExpensesQuery,
        ListExpensesResponse, MonthQuery, MonthlyLedgerResponse, MonthlyTotalResponse,
        RecurringExpenseInput, RecurringExpenseResponse, YearQuery, YearlyLedgerResponse,
    },
};

const SUPPORTED_CURRENCIES: &[&str] = &["USD", "SGD", "CNY", "JPY"];
const DEFAULT_PER_PAGE: u32 = 20;
const MAX_PER_PAGE: u32 = 100;

// ---------------------------------------------------------------------------
// Monthly ledger (read-only, the workhorse)
// ---------------------------------------------------------------------------

pub async fn monthly_ledger(
    State(state): State<AppState>,
    Query(q): Query<MonthQuery>,
) -> Result<Json<MonthlyLedgerResponse>, AppError> {
    let month = parse_month(&q.month)?;
    let first = month.first_day();
    let last = month.last_day();

    // Subscriptions are intentionally excluded from the finance dashboard
    // charts — they live on their own page. Only manual expenses and
    // recurring rules feed the rollup.
    let expenses_rows = state.expenses.list_in_month(first, last).await?;
    let rules_rows = state.recurring_expenses.list_active().await?;
    let budgets_rows = state.budgets.list_for_month(&q.month).await?;

    let expense_inputs: Vec<ExpenseLedgerInput> =
        expenses_rows.iter().map(expense_to_ledger_input).collect();
    let rule_inputs: Vec<RecurringLedgerInput> =
        rules_rows.iter().map(recurring_to_ledger_input).collect();

    let ml = ledger::project_month(month, &[], &expense_inputs, &rule_inputs);

    // Pre-join budgets ↔ spent totals into the `bars` shape.
    let bars = join_bars(&ml.totals, &budgets_rows);

    // Distinct currencies, deterministic order. Prefer the order budgets +
    // entries first appear (alphabetical from BTreeSet keeps stable output).
    let mut currencies = BTreeSet::new();
    for e in &ml.entries {
        currencies.insert(e.currency.clone());
    }
    for b in &budgets_rows {
        currencies.insert(b.currency.clone());
    }

    Ok(Json(MonthlyLedgerResponse {
        month: q.month,
        entries: ml.entries.into_iter().map(ledger_entry_response).collect(),
        totals: ml
            .totals
            .into_iter()
            .map(|t| CategoryTotalResponse {
                category: t.category,
                currency: t.currency,
                spent_cents: t.spent_cents,
            })
            .collect(),
        bars,
        currencies: currencies.into_iter().collect(),
    }))
}

// ---------------------------------------------------------------------------
// Yearly dashboard
// ---------------------------------------------------------------------------

pub async fn yearly_ledger(
    State(state): State<AppState>,
    Query(q): Query<YearQuery>,
) -> Result<Json<YearlyLedgerResponse>, AppError> {
    let year = parse_year(&q.year)?;
    let first = chrono::NaiveDate::from_ymd_opt(year, 1, 1)
        .ok_or(AppError::BadRequest("invalid_year_format"))?;
    let last = chrono::NaiveDate::from_ymd_opt(year, 12, 31)
        .ok_or(AppError::BadRequest("invalid_year_format"))?;

    // `list_in_month` takes an arbitrary inclusive date range despite the name —
    // pass the year bounds to pull every expense for the year in one query.
    let expenses_rows = state.expenses.list_in_month(first, last).await?;
    let rules_rows = state.recurring_expenses.list_active().await?;
    let budgets_rows = state.budgets.list_for_year(&q.year).await?;

    let expense_inputs: Vec<ExpenseLedgerInput> =
        expenses_rows.iter().map(expense_to_ledger_input).collect();
    let rule_inputs: Vec<RecurringLedgerInput> =
        rules_rows.iter().map(recurring_to_ledger_input).collect();

    let yearly = ledger::project_year(year, &[], &expense_inputs, &rule_inputs);

    // Aggregate budgets across the 12 months per (category, currency).
    use std::collections::BTreeMap;
    let mut budget_totals: BTreeMap<(String, String), i64> = BTreeMap::new();
    for b in &budgets_rows {
        *budget_totals
            .entry((b.category.clone(), b.currency.clone()))
            .or_insert(0) += b.amount_cents;
    }

    // Outer-join totals ↔ aggregated budgets into bars.
    let mut bar_map: BTreeMap<(String, String), (Option<i64>, i64)> = BTreeMap::new();
    for ((cat, cur), budget) in budget_totals {
        bar_map.insert((cat, cur), (Some(budget), 0));
    }
    for t in &yearly.by_category {
        bar_map
            .entry((t.category.clone(), t.currency.clone()))
            .or_insert((None, 0))
            .1 = t.spent_cents;
    }
    let bars: Vec<BudgetBarResponse> = bar_map
        .into_iter()
        .map(
            |((category, currency), (budget_cents, spent_cents))| BudgetBarResponse {
                category,
                currency,
                budget_cents,
                spent_cents,
            },
        )
        .collect();

    let monthly_totals: Vec<MonthlyTotalResponse> = yearly
        .by_month
        .into_iter()
        .map(|m| MonthlyTotalResponse {
            month: m.month,
            currency: m.currency,
            spent_cents: m.spent_cents,
        })
        .collect();

    let mut currencies = BTreeSet::new();
    for b in &bars {
        currencies.insert(b.currency.clone());
    }

    Ok(Json(YearlyLedgerResponse {
        year: q.year,
        bars,
        monthly_totals,
        currencies: currencies.into_iter().collect(),
    }))
}

fn parse_year(s: &str) -> Result<i32, AppError> {
    if s.len() != 4 {
        return Err(AppError::BadRequest("invalid_year_format"));
    }
    s.parse::<i32>()
        .map_err(|_| AppError::BadRequest("invalid_year_format"))
}

// ---------------------------------------------------------------------------
// Expenses CRUD
// ---------------------------------------------------------------------------

pub async fn list_expenses(
    State(state): State<AppState>,
    Query(q): Query<ListExpensesQuery>,
) -> Result<Json<ListExpensesResponse>, AppError> {
    let page = q.page.unwrap_or(1).max(1);
    let per_page = q
        .per_page
        .unwrap_or(DEFAULT_PER_PAGE)
        .clamp(1, MAX_PER_PAGE);
    let offset = i64::from(page.saturating_sub(1)) * i64::from(per_page);

    let (rows, total) = state
        .expenses
        .list_paginated(i64::from(per_page), offset)
        .await?;
    Ok(Json(ListExpensesResponse {
        items: rows.into_iter().map(expense_response).collect(),
        total,
        page,
        per_page,
    }))
}

pub async fn get_expense(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ExpenseResponse>, AppError> {
    let row = state.expenses.fetch(&id).await?;
    Ok(Json(expense_response(row)))
}

pub async fn create_expense(
    State(state): State<AppState>,
    Json(body): Json<ExpenseInput>,
) -> Result<(StatusCode, Json<ExpenseResponse>), AppError> {
    let write = validate_expense(&body)?;
    let id = Uuid::new_v4().to_string();
    let row = state.expenses.insert(&id, write).await?;
    Ok((StatusCode::CREATED, Json(expense_response(row))))
}

pub async fn update_expense(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<ExpenseInput>,
) -> Result<Json<ExpenseResponse>, AppError> {
    let write = validate_expense(&body)?;
    let row = state.expenses.update(&id, write).await?;
    Ok(Json(expense_response(row)))
}

pub async fn delete_expense(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    state.expenses.delete(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Recurring expenses CRUD + archive
// ---------------------------------------------------------------------------

pub async fn list_recurring(
    State(state): State<AppState>,
) -> Result<Json<Vec<RecurringExpenseResponse>>, AppError> {
    let rows = state.recurring_expenses.list_all().await?;
    Ok(Json(rows.into_iter().map(recurring_response).collect()))
}

pub async fn get_recurring(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<RecurringExpenseResponse>, AppError> {
    let row = state.recurring_expenses.fetch(&id).await?;
    Ok(Json(recurring_response(row)))
}

pub async fn create_recurring(
    State(state): State<AppState>,
    Json(body): Json<RecurringExpenseInput>,
) -> Result<(StatusCode, Json<RecurringExpenseResponse>), AppError> {
    let write = validate_recurring(&body)?;
    let id = Uuid::new_v4().to_string();
    let row = state.recurring_expenses.insert(&id, write).await?;
    Ok((StatusCode::CREATED, Json(recurring_response(row))))
}

pub async fn update_recurring(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<RecurringExpenseInput>,
) -> Result<Json<RecurringExpenseResponse>, AppError> {
    let write = validate_recurring(&body)?;
    let row = state.recurring_expenses.update(&id, write).await?;
    Ok(Json(recurring_response(row)))
}

pub async fn delete_recurring(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    state.recurring_expenses.delete(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn archive_recurring(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    state.recurring_expenses.archive(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Budgets CRUD
// ---------------------------------------------------------------------------

pub async fn list_budgets(
    State(state): State<AppState>,
    Query(q): Query<MonthQuery>,
) -> Result<Json<Vec<BudgetResponse>>, AppError> {
    parse_month(&q.month)?;
    let rows = state.budgets.list_for_month(&q.month).await?;
    Ok(Json(rows.into_iter().map(budget_response).collect()))
}

pub async fn create_budget(
    State(state): State<AppState>,
    Json(body): Json<BudgetInput>,
) -> Result<(StatusCode, Json<BudgetResponse>), AppError> {
    let write = validate_budget(&body)?;
    let id = Uuid::new_v4().to_string();
    let row = state.budgets.insert(&id, write).await?;
    Ok((StatusCode::CREATED, Json(budget_response(row))))
}

pub async fn update_budget(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<BudgetInput>,
) -> Result<Json<BudgetResponse>, AppError> {
    let write = validate_budget(&body)?;
    let row = state.budgets.update(&id, write).await?;
    Ok(Json(budget_response(row)))
}

pub async fn delete_budget(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    state.budgets.delete(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

fn parse_month(s: &str) -> Result<YearMonth, AppError> {
    // Expect strictly `YYYY-MM`. chrono can't parse without a day, so we
    // split manually.
    let bytes = s.as_bytes();
    if bytes.len() != 7 || bytes[4] != b'-' {
        return Err(AppError::BadRequest("invalid_month_format"));
    }
    let year: i32 = s[..4]
        .parse()
        .map_err(|_| AppError::BadRequest("invalid_month_format"))?;
    let month: u32 = s[5..]
        .parse()
        .map_err(|_| AppError::BadRequest("invalid_month_format"))?;
    if !(1..=12).contains(&month) {
        return Err(AppError::BadRequest("invalid_month_format"));
    }
    Ok(YearMonth::new(year, month))
}

fn validate_currency(c: &str) -> Result<(), AppError> {
    if SUPPORTED_CURRENCIES.contains(&c) {
        Ok(())
    } else {
        Err(AppError::BadRequest("currency_unsupported"))
    }
}

fn validate_expense(body: &ExpenseInput) -> Result<ExpenseWrite<'_>, AppError> {
    validate_currency(&body.currency)?;
    if body.amount_cents <= 0 {
        return Err(AppError::BadRequest("amount_must_be_positive"));
    }
    // The DB column also rejects this, but we want a stable error code.
    let category = body.category.trim();
    let notes = body
        .notes
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    Ok(ExpenseWrite {
        occurred_on: body.occurred_on,
        amount_cents: body.amount_cents,
        currency: &body.currency,
        category,
        notes,
    })
}

fn validate_recurring(body: &RecurringExpenseInput) -> Result<RecurringExpenseWrite<'_>, AppError> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name_required"));
    }
    validate_currency(&body.currency)?;
    if body.amount_cents <= 0 {
        return Err(AppError::BadRequest("amount_must_be_positive"));
    }
    if let Some(end) = body.end_date {
        if end < body.start_date {
            return Err(AppError::BadRequest("end_date_before_start"));
        }
    }
    let category = body.category.trim();
    let notes = body
        .notes
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    Ok(RecurringExpenseWrite {
        name,
        amount_cents: body.amount_cents,
        currency: &body.currency,
        category,
        cadence: body.cadence,
        start_date: body.start_date,
        end_date: body.end_date,
        notes,
    })
}

fn validate_budget(body: &BudgetInput) -> Result<BudgetWrite<'_>, AppError> {
    parse_month(&body.month)?;
    validate_currency(&body.currency)?;
    if body.amount_cents < 0 {
        return Err(AppError::BadRequest("amount_must_be_nonnegative"));
    }
    let notes = body
        .notes
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    Ok(BudgetWrite {
        month: &body.month,
        category: body.category.trim(),
        currency: &body.currency,
        amount_cents: body.amount_cents,
        notes,
    })
}

// ---------------------------------------------------------------------------
// Row → wire conversions
// ---------------------------------------------------------------------------

fn expense_to_ledger_input(row: &ExpenseRow) -> ExpenseLedgerInput {
    ExpenseLedgerInput {
        id: row.id.clone(),
        occurred_on: row.occurred_on,
        amount_cents: row.amount_cents,
        currency: row.currency.clone(),
        category: row.category.clone(),
        notes: row.notes.clone(),
    }
}

fn recurring_to_ledger_input(row: &RecurringExpenseRow) -> RecurringLedgerInput {
    RecurringLedgerInput {
        id: row.id.clone(),
        name: row.name.clone(),
        amount_cents: row.amount_cents,
        currency: row.currency.clone(),
        category: row.category.clone(),
        cadence: row.cadence,
        start_date: row.start_date,
        end_date: row.end_date,
        notes: row.notes.clone(),
    }
}

fn expense_response(row: ExpenseRow) -> ExpenseResponse {
    ExpenseResponse {
        id: row.id,
        occurred_on: row.occurred_on,
        amount_cents: row.amount_cents,
        currency: row.currency,
        category: row.category,
        notes: row.notes,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn recurring_response(row: RecurringExpenseRow) -> RecurringExpenseResponse {
    RecurringExpenseResponse {
        id: row.id,
        name: row.name,
        amount_cents: row.amount_cents,
        currency: row.currency,
        category: row.category,
        cadence: row.cadence,
        start_date: row.start_date,
        end_date: row.end_date,
        notes: row.notes,
        archived_at: row.archived_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn budget_response(row: BudgetRow) -> BudgetResponse {
    BudgetResponse {
        id: row.id,
        month: row.month,
        category: row.category,
        currency: row.currency,
        amount_cents: row.amount_cents,
        notes: row.notes,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn ledger_entry_response(e: ledger::LedgerEntry) -> LedgerEntryResponse {
    LedgerEntryResponse {
        date: e.date,
        amount_cents: e.amount_cents,
        currency: e.currency,
        category: e.category,
        source: LedgerSourceRef {
            kind: e.source_kind,
            ref_id: e.source_ref_id,
        },
        name: e.name,
        notes: e.notes,
        extra_categories: e.extra_categories,
    }
}

/// Outer-join budgets onto totals so each `(category, currency)` appearing in
/// either yields exactly one bar. Missing budget → `budget_cents = None`;
/// missing spend → `spent_cents = 0`.
fn join_bars(totals: &[ledger::CategoryTotal], budgets: &[BudgetRow]) -> Vec<BudgetBarResponse> {
    use std::collections::BTreeMap;
    type Key = (String, String);

    let mut map: BTreeMap<Key, (Option<i64>, i64)> = BTreeMap::new();
    for b in budgets {
        let key = (b.category.clone(), b.currency.clone());
        map.entry(key).or_insert((None, 0)).0 = Some(b.amount_cents);
    }
    for t in totals {
        let key = (t.category.clone(), t.currency.clone());
        map.entry(key).or_insert((None, 0)).1 = t.spent_cents;
    }
    map.into_iter()
        .map(
            |((category, currency), (budget_cents, spent_cents))| BudgetBarResponse {
                category,
                currency,
                budget_cents,
                spent_cents,
            },
        )
        .collect()
}
