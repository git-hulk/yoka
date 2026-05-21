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
  Subscription,
} from "../lib/types";

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
  const subsState = useFetch(() => api.listSubscriptions(), []);

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

  const subscriptions = subsState.status === "ok" ? subsState.data : [];
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
    <header className="space-y-5 border-b border-hairline pb-6">
      <div>
        <p className="text-[11px] uppercase tracking-micro text-ink-faint">
          Calendar · <span className="num tabular-nums">{yearLabel(anchor, view)}</span>
        </p>
        <h1 className="serif mt-3 text-4xl leading-none text-ink">
          {primaryLabel(anchor, view)}
        </h1>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={onToday}
            className="border-b border-ink-dim/40 pb-0.5 text-[11px] uppercase tracking-micro text-ink-dim transition-colors duration-200 ease-out hover:border-accent hover:text-accent"
          >
            today
          </button>
          <div className="flex items-center gap-1">
            <NavBtn direction="prev" onClick={onPrev} />
            <NavBtn direction="next" onClick={onNext} />
          </div>
        </div>
        <ViewSwitcher view={view} onChange={onView} />
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
      className="inline-flex size-8 items-center justify-center rounded-full text-ink-faint transition-colors duration-200 ease-out hover:bg-ink/[0.05] hover:text-ink"
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
  const opts: View[] = ["month", "week", "day"];
  return (
    <div
      role="tablist"
      aria-label="calendar view"
      className="inline-flex items-baseline gap-5 text-[11px] uppercase tracking-micro"
    >
      {opts.map((v) => {
        const active = v === view;
        return (
          <button
            key={v}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(v)}
            className={
              "border-b pb-0.5 transition-colors duration-200 ease-out " +
              (active
                ? "border-accent text-accent"
                : "border-transparent text-ink-faint hover:text-ink-dim")
            }
          >
            {v}
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
    <div className="animate-gridIn">
      <div className="grid grid-cols-7 border-b border-hairline pb-2.5">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div
            key={d}
            className="px-2 text-center text-[11px] uppercase tracking-micro text-ink-faint"
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
                "group relative flex min-h-[7rem] flex-col items-stretch gap-1.5 px-2.5 py-2.5 text-left " +
                "transition-colors duration-200 ease-out hover:bg-white " +
                (isToday
                  ? "bg-accent/[0.04]"
                  : inMonth ? "bg-white" : "bg-white/50")
              }
            >
              <div className="flex items-center justify-between">
                <span className="inline-flex flex-col items-start leading-none">
                  <span
                    className={
                      "num text-[12px] tabular-nums transition-colors duration-200 " +
                      (isToday
                        ? "font-semibold text-accent"
                        : inMonth
                          ? "text-ink-dim"
                          : "text-ink-faint")
                    }
                  >
                    {d.getDate()}
                  </span>
                  {isToday && (
                    <span
                      aria-hidden="true"
                      className="mt-1 block h-px w-3 bg-accent"
                    />
                  )}
                </span>
                <span
                  aria-hidden="true"
                  className="text-[13px] leading-none text-ink-faint opacity-0 translate-y-0.5 transition-all duration-200 ease-out group-hover:translate-y-0 group-hover:opacity-100"
                >
                  ＋
                </span>
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
          className="self-start rounded px-1 text-[11px] uppercase tracking-micro text-ink-faint transition-colors duration-200 hover:text-accent"
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
    <div className="animate-gridIn border-b border-hairline">
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

          {todayIdx >= 0 && <NowLine top={nowTop} todayIdx={todayIdx} columns={7} />}
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
    <div className="animate-gridIn border-b border-hairline">
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
          {isToday && <NowLine top={nowTop} todayIdx={0} columns={1} />}
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
      className="grid border-b border-hairline"
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
              "flex flex-col items-center justify-center gap-1.5 px-2 py-3.5 " +
              (last ? "" : "border-r border-hairline ") +
              (isToday ? "bg-accent/[0.05]" : "")
            }
          >
            <p
              className={
                "text-[11px] uppercase tracking-micro " +
                (isToday ? "text-accent" : "text-ink-faint")
              }
            >
              {d.toLocaleDateString(undefined, { weekday: "short" })}
            </p>
            <div className="flex flex-col items-center gap-1 leading-none">
              <p
                className={
                  "num text-xl tabular-nums leading-none " +
                  (isToday ? "font-semibold text-accent" : "text-ink-dim")
                }
              >
                {d.getDate()}
              </p>
              {isToday && (
                <span aria-hidden="true" className="block h-px w-4 bg-accent" />
              )}
            </div>
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
    <div className="relative border-r border-hairline">
      {Array.from({ length: TOTAL_HOURS }, (_, h) => (
        <div
          key={h}
          className="num absolute right-2 -translate-y-1/2 tabular-nums text-[10px] text-ink-faint"
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
        "transition-colors duration-200 ease-out " +
        (isToday ? "bg-accent/[0.04]" : "hover:bg-ink/[0.015]")
      }
      style={{
        // Hairline gridline at the bottom of each hour row.
        backgroundImage: `repeating-linear-gradient(
          to bottom,
          transparent 0,
          transparent ${HOUR_PX - 1}px,
          rgb(217 210 191 / 0.55) ${HOUR_PX - 1}px,
          rgb(217 210 191 / 0.55) ${HOUR_PX}px
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
  top, todayIdx, columns,
}: { top: number; todayIdx: number; columns: number }) {
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
        <div className="flex justify-end pr-2">
          <span className="num bg-canvas px-1 text-[10px] uppercase tracking-micro text-accent">
            now
          </span>
        </div>
        {Array.from({ length: columns }, (_, i) => {
          const isToday = i === todayIdx;
          return (
            <div key={i} className="relative">
              {isToday && (
                <span
                  className="absolute -left-[3px] top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-accent"
                  aria-hidden="true"
                />
              )}
              <div className={"h-px w-full " + (isToday ? "bg-accent" : "bg-accent/25")} />
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

/** Block chip used in the month grid. */
function EventChip({
  event, isNew = false, onClick,
}: {
  event:    EventInRange;
  isNew?:   boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  const color = chipColor(event);
  const unit  = event.tracking_mode === "hours" ? "h" : "";
  const label = chipPrimaryLabel(event);
  const amountStr = event.amount !== null ? `${formatAmount(event.amount)}${unit}` : null;
  const decorated = chipDecoration(event.status);

  return (
    <button
      type="button"
      onClick={onClick}
      title={chipTitle(event)}
      className={
        "flex min-w-0 items-baseline gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] leading-tight " +
        "transition-colors duration-200 ease-out hover:bg-[var(--chip-bg-hover)] " +
        decorated.text + " " +
        (isNew ? "animate-chipIn" : "")
      }
      style={{
        backgroundColor: decorated.bg(color),
        color:           color,
        ["--chip-bg-hover" as string]: color + "33",
        ...(decorated.border ? { boxShadow: `inset 0 0 0 1px ${color}80` } : {}),
      }}
    >
      <span className="min-w-0 truncate font-medium">{label}</span>
      {amountStr && (
        <span className="num shrink-0 tabular-nums text-[10px] opacity-65">{amountStr}</span>
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
  const color = chipColor(event);
  const unit  = event.tracking_mode === "hours" ? "h" : "";
  const when  = new Date(event.start_at).toLocaleTimeString(undefined, {
    hour: "numeric", minute: "2-digit",
  });
  const label = chipPrimaryLabel(event);
  const amountStr = event.amount !== null ? `${formatAmount(event.amount)}${unit}` : null;
  const decorated = chipDecoration(event.status);

  return (
    <button
      type="button"
      onClick={onClick}
      title={chipTitle(event)}
      className={
        "absolute z-[1] flex min-w-0 flex-col gap-0.5 overflow-hidden rounded-md px-1.5 py-1 " +
        "text-left text-[11px] leading-tight transition-shadow duration-200 ease-out " +
        "hover:z-[2] hover:shadow-page hover:brightness-95 " +
        decorated.text + " " +
        (isNew ? "animate-chipIn " : "")
      }
      style={{
        ...style,
        backgroundColor: decorated.bg(color),
        color:           color,
        ...(decorated.border ? { boxShadow: `inset 0 0 0 1px ${color}80` } : {}),
      }}
    >
      {density === "dense" ? (
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="min-w-0 truncate font-medium">{label}</span>
          {amountStr && (
            <span className="num shrink-0 tabular-nums text-[10px] opacity-65">{amountStr}</span>
          )}
        </span>
      ) : (
        <>
          <span className="flex items-baseline justify-between gap-2">
            <span className="num shrink-0 tabular-nums text-[10px] opacity-75">{when}</span>
            {amountStr && (
              <span className="num shrink-0 tabular-nums font-semibold">{amountStr}</span>
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

// Visual treatments per status:
//   pending  → outlined, no fill, "tentative" feel
//   accepted → filled, full color
//   declined → muted with strikethrough
function chipDecoration(status: EventStatus): {
  bg:     (color: string) => string;
  text:   string;
  border: boolean;
} {
  switch (status) {
    case "accepted":
      return { bg: (c) => c + "26", text: "", border: false };
    case "pending":
      return { bg: () => "transparent", text: "", border: true };
    case "declined":
      return { bg: (c) => c + "12", text: "line-through opacity-60", border: false };
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

function chipColor(e: EventInRange): string {
  return e.subscription_id
    ? subscriptionColor(e.subscription_id)
    : "#5C544A"; // ink-dim for standalone events
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

  const [title,     setTitle]     = useState("");
  const [subId,     setSubId]     = useState<string>("");
  const [amountStr, setAmountStr] = useState("");
  const [notes,     setNotes]     = useState("");
  const [timeStr,   setTimeStr]   = useState(presetTime ?? defaultTime(date));
  const [endTimeStr, setEndTimeStr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

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

  const canSubmit = !submitting && titleValid && amountValid;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const startAt = combineDateAndTime(date, timeStr);
      const endAt   = endTimeStr.trim() !== "" ? combineDateAndTime(date, endTimeStr) : null;
      const created = await api.createEvent({
        title:           title.trim() === "" ? null : title.trim(),
        start_at:        startAt.toISOString(),
        end_at:          endAt ? endAt.toISOString() : null,
        // New events default to pending — user must explicitly accept before
        // they burn the subscription.
        status:          "pending",
        subscription_id: hasSub ? subId : null,
        amount:          hasSub ? amount : null,
        notes:           notes.trim() === "" ? null : notes.trim(),
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
        className="animate-modalIn w-full max-w-md rounded-2xl border border-hairline bg-white px-6 py-6 shadow-[0_24px_48px_-24px_rgba(26,24,20,0.25)]"
      >
        <div className="flex items-baseline justify-between border-b border-hairline pb-3">
          <h2 className="serif text-base font-semibold text-ink">
            New event
          </h2>
          <p className="num text-[11px] uppercase tracking-micro text-ink-faint">
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
                value={timeStr}
                onChange={(e) => setTimeStr(e.target.value)}
                className={inputClass + " num tabular-nums"}
              />
            </Field>
            <Field label="End (optional)">
              <input
                type="time"
                value={endTimeStr}
                onChange={(e) => setEndTimeStr(e.target.value)}
                className={inputClass + " num tabular-nums"}
              />
            </Field>
          </div>

          <Field label="Notes">
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="optional"
              className={inputClass}
            />
          </Field>
        </div>

        {hasSub && (
          <p className="mt-4 text-[11px] uppercase tracking-micro text-ink-faint">
            Saved as pending — accept later to burn the subscription.
          </p>
        )}

        {error && (
          <p className="mt-3 text-xs text-pace-red">{error}</p>
        )}

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-hairline pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-full px-3 py-1.5 text-[11px] uppercase tracking-micro text-ink-faint transition-colors duration-200 hover:text-ink disabled:opacity-50"
          >
            cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex items-baseline gap-1.5 rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-surface transition-all duration-200 ease-out hover:bg-accent disabled:cursor-not-allowed disabled:bg-hairline disabled:text-ink-faint"
          >
            {submitting ? "saving…" : "save"} <span aria-hidden="true">→</span>
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

  async function handleDelete() {
    if (busy) return;
    if (!confirm("Delete this event?")) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.deleteEvent(eventId);
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
        className="animate-modalIn w-full max-w-md rounded-2xl border border-hairline bg-white px-6 py-6 shadow-[0_24px_48px_-24px_rgba(26,24,20,0.25)]"
      >
        {event === null && !loadError && (
          <p className="serif py-6 text-center text-base text-ink-faint">
            loading…
          </p>
        )}

        {loadError && (
          <p className="py-6 text-center text-sm text-pace-red">{loadError}</p>
        )}

        {event && (
          <>
            <div className="flex items-start justify-between gap-3 border-b border-hairline pb-3">
              <div className="min-w-0">
                <h2 className="serif text-base font-semibold text-ink">
                  {event.title?.trim() || sub?.name || "(no title)"}
                </h2>
                <p className="mt-1 text-[11px] uppercase tracking-micro text-ink-faint">
                  {formatEventWhen(event)}
                </p>
              </div>
              <StatusBadge status={event.status} />
            </div>

            <dl className="mt-4 space-y-3 text-sm">
              {sub && (
                <Row label="Subscription">
                  <Link
                    to={`/subscriptions/${sub.id}`}
                    onClick={onClose}
                    className="border-b border-hairline text-ink transition-colors duration-200 hover:border-accent hover:text-accent"
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
              {!sub && (
                <p className="text-xs text-ink-faint">
                  Standalone calendar entry — no subscription linked.
                </p>
              )}
            </dl>

            {actionError && (
              <p className="mt-4 text-xs text-pace-red">{actionError}</p>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4">
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className="text-[11px] uppercase tracking-micro text-ink-faint transition-colors duration-200 hover:text-pace-red disabled:opacity-50"
              >
                delete
              </button>
              <div className="flex items-center gap-2">
                {sub && event.status !== "declined" && (
                  <button
                    type="button"
                    onClick={() => runAction(() => api.declineEvent(eventId))}
                    disabled={busy}
                    className="rounded-full border border-hairline px-3 py-1.5 text-[11px] uppercase tracking-micro text-ink-dim transition-colors duration-200 hover:border-pace-red hover:text-pace-red disabled:opacity-50"
                  >
                    decline
                  </button>
                )}
                {sub && event.status !== "accepted" && (
                  <button
                    type="button"
                    onClick={() => runAction(() => api.acceptEvent(eventId))}
                    disabled={busy}
                    className="inline-flex items-baseline gap-1.5 rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-surface transition-all duration-200 ease-out hover:bg-accent disabled:cursor-not-allowed disabled:bg-hairline disabled:text-ink-faint"
                  >
                    accept <span aria-hidden="true">→</span>
                  </button>
                )}
                {!sub && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-full px-3 py-1.5 text-[11px] uppercase tracking-micro text-ink-faint transition-colors duration-200 hover:text-ink"
                  >
                    done
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
      <dt className="text-[11px] uppercase tracking-micro text-ink-faint">{label}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  );
}

function StatusBadge({ status }: { status: EventStatus }) {
  const styles: Record<EventStatus, string> = {
    pending:  "border border-hairline text-ink-dim",
    accepted: "border border-pace-green/40 bg-pace-green/10 text-pace-green",
    declined: "border border-pace-red/40 bg-pace-red/10 text-pace-red",
  };
  return (
    <span
      className={
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-micro " +
        styles[status]
      }
    >
      {status}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-micro text-ink-faint">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

const inputClass =
  "w-full bg-transparent border-b border-hairline px-0 py-2 text-base text-ink " +
  "placeholder:text-ink-faint outline-none transition " +
  "hover:border-ink-faint focus:border-accent";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ErrorBox({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="border-y border-pace-red/40 bg-pace-red/5 px-1 py-5">
      <p className="text-sm font-semibold text-pace-red">{title}</p>
      <p className="mt-1 text-xs text-ink-dim">{detail}</p>
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

/** Deterministic chip color from a small editorial palette. Cool/warm balance:
 *  navy + sage + slate read cool-ish, gold + oxblood + forest warm. */
const SUBSCRIPTION_COLORS = [
  "#1E3A5F", // accent (deep ink)
  "#2E6F4F", // pace-green (forest)
  "#9C6B16", // pace-amber (gold)
  "#9E3527", // pace-red (oxblood)
  "#5C544A", // ink-dim (slate)
  "#5C7A52", // sage — fits the editorial family
];

function subscriptionColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return SUBSCRIPTION_COLORS[Math.abs(h) % SUBSCRIPTION_COLORS.length];
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
