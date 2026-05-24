// ← 2026 → with a "this year" shortcut. Mirrors MonthSwitcher's editorial
// styling so the dashboard's two views feel like the same control set.

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

  const btn =
    "inline-flex items-center gap-1 border-b border-hairline pb-0.5 text-sm text-ink-dim " +
    "transition hover:border-accent hover:text-accent";

  return (
    <nav
      aria-label="Year navigation"
      className="flex items-baseline justify-between gap-4"
    >
      <div className="flex items-baseline gap-6">
        <button type="button" onClick={prev} className={btn}>
          <span aria-hidden="true">←</span> prev
        </button>
        <h2 className="serif text-lg leading-none text-ink">{year}</h2>
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
        this year
      </button>
    </nav>
  );
}

/** "YYYY" for the given Date in UTC. */
export function formatYear(d: Date): string {
  return d.getUTCFullYear().toString().padStart(4, "0");
}
