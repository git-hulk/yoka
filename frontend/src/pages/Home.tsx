// Subscriptions list. All rows are fetched once (paging past the server
// cap) and filtered/sorted/paginated client-side, so the filter chips and
// sort menu respond instantly. Chips only render for statuses that exist;
// sorting defaults to the app's core question: what expires soonest.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../lib/api";
import { filledFraction, statusLabel } from "../lib/pace";
import type { Status, Subscription } from "../lib/types";
import { useFetch } from "../lib/useFetch";
import Pagination from "../components/Pagination";
import SubscriptionCard from "../components/SubscriptionCard";
import { buttonClass } from "../components/ui";

const PAGE_SIZE = 10;

type Filter = "all" | Status;
type Sort = "expires" | "name" | "price" | "usage";

const SORT_LABELS: Record<Sort, string> = {
  expires: "Expires soon",
  name:    "Name",
  price:   "Price",
  usage:   "Most used",
};

const SORTERS: Record<Sort, (a: Subscription, b: Subscription) => number> = {
  expires: (a, b) => a.expires_at.localeCompare(b.expires_at),
  name:    (a, b) => a.name.localeCompare(b.name),
  price:   (a, b) => (b.price_cents ?? -1) - (a.price_cents ?? -1),
  usage:   (a, b) => filledFraction(b) - filledFraction(a),
};

// Chip order mirrors the lifecycle: live things first, history last.
const FILTER_ORDER: Status[] = ["active", "not_start", "done", "expired"];

