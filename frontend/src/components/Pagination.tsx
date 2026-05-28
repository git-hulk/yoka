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
    "inline-flex h-7 items-center gap-1 rounded-md border border-hairline bg-white px-2.5 text-sm font-medium " +
    "text-ink-dim transition hover:bg-subtle hover:text-ink " +
    "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-ink-dim";
  return (
    <nav
      aria-label={ariaLabel}
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <p className="num text-xs text-ink-faint">
        {pageStart}–{pageEnd} of {total}
      </p>
      <div className="flex items-center gap-2">
        <button type="button" onClick={prev} disabled={page <= 1} className={btn}>
          <span aria-hidden="true">←</span> Prev
        </button>
        <span className="num text-xs text-ink-faint">
          Page {page} / {pageCount}
        </span>
        <button type="button" onClick={next} disabled={page >= pageCount} className={btn}>
          Next <span aria-hidden="true">→</span>
        </button>
      </div>
    </nav>
  );
}
