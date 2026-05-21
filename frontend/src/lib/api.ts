// Typed fetch client.
//
// Routes are prefixed with `/api` so Vite's dev proxy forwards to the Rust
// server. In production set `VITE_API_BASE` at build time (defaults to ""
// → same-origin under /api).

import type { Currency, Subscription, TrackingMode, Usage } from "./types";

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
  method?: "GET" | "POST" | "PATCH" | "DELETE";
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

/** Fields when adding a usage entry. */
export interface UsageInput {
  amount: number;
  notes:  string | null;
}

export const api = {
  listSubscriptions:  () =>
    request<Subscription[]>("/subscriptions"),

  listCategories: () =>
    request<string[]>("/categories"),

  getSubscription:    (id: string) =>
    request<Subscription>(`/subscriptions/${encodeURIComponent(id)}`),

  listUsages:    (id: string) =>
    request<Usage[]>(`/subscriptions/${encodeURIComponent(id)}/usages`),

  createSubscription: (input: SubscriptionInput) =>
    request<Subscription>("/subscriptions", { method: "POST", body: input }),

  updateSubscription: (id: string, input: SubscriptionInput) =>
    request<Subscription>(`/subscriptions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body:   input,
    }),

  /** Hard-delete: removes the subscription and cascades through its usages. */
  deleteSubscription: (id: string) =>
    request<void>(`/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" }),

  /** Soft-delete: stamps `archived_at`. Row + usages survive but drop out
   *  of the active list. */
  archiveSubscription: (id: string) =>
    request<void>(`/subscriptions/${encodeURIComponent(id)}/archive`, { method: "POST" }),

  createUsage: (subscriptionId: string, input: UsageInput) =>
    request<Usage>(
      `/subscriptions/${encodeURIComponent(subscriptionId)}/usages`,
      { method: "POST", body: input },
    ),

  updateUsage: (subscriptionId: string, usageId: string, input: UsageInput) =>
    request<Usage>(
      `/subscriptions/${encodeURIComponent(subscriptionId)}/usages/${encodeURIComponent(usageId)}`,
      { method: "PATCH", body: input },
    ),

  deleteUsage: (subscriptionId: string, usageId: string) =>
    request<void>(
      `/subscriptions/${encodeURIComponent(subscriptionId)}/usages/${encodeURIComponent(usageId)}`,
      { method: "DELETE" },
    ),
};
