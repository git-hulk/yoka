// Mirror of the Rust wire types in src/schema/packages.rs.
// Kept hand-written (no codegen) — small surface, churn is rare.

export type Status = "active" | "not_start" | "done" | "expired";

export type Currency = "USD" | "SGD" | "CNY" | "JPY";
export const CURRENCIES: readonly Currency[] = ["USD", "SGD", "CNY", "JPY"];

export interface Package {
  id: string;
  name: string;
  quantity: number;
  time_known: boolean;
  start_date: string;            // "YYYY-MM-DD"
  expires_at: string;            // "YYYY-MM-DD"
  notes: string | null;
  category: string | null;
  price_cents: number | null;
  currency: Currency;
  archived_at: string | null;    // ISO-8601 UTC, null when active
  created_at: string;            // ISO-8601 UTC
  updated_at: string;            // ISO-8601 UTC

  // Derived
  consumed: number;
  remaining: number;
  days_until_expiry: number;
  required_pace_per_day: number | null;
  status: Status;
}

export interface Usage {
  id: string;
  package_id: string;
  amount: number;
  debited_by: string | null;
  notes: string | null;
  created_at: string;            // ISO-8601 UTC
}
