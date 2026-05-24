// Mirror of the Rust wire types in src/schema/.
// Kept hand-written (no codegen) — small surface, churn is rare.

export type Status = "active" | "not_start" | "done" | "expired";

export type TrackingMode = "units" | "hours" | "duration";

export type Currency = "USD" | "SGD" | "CNY" | "JPY";
export const CURRENCIES: readonly Currency[] = ["USD", "SGD", "CNY", "JPY"];

export interface Subscription {
  id: string;
  name: string;
  quantity: number | null;       // null iff tracking_mode === "duration"
  tracking_mode: TrackingMode;
  start_date: string;            // "YYYY-MM-DD"
  expires_at: string;            // "YYYY-MM-DD"
  notes: string | null;
  categories: string[];          // 0–3 entries, normalized server-side
  price_cents: number | null;
  currency: Currency;
  archived_at: string | null;    // ISO-8601 UTC, null when active
  created_at: string;            // ISO-8601 UTC
  updated_at: string;            // ISO-8601 UTC

  // Derived. For duration mode, `consumed`/`remaining` are days.
  consumed: number;
  remaining: number;
  days_until_expiry: number;
  required_pace_per_day: number | null;
  status: Status;
}

/** Page envelope returned by `GET /subscriptions`. Mirror of the Rust
 *  `ListSubscriptionsResponse`. */
