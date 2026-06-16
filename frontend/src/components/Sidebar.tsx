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

const SubscriptionIcon = (
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
    <path d="M2.5 5 L8 2.25 L13.5 5 L8 7.75 Z" />
    <path d="M2.5 5 V11 L8 13.75 L13.5 11 V5" />
    <line x1="8" y1="7.75" x2="8" y2="13.75" />
  </svg>
);

const FinanceIcon = (
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
    {/* A trio of bars climbing left-to-right — the "budget vs. spent" shape. */}
    <line x1="3.25"  y1="13"   x2="3.25"  y2="9.5" />
    <line x1="8"     y1="13"   x2="8"     y2="6.5" />
    <line x1="12.75" y1="13"   x2="12.75" y2="3.5" />
    <line x1="2"     y1="13.5" x2="14"    y2="13.5" />
  </svg>
);

const CalendarIcon = (
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
    <rect x="2.25" y="3.5" width="11.5" height="10" rx="1.25" />
    <line x1="2.25" y1="6.25" x2="13.75" y2="6.25" />
    <line x1="5.25" y1="2.25" x2="5.25" y2="4.5"  />
    <line x1="10.75" y1="2.25" x2="10.75" y2="4.5" />
  </svg>
);

const MembersIcon = (
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
    <circle cx="6" cy="6" r="2.25" />
    <circle cx="11.25" cy="7" r="1.75" />
    <path d="M2 13c.5-2.25 2.25-3.5 4-3.5s3.5 1.25 4 3.5" />
    <path d="M9.75 13c.5-1.75 1.75-2.75 2.75-2.75 1.25 0 2.25 1 2.5 2.75" />
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
          "flex-col border-r border-hairline bg-white " +
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
                className="flex h-8 w-8 items-center justify-center rounded-md text-sm font-semibold text-accent transition hover:bg-subtle"
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
                className="rounded-md px-1.5 py-1 text-sm font-semibold tracking-tight text-accent transition hover:bg-subtle"
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
          ? "bg-accent-soft font-semibold text-accent"
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

// Panel icon with a chevron pointing the direction the rail will move.
// `open=true` shows ◁ (rail will collapse left); `open=false` shows ▷
// (rail will expand right). The vertical divider mirrors the rail itself,
// so the icon reads as "this is the sidebar, here is where it's going".
function PanelToggleIcon({ open }: { open: boolean }) {
  return (
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
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <line x1="6.5" y1="3" x2="6.5" y2="13" />
      {open ? (
        <polyline points="11.25 6 9.25 8 11.25 10" />
      ) : (
        <polyline points="9.25 6 11.25 8 9.25 10" />
      )}
    </svg>
  );
}
