// Editorial pager — extracted from Home.tsx so the Finance page can reuse
// the exact same styling and behavior. `label` is used in the row summary
// ("12–24 of 87 subscriptions") so callers can match the entity noun.

interface Props {
  page:      number;
  pageCount: number;
  total:     number;
  pageStart: number;
  pageEnd:   number;
  onChange:  (p: number) => void;
  /** ARIA label for the <nav>; e.g. "Subscription pagination". */
  ariaLabel?: string;
}

export default function Pagination({
  page, pageCount, total, pageStart, pageEnd, onChange, ariaLabel = "Pagination",
}: Props) {
  const prev = () => onChange(Math.max(1, page - 1));
  const next = () => onChange(Math.min(pageCount, page + 1));
  const btn =
    "inline-flex items-center gap-1 border-b border-hairline pb-0.5 text-sm text-ink-dim " +
    "transition hover:border-accent hover:text-accent disabled:cursor-not-allowed " +
    "disabled:border-transparent disabled:text-ink-faint disabled:hover:text-ink-faint";
  return (
    <nav
      aria-label={ariaLabel}
      className="mt-5 flex items-center justify-between gap-4"
    >
      <p className="num text-[11px] uppercase tracking-micro text-ink-faint">
        {pageStart}–{pageEnd} of {total}
      </p>
      <div className="flex items-center gap-5">
        <button type="button" onClick={prev} disabled={page <= 1} className={btn}>
          <span aria-hidden="true">←</span> prev
        </button>
        <span className="num text-[11px] uppercase tracking-micro text-ink-faint">
          page {page} / {pageCount}
        </span>
        <button type="button" onClick={next} disabled={page >= pageCount} className={btn}>
          next <span aria-hidden="true">→</span>
        </button>
      </div>
    </nav>
  );
}
