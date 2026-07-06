// 12-month spend trend for a single currency.
//
// Twelve vertical bars sized proportionally to the busiest month in the
// section. Empty months render as just the month label (no bar). Each
// currency has its own identity color so multi-currency dashboards read
// as distinct at a glance. The current month is marked by tinting just
// its label in the brand accent — the bar stays in the currency color
// so identity reads first.
//
// A two-tick y-axis (`max → 0`) anchors the scale so a glance gives both
// shape and magnitude. The axis column is a fixed width so the bars
// line up horizontally across all currency sections on the same page;
// the labels themselves are blank when nothing was spent (so a cent-
// floor "$0.01" tick doesn't read as noise).

import { formatPrice, minorPerMajor } from "../lib/pace";
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

// One identity color per currency, drawn from the categorical palette
// (see src/lib/colors.ts). Green is deliberately absent so the brand
// accent's "current month" override still pops out against every chart.
const CURRENCY_BAR: Record<Currency, string> = {
  CNY: "#0D9488", // teal
  USD: "#B45309", // amber
  SGD: "#7C3AED", // violet
  JPY: "#BE123C", // rose
};

export default function MonthlyTrendChart({ currency, totals, year }: Props) {
  // Build a dense `month → spent_cents` lookup. Backend already densifies
  // every currency it returns, but be defensive in case of stale clients.
  const byMonth = new Map(totals.map((t) => [t.month, t.spent_cents]));
  const values = Array.from({ length: 12 }, (_, i) => byMonth.get(i + 1) ?? 0);
  const hasSpend = values.some((v) => v > 0);
  const max = Math.max(1, ...values);

  const now = new Date();
  const isCurrentYear = year === now.getUTCFullYear().toString().padStart(4, "0");
  const currentMonthIdx = isCurrentYear ? now.getUTCMonth() : -1; // 0..=11

  return (
    <div aria-label={`monthly spend trend in ${currency}`}>
      <div className="flex items-stretch gap-2">
        <div className="num flex h-20 w-10 shrink-0 flex-col justify-between text-right text-[10px] font-medium text-ink-faint tabular-nums">
          <span>{hasSpend ? formatPriceCompact(max, currency) : ""}</span>
          <span>{hasSpend ? "0" : ""}</span>
        </div>
        <div className="flex h-20 flex-1 items-end gap-1.5 border-b border-l border-hairline pl-1.5">
          {values.map((v, i) => {
            const frac = v / max;
            // Min visible height for non-zero values so a quiet month is still
            // a visible mark, not invisible.
            const heightPct = v > 0 ? Math.max(3, frac * 100) : 0;
            const valueLabel = v > 0 ? formatPrice(v, currency) : "—";
            const ariaLabel = `${MONTH_LABELS[i]}: ${valueLabel}`;
            return (
              <div
                key={i}
                className="group relative flex h-full flex-1 items-end"
              >
                <span
                  aria-hidden="true"
                  className="num pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-1.5 py-0.5 text-[10px] font-medium text-white opacity-0 transition-opacity tabular-nums group-hover:opacity-100"
                  style={{ bottom: `calc(${heightPct}% + 4px)` }}
                >
                  {valueLabel}
                </span>
                <div
                  className="w-full transition-all"
                  style={{ height: `${heightPct}%`, backgroundColor: CURRENCY_BAR[currency] }}
                  aria-label={ariaLabel}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-2 flex items-stretch gap-2">
        <div aria-hidden="true" className="w-10 shrink-0" />
        <div className="flex flex-1 gap-1.5 pl-1.5">
          {MONTH_LABELS.map((m, i) => {
            const current = i === currentMonthIdx;
            return (
              <div
                key={i}
                className={
                  "flex-1 text-center text-[10px] font-medium " +
                  (current ? "text-accent" : "text-ink-faint")
                }
              >
                {m}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Short magnitude label for axis ticks: "$1.8k", "¥520k", "$240". Uses
 *  the narrow symbol ($, ¥) instead of the locale-disambiguated prefix
 *  (S$, CN¥) — the currency section header already names the currency,
 *  so the axis doesn't need to. */
function formatPriceCompact(priceCents: number, currency: Currency): string {
  const major = priceCents / minorPerMajor(currency);
  return new Intl.NumberFormat(undefined, {
    style:                 "currency",
    currency,
    currencyDisplay:       "narrowSymbol",
    notation:              "compact",
    compactDisplay:        "short",
    maximumFractionDigits: 1,
  }).format(major);
}
