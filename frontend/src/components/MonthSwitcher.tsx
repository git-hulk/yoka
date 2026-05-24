// Three-button month nav: ← prev | "May 2026" | next → with a "today"
// shortcut on the right. Matches the editorial pager: hairline borders,
// uppercase micro-tracking labels, accent on hover.

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

  const btn =
    "inline-flex items-center gap-1 border-b border-hairline pb-0.5 text-sm text-ink-dim " +
    "transition hover:border-accent hover:text-accent";

  return (
    <nav
      aria-label="Month navigation"
      className="flex items-baseline justify-between gap-4"
    >
      <div className="flex items-baseline gap-6">
        <button type="button" onClick={prev} className={btn}>
          <span aria-hidden="true">←</span> prev
        </button>
        <h2 className="serif text-lg leading-none text-ink">{label}</h2>
        <button type="button" onClick={next} className={btn}>
          next <span aria-hidden="true">→</span>
        </button>
      </div>
      <button
        type="button"
        onClick={() => onChange(today)}
        disabled={isToday}
        className={
          "text-[11px] uppercase tracking-micro text-ink-faint transition " +
          "hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 " +
          "disabled:hover:text-ink-faint"
        }
      >
        today
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
