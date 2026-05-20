// Typed fetch client.
//
// Routes are prefixed with `/api` so Vite's dev proxy forwards to the Rust
// server. In production set `VITE_API_BASE` at build time (defaults to ""
// → same-origin under /api).

import type { Currency, Package, Usage } from "./types";

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

/** Fields the user can set when creating or editing a package. */
export interface PackageInput {
  name:        string;
  quantity:    number;
  time_known:  boolean;
  start_date:  string;            // "YYYY-MM-DD"
  expires_at:  string;            // "YYYY-MM-DD"
  notes:       string | null;
  category:    string | null;
  price_cents: number | null;
  currency:    Currency;
}

/** Fields when adding a usage entry. */
export interface UsageInput {
  amount: number;
  notes:  string | null;
}

export const api = {
  listPackages:  () =>
    request<Package[]>("/packages"),

  getPackage:    (id: string) =>
    request<Package>(`/packages/${encodeURIComponent(id)}`),

  listUsages:    (id: string) =>
    request<Usage[]>(`/packages/${encodeURIComponent(id)}/usages`),

  createPackage: (input: PackageInput) =>
    request<Package>("/packages", { method: "POST", body: input }),

  updatePackage: (id: string, input: PackageInput) =>
    request<Package>(`/packages/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body:   input,
    }),

  createUsage: (packageId: string, input: UsageInput) =>
    request<Usage>(
      `/packages/${encodeURIComponent(packageId)}/usages`,
      { method: "POST", body: input },
    ),

  updateUsage: (packageId: string, usageId: string, input: UsageInput) =>
    request<Usage>(
      `/packages/${encodeURIComponent(packageId)}/usages/${encodeURIComponent(usageId)}`,
      { method: "PATCH", body: input },
    ),

  deleteUsage: (packageId: string, usageId: string) =>
    request<void>(
      `/packages/${encodeURIComponent(packageId)}/usages/${encodeURIComponent(usageId)}`,
      { method: "DELETE" },
    ),
};
