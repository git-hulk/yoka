// Three-button month nav: ← prev | "May 2026" | next → with a "Today"
// shortcut on the right. GH-flavored pager: rounded segmented control.

interface Props {
  /** Current month as "YYYY-MM". */
  month: string;
  onChange: (month: string) => void;
}

export default function MonthSwitcher({ month, onChange }: Props) {
  const { year, monthIdx } = parseMonth(month);
  const label = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year:  "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthIdx, 1)));

  const prev = () => onChange(shift(month, -1));
  const next = () => onChange(shift(month,  1));
  const today = formatMonth(new Date());
  const isToday = month === today;

  return (
    <nav aria-label="Month navigation" className="flex items-center gap-2">
      <div className="inline-flex h-8 overflow-hidden rounded-md border border-hairline bg-white">
        <button
          type="button"
          onClick={prev}
          aria-label="Previous month"
          className="inline-flex h-full w-8 items-center justify-center text-ink-dim transition hover:bg-subtle hover:text-ink"
        >
          <span aria-hidden="true">←</span>
        </button>
        <span aria-hidden="true" className="w-px bg-hairline" />
        <span className="inline-flex h-full min-w-[8rem] items-center justify-center px-3 text-sm font-medium text-ink">
          {label}
        </span>
        <span aria-hidden="true" className="w-px bg-hairline" />
        <button
          type="button"
          onClick={next}
          aria-label="Next month"
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
        Today
      </button>
    </nav>
  );
}

/** "YYYY-MM" for the given Date in UTC. */
export function formatMonth(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  return `${y}-${m}`;
}

/** Shift a "YYYY-MM" by `delta` months. */
export function shift(month: string, delta: number): string {
  const { year, monthIdx } = parseMonth(month);
  const total = year * 12 + monthIdx + delta;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  return `${ny.toString().padStart(4, "0")}-${(nm + 1).toString().padStart(2, "0")}`;
}

function parseMonth(s: string): { year: number; monthIdx: number } {
  const [y, m] = s.split("-").map((n) => parseInt(n, 10));
  return { year: y, monthIdx: m - 1 };
}
