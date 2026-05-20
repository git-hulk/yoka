// Presentation-layer derivations from a Package.
//
// Two things the backend status alone can't tell us:
//   1. Color/urgency: design layers a "<=14 days left" red over the
//      backend status. The backend's job is "are you tracking right?";
//      urgency is a UI concern.
//   2. Tick position: where the filled bar edge should be *right now* if
//      you finish exactly at expiry. Requires the package's start date
//      (start_date) which the backend already exposes.

import type { Currency, Package, Status } from "./types";

export type PaceColor = "green" | "amber" | "red";

export const URGENT_DAYS = 14;

/** Color used by the bar fill and the status pill. */
export function paceColor(pkg: Package): PaceColor {
  if (pkg.status === "done")      return "green";
  if (pkg.status === "expired")   return "red";
  if (pkg.status === "not_start") return "amber";

  // Active: urgency override at <= 14 days remaining.
  if (pkg.days_until_expiry <= URGENT_DAYS) return "red";
  return "green";
}

/** Short human label for the status pill. */
export function statusLabel(status: Status): string {
  switch (status) {
    case "active":    return "active";
    case "not_start": return "inactive";
    case "done":      return "done";
    case "expired":   return "expired";
  }
}

/**
 * Fraction of `quantity` already consumed, in 0..1. Over-consumption (which
 * shouldn't happen) reads as full.
 *
 * Duration mode has no quantity: `consumed` and `remaining` are days, and
 * fill is just `consumed / (consumed + remaining)`.
 */
export function filledFraction(pkg: Package): number {
  if (pkg.tracking_mode === "duration") {
    const total = pkg.consumed + pkg.remaining;
    if (total <= 0) return 0;
    return clamp01(pkg.consumed / total);
  }
  if (pkg.quantity == null || pkg.quantity <= 0) return 0;
  return clamp01(pkg.consumed / pkg.quantity);
}

/**
 * Fraction along the bar where the pace tick belongs, in 0..1.
 *
 * "Where the filled edge should be right now if you finish exactly at
 * expiry" = elapsed_days / total_days.
 *
 * Returns `null` when the tick is meaningless: zero-length packages, before
 * the start, or duration packages (where fill IS pace by definition, so a
 * separate marker would just sit on the fill edge).
 */
export function tickFraction(pkg: Package, now: Date = new Date()): number | null {
  if (pkg.tracking_mode === "duration") return null;

  const start  = parseDateStartOfDayUtc(pkg.start_date).getTime();
  const expiry = parseExpiryEndOfDayUtc(pkg.expires_at).getTime();
  const t      = now.getTime();

  const total = expiry - start;
  if (total <= 0) return null;

  const elapsed = t - start;
  if (elapsed < 0) return null;

  return clamp01(elapsed / total);
}

/** Compact bar anchor: "3w left", "5d left", "expired 4d ago". */
export function timeToExpiryLabel(pkg: Package): string {
  const d = pkg.days_until_expiry;
  if (d <  0) return `expired ${Math.abs(d)}d ago`;
  if (d === 0) return "expires today";
  if (d <  7)  return `${d}d left`;
  if (d <  60) return `${Math.round(d / 7)}w left`;
  return `${Math.round(d / 30)}mo left`;
}

/** Detail-page anchor: "expires in 42 days", "expires today", "expired 4 days ago". */
export function timeToExpiryVerbose(pkg: Package): string {
  const d = pkg.days_until_expiry;
  if (d <  0)  return `expired ${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"} ago`;
  if (d === 0) return "expires today";
  return `expires in ${d} day${d === 1 ? "" : "s"}`;
}

/** Subtitle date: "expires Jun 30" (no year), "expires Jun 30, 2027" otherwise. */
export function expiryShortLabel(pkg: Package, now: Date = new Date()): string {
  const [y, m, d] = pkg.expires_at.split("-").map((n) => parseInt(n, 10));
  const sameYear  = y === now.getFullYear();
  const fmt = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day:   "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
  return `expires ${fmt.format(new Date(Date.UTC(y, m - 1, d)))}`;
}

/** Minor units per major for a currency. JPY has no fractional subunit
 *  (1 yen IS the minor unit); everyone else here is 100 cents per major. */
export function minorPerMajor(currency: Currency): number {
  return currency === "JPY" ? 1 : 100;
}

/** "$180" / "$180.50" / "¥5,000" / null for free or unknown. Drops trailing
 *  zero fractions for cleaner editorial display (e.g. "$180" not "$180.00"). */
export function formatPrice(
  priceCents: number | null,
  currency:   Currency,
): string | null {
  if (priceCents === null || priceCents === undefined) return null;
  const major = priceCents / minorPerMajor(currency);
  const whole = Number.isInteger(major);
  return new Intl.NumberFormat(undefined, {
    style:                 "currency",
    currency,
    maximumFractionDigits: whole ? 0 : undefined,
    minimumFractionDigits: whole ? 0 : undefined,
  }).format(major);
}

/** "4 used" vs "4.5 used" — show decimal only when fractional.
 *  Duration mode reads in days: "30 days in". */
export function usedLabel(pkg: Package): string {
  if (pkg.tracking_mode === "duration") {
    return `${formatAmount(pkg.consumed)} days in`;
  }
  return `${formatAmount(pkg.consumed)} used`;
}

/** "3/10" — consumed over quantity, decimals only when fractional.
 *  For duration packs we render days elapsed / total. */
export function usageRatioLabel(pkg: Package): string {
  if (pkg.tracking_mode === "duration") {
    const total = pkg.consumed + pkg.remaining;
    return `${formatAmount(pkg.consumed)}/${formatAmount(total)}d`;
  }
  return `${formatAmount(pkg.consumed)}/${formatAmount(pkg.quantity ?? 0)}`;
}

export function remainingLabel(pkg: Package): string {
  return formatAmount(pkg.remaining);
}

/** Usage row primary line: "Tue, May 12". */
export function formatUsageDay(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month:   "short",
    day:     "numeric",
  }).format(new Date(iso));
}

/** Usage row time: "7:00 PM" in the user's locale. */
export function formatUsageTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour:   "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

function formatAmount(n: number): string {
  // 4.0 → "4"; 4.5 → "4.5"; 4.25 → "4.25"
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/**
 * Treat `YYYY-MM-DD` expiry as end-of-day UTC. A package expiring on
 * 2026-06-30 is still valid through that whole day; pinning to 00:00 would
 * mark it expired a day early.
 */
function parseExpiryEndOfDayUtc(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
}

function parseDateStartOfDayUtc(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}
