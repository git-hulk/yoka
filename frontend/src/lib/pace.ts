// Presentation-layer derivations from a Subscription.
//
// Two things the backend status alone can't tell us:
//   1. Color/urgency: design layers a "<=14 days left" red over the
//      backend status. The backend's job is "are you tracking right?";
//      urgency is a UI concern.
//   2. Tick position: where the filled bar edge should be *right now* if
//      you finish exactly at expiry. Requires the subscription's start date
//      (start_date) which the backend already exposes.

import type { Currency, Status, Subscription, Usage } from "./types";

export type PaceColor = "green" | "amber" | "red";

export const URGENT_DAYS = 14;

/** Color used by the bar fill and the status pill. */
export function paceColor(sub: Subscription): PaceColor {
  if (sub.status === "done")      return "green";
  if (sub.status === "expired")   return "red";
  if (sub.status === "not_start") return "amber";

  // Active: urgency override at <= 14 days remaining.
  if (sub.days_until_expiry <= URGENT_DAYS) return "red";
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
export function filledFraction(sub: Subscription): number {
  if (sub.tracking_mode === "duration") {
    const total = sub.consumed + sub.remaining;
    if (total <= 0) return 0;
    return clamp01(sub.consumed / total);
  }
  if (sub.quantity == null || sub.quantity <= 0) return 0;
  return clamp01(sub.consumed / sub.quantity);
}

/**
 * Fraction along the bar where the pace tick belongs, in 0..1.
 *
 * "Where the filled edge should be right now if you finish exactly at
 * expiry" = elapsed_days / total_days.
 *
 * Returns `null` when the tick is meaningless: zero-length subscriptions, before
 * the start, or duration subscriptions (where fill IS pace by definition, so a
 * separate marker would just sit on the fill edge).
 */
export function tickFraction(sub: Subscription, now: Date = new Date()): number | null {
  if (sub.tracking_mode === "duration") return null;

  const start  = parseDateStartOfDayUtc(sub.start_date).getTime();
  const expiry = parseExpiryEndOfDayUtc(sub.expires_at).getTime();
  const t      = now.getTime();

  const total = expiry - start;
  if (total <= 0) return null;

  const elapsed = t - start;
  if (elapsed < 0) return null;

  return clamp01(elapsed / total);
}

/** Compact bar anchor: "3w left", "5d left", "expired 4d ago". */
export function timeToExpiryLabel(sub: Subscription): string {
  const d = sub.days_until_expiry;
  if (d <  0) return `expired ${Math.abs(d)}d ago`;
  if (d === 0) return "expires today";
  if (d <  7)  return `${d}d left`;
  if (d <  60) return `${Math.round(d / 7)}w left`;
  return `${Math.round(d / 30)}mo left`;
}

/** Detail-page anchor: "expires in 42 days", "expires today", "expired 4 days ago". */
export function timeToExpiryVerbose(sub: Subscription): string {
  const d = sub.days_until_expiry;
  if (d <  0)  return `expired ${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"} ago`;
  if (d === 0) return "expires today";
  return `expires in ${d} day${d === 1 ? "" : "s"}`;
}

/** Subtitle date: "expires Jun 30" (no year), "expires Jun 30, 2027" otherwise. */
export function expiryShortLabel(sub: Subscription, now: Date = new Date()): string {
  const [y, m, d] = sub.expires_at.split("-").map((n) => parseInt(n, 10));
  const sameYear  = y === now.getFullYear();
  const fmt = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day:   "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
  return `expires ${fmt.format(new Date(Date.UTC(y, m - 1, d)))}`;
}

/** "May 1 → Jun 15" — the subscription's lifespan as an editorial range. Year shown
 *  when either endpoint is in a different year than now. */
export function activeWindowLabel(sub: Subscription, now: Date = new Date()): string {
  const [sy] = sub.start_date.split("-").map((n) => parseInt(n, 10));
  const [ey] = sub.expires_at.split("-").map((n) => parseInt(n, 10));
  const includeYear = sy !== now.getFullYear() || ey !== now.getFullYear();
  return `${formatYmd(sub.start_date, includeYear)} → ${formatYmd(sub.expires_at, includeYear)}`;
}

/** Cost per unit, derived. Returns null when missing inputs or in duration mode. */
export function formatPricePerUse(sub: Subscription): string | null {
  if (sub.tracking_mode === "duration") return null;
  if (sub.price_cents == null || sub.price_cents <= 0) return null;
  if (sub.quantity == null || sub.quantity <= 0) return null;
  const perUnit = (sub.price_cents / minorPerMajor(sub.currency)) / sub.quantity;
  const formatted = new Intl.NumberFormat(undefined, {
    style:                 "currency",
    currency:              sub.currency,
    maximumFractionDigits: perUnit >= 10 ? 0 : 2,
    minimumFractionDigits: 0,
  }).format(perUnit);
  return sub.tracking_mode === "hours" ? `${formatted}/hr` : `${formatted} each`;
}

/**
 * One editorial sentence projecting forward from recent usage.
 * Returns null when the projection would be uninformative (duration mode,
 * status already covered by the pill, no signal to project from).
 */
export function paceNarrative(
  sub:    Subscription,
  usages: Usage[],
  now:    Date = new Date(),
): string | null {
  if (sub.tracking_mode === "duration") return null;
  if (sub.status === "done")             return null;
  if (sub.status === "not_start")        return null;

  const unit = sub.tracking_mode === "hours" ? "hr" : "";

  if (sub.status === "expired") {
    if (sub.remaining > 0) {
      const noun = sub.tracking_mode === "hours" ? "unused" : "unused";
      const amt  = formatAmount(roundTo1(sub.remaining));
      return sub.tracking_mode === "hours"
        ? `${amt}hr ${noun} at expiry.`
        : `${amt} ${noun} at expiry.`;
    }
    return null;
  }

  // Active.
  const recent = recentPacePerDay(usages, 14, now);

  if (recent === null) {
    // No recent usage; surface the required pace if any.
    const need = sub.required_pace_per_day;
    if (need == null || need <= 0) return null;
    return `Need ${formatAmount(roundTo2(need))}${unit}/day to finish on time.`;
  }

  if (recent <= 0 || sub.days_until_expiry <= 0) return null;

  const paceStr   = formatAmount(roundTo2(recent));
  const projected = recent * sub.days_until_expiry;
  const leftover  = sub.remaining - projected;

  // Will finish before expiry.
  if (projected >= sub.remaining + 0.5) {
    const days = Math.max(1, Math.round(sub.remaining / recent));
    const diff = sub.days_until_expiry - days;
    if (diff <= 1) return `At ${paceStr}${unit}/day, finishing right at expiry.`;
    return `At ${paceStr}${unit}/day, you'll finish ${diff} days early.`;
  }

  // Will leave some at expiry.
  if (leftover > 0.5) {
    const left = formatAmount(roundTo1(leftover));
    return sub.tracking_mode === "hours"
      ? `At ${paceStr}hr/day, ~${left}hr will go unused.`
      : `At ${paceStr}/day, ~${left} will go unused.`;
  }

  return `At ${paceStr}${unit}/day, finishing right at expiry.`;
}

/** Cadence facts: last-used label, sessions this week, avg gap. Null when there are no usages. */
export interface Cadence {
  lastUsedLabel:    string;
  sessionsThisWeek: number;
  avgGapDays:       number | null;
}

export function computeCadence(usages: Usage[], now: Date = new Date()): Cadence | null {
  if (usages.length === 0) return null;

  // Usages arrive newest-first from the API.
  const last        = new Date(usages[0].created_at);
  const lastDaysAgo = Math.floor((startOfDay(now).getTime() - startOfDay(last).getTime()) / 86400000);

  const dayName = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(last);
  const lastUsedLabel =
    lastDaysAgo <= 0 ? `${dayName}, today`
    : lastDaysAgo === 1 ? `${dayName}, yesterday`
    : `${dayName}, ${lastDaysAgo} days ago`;

  const weekAgoMs = now.getTime() - 7 * 86400000;
  let sessionsThisWeek = 0;
  for (const u of usages) {
    if (new Date(u.created_at).getTime() < weekAgoMs) break;
    sessionsThisWeek++;
  }

  let avgGapDays: number | null = null;
  if (usages.length >= 2) {
    const sample = usages.slice(0, Math.min(10, usages.length));
    let totalGap = 0;
    let gaps     = 0;
    for (let i = 0; i < sample.length - 1; i++) {
      const a = new Date(sample[i].created_at).getTime();
      const b = new Date(sample[i + 1].created_at).getTime();
      totalGap += (a - b) / 86400000;
      gaps++;
    }
    if (gaps > 0) avgGapDays = Math.max(1, Math.round(totalGap / gaps));
  }

  return { lastUsedLabel, sessionsThisWeek, avgGapDays };
}

/** Daily binned amounts for the sparkline, oldest → newest, length = `days`.
 *  Today is the last bin. Empty days are 0. */
export function dailyUsageBins(
  usages: Usage[],
  days:   number,
  now:    Date = new Date(),
): number[] {
  const bins = new Array<number>(days).fill(0);
  const todayStart = startOfDay(now).getTime();
  for (const u of usages) {
    const t   = startOfDay(new Date(u.created_at)).getTime();
    const idx = days - 1 - Math.round((todayStart - t) / 86400000);
    if (idx >= 0 && idx < days) bins[idx] += u.amount;
  }
  return bins;
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
export function usedLabel(sub: Subscription): string {
  if (sub.tracking_mode === "duration") {
    return `${formatAmount(sub.consumed)} days in`;
  }
  return `${formatAmount(sub.consumed)} used`;
}

/** "3/10" — consumed over quantity, decimals only when fractional.
 *  For duration subscriptions we render days elapsed / total. */
export function usageRatioLabel(sub: Subscription): string {
  if (sub.tracking_mode === "duration") {
    const total = sub.consumed + sub.remaining;
    return `${formatAmount(sub.consumed)}/${formatAmount(total)}d`;
  }
  return `${formatAmount(sub.consumed)}/${formatAmount(sub.quantity ?? 0)}`;
}

export function remainingLabel(sub: Subscription): string {
  return formatAmount(sub.remaining);
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

function roundTo1(n: number): number { return Math.round(n * 10)  / 10;  }
function roundTo2(n: number): number { return Math.round(n * 100) / 100; }

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function formatYmd(yyyyMmDd: string, withYear: boolean): string {
  const [y, m, d] = yyyyMmDd.split("-").map((n) => parseInt(n, 10));
  return new Intl.DateTimeFormat(undefined, {
    month:    "short",
    day:      "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Recent pace per day over the trailing `windowDays`. Returns null when the
 *  window contains no usages (caller surfaces the required pace instead). */
function recentPacePerDay(usages: Usage[], windowDays: number, now: Date): number | null {
  const startMs = now.getTime() - windowDays * 86400000;
  let sum = 0;
  let n   = 0;
  for (const u of usages) {
    const t = new Date(u.created_at).getTime();
    if (t < startMs) break;
    sum += u.amount;
    n++;
  }
  if (n === 0) return null;
  return sum / windowDays;
}

/**
 * Treat `YYYY-MM-DD` expiry as end-of-day UTC. A subscription expiring on
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
