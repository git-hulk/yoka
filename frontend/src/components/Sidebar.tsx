import { Link, useLocation } from "react-router-dom";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import GroupSwitcher from "./GroupSwitcher";
import { useAuth } from "../lib/auth";

interface Props {
  collapsed: boolean;
  onToggle: () => void;
}

const WIDTH_KEY     = "yoka:sidebar:width";
const DEFAULT_WIDTH = 224; // matches the retired md:w-56 (14rem)
const MIN_WIDTH     = 176;
const MAX_WIDTH     = 400;

function initialWidth(): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  const stored = window.localStorage.getItem(WIDTH_KEY);
  if (!stored) return DEFAULT_WIDTH;
  const n = Number(stored);
  if (!Number.isFinite(n)) return DEFAULT_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n));
}

interface NavEntry {
  to:      string;
  label:   string;
  matches: (pathname: string) => boolean;
  icon:    ReactNode;
}

// Nav icons follow the Linear Design System's 16px icon language: solid
// filled silhouettes with soft corners, not hairline strokes. Named after
// their counterparts in the Figma file's "Icons - 16px" inventory
// (box / bar-chart / calendar-empty / users).

const SubscriptionIcon = (
  <svg viewBox="0 0 16 16" fill="currentColor" className="size-4" aria-hidden="true">
    {/* box — isometric cube, three faces split by grooves */}
    <path d="M8.36 1.7 13.1 4.16a.4.4 0 0 1 0 .71L8.36 7.33a.78.78 0 0 1-.72 0L2.9 4.87a.4.4 0 0 1 0-.7L7.64 1.7a.78.78 0 0 1 .72 0Z" />
    <path d="M2.25 6.1a.4.4 0 0 1 .58-.36l4.2 2.18c.26.13.42.4.42.69v4.8a.4.4 0 0 1-.58.36l-3.78-1.96a1.53 1.53 0 0 1-.84-1.37V6.1Z" />
    <path d="M13.75 6.1a.4.4 0 0 0-.58-.36l-4.2 2.18a.78.78 0 0 0-.42.69v4.8c0 .3.31.49.58.36l3.78-1.96c.52-.27.84-.8.84-1.37V6.1Z" />
  </svg>
);

const FinanceIcon = (
  <svg viewBox="0 0 16 16" fill="currentColor" className="size-4" aria-hidden="true">
    {/* bar-chart — three rounded bars climbing left-to-right */}
    <rect x="2" y="8.5" width="3.25" height="5.5" rx="1" />
    <rect x="6.375" y="5" width="3.25" height="9" rx="1" />
    <rect x="10.75" y="2" width="3.25" height="12" rx="1" />
  </svg>
);

const CalendarIcon = (
  <svg viewBox="0 0 16 16" fill="currentColor" className="size-4" aria-hidden="true">
    {/* calendar-empty — filled frame, binding posts, open date area */}
    <path
      fillRule="evenodd"
      d="M5 1.75a.75.75 0 0 1 .75.75V3h4.5v-.5a.75.75 0 0 1 1.5 0V3h.5A1.75 1.75 0 0 1 14 4.75v7.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-7.5A1.75 1.75 0 0 1 3.75 3h.5v-.5A.75.75 0 0 1 5 1.75ZM12.5 6.75h-9v5.5c0 .14.11.25.25.25h8.5c.14 0 .25-.11.25-.25v-5.5Z"
    />
  </svg>
);

const MembersIcon = (
  <svg viewBox="0 0 16 16" fill="currentColor" className="size-4" aria-hidden="true">
    {/* users — lead silhouette with a trailing partial figure */}
    <circle cx="6" cy="4.75" r="2.75" />
    <path d="M6 8.75c-2.2 0-4.13 1.53-4.56 3.72-.08.42.26.78.68.78h7.76c.42 0 .76-.36.68-.78C10.13 10.28 8.2 8.75 6 8.75Z" />
    <circle cx="11.6" cy="5.25" r="2.1" />
    <path d="M11.6 8.9c-.34 0-.67.05-.99.13.71.75 1.23 1.7 1.44 2.77.06.3.05.61-.02.9h2.14c.42 0 .76-.36.67-.77-.36-1.72-1.66-3.03-3.24-3.03Z" />
  </svg>
);

