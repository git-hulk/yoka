import { Link, useLocation } from "react-router-dom";
import { useEffect, type ReactNode } from "react";

interface Props {
  collapsed: boolean;
  onToggle: () => void;
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
    className="size-[18px]"
    aria-hidden="true"
  >
    <path d="M2.5 5 L8 2.25 L13.5 5 L8 7.75 Z" />
    <path d="M2.5 5 V11 L8 13.75 L13.5 11 V5" />
    <line x1="8" y1="7.75" x2="8" y2="13.75" />
  </svg>
);

const NAV: NavEntry[] = [
  {
    to:      "/",
    label:   "Subscriptions",
    matches: (p) => p === "/" || p.startsWith("/subscriptions"),
    icon:    SubscriptionIcon,
  },
  // Future: Members, Settings — append here. The page-level routes get
  // registered in App.tsx; the sidebar only needs the link.
];

export default function Sidebar({ collapsed, onToggle }: Props) {
  const location = useLocation();

  // Mobile drawer behavior: when navigating, collapse so the drawer closes.
  // Desktop rail stays put across navigations.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.innerWidth < 768 && !collapsed) onToggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return (
    <>
      {/* Backdrop, mobile only, when the drawer is open */}
      {!collapsed && (
        <button
          type="button"
          onClick={onToggle}
          aria-label="close sidebar"
          className="fixed inset-0 z-20 bg-ink/30 backdrop-blur-[1px] md:hidden"
        />
      )}

      <aside
        className={
          "flex-col border-r border-hairline bg-canvas " +
          "md:static md:z-auto md:flex md:shrink-0 md:transition-[width] md:duration-200 md:ease-out " +
          (collapsed
            ? "hidden md:w-16"
            : "fixed inset-y-0 left-0 z-30 flex w-56 md:w-56")
        }
      >
        <div
          className={
            "flex items-center pt-7 pb-8 " +
            (collapsed
              ? "justify-center px-2"
              : "gap-3 px-5")
          }
        >
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
            title={collapsed ? "Show sidebar" : "Hide sidebar"}
            className="-ml-1 rounded-full p-2 text-ink-faint transition hover:bg-accent-soft hover:text-ink"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-5"
              aria-hidden="true"
            >
              <line x1="4"  y1="7"  x2="20" y2="7" />
              <line x1="4"  y1="12" x2="20" y2="12" />
              <line x1="4"  y1="17" x2="20" y2="17" />
            </svg>
          </button>
          {!collapsed && (
            <Link
              to="/"
              aria-label="yoka — home"
              className="group inline-flex items-center leading-none text-accent transition hover:text-ink"
            >
              <span className="serif text-base italic">yoka</span>
            </Link>
          )}
        </div>

        <nav className={collapsed ? "flex-1 px-2" : "flex-1 px-5"}>
          <ul className="space-y-1.5">
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
      </aside>
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
          "flex items-center justify-center rounded-md py-2 transition " +
          (active
            ? "bg-accent-soft text-accent"
            : "text-ink-dim hover:bg-accent-soft hover:text-ink")
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
        "flex items-center gap-2.5 py-1.5 text-base transition " +
        (active
          ? "serif italic text-accent"
          : "text-ink-dim hover:text-ink")
      }
    >
      <span aria-hidden="true" className="inline-flex shrink-0">
        {entry.icon}
      </span>
      {entry.label}
    </Link>
  );
}
