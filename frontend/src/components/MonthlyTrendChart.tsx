// 12-month spend trend for a single currency.
//
// Twelve vertical bars sized proportionally to the busiest month in the
// section. Empty months render as just the month label (no bar). Each
// month carries its own editorial hue so the chart reads as a year at a
// glance; the current month is tinted with the accent color, taking
// precedence over the per-month color so "where we are in the year" still
// reads first.

import { formatPrice } from "../lib/pace";
import type { Currency, MonthlyTotal } from "../lib/types";

interface Props {
  currency: Currency;
  /** Up to 12 entries, one per month, all matching `currency`. Caller
   *  filters from the year payload. */
  totals: MonthlyTotal[];
  /** Year being shown — used to decide whether to highlight a "this month"
   *  column. The highlight only applies when `year` matches the current
   *  calendar year. */
  year: string;
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Per-month editorial palette. Twelve desaturated hues chosen to stay in
// the same register as the rest of the app (forest / gold / oxblood /
// slate / sage / moss / caramel / wine / pine / cocoa / bronze / olive).
// Deliberately avoids the accent green (#15803D) and the retired navy.
const MONTH_COLORS = [
  "#2E6F4F", // Jan — forest
  "#5C7F66", // Feb — moss
  "#5C7A52", // Mar — sage
  "#4A574A", // Apr — pine
  "#9C6B16", // May — antique gold
  "#9C7548", // Jun — caramel
  "#7C3A4F", // Jul — wine
  "#9E3527", // Aug — oxblood
  "#6B4538", // Sep — cocoa
  "#8E6B4A", // Oct — bronze
  "#5C544A", // Nov — slate
  "#3E4A38", // Dec — olive ink
];

export default function MonthlyTrendChart({ currency, totals, year }: Props) {
  // Build a dense `month → spent_cents` lookup. Backend already densifies
  // every currency it returns, but be defensive in case of stale clients.
  const byMonth = new Map(totals.map((t) => [t.month, t.spent_cents]));
  const values = Array.from({ length: 12 }, (_, i) => byMonth.get(i + 1) ?? 0);
  const max = Math.max(1, ...values);

  const now = new Date();
  const isCurrentYear = year === now.getUTCFullYear().toString().padStart(4, "0");
  const currentMonthIdx = isCurrentYear ? now.getUTCMonth() : -1; // 0..=11

  return (
    <div className="space-y-2" aria-label={`monthly spend trend in ${currency}`}>
      <div className="flex h-20 items-end gap-1.5">
        {values.map((v, i) => {
          const frac = v / max;
          // Min visible height for non-zero values so a quiet month is still
          // a visible mark, not invisible.
          const heightPct = v > 0 ? Math.max(3, frac * 100) : 0;
          const current = i === currentMonthIdx;
          const label = `${MONTH_LABELS[i]}: ${v > 0 ? formatPrice(v, currency) : "—"}`;
          return (
            <div
              key={i}
              className="flex h-full flex-1 items-end"
              title={label}
            >
              <div
                className={`w-full transition-all ${current ? "bg-accent" : ""}`}
                style={current ? { height: `${heightPct}%` } : { height: `${heightPct}%`, backgroundColor: MONTH_COLORS[i] }}
                aria-label={label}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5">
        {MONTH_LABELS.map((m, i) => {
          const current = i === currentMonthIdx;
          return (
            <div
              key={i}
              className={
                "flex-1 text-center text-[10px] uppercase tracking-micro " +
                (current ? "text-accent" : "text-ink-faint")
              }
            >
              {m}
            </div>
          );
        })}
      </div>
    </div>
  );
}