const NAV: NavEntry[] = [
  {
    to:      "/",
    label:   "Subscriptions",
    matches: (p) => p === "/" || p.startsWith("/subscriptions"),
    icon:    SubscriptionIcon,
  },
  {
    to:      "/finance",
    label:   "Finance",
    matches: (p) => p.startsWith("/finance"),
    icon:    FinanceIcon,
  },
  {
    to:      "/calendar",
    label:   "Calendar",
    matches: (p) => p.startsWith("/calendar"),
    icon:    CalendarIcon,
  },
  {
    to:      "/members",
    label:   "Members",
    matches: (p) => p.startsWith("/members"),
    icon:    MembersIcon,
  },
];

export default function Sidebar({ collapsed, onToggle }: Props) {
  const location = useLocation();
  const { me, logout } = useAuth();
  const [width, setWidth]           = useState<number>(initialWidth);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    window.localStorage.setItem(WIDTH_KEY, String(width));
  }, [width]);

  // Mobile drawer behavior: when navigating, collapse so the drawer closes.
  // Desktop rail stays put across navigations.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.innerWidth < 768 && !collapsed) onToggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor     = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor     = "col-resize";

    const onMove = (ev: MouseEvent) => {
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, ev.clientX)));
    };
    const onUp = () => {
      setIsResizing(false);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor     = prevCursor;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <>
      {/* Backdrop, mobile only, when the drawer is open */}
      {!collapsed && (
        <button
          type="button"
          onClick={onToggle}
          aria-label="close sidebar"
          className="fixed inset-0 z-20 bg-ink/40 md:hidden"
        />
      )}

      <aside
        style={collapsed ? undefined : ({ "--sidebar-w": `${width}px` } as CSSProperties)}
        className={
          "flex-col border-r border-hairline bg-canvas " +
          "md:static md:z-auto md:flex md:shrink-0 " +
          (isResizing ? "" : "md:transition-[width] md:duration-200 md:ease-out ") +
          (collapsed
            ? "hidden md:w-16"
            : "fixed inset-y-0 left-0 z-30 flex w-56 md:w-[var(--sidebar-w)]")
        }
      >
        {collapsed ? (
          <div className="flex flex-col items-center gap-1 px-2 pt-4 pb-4">
            {me ? (
              <GroupSwitcher collapsed />
            ) : (
              <Link
                to="/"
                aria-label="yoka — home"
                className="flex h-8 w-8 items-center justify-center rounded-md text-sm font-medium text-accent transition hover:bg-subtle"
              >
                Y
              </Link>
            )}
            <button
              type="button"
              onClick={onToggle}
              aria-label="Show sidebar"
              title="Show sidebar"
              className="rounded-md p-2 text-ink-faint transition hover:bg-subtle hover:text-ink"
            >
              <PanelToggleIcon open={false} />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 px-3 pt-4 pb-2">
            {me ? (
              <GroupSwitcher collapsed={false} />
            ) : (
              <Link
                to="/"
                aria-label="yoka — home"
                className="rounded-md px-1.5 py-1 text-sm font-medium tracking-tight text-accent transition hover:bg-subtle"
              >
                YOKA
              </Link>
            )}
            <button
              type="button"
              onClick={onToggle}
              aria-label="Hide sidebar"
              title="Hide sidebar"
              className="shrink-0 rounded-md p-1.5 text-ink-faint transition hover:bg-subtle hover:text-ink"
            >
              <PanelToggleIcon open={true} />
            </button>
          </div>
        )}

        <nav className={collapsed ? "flex-1 px-2 pt-2" : "flex-1 px-2 pt-2"}>
          <ul className="space-y-0.5">
            {NAV.map((entry) => (
              <li key={entry.to}>
                <NavItem
                  entry={entry}
                  active={entry.matches(location.pathname)}
                  collapsed={collapsed}
                />
              </li>
            ))}
          </ul>
        </nav>

        {me && !collapsed && (
          <div className="border-t border-hairline px-3 py-3">
            <div className="truncate text-xs text-ink-faint">{me.user.email}</div>
            <button
              type="button"
              onClick={() => void logout()}
              className="mt-1 text-xs font-medium text-ink-dim transition hover:text-ink"
            >
              Sign out
            </button>
          </div>
        )}
      </aside>

      {/* Drag handle on the sidebar's right edge — desktop only, expanded only.
          Fixed-positioned with inline `left` so it doesn't depend on the aside
          providing a positioning context (the aside is `md:static`). */}
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onMouseDown={startResize}
          onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
          title="Drag to resize · double-click to reset"
          style={{ left: `${width - 4}px` }}
          className="group fixed inset-y-0 z-40 hidden w-2 cursor-col-resize md:block"
        >
          {/* Edge line — visible on hover, solid while dragging. Marks the
              exact pixel boundary the user is moving. */}
          <span
            aria-hidden="true"
            className={
              "pointer-events-none absolute inset-y-0 left-1/2 block w-px -translate-x-1/2 transition " +
              (isResizing
                ? "bg-accent"
                : "bg-transparent group-hover:bg-accent/30")
            }
          />
          {/* Grip pill — small rounded card with two vertical strokes, the
              classic "draggable" affordance. Fades in on hover; border and
              strokes pick up the accent while dragging. */}
          <span
            aria-hidden="true"
            className={
              "pointer-events-none absolute top-1/2 left-1/2 flex h-9 w-[10px] -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-[3px] rounded-full border bg-white shadow-sm transition duration-150 " +
              (isResizing
                ? "border-accent"
                : "border-hairline opacity-0 group-hover:opacity-100")
            }
          >
            <span
              className={
                "block h-3.5 w-px transition " +
                (isResizing ? "bg-accent" : "bg-ink-faint")
              }
            />
            <span
              className={
                "block h-3.5 w-px transition " +
                (isResizing ? "bg-accent" : "bg-ink-faint")
              }
            />
          </span>
        </div>
      )}
    </>
  );
}

