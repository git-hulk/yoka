// Typed fetch client.
//
// Routes are prefixed with `/api` so Vite's dev proxy forwards to the Rust
// server. In production set `VITE_API_BASE` at build time (defaults to ""
// → same-origin under /api).

import type {
  Budget,
  Cadence,
  CalendarEvent,
  Currency,
  EventInRange,
  EventStatus,
  Expense,
  ExpensesPage,
  MonthlyLedger,
  RecurringExpense,
  Subscription,
  SubscriptionsPage,
  TrackingMode,
  YearlyLedger,
} from "./types";

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOpts {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?:   unknown;
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { method = "GET", body } = opts;
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      accept: "application/json",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let code = "http_error";
    try {
      const errBody = (await res.json()) as { error?: string };
      if (errBody.error) code = errBody.error;
    } catch {
      // body wasn't JSON; keep generic code
    }
    throw new ApiError(res.status, code, `${res.status} ${code}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Fields the user can set when creating or editing a subscription.
 *  `quantity` is `null` iff `tracking_mode === "duration"`. */
export interface SubscriptionInput {
  name:          string;
  quantity:      number | null;
  tracking_mode: TrackingMode;
  start_date:    string;            // "YYYY-MM-DD"
  expires_at:    string;            // "YYYY-MM-DD"
  notes:         string | null;
  categories:    string[];          // max 3 entries

  price_cents:   number | null;
  currency:      Currency;
}

/** Fields the user can set when creating or editing an event.
 *
 *  `(subscription_id, amount)` must agree: both set (burns the subscription)
 *  or both null (standalone calendar entry). `status` defaults to "pending"
 *  when omitted — the backend treats only "accepted" events as burns. */
export interface EventInput {
  title:           string | null;
  start_at:        string;          // ISO-8601 UTC
  end_at:          string | null;
  status?:         EventStatus;
  subscription_id: string | null;
  amount:          number | null;
  notes:           string | null;
  recurrence_rule?: import("./types").RecurrenceRule | null;
}

export const api = {
  /** Paginated list. Server defaults: `page = 1`, `per_page = 10`
   *  (max 100). Returns the items plus a `total` count for the page UI. */
  listSubscriptions: (params: { page?: number; perPage?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.page !== undefined) qs.set("page", String(params.page));
    if (params.perPage !== undefined) qs.set("per_page", String(params.perPage));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<SubscriptionsPage>(`/subscriptions${suffix}`);
  },

  listCategories: () =>
    request<string[]>("/categories"),

  getSubscription:    (id: string) =>
    request<Subscription>(`/subscriptions/${encodeURIComponent(id)}`),

  /** Status-agnostic — returns pending, accepted, and declined events.
   *  Callers that want only burns (the subscription detail page) filter
   *  on `status === "accepted"` client-side. */
  listSubscriptionEvents: (id: string) =>
    request<CalendarEvent[]>(`/subscriptions/${encodeURIComponent(id)}/events`),

  createSubscription: (input: SubscriptionInput) =>
    request<Subscription>("/subscriptions", { method: "POST", body: input }),

  updateSubscription: (id: string, input: SubscriptionInput) =>
    request<Subscription>(`/subscriptions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body:   input,
    }),

  /** Hard-delete: removes the subscription and cascades through its events. */
  deleteSubscription: (id: string) =>
    request<void>(`/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" }),

  /** Soft-delete: stamps `archived_at`. Row + events survive but drop out
   *  of the active list. */
  archiveSubscription: (id: string) =>
    request<void>(`/subscriptions/${encodeURIComponent(id)}/archive`, { method: "POST" }),

  // ---------- events ------------------------------------------------------

  /** Cross-subscription range query for the calendar. Half-open `[from, to)`.
   *  Both bounds are ISO-8601 UTC instants. Includes standalone events. */
  listEventsInRange: (from: string, to: string) =>
    request<EventInRange[]>(
      `/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),

  getEvent: (id: string) =>
    request<CalendarEvent>(`/events/${encodeURIComponent(id)}`),

  createEvent: (input: EventInput) =>
    request<CalendarEvent>("/events", { method: "POST", body: input }),

  updateEvent: (id: string, input: EventInput) =>
    request<CalendarEvent>(`/events/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body:   input,
    }),

  deleteEvent: (id: string) =>
    request<void>(`/events/${encodeURIComponent(id)}`, { method: "DELETE" }),

  acceptEvent: (id: string) =>
    request<CalendarEvent>(`/events/${encodeURIComponent(id)}/accept`, { method: "POST" }),

  declineEvent: (id: string) =>
    request<CalendarEvent>(`/events/${encodeURIComponent(id)}/decline`, { method: "POST" }),

  // ---------- finance -----------------------------------------------------

  /** Workhorse: monthly ledger view + pre-joined budget bars. The page hits
   *  this once per month switch. */
  getMonthlyLedger: (month: string) =>
    request<MonthlyLedger>(`/finance/ledger?month=${encodeURIComponent(month)}`),

  /** Yearly dashboard: aggregated bars per `(category, currency)` summing
   *  all 12 months of spend and the 12 months of budgets. Read-only —
   *  budgets are defined monthly. */
  getYearlyLedger: (year: string) =>
    request<YearlyLedger>(`/finance/yearly?year=${encodeURIComponent(year)}`),

  listExpenses: (params: { page?: number; perPage?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.page !== undefined) qs.set("page", String(params.page));
    if (params.perPage !== undefined) qs.set("per_page", String(params.perPage));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<ExpensesPage>(`/finance/expenses${suffix}`);
  },

  getExpense: (id: string) =>
    request<Expense>(`/finance/expenses/${encodeURIComponent(id)}`),

  createExpense: (input: ExpenseInput) =>
    request<Expense>("/finance/expenses", { method: "POST", body: input }),

  updateExpense: (id: string, input: ExpenseInput) =>
    request<Expense>(`/finance/expenses/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body:   input,
    }),

  deleteExpense: (id: string) =>
    request<void>(`/finance/expenses/${encodeURIComponent(id)}`, { method: "DELETE" }),

  listRecurringExpenses: () =>
    request<RecurringExpense[]>("/finance/recurring-expenses"),

  getRecurringExpense: (id: string) =>
    request<RecurringExpense>(`/finance/recurring-expenses/${encodeURIComponent(id)}`),

  createRecurringExpense: (input: RecurringExpenseInput) =>
    request<RecurringExpense>("/finance/recurring-expenses", { method: "POST", body: input }),

  updateRecurringExpense: (id: string, input: RecurringExpenseInput) =>
    request<RecurringExpense>(`/finance/recurring-expenses/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body:   input,
    }),

  deleteRecurringExpense: (id: string) =>
    request<void>(`/finance/recurring-expenses/${encodeURIComponent(id)}`, { method: "DELETE" }),

  archiveRecurringExpense: (id: string) =>
    request<void>(`/finance/recurring-expenses/${encodeURIComponent(id)}/archive`, {
      method: "POST",
    }),

  listBudgets: (month: string) =>
    request<Budget[]>(`/finance/budgets?month=${encodeURIComponent(month)}`),

  createBudget: (input: BudgetInput) =>
    request<Budget>("/finance/budgets", { method: "POST", body: input }),

  updateBudget: (id: string, input: BudgetInput) =>
    request<Budget>(`/finance/budgets/${encodeURIComponent(id)}`, {
      method: "PUT",
      body:   input,
    }),

  deleteBudget: (id: string) =>
    request<void>(`/finance/budgets/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

// ---------------------------------------------------------------------------
// Finance input types — wire shapes for create/update
// ---------------------------------------------------------------------------

export interface ExpenseInput {
  occurred_on:  string;            // "YYYY-MM-DD"
  amount_cents: number;
  currency:     Currency;
  category:     string;            // "" allowed
  notes:        string | null;
}

export interface RecurringExpenseInput {
  name:         string;
  amount_cents: number;
  currency:     Currency;
  category:     string;
  cadence:      Cadence;
  start_date:   string;            // "YYYY-MM-DD"
  end_date:     string | null;     // "YYYY-MM-DD" or null
  notes:        string | null;
}

export interface BudgetInput {
  month:        string;            // "YYYY-MM"
  category:     string;
  currency:     Currency;
  amount_cents: number;
  notes:        string | null;
}
