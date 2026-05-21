import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api } from "../lib/api";
import {
  activeWindowLabel,
  computeCadence,
  dailyUsageBins,
  filledFraction,
  formatPrice,
  formatPricePerUse,
  formatUsageDay,
  formatUsageTime,
  paceColor,
  paceNarrative,
  remainingLabel,
  statusLabel,
  tickFraction,
  timeToExpiryVerbose,
  usedLabel,
  type Cadence,
} from "../lib/pace";
import type { Subscription, Usage } from "../lib/types";
import { isNotFound, useFetch } from "../lib/useFetch";
import Sparkline from "../components/Sparkline";
import StatusPill from "../components/StatusPill";
import TrackBand from "../components/TrackBand";

const CADENCE_DAYS = 30;

export default function SubscriptionDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate    = useNavigate();
  const subState    = useFetch(() => api.getSubscription(id), [id]);
  const usagesState = useFetch(() => api.listUsages(id), [id]);

  if (subState.status === "loading") return <Skeleton />;
  if (subState.status === "error") {
    return isNotFound(subState.error)
      ? <NotFound id={id} />
      : <ErrorBox title="Couldn't load subscription" detail={subState.error.message} />;
  }

  const sub    = subState.data;
  const usages = usagesState.status === "ok" ? usagesState.data : [];

  const isDuration = sub.tracking_mode === "duration";

  return (
    <div className="space-y-12">
      <Hero
        sub={sub}
        usages={usages}
        usagesLoading={usagesState.status === "loading"}
        onRemoved={() => navigate("/")}
      />

      {!isDuration && usages.length > 0 && (
        <Cadence sub={sub} usages={usages} />
      )}

      {!isDuration && (
        <UsageHistory
          loading={usagesState.status === "loading"}
          error={usagesState.status === "error" ? usagesState.error : null}
          usages={usages}
          timeKnown={sub.tracking_mode === "hours"}
        />
      )}
    </div>
  );
}

function Hero({
  sub, usages, usagesLoading, onRemoved,
}: {
  sub:           Subscription;
  usages:        Usage[];
  usagesLoading: boolean;
  onRemoved:     () => void;
}) {
  const color     = paceColor(sub);
  const subtitle  = buildSubtitle(sub);
  const narrative = paceNarrative(sub, usages);
  const notes     = sub.notes?.trim();

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 border-b border-hairline pb-3">
        <span className="text-[11px] uppercase tracking-micro text-ink-faint">
          {sub.categories.length > 0 ? sub.categories.join(" · ") : "subscription"}
        </span>
        <StatusPill status={sub.status} color={color} label={statusLabel(sub.status)} />
      </div>

      <h1 className="serif mt-6 text-base font-bold leading-none text-ink">
        {sub.name}
      </h1>

      {subtitle && (
        <p className="num mt-3 text-sm text-ink-dim">
          {subtitle}
        </p>
      )}

      {notes && (
        <p className="serif mt-3 max-w-[60ch] text-sm italic leading-snug text-ink-dim">
          &ldquo;{notes}&rdquo;
        </p>
      )}

      <div className="mt-10 flex flex-wrap items-baseline gap-x-4">
        <span className="serif num text-base font-bold leading-none text-ink">
          {remainingLabel(sub)}
        </span>
        <span className="serif text-base italic leading-tight text-ink-dim">
          {sub.tracking_mode === "duration" ? (
            <>
              of{" "}
              <span className="num not-italic">
                {formatAmount(sub.consumed + sub.remaining)}
              </span>{" "}
              days remain,
            </>
          ) : (
            <>
              of <span className="num not-italic">{formatAmount(sub.quantity ?? 0)}</span>{" "}
              {sub.tracking_mode === "hours" ? "hours " : ""}remain,
            </>
          )}
        </span>
      </div>

      <p className="serif mt-1 text-base italic leading-tight text-ink-dim">
        {timeToExpiryVerbose(sub)}.
      </p>

      <div className="mt-10">
        <TrackBand
          color={color}
          filled={filledFraction(sub)}
          tick={tickFraction(sub)}
          leftLabel={usedLabel(sub)}
          rightLabel={paceTickLabel(sub)}
          size="lg"
        />
      </div>

      {narrative && (
        <p className="serif mt-5 text-base italic leading-snug text-ink-dim">
          {narrative}
        </p>
      )}

      <HeroActions
        id={sub.id}
        usageCount={usages.length}
        usagesLoading={usagesLoading}
        onRemoved={onRemoved}
      />
    </section>
  );
}