function NavItem({
  entry,
  active,
  collapsed,
}: {
  entry: NavEntry;
  active: boolean;
  collapsed: boolean;
}) {
  if (collapsed) {
    return (
      <Link
        to={entry.to}
        title={entry.label}
        aria-label={entry.label}
        className={
          "flex h-8 items-center justify-center rounded-md transition " +
          (active
            ? "bg-accent-soft text-accent"
            : "text-ink-dim hover:bg-subtle hover:text-ink")
        }
      >
        {entry.icon}
      </Link>
    );
  }
  return (
    <Link
      to={entry.to}
      className={
        "flex h-8 items-center gap-2 rounded-md px-2 text-sm transition " +
        (active
          ? "bg-accent-soft font-medium text-accent"
          : "font-medium text-ink-dim hover:bg-subtle hover:text-ink")
      }
    >
      <span aria-hidden="true" className="inline-flex shrink-0">
        {entry.icon}
      </span>
      {entry.label}
    </Link>
  );
}

// Panel toggle in the Linear icon language: a soft frame with the sidebar
// rail on the left. Rail filled = sidebar showing (click hides it); rail
// hollow with just the divider = sidebar hidden (click brings it back).
function PanelToggleIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg viewBox="0 0 16 16" fill="currentColor" className="size-4" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M4.25 2A2.25 2.25 0 0 0 2 4.25v7.5A2.25 2.25 0 0 0 4.25 14h7.5A2.25 2.25 0 0 0 14 11.75v-7.5A2.25 2.25 0 0 0 11.75 2h-7.5Zm2.25 1.5h5.25c.41 0 .75.34.75.75v7.5c0 .41-.34.75-.75.75H6.5v-9Z"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="size-4" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M4.25 2A2.25 2.25 0 0 0 2 4.25v7.5A2.25 2.25 0 0 0 4.25 14h7.5A2.25 2.25 0 0 0 14 11.75v-7.5A2.25 2.25 0 0 0 11.75 2h-7.5Zm-.75 2.25c0-.41.34-.75.75-.75H5v9h-.75a.75.75 0 0 1-.75-.75v-7.5Zm3 8.25h5.25c.41 0 .75-.34.75-.75v-7.5a.75.75 0 0 0-.75-.75H6.5v9Z"
      />
    </svg>
  );
}
