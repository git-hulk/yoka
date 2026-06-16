// Google-Calendar-style view for events. Three modes: month, week, day.
//
// Events vs. usages:
//   * An event may stand alone (no subscription link) or burn a subscription
//     when status === "accepted".
//   * Clicking an event opens its detail modal — not the subscription page.
//   * Clicking an empty slot opens the new-event modal; events default to
//     `pending` and only count against the subscription once accepted.
//
// Timezone notes:
//   * The grid is rendered in the user's local time.
//   * Range queries send half-open UTC bounds covering the visible window
//     with a safe ±1d padding.
//   * Events without a clicked time fall under local noon so they land on
//     the right day regardless of timezone.

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";

import { ApiError, api } from "../lib/api";
import { useFetch } from "../lib/useFetch";
import type {
  CalendarEvent,
  EventInRange,
  EventStatus,
  Freq,
  RecurrenceRule,
  Subscription,
  Weekday,
} from "../lib/types";
import { isRecurringInstance } from "../lib/types";

type View = "month" | "week" | "day";

// Grid sizing — Google Calendar uses ~48px per hour at default zoom; we match.
const HOUR_PX                 = 48;
const TOTAL_HOURS             = 24;
const DEFAULT_DURATION_MIN    = 30;
const SCROLL_TO_HOUR          = 7;     // initial scroll target in week/day views
const GUTTER_REM              = 3.5;   // hour gutter width

