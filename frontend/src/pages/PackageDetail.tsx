import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

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
  const navigate    = useNavigate();
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

  const isDuration = pkg.tracking_mode === "duration";

  return (
    <div className="space-y-12">
      <Hero
        pkg={pkg}
        usageCount={usagesState.status === "ok" ? usagesState.data.length : 0}
        usagesLoading={usagesState.status === "loading"}
        onRemoved={() => navigate("/")}
      />

      {!isDuration && (
        <UsageHistory
          loading={usagesState.status === "loading"}
          error={usagesState.status === "error" ? usagesState.error : null}
          usages={usages}
          timeKnown={pkg.tracking_mode === "hours"}
        />
      )}
    </div>
  );
}

function Hero({
  pkg, usageCount, usagesLoading, onRemoved,
}: {
  pkg:           Package;
  usageCount:    number;
  usagesLoading: boolean;
  onRemoved:     () => void;
}) {
  const color = paceColor(pkg);
  const price = formatPrice(pkg.price_cents, pkg.currency);

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 border-b border-hairline pb-3">
        <span className="text-[11px] uppercase tracking-micro text-ink-faint">
          {pkg.categories.length > 0 ? pkg.categories.join(" · ") : "package"}
        </span>
        <StatusPill status={pkg.status} color={color} label={statusLabel(pkg.status)} />
      </div>

      <h1 className="serif mt-6 text-base font-bold leading-none text-ink">
        {pkg.name}
      </h1>

      <p className="mt-3 text-sm text-ink-dim">
        {[price, expiryShortLabel(pkg)].filter(Boolean).join(" · ")}
      </p>

      <div className="mt-10 flex flex-wrap items-baseline gap-x-4">
        <span className="serif num text-base font-bold leading-none text-ink">
          {remainingLabel(pkg)}
        </span>
        <span className="serif text-base italic leading-tight text-ink-dim">
          {pkg.tracking_mode === "duration" ? (
            <>
              of{" "}
              <span className="num not-italic">
                {formatAmount(pkg.consumed + pkg.remaining)}
              </span>{" "}
              days remain,
            </>
          ) : (
            <>
              of <span className="num not-italic">{formatAmount(pkg.quantity ?? 0)}</span>{" "}
              {pkg.tracking_mode === "hours" ? "hours " : ""}remain,
            </>
          )}
        </span>
      </div>

      <p className="serif mt-1 text-base italic leading-tight text-ink-dim">
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

      <HeroActions
        id={pkg.id}
        usageCount={usageCount}
        usagesLoading={usagesLoading}
        onRemoved={onRemoved}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Terminal actions live next to the entry action ("edit pack") at the bottom
// of the hero, on the page users actually land on. Three peers in the same
// tracking-micro register: archive (ink-dim), delete (pace-red), edit pack
// (underlined entry). Click archive/delete and the row collapses into a
// confirm panel rendered in the same slot — no modal.

type Pending = "archive" | "delete" | null;

function HeroActions({
  id, usageCount, usagesLoading, onRemoved,
}: {
  id:            string;
  usageCount:    number;
  usagesLoading: boolean;
  onRemoved:     () => void;
}) {
  const [pending,    setPending]    = useState<Pending>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  async function commit(action: "archive" | "delete") {
    setSubmitting(true);
    setError(null);
    try {
      if (action === "archive") await api.archivePackage(id);
      else                      await api.deletePackage(id);
      onRemoved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove.");
      setSubmitting(false);
    }
  }

  function cancel() {
    setPending(null);
    setError(null);
  }

  const usageNoun = usageCount === 1 ? "usage" : "usages";

  if (pending === "archive") {
    return (
      <ConfirmPanel
        title="Archive this pack?"
        body="Hides from the active list. Nothing is deleted."
        confirmLabel="Archive"
        loadingLabel="Archiving…"
        confirmTone="bg-ink"
        onCancel={cancel}
        onConfirm={() => commit("archive")}
        submitting={submitting}
        error={error}
      />
    );
  }

  if (pending === "delete") {
    return (
      <ConfirmPanel
        title="Delete this pack?"
        body={
          usagesLoading
            ? "Counting usages…"
            : usageCount > 0
              ? `Removes the pack and its ${usageCount} ${usageNoun}. This can't be undone.`
              : "This can't be undone."
        }
        confirmLabel="Delete forever"
        loadingLabel="Deleting…"
        confirmTone="bg-pace-red"
        onCancel={cancel}
        onConfirm={() => commit("delete")}
        submitting={submitting}
        error={error}
        disabled={usagesLoading}
      />
    );
  }

  return (
    <div className="mt-8 flex items-center justify-between gap-6 text-[11px] uppercase tracking-micro">
      <div className="flex items-center gap-6">
        <button
          type="button"
          onClick={() => setPending("archive")}
          className="border-b border-ink/40 pb-0.5 text-ink-dim transition hover:border-ink hover:text-ink"
        >
          archive
        </button>
        <button
          type="button"
          onClick={() => setPending("delete")}
          className="border-b border-pace-red/40 pb-0.5 text-pace-red transition hover:border-pace-red hover:text-pace-red"
        >
          delete
        </button>
      </div>
      <Link
        to={`/packages/${id}/edit`}
        className="border-b border-ink/40 pb-0.5 text-ink-dim transition hover:border-accent hover:text-accent"
      >
        edit pack
      </Link>
    </div>
  );
}

function ConfirmPanel({
  title, body, confirmLabel, loadingLabel, confirmTone,
  onCancel, onConfirm, submitting, error, disabled = false,
}: {
  title:        string;
  body:         string | null;
  confirmLabel: string;
  loadingLabel: string;
  confirmTone:  string;
  onCancel:     () => void;
  onConfirm:    () => void;
  submitting:   boolean;
  error:        string | null;
  disabled?:    boolean;
}) {
  return (
    <div className="mt-8">
      <p className="serif text-base italic text-ink">{title}</p>
      {body && (
        <p className="mt-2 text-sm text-ink-dim">{body}</p>
      )}

      {error && (
        <p className="mt-3 text-sm font-semibold text-pace-red">{error}</p>
      )}

      <div className="mt-6 flex items-center gap-6">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="text-[11px] uppercase tracking-micro text-ink-dim transition hover:text-ink disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={submitting || disabled}
          className={
            `inline-flex items-baseline px-5 py-2.5 text-sm font-medium text-canvas ` +
            `transition hover:bg-ink disabled:cursor-not-allowed disabled:bg-ink-faint ` +
            confirmTone
          }
        >
          {submitting ? loadingLabel : confirmLabel}
        </button>
      </div>
    </div>
  );
}

function paceTickLabel(pkg: Package): string | undefined {
  // The tick marker on the bar reflects "where you should be" if you finish
  // exactly at expiry. Surface the matching label on the right.
  //
  // Duration mode has no separate pace (fill IS pace), so the right side
  // stays empty for active and done; not-started still gets a hint.
  if (pkg.tracking_mode === "duration") {
    return pkg.status === "not_start" ? "inactive" : undefined;
  }
  if (pkg.days_until_expiry < 0) return "past due";
  if (pkg.status === "done")     return "all used";
  if (pkg.status === "not_start") return "inactive";
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
        <h2 className="serif text-base italic font-semibold text-ink">History</h2>
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
      <p className="serif text-base italic font-semibold text-ink">No such package.</p>
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
