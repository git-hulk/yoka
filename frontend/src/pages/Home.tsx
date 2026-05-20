import { Link } from "react-router-dom";

import { api } from "../lib/api";
import { useFetch } from "../lib/useFetch";
import PackageCard from "../components/PackageCard";

export default function Home() {
  const state = useFetch(() => api.listPackages(), []);

  return (
    <div className="space-y-10">
      <PageHeading
        count={state.status === "ok" ? state.data.length : null}
      />

      {state.status === "loading" && <Skeleton />}

      {state.status === "error" && (
        <ErrorBox title="Couldn't load packages" detail={state.error.message} />
      )}

      {state.status === "ok" && (
        state.data.length === 0 ? (
          <Empty />
        ) : (
          <div>
            <ColumnHeader />
            <ul className="border-y border-hairline divide-y divide-hairline">
              {state.data.map((p) => (
                <li key={p.id}>
                  <PackageCard pkg={p} />
                </li>
              ))}
            </ul>
          </div>
        )
      )}
    </div>
  );
}

function PageHeading({ count }: { count: number | null }) {
  return (
    <div className="flex items-end justify-between gap-4 border-b border-hairline pb-4">
      <div>
        <h1 className="serif text-base font-bold leading-none text-ink">
          Packages
        </h1>
        {count !== null && (
          <p className="num mt-3 text-[11px] uppercase tracking-micro text-ink-faint">
            {count} {count === 1 ? "pack" : "packs"}
          </p>
        )}
      </div>
      <Link
        to="/packages/new"
        className="inline-flex items-baseline gap-1.5 border-b border-ink pb-0.5 text-sm font-medium text-ink transition hover:border-accent hover:text-accent"
      >
        <span aria-hidden="true" className="text-base leading-none">＋</span>
        new pack
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
      <p className="serif text-base italic font-semibold text-ink">No packages yet.</p>
      <p className="mt-3 text-sm text-ink-dim">
        Add a prepaid pack and it'll show up here,<br className="hidden sm:inline" />
        with its pace as it burns down.
      </p>
      <Link
        to="/packages/new"
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