function buildSubtitle(sub: Subscription): string {
  const parts: string[] = [activeWindowLabel(sub)];
  const price = formatPrice(sub.price_cents, sub.currency);
  if (price) parts.push(price);
  const perUse = formatPricePerUse(sub);
  if (perUse) parts.push(`~${perUse}`);
  return parts.join("  ·  ");
}

// ---------------------------------------------------------------------------
// Terminal actions live next to the entry action ("edit subscription") at the bottom
// of the hero, on the page users actually land on. Three peers in the same
// tracking-micro register: archive (ink-dim), delete (pace-red), edit
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
      if (action === "archive") await api.archiveSubscription(id);
      else                      await api.deleteSubscription(id);
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
        title="Archive this subscription?"
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
        title="Delete this subscription?"
        body={
          usagesLoading
            ? "Counting usages…"
            : usageCount > 0
              ? `Removes the subscription and its ${usageCount} ${usageNoun}. This can't be undone.`
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
        to={`/subscriptions/${id}/edit`}
        className="border-b border-ink/40 pb-0.5 text-ink-dim transition hover:border-accent hover:text-accent"
      >
        edit subscription
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

function paceTickLabel(sub: Subscription): string | undefined {
  // The tick marker on the bar reflects "where you should be" if you finish
  // exactly at expiry. Surface the matching label on the right.
  //
  // Duration mode has no separate pace (fill IS pace), so the right side
  // stays empty for active and done; not-started still gets a hint.
  if (sub.tracking_mode === "duration") {
    return sub.status === "not_start" ? "inactive" : undefined;
  }
  if (sub.days_until_expiry < 0) return "past due";
  if (sub.status === "done")     return "all used";
  if (sub.status === "not_start") return "inactive";
  return "pace";
}

// ---------------------------------------------------------------------------
// Cadence: a quiet daily histogram of the last CADENCE_DAYS, plus a single
// sentence naming the numbers (last used, sessions this week, average gap).
// Read order is top-down: heading establishes the section, sparkline shows
// the shape, sentence reads the shape aloud.

function Cadence({ sub, usages }: { sub: Subscription; usages: Usage[] }) {
  const cadence = computeCadence(usages);
  if (!cadence) return null;

  const bins        = dailyUsageBins(usages, CADENCE_DAYS);
  const totalInWin  = bins.reduce((s, v) => s + v, 0);
  const unit        = sub.tracking_mode === "hours" ? "hr" : "";
  const sentence    = composeCadenceSentence(cadence);

  return (
    <section>
      <div className="flex items-baseline justify-between border-b border-hairline pb-3">
        <h2 className="serif text-base italic font-semibold text-ink">Cadence</h2>
        <span className="num text-[11px] uppercase tracking-micro text-ink-faint">
          last {CADENCE_DAYS} days
        </span>
      </div>

      <div className="mt-6">
        <Sparkline
          bins={bins}
          label={`${formatAmount(totalInWin)}${unit} across the last ${CADENCE_DAYS} days`}
        />
        <div className="num mt-2 flex justify-between text-[11px] uppercase tracking-micro text-ink-faint">
          <span>{CADENCE_DAYS}d ago</span>
          <span>today</span>
        </div>
      </div>

      <p className="serif mt-6 max-w-[65ch] text-base italic leading-snug text-ink-dim">
        {sentence}
      </p>
    </section>
  );
}

function composeCadenceSentence(cadence: Cadence): string {
  const sessions = cadence.sessionsThisWeek;
  const sessionWord =
    sessions === 0 ? "No sessions this week"
    : sessions === 1 ? "1 session this week"
    : `${sessions} sessions this week`;

  const parts: string[] = [`Last used ${cadence.lastUsedLabel}.`, `${sessionWord}.`];

  if (cadence.avgGapDays !== null) {
    const gap = cadence.avgGapDays;
    parts.push(gap === 1 ? "Avg 1 day between." : `Avg ${gap} days between.`);
  }

  return parts.join(" ");
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
      <p className="serif text-base italic font-semibold text-ink">No such subscription.</p>
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
