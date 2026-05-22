import { useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../lib/api";
import { useFetch } from "../lib/useFetch";
import SubscriptionCard from "../components/SubscriptionCard";

const PAGE_SIZE = 10;

export default function Home() {
  const [page, setPage] = useState(1);
  const state = useFetch(
    () => api.listSubscriptions({ page, perPage: PAGE_SIZE }),
    [page],
  );

  const total = state.status === "ok" ? state.data.total : null;
  const pageCount =
    total === null ? 1 : Math.max(1, Math.ceil(total / PAGE_SIZE));

  // If a delete drops the row count past the current page, fall back one.
  if (state.status === "ok" && page > pageCount) {
    setPage(pageCount);
  }

  return (
    <div className="space-y-10">
      <PageHeading count={total} />

      {state.status === "loading" && <Skeleton />}

      {state.status === "error" && (
        <ErrorBox title="Couldn't load subscriptions" detail={state.error.message} />
      )}

      {state.status === "ok" && (
        state.data.total === 0 ? (
          <Empty />
        ) : (
          <div>
            <ColumnHeader />
            <ul className="border-y border-hairline divide-y divide-hairline">
              {state.data.items.map((s) => (
                <li key={s.id}>
                  <SubscriptionCard sub={s} />
                </li>
              ))}
            </ul>
            {pageCount > 1 && (
              <Pagination
                page={page}
                pageCount={pageCount}
                total={state.data.total}
                pageStart={(page - 1) * PAGE_SIZE + 1}
                pageEnd={(page - 1) * PAGE_SIZE + state.data.items.length}
                onChange={setPage}
              />
            )}
          </div>
        )
      )}
    </div>
  );
}

function Pagination({
  page, pageCount, total, pageStart, pageEnd, onChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageStart: number;
  pageEnd: number;
  onChange: (p: number) => void;
}) {
  const prev = () => onChange(Math.max(1, page - 1));
  const next = () => onChange(Math.min(pageCount, page + 1));
  const btn =
    "inline-flex items-center gap-1 border-b border-hairline pb-0.5 text-sm text-ink-dim " +
    "transition hover:border-accent hover:text-accent disabled:cursor-not-allowed " +
    "disabled:border-transparent disabled:text-ink-faint disabled:hover:text-ink-faint";
  return (
    <nav
      aria-label="Subscription pagination"
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

function PageHeading({ count }: { count: number | null }) {
  return (
    <div className="flex items-end justify-between gap-4 border-b border-hairline pb-4">
      <div>
        <h1 className="serif text-base font-bold leading-none text-ink">
          Subscriptions
        </h1>
        {count !== null && (
          <p className="num mt-3 text-[11px] uppercase tracking-micro text-ink-faint">
            {count} {count === 1 ? "subscription" : "subscriptions"}
          </p>
        )}
      </div>
      <Link
        to="/subscriptions/new"
        className="inline-flex items-baseline gap-1.5 border-b border-ink pb-0.5 text-sm font-medium text-ink transition hover:border-accent hover:text-accent"
      >
        <span aria-hidden="true" className="text-base leading-none">＋</span>
        new subscription
      </Link>
    </div>
  );
}

function ColumnHeader() {
  return (
    <div className="-mx-4 grid grid-cols-[minmax(0,1.4fr)_minmax(110px,1.3fr)_5.5rem_5rem] gap-5 px-4 pb-3 text-[11px] uppercase tracking-micro text-ink-faint sm:grid-cols-[minmax(0,1.4fr)_minmax(140px,1.4fr)_5.5rem_5rem_5rem]">
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
    <div aria-busy="true">
      <ColumnHeader />
      <ul className="border-y border-hairline divide-y divide-hairline">
        {[0, 1, 2, 3].map((i) => (
          <li
            key={i}
            className="-mx-4 grid grid-cols-[minmax(0,1.4fr)_minmax(110px,1.3fr)_5.5rem_5rem] items-center gap-5 px-4 py-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(140px,1.4fr)_5.5rem_5rem_5rem]"
          >
            <div className="h-5 w-40 animate-pulse rounded-sm bg-ink/5" />
            <div className="space-y-2">
              <div className="h-2 w-8 animate-pulse rounded-sm bg-ink/5" />
              <div className="h-2.5 animate-pulse rounded-sm bg-ink/5" />
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
    <div className="pt-6 text-center">
      <p className="serif text-base font-semibold text-ink">No subscriptions yet.</p>
      <p className="mt-3 text-sm text-ink-dim">
        Add a prepaid subscription and it'll show up here,<br className="hidden sm:inline" />
        with its pace as it burns down.
      </p>
      <Link
        to="/subscriptions/new"
        className="mt-7 inline-flex items-baseline gap-1.5 border-b border-ink pb-0.5 text-sm font-medium text-ink transition hover:border-accent hover:text-accent"
      >
        <span aria-hidden="true">＋</span>
        add the first one
      </Link>
    </div>
  );
}

function ErrorBox({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="border-y border-pace-red/40 bg-pace-red/5 px-1 py-5">
      <p className="text-sm font-semibold text-pace-red">{title}</p>
      <p className="mt-1 text-xs text-ink-dim">{detail}</p>
    </div>
  );
}