// Modal state is a discriminated union: either we're creating a new event
// for a given date/time, or we're viewing the detail of an existing event.
type ModalState =
  | { kind: "new"; date: Date; time?: string }
  | { kind: "detail"; eventId: string }
  | null;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Calendar() {
  const [params, setParams] = useSearchParams();

  const view: View = parseView(params.get("view"));
  const anchor = parseDate(params.get("date"));

  function setView(next: View) {
    const p = new URLSearchParams(params);
    p.set("view", next);
    setParams(p, { replace: true });
  }
  function setAnchor(next: Date) {
    const p = new URLSearchParams(params);
    p.set("date", ymd(next));
    setParams(p, { replace: true });
  }
  function setViewAndAnchor(nextView: View, nextAnchor: Date) {
    const p = new URLSearchParams(params);
    p.set("view", nextView);
    p.set("date", ymd(nextAnchor));
    setParams(p, { replace: true });
  }
  function goToday() { setAnchor(new Date()); }
  function goPrev()  { setAnchor(shift(anchor, view, -1)); }
  function goNext()  { setAnchor(shift(anchor, view, +1)); }

  const [windowStart, windowEnd] = useMemo(() => visibleWindow(anchor, view), [anchor, view]);

  const eventsState = useFetch(
    () => api.listEventsInRange(windowStart.toISOString(), windowEnd.toISOString()),
    [windowStart.getTime(), windowEnd.getTime()],
  );

  // Subscription list powers the new-event modal's picker and the color map.
  // Modal pickers need the full subscription list, not just one page. 100 is
  // the server's per-page cap; if the active list grows past that, the picker
  // needs a search/typeahead, not more pagination knobs here.
  const subsState = useFetch(() => api.listSubscriptions({ perPage: 100 }), []);

  const [modal, setModal] = useState<ModalState>(null);

  // Optimistic / mutation cache layered on top of the fetched range.
  //
  //   * `extra` — events created during this session, not yet in the
  //     server-fetched range. Cleared on range change (refetch picks them
  //     up).
  //   * `overrides` — events that have been edited or status-flipped, keyed
  //     by id. The lookup wins over the fetched row, so accept/decline
  //     reflects instantly without a refetch.
  //   * `removed` — soft-deletion set; ids drop out of the rendered list.
  const [extra,     setExtra]     = useState<EventInRange[]>([]);
  const [overrides, setOverrides] = useState<Record<string, EventInRange>>({});
  const [removed,   setRemoved]   = useState<Set<string>>(new Set());
  useEffect(() => {
    setExtra([]);
    setOverrides({});
    setRemoved(new Set());
  }, [windowStart.getTime(), windowEnd.getTime()]);

  const allEvents: EventInRange[] = useMemo(() => {
    const base = eventsState.status === "ok" ? eventsState.data : [];
    const merged: EventInRange[] = [];
    for (const e of [...base, ...extra]) {
      if (removed.has(e.id)) continue;
      merged.push(overrides[e.id] ?? e);
    }
    return merged;
  }, [eventsState, extra, overrides, removed]);

  const newIds = useMemo(() => new Set(extra.map((e) => e.id)), [extra]);

  function onEventCreated(e: EventInRange) {
    setExtra((prev) => [...prev, e]);
    setModal(null);
  }
  function onEventUpdated(e: EventInRange) {
    setOverrides((prev) => ({ ...prev, [e.id]: e }));
  }
  function onEventDeleted(id: string) {
    setRemoved((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setModal(null);
  }

  const subscriptions = subsState.status === "ok" ? subsState.data.items : [];
  const subscriptionsError = subsState.status === "error" ? subsState.error.message : null;

  return (
    <div className="space-y-5">
      <Header
        view={view}
        anchor={anchor}
        onView={setView}
        onToday={goToday}
        onPrev={goPrev}
        onNext={goNext}
      />

      {eventsState.status === "error" && (
        <ErrorBox title="Couldn't load events" detail={eventsState.error.message} />
      )}

      {view === "month" && (
        <MonthGrid
          key={"m-" + ymd(anchor)}
          anchor={anchor}
          events={allEvents}
          newIds={newIds}
          onPickDay={(d) => setModal({ kind: "new", date: noonLocal(d) })}
          onPickEvent={(id) => setModal({ kind: "detail", eventId: id })}
          onJumpToDay={(d) => setViewAndAnchor("day", d)}
        />
      )}
      {view === "week" && (
        <WeekView
          key={"w-" + ymd(anchor)}
          anchor={anchor}
          events={allEvents}
          newIds={newIds}
          onPickSlot={(date, time) => setModal({ kind: "new", date, time })}
          onPickEvent={(id) => setModal({ kind: "detail", eventId: id })}
        />
      )}
      {view === "day" && (
        <DayView
          key={"d-" + ymd(anchor)}
          anchor={anchor}
          events={allEvents}
          newIds={newIds}
          onPickSlot={(date, time) => setModal({ kind: "new", date, time })}
          onPickEvent={(id) => setModal({ kind: "detail", eventId: id })}
        />
      )}

      {modal?.kind === "new" && (
        <NewEventModal
          date={modal.date}
          defaultTime={modal.time}
          subscriptions={subscriptions}
          subscriptionsError={subscriptionsError}
          onClose={() => setModal(null)}
          onCreated={onEventCreated}
        />
      )}

      {modal?.kind === "detail" && (
        <EventDetailModal
          eventId={modal.eventId}
          subscriptions={subscriptions}
          onClose={() => setModal(null)}
          onUpdated={onEventUpdated}
          onDeleted={onEventDeleted}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function Header({
  view, anchor, onView, onToday, onPrev, onNext,
}: {
  view:    View;
  anchor:  Date;
  onView:  (v: View) => void;
  onToday: () => void;
  onPrev:  () => void;
  onNext:  () => void;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 pb-2">
      <h1 className="flex items-baseline gap-2.5 text-3xl font-semibold tracking-tight text-ink">
        <span>{primaryLabel(anchor, view)}</span>
        <span className="num text-2xl font-light tabular-nums text-ink-faint">
          {yearLabel(anchor, view)}
        </span>
      </h1>

      <div className="flex items-center gap-2">
        <ViewSwitcher view={view} onChange={onView} />
        <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-hairline" />
        <button
          type="button"
          onClick={onToday}
          className="inline-flex h-8 items-center rounded-md px-2.5 text-sm font-medium text-ink-dim transition hover:bg-subtle hover:text-ink"
        >
          Today
        </button>
        <div className="inline-flex h-8 overflow-hidden rounded-md border border-hairline bg-white">
          <NavBtn direction="prev" onClick={onPrev} />
          <span aria-hidden="true" className="w-px bg-hairline" />
          <NavBtn direction="next" onClick={onNext} />
        </div>
      </div>
    </header>
  );
}

function NavBtn({
  direction, onClick,
}: { direction: "prev" | "next"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={direction === "prev" ? "previous" : "next"}
      className="inline-flex h-full w-8 items-center justify-center text-ink-dim transition hover:bg-subtle hover:text-ink"
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-4"
        aria-hidden="true"
      >
        {direction === "prev"
          ? <polyline points="10 3.5 5.5 8 10 12.5" />
          : <polyline points="6 3.5 10.5 8 6 12.5" />}
      </svg>
    </button>
  );
}

function ViewSwitcher({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const opts: { value: View; label: string }[] = [
    { value: "month", label: "Month" },
    { value: "week",  label: "Week"  },
    { value: "day",   label: "Day"   },
  ];
  return (
    <div
      role="tablist"
      aria-label="calendar view"
      className="inline-flex h-8 gap-0.5 rounded-md bg-subtle p-0.5"
    >
      {opts.map((opt) => {
        const active = opt.value === view;
        return (
          <button
            key={opt.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={
              "inline-flex items-center rounded-[5px] px-3 text-sm font-medium transition " +
              (active
                ? "bg-white text-ink shadow-page"
                : "text-ink-dim hover:text-ink")
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Month grid
// ---------------------------------------------------------------------------

function MonthGrid({
  anchor, events, newIds, onPickDay, onPickEvent, onJumpToDay,
}: {
  anchor:      Date;
  events:      EventInRange[];
  newIds:      Set<string>;
  onPickDay:   (d: Date) => void;
  onPickEvent: (id: string) => void;
  onJumpToDay: (d: Date) => void;
}) {
  const cells = useMemo(() => monthCells(anchor), [anchor]);
  const byDay = useMemo(() => groupByLocalDay(events), [events]);
  const todayKey = ymd(new Date());
  const anchorMonth = anchor.getMonth();

  return (
    <div className="animate-gridIn overflow-hidden rounded-lg border border-hairline">
      <div className="grid grid-cols-7 bg-white">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => (
          <div
            key={d}
            className={
              "border-b border-hairline px-3 py-2.5 text-[10px] font-medium uppercase tracking-micro text-ink-faint " +
              (i < 6 ? "border-r border-hairline" : "")
            }
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-hairline">
        {cells.map((d, i) => {
          const key       = ymd(d);
          const inMonth   = d.getMonth() === anchorMonth;
          const isToday   = key === todayKey;
          const dayEvents = byDay.get(key) ?? [];
          return (
            <button
              key={key + "-" + i}
              type="button"
              onClick={() => onPickDay(d)}
              aria-label={`add event on ${key}`}
              className={
                "group relative flex min-h-[7.5rem] flex-col items-stretch gap-1.5 px-2 pb-2 pt-1.5 text-left " +
                "transition-colors duration-150 ease-out " +
                (inMonth ? "bg-white hover:bg-accent-soft" : "bg-[#FAF8F2] hover:bg-subtle")
              }
            >
              <div className="flex items-center justify-end">
                <DayNumber date={d} isToday={isToday} inMonth={inMonth} />
              </div>
              <CellChips
                events={dayEvents}
                newIds={newIds}
                onPickEvent={onPickEvent}
                onMore={(e) => {
                  e.stopPropagation();
                  onJumpToDay(d);
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DayNumber({
  date, isToday, inMonth,
}: { date: Date; isToday: boolean; inMonth: boolean }) {
  if (isToday) {
    return (
      <span
        aria-label="today"
        className="num inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-accent px-1 text-[12px] font-semibold tabular-nums text-white"
      >
        {date.getDate()}
      </span>
    );
  }
  return (
    <span
      className={
        "num text-[12px] tabular-nums leading-6 " +
        (inMonth ? "text-ink-dim" : "text-ink-faint")
      }
    >
      {date.getDate()}
    </span>
  );
}

function CellChips({
  events, newIds, onPickEvent, onMore,
}: {
  events:      EventInRange[];
  newIds:      Set<string>;
  onPickEvent: (id: string) => void;
  onMore:      (e: React.MouseEvent) => void;
}) {
  const MAX = 3;
  const shown = events.slice(0, MAX);
  const extra = events.length - shown.length;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {shown.map((e) => (
        <EventChip
          key={e.id}
          event={e}
          isNew={newIds.has(e.id)}
          onClick={(ev) => {
            ev.stopPropagation();
            onPickEvent(e.id);
          }}
        />
      ))}
      {extra > 0 && (
        <button
          type="button"
          onClick={onMore}
          className="self-start rounded px-1 py-px text-[11px] font-medium text-ink-faint transition hover:text-accent"
        >
          +{extra} more
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Week view — Google-style time grid: hour gutter + 7 day columns.
// ---------------------------------------------------------------------------

function WeekView({
  anchor, events, newIds, onPickSlot, onPickEvent,
}: {
  anchor:      Date;
  events:      EventInRange[];
  newIds:      Set<string>;
  onPickSlot:  (date: Date, time: string) => void;
  onPickEvent: (id: string) => void;
}) {
  const days  = useMemo(() => weekDays(anchor), [anchor]);
  const byDay = useMemo(() => groupByLocalDay(events), [events]);
  const now      = useNow();
  const todayKey = ymd(now);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = SCROLL_TO_HOUR * HOUR_PX;
  }, []);

  const todayIdx = days.findIndex((d) => ymd(d) === todayKey);
  const nowTop   = (now.getHours() + now.getMinutes() / 60) * HOUR_PX;

  return (
    <div className="animate-gridIn overflow-hidden rounded-lg border border-hairline bg-white">
      <DayHeaderRow days={days} todayKey={todayKey} />

      <div
        ref={scrollRef}
        className="relative overflow-y-auto"
        style={{ maxHeight: "calc(100dvh - 18rem)" }}
      >
        <div
          className="relative grid"
          style={{
            gridTemplateColumns: `${GUTTER_REM}rem repeat(7, minmax(0, 1fr))`,
            height: TOTAL_HOURS * HOUR_PX,
          }}
        >
          <HourGutter />
          {days.map((d) => {
            const laid    = layoutEvents(byDay.get(ymd(d)) ?? []);
            const isToday = ymd(d) === todayKey;
            return (
              <DayColumn
                key={ymd(d)}
                day={d}
                laid={laid}
                newIds={newIds}
                isToday={isToday}
                onPickSlot={onPickSlot}
                onPickEvent={onPickEvent}
                density="dense"
              />
            );
          })}

          {todayIdx >= 0 && <NowLine top={nowTop} todayIdx={todayIdx} columns={7} now={now} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Day view — same time grid, single column.
// ---------------------------------------------------------------------------

function DayView({
  anchor, events, newIds, onPickSlot, onPickEvent,
}: {
  anchor:      Date;
  events:      EventInRange[];
  newIds:      Set<string>;
  onPickSlot:  (date: Date, time: string) => void;
  onPickEvent: (id: string) => void;
}) {
  const byDay  = useMemo(() => groupByLocalDay(events), [events]);
  const laid   = useMemo(() => layoutEvents(byDay.get(ymd(anchor)) ?? []), [byDay, anchor]);
  const now      = useNow();
  const isToday  = sameLocalDay(anchor, now);
  const nowTop   = (now.getHours() + now.getMinutes() / 60) * HOUR_PX;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = SCROLL_TO_HOUR * HOUR_PX;
  }, []);

  return (
    <div className="animate-gridIn overflow-hidden rounded-lg border border-hairline bg-white">
      <DayHeaderRow days={[anchor]} todayKey={ymd(now)} />

      <div
        ref={scrollRef}
        className="relative overflow-y-auto"
        style={{ maxHeight: "calc(100dvh - 18rem)" }}
      >
        <div
          className="relative grid"
          style={{
            gridTemplateColumns: `${GUTTER_REM}rem minmax(0, 1fr)`,
            height: TOTAL_HOURS * HOUR_PX,
          }}
        >
          <HourGutter />
          <DayColumn
            day={anchor}
            laid={laid}
            newIds={newIds}
            isToday={isToday}
            onPickSlot={onPickSlot}
            onPickEvent={onPickEvent}
            density="roomy"
          />
          {isToday && <NowLine top={nowTop} todayIdx={0} columns={1} now={now} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Day-header row (sticky-like band above the time grid)
// ---------------------------------------------------------------------------

function DayHeaderRow({ days, todayKey }: { days: Date[]; todayKey: string }) {
  return (
    <div
      className="grid border-b border-hairline bg-white"
      style={{
        gridTemplateColumns: `${GUTTER_REM}rem repeat(${days.length}, minmax(0, 1fr))`,
      }}
    >
      <div className="border-r border-hairline" />
      {days.map((d, i) => {
        const isToday = ymd(d) === todayKey;
        const last    = i === days.length - 1;
        return (
          <div
            key={ymd(d)}
            className={
              "flex items-center gap-2.5 px-3 py-3 " +
              (last ? "" : "border-r border-hairline")
            }
          >
            <span
              className={
                "text-[10px] font-medium uppercase tracking-micro " +
                (isToday ? "text-accent" : "text-ink-faint")
              }
            >
              {d.toLocaleDateString(undefined, { weekday: "short" })}
            </span>
            {isToday ? (
              <span
                aria-label="today"
                className="num inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-accent px-1.5 text-sm font-semibold tabular-nums leading-none text-white"
              >
                {d.getDate()}
              </span>
            ) : (
              <span className="num text-xl font-semibold tabular-nums leading-none text-ink">
                {d.getDate()}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hour gutter
// ---------------------------------------------------------------------------

function HourGutter() {
  return (
    <div className="relative border-r border-hairline bg-white">
      {Array.from({ length: TOTAL_HOURS }, (_, h) => (
        <div
          key={h}
          className="num absolute right-2 -translate-y-1/2 tabular-nums text-[10px] font-medium text-ink-faint"
          style={{ top: h * HOUR_PX }}
        >
          {h === 0 ? "" : hourLabel(h)}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Day column (the hour-tall rail per day)
// ---------------------------------------------------------------------------

function DayColumn({
  day, laid, newIds, isToday, onPickSlot, onPickEvent, density,
}: {
  day:         Date;
  laid:        LaidOutEvent[];
  newIds:      Set<string>;
  isToday:     boolean;
  onPickSlot:  (date: Date, time: string) => void;
  onPickEvent: (id: string) => void;
  density:     "dense" | "roomy";
}) {
  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const y    = e.clientY - rect.top;
    const { hour, minute } = snapSlot(y);
    onPickSlot(day, `${pad(hour)}:${pad(minute)}`);
  }

  return (
    <div
      onClick={handleClick}
      className={
        "relative cursor-pointer border-r border-hairline last:border-r-0 " +
        "transition-colors duration-150 ease-out " +
        (isToday ? "bg-accent/[0.035]" : "hover:bg-subtle/60")
      }
      style={{
        // Hairline gridline at the bottom of each hour row, with a fainter
        // tick at the half-hour for finer time reading.
        backgroundImage: `repeating-linear-gradient(
          to bottom,
          transparent 0,
          transparent ${HOUR_PX / 2 - 1}px,
          rgb(217 210 191 / 0.22) ${HOUR_PX / 2 - 1}px,
          rgb(217 210 191 / 0.22) ${HOUR_PX / 2}px,
          transparent ${HOUR_PX / 2}px,
          transparent ${HOUR_PX - 1}px,
          rgb(217 210 191 / 0.5) ${HOUR_PX - 1}px,
          rgb(217 210 191 / 0.5) ${HOUR_PX}px
        )`,
      }}
    >
      {laid.map((ev) => (
        <TimedEventChip
          key={ev.event.id}
          event={ev.event}
          isNew={newIds.has(ev.event.id)}
          density={density}
          onClick={(e) => {
            e.stopPropagation();
            onPickEvent(ev.event.id);
          }}
          style={{
            top:    (ev.startMin / 60) * HOUR_PX,
            height: (ev.durationMin / 60) * HOUR_PX,
            left:   `calc(${(ev.col / ev.cols) * 100}% + 2px)`,
            width:  `calc(${(1 / ev.cols) * 100}% - 4px)`,
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Now-line
// ---------------------------------------------------------------------------

function NowLine({
  top, todayIdx, columns, now,
}: { top: number; todayIdx: number; columns: number; now: Date }) {
  // 24h `HH:MM` for compactness and unambiguous reading inside the gutter.
  const timeLabel = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return (
    <div
      className="pointer-events-none absolute left-0 right-0 z-10"
      style={{ top }}
      aria-hidden="true"
    >
      <div
        className="grid items-center"
        style={{ gridTemplateColumns: `${GUTTER_REM}rem repeat(${columns}, minmax(0, 1fr))` }}
      >
        <div className="flex justify-end pr-1.5">
          <span className="num rounded-sm bg-accent px-1.5 py-[1px] text-[10px] font-semibold tabular-nums leading-tight text-white">
            {timeLabel}
          </span>
        </div>
        {Array.from({ length: columns }, (_, i) => {
          const isToday = i === todayIdx;
          return (
            <div key={i} className="relative">
              {isToday && (
                <span
                  className="absolute -left-[3px] top-1/2 block size-1.5 -translate-y-1/2 rounded-full bg-accent ring-2 ring-white"
                  aria-hidden="true"
                />
              )}
              <div className={"h-px w-full " + (isToday ? "bg-accent" : "bg-accent/20")} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------

/** Status dot used as the leading anchor of every chip. Filled for accepted,
 *  a ring for pending (the event isn't committed yet), muted for declined. */
function StatusDot({ status }: { status: EventStatus }) {
  if (status === "accepted") {
    return (
      <span
        aria-hidden="true"
        className="block size-1.5 shrink-0 rounded-full bg-accent"
      />
    );
  }
  if (status === "pending") {
    return (
      <span
        aria-hidden="true"
        className="block size-1.5 shrink-0 rounded-full ring-[1.25px] ring-inset ring-accent/70"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="block size-1.5 shrink-0 rounded-full bg-ink-faint/70"
    />
  );
}

/** Block chip used in the month grid. */
function EventChip({
  event, isNew = false, onClick,
}: {
  event:    EventInRange;
  isNew?:   boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  const unit  = event.tracking_mode === "hours" ? "h" : "";
  const label = chipPrimaryLabel(event);
  const amountStr = event.amount !== null ? `${formatAmount(event.amount)}${unit}` : null;
  const s = chipStyle(event);

  return (
    <button
      type="button"
      onClick={onClick}
      title={chipTitle(event)}
      className={
        "flex min-w-0 items-center gap-1.5 rounded px-1.5 py-[3px] text-[11px] leading-tight " +
        "transition-colors duration-150 ease-out hover:bg-[var(--chip-bg-hover)] " +
        s.textClass + " " +
        (isNew ? "animate-chipIn" : "")
      }
      style={{
        backgroundColor: s.bg,
        color:           s.fg,
        ["--chip-bg-hover" as string]: s.hoverBg,
        ...(s.border ? { boxShadow: `inset 0 0 0 1px ${s.border}` } : {}),
      }}
    >
      <StatusDot status={event.status} />
      <span className="min-w-0 truncate font-medium">{label}</span>
      {amountStr && (
        <span className="num ml-auto shrink-0 tabular-nums text-[10px] opacity-70">{amountStr}</span>
      )}
    </button>
  );
}

/** Chip used in the week/day time grid — positioned absolutely. */
function TimedEventChip({
  event, isNew, density, style, onClick,
}: {
  event:   EventInRange;
  isNew:   boolean;
  density: "dense" | "roomy";
  style:   React.CSSProperties;
  onClick: (e: React.MouseEvent) => void;
}) {
  const unit  = event.tracking_mode === "hours" ? "h" : "";
  const when  = new Date(event.start_at).toLocaleTimeString(undefined, {
    hour: "numeric", minute: "2-digit",
  });
  const label = chipPrimaryLabel(event);
  const amountStr = event.amount !== null ? `${formatAmount(event.amount)}${unit}` : null;
  const s = chipStyle(event);

  // boxShadow composes the chip's inset border with a hover lift. The lift
  // is gated on a CSS var so we can chain it without clobbering the border.
  const baseShadow  = s.border ? `inset 0 0 0 1px ${s.border}` : null;
  const hoverShadow = "0 4px 12px -6px rgba(26, 24, 20, 0.18)";

  return (
    <button
      type="button"
      onClick={onClick}
      title={chipTitle(event)}
      className={
        "absolute z-[1] flex min-w-0 flex-col gap-0.5 overflow-hidden rounded-md px-2 py-1 " +
        "text-left text-[11px] leading-tight transition-[box-shadow,background-color] duration-150 ease-out " +
        "hover:z-[2] hover:bg-[var(--chip-bg-hover)] hover:shadow-[var(--chip-shadow-hover)] " +
        s.textClass + " " +
        (isNew ? "animate-chipIn " : "")
      }
      style={{
        ...style,
        backgroundColor: s.bg,
        color:           s.fg,
        ["--chip-bg-hover" as string]: s.hoverBg,
        ["--chip-shadow-hover" as string]: baseShadow
          ? `${baseShadow}, ${hoverShadow}`
          : hoverShadow,
        ...(baseShadow ? { boxShadow: baseShadow } : {}),
      }}
    >
      {density === "dense" ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <StatusDot status={event.status} />
          <span className="min-w-0 truncate font-medium">{label}</span>
          {amountStr && (
            <span className="num ml-auto shrink-0 tabular-nums text-[10px] opacity-70">{amountStr}</span>
          )}
        </span>
      ) : (
        <>
          <span className="flex items-center gap-1.5">
            <StatusDot status={event.status} />
            <span className="num shrink-0 tabular-nums text-[10px] opacity-75">{when}</span>
            {amountStr && (
              <span className="num ml-auto shrink-0 tabular-nums font-semibold">{amountStr}</span>
            )}
          </span>
          <span className="min-w-0 truncate font-medium">
            {label}
            {event.notes ? <span className="opacity-70"> · {event.notes}</span> : null}
          </span>
        </>
      )}
    </button>
  );
}

// Resolved colors for a chip in its current status. Accepted = soft green
// wash + deep green text (committed, but legible at small sizes). Pending =
// white + green ring (open, awaiting confirmation). Declined = paper wash +
// faint strikethrough.
interface ChipStyle {
  bg:        string;
  fg:        string;
  hoverBg:   string;
  border:    string | null;
  textClass: string;
}

const ACCENT          = "#15803D"; // brand green; matches tailwind accent.DEFAULT
const ACCEPTED_BG     = "#15803D14"; // ~8% wash
const ACCEPTED_HOVER  = "#15803D29"; // ~16%
const ACCEPTED_TEXT   = "#0F5A2B";   // deeper green for contrast on wash
const PENDING_HOVER   = "#15803D0F"; // ~6%
const DECLINED_BG     = "#F6F4EE";   // matches `subtle` token
const DECLINED_HOVER  = "#EDE9DC";

function chipStyle(event: EventInRange): ChipStyle {
  switch (event.status) {
    case "accepted":
      return {
        bg:        ACCEPTED_BG,
        fg:        ACCEPTED_TEXT,
        hoverBg:   ACCEPTED_HOVER,
        border:    null,
        textClass: "",
      };
    case "pending":
      return {
        bg:        "#FFFFFF",
        fg:        "#1A1814",
        hoverBg:   PENDING_HOVER,
        border:    ACCENT + "5C", // ~36% green hairline
        textClass: "",
      };
    case "declined":
      return {
        bg:        DECLINED_BG,
        fg:        "#8E8675",
        hoverBg:   DECLINED_HOVER,
        border:    null,
        textClass: "line-through",
      };
  }
}

function chipPrimaryLabel(e: EventInRange): string {
  if (e.title && e.title.trim()) return e.title;
  if (e.subscription_name) return e.subscription_name;
  return "(no title)";
}

function chipTitle(e: EventInRange): string {
  const parts: string[] = [];
  parts.push(chipPrimaryLabel(e));
  if (e.subscription_name && e.title) parts.push(e.subscription_name);
  if (e.amount !== null) {
    const unit = e.tracking_mode === "hours" ? "h" : "";
    parts.push(`${formatAmount(e.amount)}${unit}`);
  }
  parts.push(e.status);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// New-event modal
// ---------------------------------------------------------------------------

function NewEventModal({
  date, defaultTime: presetTime, subscriptions, subscriptionsError, onClose, onCreated,
}: {
  date:               Date;
  defaultTime?:       string;
  subscriptions:      Subscription[];
  subscriptionsError: string | null;
  onClose:            () => void;
  onCreated:          (e: EventInRange) => void;
}) {
  const trackableSubs = useMemo(
    () => subscriptions.filter(
      (s) => s.tracking_mode !== "duration" && s.status === "active",
    ),
    [subscriptions],
  );

  const initialStart = presetTime ?? defaultTime(date);
  const [title,     setTitle]     = useState("");
  const [subId,     setSubId]     = useState<string>("");
  const [amountStr, setAmountStr] = useState("");
  const [notes,     setNotes]     = useState("");
  const [timeStr,   setTimeStr]   = useState(initialStart);
  const [endTimeStr, setEndTimeStr] = useState(() => addMinutesHHMM(initialStart, 60));
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  // When the user moves the start, keep the existing duration: shift the end
  // by the same delta. If they later edit end manually, that's preserved
  // because shifting an already-edited end still preserves duration.
  function changeStart(next: string) {
    const delta = diffMinutesHHMM(timeStr, next);
    setTimeStr(next);
    setEndTimeStr((prev) => addMinutesHHMM(prev, delta));
  }

  // Recurrence form. `freq === ""` means single occurrence.
  const [freq,       setFreq]       = useState<"" | Freq>("");
  const [weekdays,   setWeekdays]   = useState<Set<Weekday>>(() => new Set([defaultWeekdayOf(date)]));
  const [endKind,    setEndKind]    = useState<"never" | "until" | "count">("never");
  const [endDate,    setEndDate]    = useState<string>(defaultEndDate(date));
  const [endCount,   setEndCount]   = useState<string>("10");

  function toggleWeekday(d: Weekday) {
    setWeekdays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sub = trackableSubs.find((s) => s.id === subId);
  const hasSub = subId !== "";
  const amount = Number(amountStr);
  const amountValid = hasSub
    ? amountStr.trim() !== "" && Number.isFinite(amount) && amount > 0
    : true;
  const titleValid = hasSub || title.trim() !== "";
  // End is required and must sit strictly after start.
  const endValid = endTimeStr.trim() !== "" && diffMinutesHHMM(timeStr, endTimeStr) > 0;

  const canSubmit = !submitting && titleValid && amountValid && endValid;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const startAt = combineDateAndTime(date, timeStr);
      const endAt   = combineDateAndTime(date, endTimeStr);
      const rule = buildRecurrence(freq, weekdays, endKind, endDate, endCount);
      const created = await api.createEvent({
        title:           title.trim() === "" ? null : title.trim(),
        start_at:        startAt.toISOString(),
        end_at:          endAt.toISOString(),
        // New events default to pending — user must explicitly accept before
        // they burn the subscription.
        status:          "pending",
        subscription_id: hasSub ? subId : null,
        amount:          hasSub ? amount : null,
        notes:           notes.trim() === "" ? null : notes.trim(),
        recurrence_rule: rule,
      });
      onCreated(eventToInRange(created, sub));
    } catch (err) {
      setError(saveErrorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="new event"
      className="animate-backdropIn fixed inset-0 z-40 flex items-end justify-center bg-ink/30 px-4 backdrop-blur-[2px] sm:items-center"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="animate-modalIn w-full max-w-md rounded-md border border-hairline bg-white px-5 py-4 shadow-[0_16px_40px_-16px_rgba(26,24,20,0.25)]"
      >
        <div className="flex items-baseline justify-between border-b border-hairline pb-3">
          <h2 className="text-base font-semibold text-ink">New event</h2>
          <p className="num text-xs text-ink-faint">
            {date.toLocaleDateString(undefined, {
              weekday: "short", month: "short", day: "numeric",
            })}
          </p>
        </div>

        {subscriptionsError && (
          <p className="mt-3 text-xs text-pace-red">
            Couldn't load subscriptions: {subscriptionsError}
          </p>
        )}

        <div className="mt-4 space-y-4">
          <Field label="Title">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={hasSub ? "optional" : "what's happening?"}
              autoFocus
              className={inputClass}
            />
          </Field>

          <Field label="Subscription">
            <select
              value={subId}
              onChange={(e) => setSubId(e.target.value)}
              className={inputClass}
            >
              <option value="">(no subscription — calendar only)</option>
              {trackableSubs.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>

          {hasSub && (
            <Field label={sub?.tracking_mode === "hours" ? "Hours" : "Amount"}>
              <input
                type="number"
                min={0}
                step={sub?.tracking_mode === "hours" ? "0.01" : "1"}
                inputMode={sub?.tracking_mode === "hours" ? "decimal" : "numeric"}
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder={sub?.tracking_mode === "hours" ? "1.5" : "1"}
                className={inputClass + " num tabular-nums"}
              />
            </Field>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field label="Start">
              <input
                type="time"
                required
                value={timeStr}
                onChange={(e) => changeStart(e.target.value)}
                className={inputClass + " num tabular-nums"}
              />
            </Field>
            <Field label="End">
              <input
                type="time"
                required
                value={endTimeStr}
                onChange={(e) => setEndTimeStr(e.target.value)}
                className={inputClass + " num tabular-nums"}
              />
            </Field>
          </div>
          {!endValid && (
            <p className="text-[11px] text-pace-red">
              End time must be after start time.
            </p>
          )}

          <Field label="Notes">
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="optional"
              className={inputClass}
            />
          </Field>

          <Field label="Repeats">
            <select
              value={freq}
              onChange={(e) => setFreq(e.target.value as "" | Freq)}
              className={inputClass}
            >
              <option value="">Doesn't repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </Field>

          {freq === "weekly" && (
            <Field label="On">
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAY_OPTS.map(({ code, label }) => {
                  const active = weekdays.has(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => toggleWeekday(code)}
                      aria-pressed={active}
                      className={
                        "h-8 min-w-8 rounded-md px-2 text-xs font-semibold transition " +
                        (active
                          ? "bg-accent text-white"
                          : "border border-hairline bg-white text-ink-dim hover:bg-subtle hover:text-ink")
                      }
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}

          {freq !== "" && (
            <Field label="Ends">
              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-3 text-sm text-ink">
                  <input
                    type="radio"
                    name="end-kind"
                    checked={endKind === "never"}
                    onChange={() => setEndKind("never")}
                    className="accent-accent"
                  />
                  <span>Never</span>
                </label>
                <label className="flex items-center gap-3 text-sm text-ink">
                  <input
                    type="radio"
                    name="end-kind"
                    checked={endKind === "until"}
                    onChange={() => setEndKind("until")}
                    className="accent-accent"
                  />
                  <span>On</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    onFocus={() => setEndKind("until")}
                    className="num h-8 flex-1 rounded-md border border-hairline bg-white px-2 text-sm tabular-nums text-ink outline-none transition hover:border-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
                  />
                </label>
                <label className="flex items-center gap-3 text-sm text-ink">
                  <input
                    type="radio"
                    name="end-kind"
                    checked={endKind === "count"}
                    onChange={() => setEndKind("count")}
                    className="accent-accent"
                  />
                  <span>After</span>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={endCount}
                    onChange={(e) => setEndCount(e.target.value)}
                    onFocus={() => setEndKind("count")}
                    className="num h-8 w-16 rounded-md border border-hairline bg-white px-2 text-sm tabular-nums text-ink outline-none transition hover:border-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
                  />
                  <span className="text-ink-dim">occurrences</span>
                </label>
              </div>
            </Field>
          )}
        </div>

        {hasSub && (
          <p className="mt-3 text-xs text-ink-faint">
            Saved as pending. Accept it later to burn the subscription.
          </p>
        )}

        {error && (
          <p className="mt-3 text-xs text-pace-red">{error}</p>
        )}

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-hairline pt-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="inline-flex h-8 items-center rounded-md border border-hairline bg-white px-3 text-sm font-medium text-ink transition hover:bg-subtle disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex h-8 items-center rounded-md border border-accent bg-accent px-3 text-sm font-medium text-white transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:border-ink-faint disabled:bg-ink-faint"
          >
            {submitting ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event detail modal — opens when an existing event chip is clicked.
// ---------------------------------------------------------------------------

function EventDetailModal({
  eventId, subscriptions, onClose, onUpdated, onDeleted,
}: {
  eventId:       string;
  subscriptions: Subscription[];
  onClose:       () => void;
  onUpdated:     (e: EventInRange) => void;
  onDeleted:     (id: string) => void;
}) {
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEvent(null);
    setLoadError(null);
    api.getEvent(eventId).then(
      (data) => { if (!cancelled) setEvent(data); },
      (err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => { cancelled = true; };
  }, [eventId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function syncToParent(updated: CalendarEvent) {
    const sub = updated.subscription_id
      ? subscriptions.find((s) => s.id === updated.subscription_id) ?? null
      : null;
    onUpdated(eventToInRange(updated, sub ?? undefined));
  }

  async function runAction(fn: () => Promise<CalendarEvent>) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const updated = await fn();
      setEvent(updated);
      syncToParent(updated);
    } catch (err) {
      setActionError(saveErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // A composite id (`<parent_id>:date`) marks this view as a single
  // occurrence of a recurring series. The detail response carries the
  // parent's recurrence_rule for describing the cadence; deleting from
  // here removes the whole series.
  const isInstance = isRecurringInstance(eventId);
  const parentId = isInstance ? eventId.split(":")[0] : eventId;
  const recurrence = event?.recurrence_rule ?? null;

  async function handleDelete() {
    if (busy) return;
    const prompt = recurrence
      ? "Delete the entire series? All future occurrences will be removed."
      : "Delete this event?";
    if (!confirm(prompt)) return;
    setBusy(true);
    setActionError(null);
    try {
      // Per-instance delete is intentionally unsupported by the backend; for
      // a recurring entry we always delete the parent series.
      await api.deleteEvent(parentId);
      // Tell the parent to drop this id from its rendered list. For a series
      // root, dropping the root id is correct — virtual instances will stop
      // being generated on the next refetch.
      onDeleted(eventId);
    } catch (err) {
      setActionError(saveErrorMessage(err));
      setBusy(false);
    }
  }

  const sub = event?.subscription_id
    ? subscriptions.find((s) => s.id === event.subscription_id) ?? null
    : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="event detail"
      className="animate-backdropIn fixed inset-0 z-40 flex items-end justify-center bg-ink/30 px-4 backdrop-blur-[2px] sm:items-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-modalIn w-full max-w-md rounded-md border border-hairline bg-white px-5 py-4 shadow-[0_16px_40px_-16px_rgba(26,24,20,0.25)]"
      >
        {event === null && !loadError && (
          <p className="py-6 text-center text-sm text-ink-faint">Loading…</p>
        )}

        {loadError && (
          <p className="py-6 text-center text-sm text-pace-red">{loadError}</p>
        )}

        {event && (
          <>
            <div className="flex items-start justify-between gap-3 border-b border-hairline pb-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-ink">
                  {event.title?.trim() || sub?.name || "(no title)"}
                </h2>
                <p className="mt-0.5 text-xs text-ink-faint">
                  {formatEventWhen(event)}
                </p>
              </div>
              <StatusBadge status={event.status} />
            </div>

            <dl className="mt-4 space-y-2 text-sm">
              {sub && (
                <Row label="Subscription">
                  <Link
                    to={`/subscriptions/${sub.id}`}
                    onClick={onClose}
                    className="text-accent transition hover:underline"
                  >
                    {sub.name}
                  </Link>
                </Row>
              )}
              {event.amount !== null && (
                <Row label="Amount">
                  <span className="num tabular-nums">
                    {formatAmount(event.amount)}
                    {sub?.tracking_mode === "hours" ? "h" : ""}
                  </span>
                </Row>
              )}
              {event.notes && (
                <Row label="Notes">
                  <span className="text-ink-dim">{event.notes}</span>
                </Row>
              )}
              {recurrence && (
                <Row label="Repeats">
                  <span className="text-ink-dim">{describeRecurrence(recurrence)}</span>
                </Row>
              )}
              {!sub && (
                <p className="text-xs text-ink-faint">
                  Standalone calendar entry, no subscription linked.
                </p>
              )}
            </dl>

            {actionError && (
              <p className="mt-3 text-xs text-pace-red">{actionError}</p>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3">
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className="inline-flex h-8 items-center rounded-md border border-pace-red/30 bg-white px-3 text-sm font-medium text-pace-red transition hover:bg-pace-red/5 disabled:opacity-50"
              >
                {recurrence ? "Delete series" : "Delete"}
              </button>
              <div className="flex items-center gap-2">
                {sub && event.status !== "declined" && (
                  <button
                    type="button"
                    onClick={() => runAction(() => api.declineEvent(eventId))}
                    disabled={busy}
                    className="inline-flex h-8 items-center rounded-md border border-hairline bg-white px-3 text-sm font-medium text-ink transition hover:bg-subtle disabled:opacity-50"
                  >
                    Decline
                  </button>
                )}
                {sub && event.status !== "accepted" && (
                  <button
                    type="button"
                    onClick={() => runAction(() => api.acceptEvent(eventId))}
                    disabled={busy}
                    className="inline-flex h-8 items-center rounded-md border border-accent bg-accent px-3 text-sm font-medium text-white transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:border-ink-faint disabled:bg-ink-faint"
                  >
                    Accept
                  </button>
                )}
                {!sub && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex h-8 items-center rounded-md border border-hairline bg-white px-3 text-sm font-medium text-ink transition hover:bg-subtle"
                  >
                    Done
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-xs font-medium text-ink-dim">{label}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  );
}

function StatusBadge({ status }: { status: EventStatus }) {
  const styles: Record<EventStatus, string> = {
    pending:  "border-accent/30 bg-white       text-ink-dim",
    accepted: "border-transparent bg-accent/10 text-accent",
    declined: "border-hairline    bg-subtle    text-ink-faint",
  };
  const labels: Record<EventStatus, string> = {
    pending: "Pending", accepted: "Accepted", declined: "Declined",
  };
  return (
    <span
      className={
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium " +
        styles[status]
      }
    >
      <StatusDot status={status} />
      {labels[status]}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-ink-dim">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

const inputClass =
  "h-8 w-full rounded-md border border-hairline bg-white px-2.5 text-sm text-ink " +
  "placeholder:text-ink-faint outline-none transition " +
  "hover:border-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ErrorBox({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-md border border-pace-red/40 bg-pace-red/5 px-4 py-3">
      <p className="text-sm font-semibold text-pace-red">{title}</p>
      <p className="mt-0.5 text-xs text-ink-dim">{detail}</p>
    </div>
  );
}

function parseView(raw: string | null): View {
  return raw === "week" || raw === "day" ? raw : "month";
}

/** `YYYY-MM-DD` → local-noon `Date`; null/invalid → today. */
function parseDate(raw: string | null): Date {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map((n) => parseInt(n, 10));
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  }
  return new Date();
}

function ymd(d: Date): string {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function shift(d: Date, view: View, dir: 1 | -1): Date {
  const next = new Date(d);
  if (view === "month") next.setMonth(next.getMonth() + dir);
  else if (view === "week") next.setDate(next.getDate() + 7 * dir);
  else next.setDate(next.getDate() + dir);
  return next;
}

function visibleWindow(anchor: Date, view: View): [Date, Date] {
  if (view === "month") {
    const start = startOfMonthGrid(anchor);
    const end   = new Date(start);
    end.setDate(end.getDate() + 42);
    return [startOfDayLocal(start), startOfDayLocal(end)];
  }
  if (view === "week") {
    const start = startOfWeekMonday(anchor);
    const end   = new Date(start);
    end.setDate(end.getDate() + 7);
    return [startOfDayLocal(start), startOfDayLocal(end)];
  }
  const start = startOfDayLocal(anchor);
  const end   = new Date(start);
  end.setDate(end.getDate() + 1);
  return [start, end];
}

function startOfDayLocal(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfMonthGrid(anchor: Date): Date {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  return startOfWeekMonday(first);
}

function startOfWeekMonday(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const offset = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - offset);
  return x;
}

function monthCells(anchor: Date): Date[] {
  const start = startOfMonthGrid(anchor);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function weekDays(anchor: Date): Date[] {
  const start = startOfWeekMonday(anchor);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function groupByLocalDay(events: EventInRange[]): Map<string, EventInRange[]> {
  const out = new Map<string, EventInRange[]>();
  for (const e of events) {
    const key = ymd(new Date(e.start_at));
    const arr = out.get(key);
    if (arr) arr.push(e);
    else out.set(key, [e]);
  }
  for (const arr of out.values()) {
    arr.sort((a, b) => +new Date(a.start_at) - +new Date(b.start_at));
  }
  return out;
}

function noonLocal(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

/** Default `HH:MM` for the time input — today → current time, otherwise noon. */
function defaultTime(d: Date): string {
  const today = new Date();
  if (sameLocalDay(d, today)) {
    return `${pad(today.getHours())}:${pad(today.getMinutes())}`;
  }
  return "12:00";
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function combineDateAndTime(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(),
                  Number.isFinite(h) ? h : 12,
                  Number.isFinite(m) ? m : 0,
                  0, 0);
}

/** Shift an `HH:MM` string by `minutes`, clamping to `[00:00, 23:59]`. */
function addMinutesHHMM(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const total = Math.max(0, Math.min(23 * 60 + 59, h * 60 + m + minutes));
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** Minutes between two `HH:MM` strings — `b - a`. Returns 0 if either is malformed. */
function diffMinutesHHMM(a: string, b: string): number {
  const [ah, am] = a.split(":").map((n) => parseInt(n, 10));
  const [bh, bm] = b.split(":").map((n) => parseInt(n, 10));
  if (![ah, am, bh, bm].every((n) => Number.isFinite(n))) return 0;
  return (bh * 60 + bm) - (ah * 60 + am);
}

function primaryLabel(anchor: Date, view: View): string {
  if (view === "month") {
    return anchor.toLocaleDateString(undefined, { month: "long" });
  }
  if (view === "week") {
    const days = weekDays(anchor);
    const a = days[0];
    const b = days[6];
    const sameMonth = a.getMonth() === b.getMonth();
    if (sameMonth) {
      return `${a.toLocaleDateString(undefined, { month: "long" })} ${a.getDate()} – ${b.getDate()}`;
    }
    const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${fmt(a)} – ${fmt(b)}`;
  }
  return anchor.toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });
}

function yearLabel(anchor: Date, view: View): string {
  if (view === "week") {
    const days = weekDays(anchor);
    const a = days[0].getFullYear();
    const b = days[6].getFullYear();
    return a === b ? String(a) : `${a} – ${b}`;
  }
  return String(anchor.getFullYear());
}

function hourLabel(h: number): string {
  if (h === 0)   return "12 AM";
  if (h < 12)    return `${h} AM`;
  if (h === 12)  return "12 PM";
  return `${h - 12} PM`;
}

/** Click y-offset → quantized {hour, minute} slot (snapped to 30 min). */
function snapSlot(y: number): { hour: number; minute: number } {
  const totalMin = (y / HOUR_PX) * 60;
  const snapped  = Math.max(0, Math.min(23 * 60 + 30, Math.round(totalMin / 30) * 30));
  return { hour: Math.floor(snapped / 60), minute: snapped % 60 };
}

function formatAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

// ---------------------------------------------------------------------------
// Recurrence form helpers
// ---------------------------------------------------------------------------

const WEEKDAY_OPTS: { code: Weekday; label: string }[] = [
  { code: "MO", label: "M" },
  { code: "TU", label: "T" },
  { code: "WE", label: "W" },
  { code: "TH", label: "T" },
  { code: "FR", label: "F" },
  { code: "SA", label: "S" },
  { code: "SU", label: "S" },
];

const WEEKDAY_FROM_INDEX: Weekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function defaultWeekdayOf(d: Date): Weekday {
  return WEEKDAY_FROM_INDEX[d.getDay()];
}

/** Default the "Ends on" date to ~3 months from the start. */
function defaultEndDate(start: Date): string {
  const d = new Date(start);
  d.setMonth(d.getMonth() + 3);
  return d.toISOString().slice(0, 10);
}

function buildRecurrence(
  freq: "" | Freq,
  weekdays: Set<Weekday>,
  endKind: "never" | "until" | "count",
  endDate: string,
  endCount: string,
): RecurrenceRule | null {
  if (freq === "") return null;
  const rule: RecurrenceRule = { freq };
  if (freq === "weekly" && weekdays.size > 0) {
    rule.byweekday = WEEKDAY_FROM_INDEX
      .filter((d) => weekdays.has(d))
      // Sort by ISO weekday order (Mon → Sun) for stable JSON.
      .sort((a, b) => WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b));
  }
  if (endKind === "until") {
    rule.until = endDate;
  } else if (endKind === "count") {
    const n = parseInt(endCount, 10);
    if (Number.isFinite(n) && n > 0) rule.count = n;
  }
  return rule;
}

const WEEKDAY_ORDER: Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/** Human label for a rule on the detail modal. */
function describeRecurrence(rule: RecurrenceRule): string {
  const dayNames: Record<Weekday, string> = {
    MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun",
  };
  let core: string;
  if (rule.freq === "daily") core = "Repeats daily";
  else if (rule.freq === "monthly") core = "Repeats monthly";
  else {
    const days = rule.byweekday?.length
      ? rule.byweekday.map((d) => dayNames[d]).join(", ")
      : null;
    core = days ? `Repeats weekly on ${days}` : "Repeats weekly";
  }
  if (rule.until) core += `, until ${rule.until}`;
  else if (rule.count) core += `, ${rule.count} occurrences`;
  return core;
}

/** Format the event's time range for the detail header. */
function formatEventWhen(e: CalendarEvent): string {
  const start = new Date(e.start_at);
  const dateLabel = start.toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
  });
  const startLabel = start.toLocaleTimeString(undefined, {
    hour: "numeric", minute: "2-digit",
  });
  if (e.end_at) {
    const endLabel = new Date(e.end_at).toLocaleTimeString(undefined, {
      hour: "numeric", minute: "2-digit",
    });
    return `${dateLabel} · ${startLabel} – ${endLabel}`;
  }
  return `${dateLabel} · ${startLabel}`;
}

function saveErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "amount_must_be_positive":          return "Amount must be greater than 0.";
      case "subscription_amount_mismatch":     return "Pick a subscription, or remove the amount.";
      case "end_before_start":                 return "End time must be after start.";
      case "events_forbidden_for_duration":    return "This subscription tracks duration, not usage.";
      case "accept_requires_subscription":     return "Standalone events can't be accepted.";
      case "not_found":                        return "Event no longer exists.";
      default:                                 return `Couldn't save (${err.code}).`;
    }
  }
  return err instanceof Error ? err.message : "Couldn't save event.";
}

/** Build a calendar-range row from a freshly-created/updated event, looking
 *  up the linked subscription's display fields when present. */
function eventToInRange(e: CalendarEvent, sub: Subscription | undefined): EventInRange {
  return {
    id:                e.id,
    title:             e.title,
    start_at:          e.start_at,
    end_at:            e.end_at,
    status:            e.status,
    subscription_id:   e.subscription_id,
    subscription_name: sub?.name ?? null,
    tracking_mode:     sub?.tracking_mode ?? null,
    amount:            e.amount,
    notes:             e.notes,
    created_at:        e.created_at,
    updated_at:        e.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Event layout — Google-style cluster columns.
// ---------------------------------------------------------------------------

interface LaidOutEvent {
  event:       EventInRange;
  startMin:    number;
  durationMin: number;
  col:         number;
  cols:        number;
}

/** Lay out a day's events as positioned blocks. Overlapping events split the
 *  column width evenly inside their cluster — same algorithm Google Calendar
 *  uses for concurrent events. Duration honors `end_at` when present;
 *  otherwise falls back to a 30-minute block. */
function layoutEvents(events: EventInRange[]): LaidOutEvent[] {
  if (events.length === 0) return [];

  const items = events
    .map((e) => {
      const start = new Date(e.start_at);
      const startMin = start.getHours() * 60 + start.getMinutes();
      let durationMin = DEFAULT_DURATION_MIN;
      if (e.end_at) {
        const end = new Date(e.end_at);
        const endMin = end.getHours() * 60 + end.getMinutes();
        durationMin = Math.max(15, endMin - startMin);
      }
      return { event: e, startMin, durationMin };
    })
    .sort((a, b) => a.startMin - b.startMin);

  // Partition into clusters of overlapping events.
  const clusters: typeof items[] = [];
  let curr: typeof items = [];
  let currEnd = -Infinity;
  for (const it of items) {
    if (it.startMin < currEnd) {
      curr.push(it);
      currEnd = Math.max(currEnd, it.startMin + it.durationMin);
    } else {
      if (curr.length) clusters.push(curr);
      curr = [it];
      currEnd = it.startMin + it.durationMin;
    }
  }
  if (curr.length) clusters.push(curr);

  // Greedy column assignment within each cluster.
  const out: LaidOutEvent[] = [];
  for (const cluster of clusters) {
    const colEnds: number[] = [];
    const assigned: number[] = [];
    for (const it of cluster) {
      let col = colEnds.findIndex((end) => end <= it.startMin);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(0);
      }
      colEnds[col] = it.startMin + it.durationMin;
      assigned.push(col);
    }
    const cols = colEnds.length;
    cluster.forEach((it, i) => {
      out.push({
        event:       it.event,
        startMin:    it.startMin,
        durationMin: it.durationMin,
        col:         assigned[i],
        cols,
      });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Re-render once per minute so the now-line drifts smoothly. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}
