// Yearly timeline of key events.
//
// Two sources feed one month-grouped spine:
//
//   1. Subscription pay events — derived, one per subscription, on its
//      start_date (the day you paid). Identity-colored node, links to the
//      subscription, price on the right. Read-only here; the date and price
//      are edited on the subscription itself.
//   2. User-authored events — persisted via /timeline-events. Created and
//      edited inline on this page (no modals): "New event" opens a composer
//      under the header, hovering a row reveals Edit, and the editor swaps
//      into the row in place.
//
// Subscriptions are fetched once per load (paging through the API cap);
// custom events are fetched per year. A bump counter refetches after writes.

import { useState } from "react";
import { Link } from "react-router-dom";

import YearSwitcher from "../components/YearSwitcher";
import { api, type TimelineEventInput } from "../lib/api";
import { subscriptionColor } from "../lib/colors";
import { formatPrice } from "../lib/pace";
import type { Subscription, TimelineEvent } from "../lib/types";
import { useFetch } from "../lib/useFetch";

type Entry =
  | { date: string; kind: "pay"; sub: Subscription }
  | { date: string; kind: "custom"; ev: TimelineEvent };

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function Timeline() {
  const [year, setYear]       = useState(() => String(new Date().getUTCFullYear()));
  const [bump, setBump]       = useState(0);
  const [composing, setComposing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const state = useFetch(
    () => Promise.all([fetchAllSubscriptions(), api.listTimelineEvents(year)]),
    [year, bump],
  );

  const refresh = () => {
    setComposing(false);
    setEditingId(null);
    setBump((n) => n + 1);
  };

  const entries =
    state.status === "ok" ? mergeEntries(state.data[0], state.data[1], year) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hairline pb-4">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-ink">Timeline</h1>
          <p className="num mt-1 text-xs text-ink-faint">
            {entries === null ? "Key dates, one year at a time" : summaryLabel(entries)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <YearSwitcher year={year} onChange={setYear} />
          <button
            type="button"
            onClick={() => setComposing(true)}
            disabled={composing}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-accent bg-accent px-3 text-sm font-medium text-white transition hover:bg-accent-deep disabled:opacity-50"
          >
            <span aria-hidden="true" className="text-base leading-none">＋</span>
            New event
          </button>
        </div>
      </div>

      {composing && (
        <EventComposer
          initial={{ title: "", occurred_on: defaultComposeDate(year), notes: null }}
          onSaved={refresh}
          onCancel={() => setComposing(false)}
        />
      )}

      {state.status === "loading" && <Skeleton />}

      {state.status === "error" && (
        <div className="rounded-lg border border-pace-red/40 bg-pace-red/5 px-4 py-3">
          <p className="text-sm font-medium text-pace-red">Couldn't load the timeline</p>
          <p className="mt-0.5 text-xs text-ink-dim">{state.error.message}</p>
        </div>
      )}

      {state.status === "ok" && entries && (
        entries.length === 0 && !composing ? (
          <Empty year={year} onCompose={() => setComposing(true)} />
        ) : (
          <Year
            entries={entries}
            year={year}
            editingId={editingId}
            onEdit={setEditingId}
            onSaved={refresh}
            onCancelEdit={() => setEditingId(null)}
          />
        )
      )}
    </div>
  );
}

async function fetchAllSubscriptions(): Promise<Subscription[]> {
  const first = await api.listSubscriptions({ page: 1, perPage: 100 });
  const items = [...first.items];
  let page = 1;
  while (items.length < first.total) {
    page += 1;
    const next = await api.listSubscriptions({ page, perPage: 100 });
    if (next.items.length === 0) break;
    items.push(...next.items);
  }
  return items;
}

function mergeEntries(
  subs: Subscription[],
  events: TimelineEvent[],
  year: string,
): Entry[] {
  const entries: Entry[] = [];
  for (const sub of subs) {
    if (sub.start_date.slice(0, 4) === year) {
      entries.push({ date: sub.start_date, kind: "pay", sub });
    }
  }
  for (const ev of events) {
    entries.push({ date: ev.occurred_on, kind: "custom", ev });
  }
  return entries.sort((a, b) => a.date.localeCompare(b.date));
}

function summaryLabel(entries: Entry[]): string {
  const pays = entries.filter((e) => e.kind === "pay").length;
  const custom = entries.length - pays;
  if (entries.length === 0) return "No key dates this year";
  const parts: string[] = [];
  if (pays > 0) parts.push(`${pays} ${pays === 1 ? "payment" : "payments"}`);
  if (custom > 0) parts.push(`${custom} ${custom === 1 ? "event" : "events"}`);
  return parts.join(" · ");
}

/** Compose date defaults to today when viewing the current year, else Jan 1. */
function defaultComposeDate(year: string): string {
  const today = todayIso();
  return today.slice(0, 4) === year ? today : `${year}-01-01`;
}

// ---------------------------------------------------------------------------
// Year body
// ---------------------------------------------------------------------------

function Year({
  entries, year, editingId, onEdit, onSaved, onCancelEdit,
}: {
  entries:      Entry[];
  year:         string;
  editingId:    string | null;
  onEdit:       (id: string) => void;
  onSaved:      () => void;
  onCancelEdit: () => void;
}) {
  const today = todayIso();
  const showToday = today.slice(0, 4) === year;
  const todayMonth = parseInt(today.slice(5, 7), 10) - 1;

  const byMonth = new Map<number, Entry[]>();
  for (const entry of entries) {
    const m = parseInt(entry.date.slice(5, 7), 10) - 1;
    const list = byMonth.get(m) ?? [];
    list.push(entry);
    byMonth.set(m, list);
  }
  // The current month always renders while viewing the current year so the
  // "today" rule has a home even when nothing is scheduled around it.
  if (showToday && !byMonth.has(todayMonth)) byMonth.set(todayMonth, []);

  const months = [...byMonth.keys()].sort((a, b) => a - b);

  return (
    <div className="space-y-7">
      {months.map((m) => (
        <MonthBlock
          key={m}
          name={MONTH_NAMES[m]}
          entries={byMonth.get(m) ?? []}
          today={today}
          markerInMonth={showToday && m === todayMonth}
          editingId={editingId}
          onEdit={onEdit}
          onSaved={onSaved}
          onCancelEdit={onCancelEdit}
        />
      ))}
    </div>
  );
}

function MonthBlock({
  name, entries, today, markerInMonth, editingId, onEdit, onSaved, onCancelEdit,
}: {
  name:          string;
  entries:       Entry[];
  today:         string;
  markerInMonth: boolean;
  editingId:     string | null;
  onEdit:        (id: string) => void;
  onSaved:       () => void;
  onCancelEdit:  () => void;
}) {
  // Interleave the today-rule at its chronological slot. Same-day entries
  // stay above the rule: they've already happened by the time you look.
  const rows: Array<{ key: string; node: JSX.Element }> = [];
  let placed = !markerInMonth;
  for (const entry of entries) {
    if (!placed && entry.date > today) {
      rows.push({ key: "today", node: <TodayRule date={today} /> });
      placed = true;
    }
    const past = entry.date < today;
    if (entry.kind === "pay") {
      rows.push({
        key:  `pay:${entry.sub.id}`,
        node: <PayRow sub={entry.sub} past={past} />,
      });
    } else if (editingId === entry.ev.id) {
      rows.push({
        key:  `edit:${entry.ev.id}`,
        node: (
          <EventComposer
            initial={{
              title:       entry.ev.title,
              occurred_on: entry.ev.occurred_on,
              notes:       entry.ev.notes,
            }}
            eventId={entry.ev.id}
            onSaved={onSaved}
            onCancel={onCancelEdit}
          />
        ),
      });
    } else {
      rows.push({
        key:  `custom:${entry.ev.id}`,
        node: <CustomRow ev={entry.ev} past={past} onEdit={() => onEdit(entry.ev.id)} />,
      });
    }
  }
  if (!placed) rows.push({ key: "today", node: <TodayRule date={today} /> });

  return (
    <section aria-label={name}>
      <h2 className="text-2xs font-medium uppercase tracking-micro text-ink-faint">
        {name}
      </h2>
      <div className="relative mt-2">
        <span
          aria-hidden="true"
          className="absolute inset-y-1 left-[4.4rem] w-px bg-hairline"
        />
        <ul>
          {rows.map((r) => (
            <li key={r.key}>{r.node}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

const ROW_GRID = "grid grid-cols-[3.5rem_1.8rem_minmax(0,1fr)] items-center";

function PayRow({ sub, past }: { sub: Subscription; past: boolean }) {
  const color = subscriptionColor(sub.id);
  return (
    <div className={`group ${ROW_GRID}`}>
      <span className="num py-2.5 text-right text-xs tabular-nums text-ink-faint">
        {dayLabel(sub.start_date)}
      </span>
      <span className="relative flex justify-center" aria-hidden="true">
        <span
          className={"z-[1] size-[7px] rounded-full " + (past ? "opacity-45" : "")}
          style={{ backgroundColor: color }}
        />
      </span>
      <span className="flex min-w-0 items-center gap-2 border-b border-hairline py-2.5 group-last:border-b-0">
        <span className={"flex min-w-0 items-baseline gap-1.5 " + (past ? "opacity-60" : "")}>
          <Link
            to={`/subscriptions/${sub.id}`}
            className="truncate text-sm font-medium text-ink transition hover:text-accent"
          >
            {sub.name}
          </Link>
          <span className="shrink-0 text-sm text-ink-dim">{past ? "paid" : "pays"}</span>
        </span>
        <span className="num ml-auto shrink-0 text-xs tabular-nums text-ink-faint">
          {payMeta(sub)}
        </span>
      </span>
    </div>
  );
}

function CustomRow({
  ev, past, onEdit,
}: {
  ev:     TimelineEvent;
  past:   boolean;
  onEdit: () => void;
}) {
  return (
    <div className={`group ${ROW_GRID}`}>
      <span className="num py-2.5 text-right text-xs tabular-nums text-ink-faint">
        {dayLabel(ev.occurred_on)}
      </span>
      <span className="relative flex justify-center" aria-hidden="true">
        {/* User-authored events get the ink node — distinct from the
            identity-colored pay dots without spending the accent. */}
        <span
          className={
            "z-[1] size-[7px] rounded-full bg-ink " + (past ? "opacity-45" : "")
          }
        />
      </span>
      <span className="flex min-w-0 items-center gap-2 border-b border-hairline py-2.5 group-last:border-b-0">
        <span className={"flex min-w-0 items-baseline gap-1.5 " + (past ? "opacity-60" : "")}>
          <span className="truncate text-sm font-medium text-ink">{ev.title}</span>
          {ev.notes && (
            <span className="truncate text-sm text-ink-dim">{ev.notes}</span>
          )}
        </span>
        <button
          type="button"
          onClick={onEdit}
          className="ml-auto shrink-0 rounded-md px-2 py-0.5 text-xs font-medium text-ink-faint opacity-0 transition group-hover:opacity-100 hover:bg-subtle hover:text-ink focus-visible:opacity-100"
        >
          Edit
        </button>
      </span>
    </div>
  );
}

function TodayRule({ date }: { date: string }) {
  return (
    <div className={ROW_GRID} aria-label={`today, ${dayLabel(date)}`}>
      <span className="num py-1.5 text-right text-xs font-medium tabular-nums text-accent">
        {dayLabel(date)}
      </span>
      <span className="relative flex justify-center" aria-hidden="true">
        <span className="z-[1] size-[7px] rounded-full bg-accent ring-2 ring-white" />
      </span>
      <span className="flex items-center gap-2 py-1.5" aria-hidden="true">
        <span className="h-px flex-1 bg-accent/40" />
        <span className="text-2xs font-medium uppercase tracking-micro text-accent">
          Today
        </span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composer (create + edit)
// ---------------------------------------------------------------------------

const INPUT =
  "h-8 rounded-md border border-hairline bg-white px-2.5 text-sm text-ink " +
  "placeholder:text-ink-faint transition hover:border-ink-faint " +
  "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft";

function EventComposer({
  initial, eventId, onSaved, onCancel,
}: {
  initial:  TimelineEventInput;
  /** Present = edit an existing event; absent = create. */
  eventId?: string;
  onSaved:  () => void;
  onCancel: () => void;
}) {
  const [title, setTitle]   = useState(initial.title);
  const [date, setDate]     = useState(initial.occurred_on);
  const [notes, setNotes]   = useState(initial.notes ?? "");
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !date) return;
    setBusy(true);
    setError(null);
    const input: TimelineEventInput = {
      title:       title.trim(),
      occurred_on: date,
      notes:       notes.trim() === "" ? null : notes.trim(),
    };
    try {
      if (eventId) await api.updateTimelineEvent(eventId, input);
      else await api.createTimelineEvent(input);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!eventId) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteTimelineEvent(eventId);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="my-2 rounded-lg border border-hairline bg-subtle/40 p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
          aria-label="Event date"
          className={`num w-36 tabular-nums ${INPUT}`}
        />
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What happened?"
          required
          maxLength={200}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the composer
          // appears on explicit user intent; focusing its first field is the
          // expected continuation of that action.
          autoFocus
          aria-label="Event title"
          className={`min-w-[12rem] flex-1 ${INPUT}`}
        />
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          aria-label="Event notes"
          className={`min-w-[10rem] flex-1 ${INPUT}`}
        />
        <div className="ml-auto flex items-center gap-2">
          {eventId && (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className="inline-flex h-8 items-center rounded-md px-2.5 text-xs font-medium text-pace-red transition hover:bg-pace-red/10 disabled:opacity-50"
            >
              Delete
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex h-8 items-center rounded-md border border-hairline bg-white px-3 text-sm font-medium text-ink transition hover:bg-subtle disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !title.trim() || !date}
            className="inline-flex h-8 items-center rounded-md border border-accent bg-accent px-3 text-sm font-medium text-white transition hover:bg-accent-deep disabled:opacity-50"
          >
            {eventId ? "Save" : "Add event"}
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-pace-red">{error}</p>}
    </form>
  );
}

// ---------------------------------------------------------------------------
// States + helpers
// ---------------------------------------------------------------------------

function payMeta(sub: Subscription): string {
  const price = formatPrice(sub.price_cents, sub.currency);
  if (price) return price;
  if (sub.quantity !== null) {
    return `${sub.quantity}${sub.tracking_mode === "hours" ? "h" : " uses"}`;
  }
  return "";
}

function Empty({ year, onCompose }: { year: string; onCompose: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-hairline bg-subtle/40 px-6 py-12 text-center">
      <p className="text-base font-medium text-ink">Nothing lands in {year}.</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-ink-dim">
        Subscription payments show up here automatically. Add your own key
        dates to fill in the rest of the story.
      </p>
      <button
        type="button"
        onClick={onCompose}
        className="mt-5 inline-flex h-8 items-center gap-1 rounded-md border border-accent bg-accent px-3 text-sm font-medium text-white transition hover:bg-accent-deep"
      >
        <span aria-hidden="true">＋</span>
        Add an event
      </button>
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" className="space-y-7">
      {[0, 1].map((block) => (
        <div key={block}>
          <div className="h-3 w-16 animate-pulse rounded-sm bg-ink/5" />
          <div className="mt-3 space-y-3">
            {[0, 1, 2].map((row) => (
              <div key={row} className={`${ROW_GRID} gap-y-2`}>
                <div className="h-3 animate-pulse rounded-sm bg-ink/5" />
                <div className="flex justify-center">
                  <div className="size-[7px] animate-pulse rounded-full bg-ink/10" />
                </div>
                <div className="h-4 w-2/3 animate-pulse rounded-sm bg-ink/5" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function dayLabel(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split("-").map((n) => parseInt(n, 10));
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day:   "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
