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
