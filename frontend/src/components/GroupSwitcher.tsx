// Sidebar header dropdown: shows the active group, lists the user's other
// groups, links to Members + "Create new group". Selecting a group calls
// /me/active-group and reloads (the simplest way to refetch every page).

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

interface Props {
  collapsed: boolean;
}

export default function GroupSwitcher({ collapsed }: Props) {
  const { me, setActiveGroup } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  if (!me) return null;

  async function newGroup() {
    const name = prompt("New group name");
    if (!name || !name.trim()) return;
    try {
      const g = await api.createGroup(name.trim());
      await setActiveGroup(g.id);
    } catch (err) {
      alert(err instanceof ApiError ? err.code : String(err));
    }
  }

  if (collapsed) {
    return (
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title={me.active_group.name}
          aria-label={`Group: ${me.active_group.name}`}
          className="flex h-8 w-8 items-center justify-center rounded-md text-sm font-semibold text-accent transition hover:bg-subtle"
        >
          {me.active_group.name.charAt(0).toUpperCase()}
        </button>
        {open && <Menu me={me} setActiveGroup={setActiveGroup} onNew={newGroup} onClose={() => setOpen(false)} />}
      </div>
    );
  }

  return (
    <div className="relative w-full" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm font-semibold tracking-tight text-accent transition hover:bg-subtle"
      >
        <span className="truncate">{me.active_group.name}</span>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="size-3.5 shrink-0 text-ink-faint" aria-hidden="true">
          <polyline points="4 6 8 10 12 6" />
        </svg>
      </button>
      {open && <Menu me={me} setActiveGroup={setActiveGroup} onNew={newGroup} onClose={() => setOpen(false)} />}
    </div>
  );
}

function Menu({
  me,
  setActiveGroup,
  onNew,
  onClose,
}: {
  me:             ReturnType<typeof useAuth>["me"] & object;
  setActiveGroup: (id: string) => Promise<void>;
  onNew:          () => void;
  onClose:        () => void;
}) {
  if (!me) return null;
  return (
    <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-md border border-hairline bg-white py-1 shadow-sm">
      <div className="px-3 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wider text-ink-faint">
        Groups
      </div>
      <ul className="max-h-64 overflow-y-auto">
        {me.groups.map((g) => {
          const active = g.id === me.active_group.id;
          return (
            <li key={g.id}>
              <button
                type="button"
                onClick={() => {
                  if (!active) void setActiveGroup(g.id);
                  onClose();
                }}
                className={
                  "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition " +
                  (active
                    ? "bg-accent-soft font-medium text-accent"
                    : "text-ink-dim hover:bg-subtle hover:text-ink")
                }
              >
                <span className="min-w-0 truncate">{g.name}</span>
                <span className="shrink-0 text-xs text-ink-faint">{g.role}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="my-1 border-t border-hairline" />
      <Link
        to="/members"
        onClick={onClose}
        className="block px-3 py-1.5 text-sm text-ink-dim transition hover:bg-subtle hover:text-ink"
      >
        Manage members
      </Link>
      <button
        type="button"
        onClick={() => {
          onClose();
          onNew();
        }}
        className="block w-full px-3 py-1.5 text-left text-sm text-ink-dim transition hover:bg-subtle hover:text-ink"
      >
        + New group
      </button>
    </div>
  );
}
