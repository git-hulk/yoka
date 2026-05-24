// One row: category, currency-formatted spent / budget, and a hairline
// progress bar. Color tracks status:
//   < 80%  → pace.green
//   80–99% → pace.amber
//   >= 100% → pace.red
// When `budget_cents` is null we render in grey with no fill — there's
// nothing to compare against.

import { formatPrice } from "../lib/pace";
import type { BudgetBar as BudgetBarData } from "../lib/types";

interface Props {
  bar: BudgetBarData;
  /** Click handler for the inline-edit affordance. The page wires this to
   *  open an edit input; the bar component stays presentational. */
  onEdit?: () => void;
}

export default function BudgetBar({ bar, onEdit }: Props) {
  const hasBudget = bar.budget_cents !== null && bar.budget_cents > 0;
  const fraction  = hasBudget && bar.budget_cents
    ? Math.min(1, bar.spent_cents / bar.budget_cents)
    : 0;
  const overspent = hasBudget && bar.budget_cents && bar.spent_cents > bar.budget_cents;
  const pct       = Math.round(fraction * 100);

  // Color tiers. Threshold matches the editorial convention used by
  // `paceColor`: <80% green, 80–99% amber, ≥100% red.
  let fillClass = "bg-pace-green";
  let trackClass = "bg-track-green";
  if (hasBudget) {
    if (fraction >= 1)        { fillClass = "bg-pace-red";   trackClass = "bg-track-red"; }
    else if (fraction >= 0.8) { fillClass = "bg-pace-amber"; trackClass = "bg-track-amber"; }
  } else {
    fillClass = "";
    trackClass = "bg-track-neutral";
  }

  const label = bar.category || "Uncategorized";
  const spent = formatPrice(bar.spent_cents, bar.currency);
  const budget = hasBudget && bar.budget_cents !== null
    ? formatPrice(bar.budget_cents, bar.currency)
    : null;

  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-sm text-ink">{label}</p>
        <p className="num text-sm tabular-nums text-ink-dim">
          <span className={overspent ? "text-pace-red" : ""}>{spent}</span>
          {budget && (
            <>
              <span className="mx-1 text-ink-faint">/</span>
              <button
                type="button"
                onClick={onEdit}
                aria-label={`edit budget for ${label}`}
                className="border-b border-hairline pb-0.5 text-ink-dim transition hover:border-accent hover:text-accent"
              >
                {budget}
              </button>
            </>
          )}
          {!budget && onEdit && (
            <>
              <span className="mx-1 text-ink-faint">/</span>
              <button
                type="button"
                onClick={onEdit}
                aria-label={`set budget for ${label}`}
                className="text-[11px] uppercase tracking-micro text-ink-faint transition hover:text-accent"
              >
                set budget
              </button>
            </>
          )}
        </p>
      </div>
      <div className={`mt-2 h-1 w-full ${trackClass}`} role="progressbar"
           aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        {hasBudget && (
          <div
            className={`h-full ${fillClass}`}
            style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
          />
        )}
      </div>
    </div>
  );
}
