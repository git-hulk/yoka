import { useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../lib/api";
import { useFetch } from "../lib/useFetch";
import Pagination from "../components/Pagination";
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
    <div className="space-y-6">
      <PageHeading count={total} />

      {state.status === "loading" && <Skeleton />}

      {state.status === "error" && (
        <ErrorBox title="Couldn't load subscriptions" detail={state.error.message} />
      )}

      {state.status === "ok" && (
        state.data.total === 0 ? (
          <Empty />
        ) : (
          <div className="overflow-hidden rounded-lg border border-hairline">
            <ColumnHeader />
            <ul className="divide-y divide-hairline">
              {state.data.items.map((s) => (
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
                  total={state.data.total}
                  pageStart={(page - 1) * PAGE_SIZE + 1}
                  pageEnd={(page - 1) * PAGE_SIZE + state.data.items.length}
                  onChange={setPage}
                  ariaLabel="Subscription pagination"
                />
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
      <Link
        to="/subscriptions/new"
        className="inline-flex h-8 items-center gap-1 rounded-md border border-accent bg-accent px-3 text-sm font-medium text-white transition hover:bg-accent-deep"
      >
        <span aria-hidden="true" className="text-base leading-none">＋</span>
        New subscription
      </Link>
    </div>
  );
}

function ColumnHeader() {
  return (
    <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(110px,1.3fr)_5.5rem_5rem] gap-5 border-b border-hairline bg-subtle/60 px-4 py-2 text-xs font-medium text-ink-dim sm:grid-cols-[minmax(0,1.4fr)_minmax(140px,1.4fr)_5.5rem_5rem_5rem]">
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
    <div className="rounded-lg border border-dashed border-hairline bg-subtle/40 px-6 py-12 text-center">
      <p className="text-base font-medium text-ink">No subscriptions yet.</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-ink-dim">
        Add a prepaid subscription and it'll show up here, with its pace as it
        burns down.
      </p>
      <Link
        to="/subscriptions/new"
        className="mt-5 inline-flex h-8 items-center gap-1 rounded-md border border-accent bg-accent px-3 text-sm font-medium text-white transition hover:bg-accent-deep"
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