export interface SubscriptionsPage {
  items: Subscription[];
  total: number;
  page: number;
  per_page: number;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type EventStatus = "pending" | "accepted" | "declined";

export type Freq = "daily" | "weekly" | "monthly";

export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

/** Mirror of the Rust `RecurrenceRule`. Exactly zero or one of `until`/`count`
 *  may be present. `byweekday` is meaningful for `freq === "weekly"` only. */
export interface RecurrenceRule {
  freq: Freq;
  byweekday?: Weekday[];
  until?: string;        // "YYYY-MM-DD"
  count?: number;
}

/** A calendar entry. May stand alone (no subscription link) or burn down a
 *  subscription when status === "accepted". A row with `recurrence_rule` set
 *  is a "series root" whose virtual instances surface in calendar listings
 *  with composite ids of the form `<parent_id>:YYYY-MM-DD`. */
export interface CalendarEvent {
  id: string;
  title: string | null;
  start_at: string;                       // ISO-8601 UTC
  end_at: string | null;                  // ISO-8601 UTC, null = point-in-time
  status: EventStatus;
  subscription_id: string | null;
  amount: number | null;                  // present iff subscription_id is set
  notes: string | null;
  recurrence_rule?: RecurrenceRule | null;
  created_at: string;
  updated_at: string;
}

/** Calendar range payload — event enriched with the linked subscription's
 *  label + tracking mode (when linked) so chips can render without a second
 *  lookup. Virtual recurring instances appear here as separate rows. */
export interface EventInRange {
  id: string;
  title: string | null;
  start_at: string;
  end_at: string | null;
  status: EventStatus;
  subscription_id: string | null;
  subscription_name: string | null;
  tracking_mode: TrackingMode | null;
  amount: number | null;
  notes: string | null;
  recurrence_rule?: RecurrenceRule | null;
  created_at: string;
  updated_at: string;
}

/** True when the id refers to a virtual instance of a recurring series.
 *  Composite ids are `<parent_id>:YYYY-MM-DD`. Subscription/event ids are
 *  UUIDs and never contain a colon, so a colon is a safe sentinel. */
export function isRecurringInstance(id: string): boolean {
  return id.includes(":");
}

// ---------------------------------------------------------------------------
// Usages
//
// "Usage" is now a *projection* of an accepted, subscription-linked event:
// the historical burn-down view that the subscription detail/edit pages
// render. The Event type above is the source of truth.
// ---------------------------------------------------------------------------

export interface Usage {
  id: string;
  subscription_id: string;
  amount: number;
  notes: string | null;
  created_at: string;            // ISO-8601 UTC — the event's `start_at`
}

/** Convert an event row into the Usage shape consumed by pace/cadence
 *  helpers and the subscription-detail history list. Returns `null` for
 *  events that don't burn (no subscription link, no amount, or status
 *  isn't `accepted`). */
export function eventToUsage(e: CalendarEvent): Usage | null {
  if (e.status !== "accepted") return null;
  if (e.subscription_id === null || e.amount === null) return null;
  return {
    id: e.id,
    subscription_id: e.subscription_id,
    amount: e.amount,
    notes: e.notes,
    created_at: e.start_at,
  };
}

// ---------------------------------------------------------------------------
// Finance — mirror of backend/src/schema/finance.rs
// ---------------------------------------------------------------------------

export type Cadence = "monthly" | "yearly";

export type LedgerSourceKind = "subscription" | "expense" | "recurring";

/** One-off expense (`expenses` table). `category` is a single string;
 *  `""` is allowed and rendered as "Uncategorized" in the UI. */
export interface Expense {
  id: string;
  occurred_on: string;           // "YYYY-MM-DD"
  amount_cents: number;
  currency: Currency;
  category: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpensesPage {
  items: Expense[];
  total: number;
  page: number;
  per_page: number;
}

/** Recurring-expense rule. Instances are derived per month on the server;
 *  this row is the rule itself. `archived_at` mirrors subscriptions. */
export interface RecurringExpense {
  id: string;
  name: string;
  amount_cents: number;
  currency: Currency;
  category: string;
  cadence: Cadence;
  start_date: string;            // "YYYY-MM-DD"
  end_date: string | null;       // "YYYY-MM-DD", null = open-ended
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Per-month, per-(category, currency) budget. UNIQUE on the triple. */
export interface Budget {
  id: string;
  month: string;                 // "YYYY-MM"
  category: string;
  currency: Currency;
  amount_cents: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface LedgerSourceRef {
  kind: LedgerSourceKind;
  ref_id: string;
}

export interface LedgerEntry {
  date: string;                  // "YYYY-MM-DD"
  amount_cents: number;
  currency: Currency;
  category: string;              // "" = Uncategorized
  source: LedgerSourceRef;
  name: string;
  notes: string | null;
  /** Tags from a multi-category subscription beyond the budget-attribution
   *  category. Empty for expense/recurring entries. UI surfaces these as a
   *  tooltip on the ledger row. */
  extra_categories: string[];
}

export interface CategoryTotal {
  category: string;
  currency: Currency;
  spent_cents: number;
}

/** Pre-joined "budget bar" — one per `(category, currency)` that has either a
 *  budget set or any spending. `budget_cents === null` means "no budget" and
 *  the UI renders the bar in grey. */
export interface BudgetBar {
  category: string;
  currency: Currency;
  budget_cents: number | null;
  spent_cents: number;
}

export interface MonthlyLedger {
  month: string;                 // echo of the query month
  entries: LedgerEntry[];
  totals: CategoryTotal[];
  bars: BudgetBar[];
  /** Distinct currencies present in entries ∪ bars. The page groups itself
   *  into one section per currency in this order. */
  currencies: Currency[];
}

/** One trend-chart data point: spend in a single month for a single currency.
 *  `month` is 1..=12; rows are dense across the year, so a quiet month still
 *  appears with `spent_cents: 0`. */
export interface MonthlyTotal {
  month: number;
  currency: Currency;
  spent_cents: number;
}

/** Yearly dashboard payload — summary only. Each `BudgetBar`'s
 *  `budget_cents` is the sum of the 12 monthly budgets for that
 *  `(category, currency)`; if no monthly budgets exist, it's `null`.
 *  `monthly_totals` is the 12-month trend per currency. */
export interface YearlyLedger {
  year: string;                  // "YYYY"
  bars: BudgetBar[];
  monthly_totals: MonthlyTotal[];
  currencies: Currency[];
}