export default function Home() {
  const [page, setPage]     = useState(1);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort]     = useState<Sort>("expires");
  const state = useFetch(() => api.listAllSubscriptions(), []);

  const all = state.status === "ok" ? state.data : null;

  const visible = useMemo(() => {
    if (!all) return null;
    const filtered = filter === "all" ? all : all.filter((s) => s.status === filter);
    return [...filtered].sort(SORTERS[sort]);
  }, [all, filter, sort]);

  const pageCount = visible ? Math.max(1, Math.ceil(visible.length / PAGE_SIZE)) : 1;
  if (visible && page > pageCount) setPage(pageCount);
  const pageItems = visible
    ? visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    : null;

  const pick = (f: Filter) => {
    setFilter(f);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <PageHeading count={all?.length ?? null} />

      {state.status === "loading" && <Skeleton />}

      {state.status === "error" && (
        <ErrorBox title="Couldn't load subscriptions" detail={state.error.message} />
      )}

      {state.status === "ok" && all && visible && pageItems && (
        all.length === 0 ? (
          <Empty />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <FilterChips all={all} filter={filter} onPick={pick} />
              <SortMenu
                sort={sort}
                onPick={(s) => {
                  setSort(s);
                  setPage(1);
                }}
              />
            </div>

            {visible.length === 0 ? (
              <div className="rounded-lg border border-hairline bg-subtle/40 px-4 py-8 text-center text-sm text-ink-dim">
                Nothing is {statusLabel(filter as Status)} right now.
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-hairline">
                <ColumnHeader />
                <ul className="divide-y divide-hairline">
                  {pageItems.map((s) => (
                    <li key={s.id}>
                      <SubscriptionCard sub={s} />
                    </li>
                  ))}
                </ul>
                {pageCount > 1 && (
                  <div className="border-t border-hairline bg-subtle/60 px-4 py-2">
                    <Pagination
                      page={page}
                      pageCount={pageCount}
                      total={visible.length}
                      pageStart={(page - 1) * PAGE_SIZE + 1}
                      pageEnd={(page - 1) * PAGE_SIZE + pageItems.length}
                      onChange={setPage}
                      ariaLabel="Subscription pagination"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}

function PageHeading({ count }: { count: number | null }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hairline pb-4">
      <div>
        <h1 className="text-xl font-medium tracking-tight text-ink">
          Subscriptions
        </h1>
        {count !== null && (
          <p className="num mt-1 text-xs text-ink-faint">
            {count} {count === 1 ? "subscription" : "subscriptions"}
          </p>
        )}
      </div>
      <Link to="/subscriptions/new" className={buttonClass("primary")}>
        <span aria-hidden="true" className="text-base leading-none">＋</span>
        New subscription
      </Link>
    </div>
  );
}

function FilterChips({
  all, filter, onPick,
}: {
  all:    Subscription[];
  filter: Filter;
  onPick: (f: Filter) => void;
}) {
  const counts = new Map<Status, number>();
  for (const s of all) counts.set(s.status, (counts.get(s.status) ?? 0) + 1);

  const chip = (active: boolean) =>
    "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition " +
    (active ? "bg-subtle text-ink" : "text-ink-dim hover:bg-subtle/60 hover:text-ink");

  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by status">
      <button
        type="button"
        onClick={() => onPick("all")}
        aria-pressed={filter === "all"}
        className={chip(filter === "all")}
      >
        All
        <span className="num text-2xs tabular-nums text-ink-faint">{all.length}</span>
      </button>
      {FILTER_ORDER.filter((st) => (counts.get(st) ?? 0) > 0).map((st) => (
        <button
          key={st}
          type="button"
          onClick={() => onPick(st)}
          aria-pressed={filter === st}
          className={chip(filter === st)}
        >
          {statusLabel(st)}
          <span className="num text-2xs tabular-nums text-ink-faint">
            {counts.get(st)}
          </span>
        </button>
      ))}
    </div>
  );
}

function SortMenu({ sort, onPick }: { sort: Sort; onPick: (s: Sort) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-ink-dim transition hover:bg-subtle hover:text-ink"
      >
        <span className="text-ink-faint">Sort</span>
        {SORT_LABELS[sort]}
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-3 text-ink-faint"
          aria-hidden="true"
        >
          <polyline points="4 6 8 10 12 6" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border border-hairline bg-white py-1 shadow-pop"
        >
          {(Object.keys(SORT_LABELS) as Sort[]).map((s) => (
            <button
              key={s}
              type="button"
              role="menuitemradio"
              aria-checked={s === sort}
              onClick={() => {
                onPick(s);
                setOpen(false);
              }}
              className={
                "mx-1 flex w-[calc(100%-0.5rem)] items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition " +
                (s === sort
                  ? "font-medium text-ink"
                  : "text-ink-dim hover:bg-subtle hover:text-ink")
              }
            >
              {SORT_LABELS[s]}
              {s === sort && (
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="size-3.5 shrink-0 text-accent"
                  aria-hidden="true"
                >
                  <polyline points="3 8.5 6.5 12 13 4.5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ColumnHeader() {
  return (
    <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(110px,1.3fr)_5.5rem_5rem] gap-5 border-b border-hairline bg-subtle/60 px-4 py-2 text-2xs font-medium uppercase tracking-micro text-ink-faint sm:grid-cols-[minmax(0,1.4fr)_minmax(140px,1.4fr)_5.5rem_5rem_5rem]">
      <span>Name</span>
      <span>Usage</span>
      <span>Status</span>
      <span className="hidden text-right sm:inline">Price</span>
      <span className="text-right">Expires</span>
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" className="overflow-hidden rounded-lg border border-hairline">
      <ColumnHeader />
      <ul className="divide-y divide-hairline">
        {[0, 1, 2, 3].map((i) => (
          <li
            key={i}
            className="grid grid-cols-[minmax(0,1.4fr)_minmax(110px,1.3fr)_5.5rem_5rem] items-center gap-5 px-4 py-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(140px,1.4fr)_5.5rem_5rem_5rem]"
          >
            <div className="h-4 w-40 animate-pulse rounded-sm bg-ink/5" />
            <div className="flex items-center gap-2.5">
              <div className="h-3 w-11 shrink-0 animate-pulse rounded-sm bg-ink/5" />
              <div className="h-1.5 flex-1 animate-pulse rounded-sm bg-ink/5" />
            </div>
            <div className="h-3 w-14 animate-pulse rounded-sm bg-ink/5" />
            <div className="hidden h-4 animate-pulse rounded-sm bg-ink/5 sm:block" />
            <div className="h-4 animate-pulse rounded-sm bg-ink/5" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Empty() {
  return (
    <div className="rounded-lg border border-dashed border-hairline bg-subtle/40 px-6 py-12 text-center">
      <p className="text-base font-medium text-ink">No subscriptions yet.</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-ink-dim">
        Add a prepaid subscription and it'll show up here, with its pace as it
        burns down.
      </p>
      <Link
        to="/subscriptions/new"
        className={buttonClass("primary", "md", "mt-5")}
      >
        <span aria-hidden="true">＋</span>
        Add the first one
      </Link>
    </div>
  );
}

function ErrorBox({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-pace-red/40 bg-pace-red/5 px-4 py-3">
      <p className="text-sm font-medium text-pace-red">{title}</p>
      <p className="mt-0.5 text-xs text-ink-dim">{detail}</p>
    </div>
  );
}
