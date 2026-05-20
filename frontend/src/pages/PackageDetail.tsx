import { Link, useParams } from "react-router-dom";

import { api } from "../lib/api";
import {
  expiryShortLabel,
  filledFraction,
  formatPrice,
  formatUsageDay,
  formatUsageTime,
  paceColor,
  remainingLabel,
  statusLabel,
  tickFraction,
  timeToExpiryVerbose,
  usedLabel,
} from "../lib/pace";
import type { Package, Usage } from "../lib/types";
import { isNotFound, useFetch } from "../lib/useFetch";
import StatusPill from "../components/StatusPill";
import TrackBand from "../components/TrackBand";

export default function PackageDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const pkgState    = useFetch(() => api.getPackage(id), [id]);
  const usagesState = useFetch(() => api.listUsages(id), [id]);

  if (pkgState.status === "loading") return <Skeleton />;
  if (pkgState.status === "error") {
    return isNotFound(pkgState.error)
      ? <NotFound id={id} />
      : <ErrorBox title="Couldn't load package" detail={pkgState.error.message} />;
  }

  const pkg    = pkgState.data;
  const usages = usagesState.status === "ok" ? usagesState.data : [];

  return (
    <div className="space-y-12">
      <Hero pkg={pkg} />

      <UsageHistory
        loading={usagesState.status === "loading"}
        error={usagesState.status === "error" ? usagesState.error : null}
        usages={usages}
        timeKnown={pkg.time_known}
      />
    </div>
  );
}

function Hero({ pkg }: { pkg: Package }) {
  const color = paceColor(pkg);
  const price = formatPrice(pkg.price_cents, pkg.currency);

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 border-b border-hairline pb-3">
        <span className="text-[10px] uppercase tracking-micro text-ink-faint">
          {pkg.category ?? "package"}
        </span>
        <StatusPill color={color} label={statusLabel(pkg.status)} />
      </div>

      <h1 className="serif mt-6 text-5xl leading-none text-ink">
        {pkg.name}
      </h1>

      <p className="mt-3 text-sm text-ink-dim">
        {[price, expiryShortLabel(pkg)].filter(Boolean).join(" · ")}
      </p>

      <div className="mt-10 flex flex-wrap items-baseline gap-x-4">
        <span className="serif num text-6xl leading-none text-ink sm:text-7xl">
          {remainingLabel(pkg)}
        </span>
        <span className="serif text-xl italic leading-tight text-ink-dim sm:text-2xl">
          of <span className="num not-italic">{formatAmount(pkg.quantity)}</span>{" "}
          {pkg.time_known ? "hours " : ""}remain,
        </span>
      </div>

      <p className="serif mt-1 text-xl italic leading-tight text-ink-dim sm:text-2xl">
        {timeToExpiryVerbose(pkg)}.
      </p>

      <div className="mt-10">
        <TrackBand
          color={color}
          filled={filledFraction(pkg)}
          tick={tickFraction(pkg)}
          leftLabel={usedLabel(pkg)}
          rightLabel={paceTickLabel(pkg)}
          size="lg"
        />
      </div>

      <div className="mt-8 flex items-center justify-end">
        <Link
          to={`/packages/${pkg.id}/edit`}
          className="border-b border-ink/40 pb-0.5 text-[11px] uppercase tracking-micro text-ink-dim transition hover:border-accent hover:text-accent"
        >
          edit pack
        </Link>
      </div>
    </section>
  );
}

function paceTickLabel(pkg: Package): string {
  // The tick marker on the bar reflects "where you should be" if you finish
  // exactly at expiry. Surface the matching label on the right.
  if (pkg.days_until_expiry < 0) return "past due";
  if (pkg.status === "done")     return "all used";
  if (pkg.status === "not_start") return "not started";
  return "pace";
}

// ---------------------------------------------------------------------------

function UsageHistory({
  loading, error, usages, timeKnown,
}: {
  loading: boolean;
  error:   Error | null;
  usages:  Usage[];
  timeKnown: boolean;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between border-b border-hairline pb-3">
        <h2 className="serif text-2xl italic text-ink">History</h2>
        {usages.length > 0 && (
          <span className="num text-[11px] uppercase tracking-micro text-ink-faint">
            {usages.length} {usages.length === 1 ? "entry" : "entries"}
          </span>
        )}
      </div>

      {loading && <EmptyRow text="loading…" />}

      {error && (
        <div className="border-b border-pace-red/40 px-1 py-5">
          <p className="text-sm font-semibold text-pace-red">
            Couldn't load history
          </p>
          <p className="mt-1 text-xs text-ink-dim">{error.message}</p>
        </div>
      )}

      {!loading && !error && usages.length === 0 && (
        <EmptyRow text="no usages yet" />
      )}

      {!loading && !error && usages.length > 0 && (
        <ul className="divide-y divide-hairline">
          {usages.map((u) => (
            <li key={u.id}>
              <LedgerRow
                date={formatUsageDay(u.created_at)}
                detail={composeUsageDetail(u)}
                amount={`${formatAmount(u.amount)}${timeKnown ? "h" : ""}`}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LedgerRow({
  date, detail, amount,
}: {
  date:    string;
  detail?: string;
  amount:  string;
}) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-baseline gap-4 py-4">
      <span className="serif text-sm italic text-ink-dim">{date}</span>
      <span className="truncate text-sm text-ink-dim">{detail ?? ""}</span>
      <span className="num text-base font-medium tabular-nums text-ink">
        {amount}
      </span>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <p className="serif py-6 text-center text-base italic text-ink-faint">
      {text}
    </p>
  );
}

function composeUsageDetail(u: Usage): string | undefined {
  const time  = formatUsageTime(u.created_at);
  const notes = u.notes?.trim();
  if (time && notes) return `${time} · ${notes}`;
  return time || notes || undefined;
}

// ---------------------------------------------------------------------------

function Skeleton() {
  return (
    <div className="space-y-12" aria-busy="true">
      <div className="h-3 w-24 animate-pulse rounded-sm bg-ink/5" />
      <div>
        <div className="h-3 w-16 animate-pulse rounded-sm border-b border-hairline bg-ink/5" />
        <div className="mt-6 h-12 w-56 animate-pulse rounded-sm bg-ink/5" />
        <div className="mt-3 h-3 w-40 animate-pulse rounded-sm bg-ink/5" />
        <div className="mt-10 h-16 w-32 animate-pulse rounded-sm bg-ink/5" />
        <div className="mt-10 h-3 w-full animate-pulse rounded-sm bg-ink/5" />
      </div>
      <div className="h-6 w-24 animate-pulse rounded-sm bg-ink/5" />
    </div>
  );
}

function NotFound({ id }: { id: string }) {
  return (
    <div className="border-y border-hairline py-12 text-center">
      <p className="serif text-3xl italic text-ink">No such package.</p>
      <p className="mt-3 text-sm text-ink-dim">
        <span className="num">{id}</span> may have been archived or deleted.
      </p>
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

// ---------------------------------------------------------------------------

function formatAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}
