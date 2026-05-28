// ← 2026 → with a "this year" shortcut. Mirrors MonthSwitcher so the
// dashboard's two views feel like the same control set.

interface Props {
  /** Current year as "YYYY". */
  year: string;
  onChange: (year: string) => void;
}

export default function YearSwitcher({ year, onChange }: Props) {
  const numeric = parseInt(year, 10);
  const prev = () => onChange(String(numeric - 1).padStart(4, "0"));
  const next = () => onChange(String(numeric + 1).padStart(4, "0"));
  const today = formatYear(new Date());
  const isToday = year === today;

  return (
    <nav aria-label="Year navigation" className="flex items-center gap-2">
      <div className="inline-flex h-8 overflow-hidden rounded-md border border-hairline bg-white">
        <button
          type="button"
          onClick={prev}
          aria-label="Previous year"
          className="inline-flex h-full w-8 items-center justify-center text-ink-dim transition hover:bg-subtle hover:text-ink"
        >
          <span aria-hidden="true">←</span>
        </button>
        <span aria-hidden="true" className="w-px bg-hairline" />
        <span className="num inline-flex h-full min-w-[4.5rem] items-center justify-center px-3 text-sm font-semibold tabular-nums text-ink">
          {year}
        </span>
        <span aria-hidden="true" className="w-px bg-hairline" />
        <button
          type="button"
          onClick={next}
          aria-label="Next year"
          className="inline-flex h-full w-8 items-center justify-center text-ink-dim transition hover:bg-subtle hover:text-ink"
        >
          <span aria-hidden="true">→</span>
        </button>
      </div>
      <button
        type="button"
        onClick={() => onChange(today)}
        disabled={isToday}
        className="inline-flex h-8 items-center rounded-md border border-hairline bg-white px-3 text-sm font-medium text-ink-dim transition hover:bg-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        This year
      </button>
    </nav>
  );
}

/** "YYYY" for the given Date in UTC. */
export function formatYear(d: Date): string {
  return d.getUTCFullYear().toString().padStart(4, "0");
}
