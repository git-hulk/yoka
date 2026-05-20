import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface NavEntry {
  to:      string;
  label:   string;
  matches: (pathname: string) => boolean;
}

const NAV: NavEntry[] = [
  {
    to:      "/",
    label:   "Packages",
    matches: (p) => p === "/" || p.startsWith("/packages"),
  },
  // Future: Members, Settings — append here. The page-level routes get
  // registered in App.tsx; the sidebar only needs the link.
];

export default function Sidebar({ open, onClose }: Props) {
  const location = useLocation();

  // Drawer behavior: auto-close on mobile when navigating.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.innerWidth < 768 && open) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop, mobile only */}
      <button
        type="button"
        onClick={onClose}
        aria-label="close sidebar"
        className="fixed inset-0 z-20 bg-ink/30 backdrop-blur-[1px] md:hidden"
      />

      <aside
        className="
          fixed inset-y-0 left-0 z-30 flex w-56 flex-col border-r border-hairline bg-canvas
          md:static md:z-auto md:shrink-0
        "
      >
        <div className="flex items-center justify-between gap-3 px-5 pt-7 pb-8">
          <Link
            to="/"
            className="serif text-base italic leading-none text-accent transition hover:text-ink"
          >
            yoka
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Hide sidebar"
            title="Hide sidebar"
            className="-mr-1 p-1 text-ink-faint transition hover:text-ink"
          >
            {/* Panel-left-close: sidebar pane + chevron pointing left. */}
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
              <rect x="2" y="3.5" width="12" height="9" rx="1.25" />
              <line x1="6" y1="3.5" x2="6" y2="12.5" />
              <path d="M11 6 L8.5 8 L11 10" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 px-5">
          <ul className="space-y-1.5">
            {NAV.map((entry) => (
              <li key={entry.to}>
                <NavItem
                  entry={entry}
                  active={entry.matches(location.pathname)}
                />
              </li>
            ))}
          </ul>
        </nav>
      </aside>
    </>
  );
}

function NavItem({ entry, active }: { entry: NavEntry; active: boolean }) {
  return (
    <Link
      to={entry.to}
      className={
        "block py-1.5 text-base transition " +
        (active
          ? "serif italic text-accent"
          : "text-ink-dim hover:text-ink")
      }
    >
      {entry.label}
    </Link>
  );
}
