// Sidebar header dropdown: shows the active group, lists the user's other
// groups, links to Members, and creates groups inline (no browser prompt,
// no modal). Selecting a group calls /me/active-group and reloads (the
// simplest way to refetch every page).
//
// Anatomy follows Linear's workspace switcher: a colored avatar tile carries
// the group identity (stable hash color per group id), the active row gets a
// check mark, and "New group" swaps the menu footer for a small composer.

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { subscriptionColor } from "../lib/colors";
import { buttonClass } from "./ui";

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
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!me) return null;

  const trigger = collapsed ? (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      title={me.active_group.name}
      aria-label={`Group: ${me.active_group.name}`}
      aria-haspopup="menu"
      aria-expanded={open}
      className="flex h-8 w-8 items-center justify-center rounded-md transition hover:bg-subtle"
    >
      <GroupTile id={me.active_group.id} name={me.active_group.name} />
    </button>
  ) : (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-haspopup="menu"
      aria-expanded={open}
      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition hover:bg-subtle"
    >
      <GroupTile id={me.active_group.id} name={me.active_group.name} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium tracking-tight text-ink">
        {me.active_group.name}
      </span>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-3.5 shrink-0 text-ink-faint"
        aria-hidden="true"
      >
        <polyline points="4 6 8 10 12 6" />
      </svg>
    </button>
  );

  return (
    <div className={collapsed ? "relative" : "relative w-full"} ref={ref}>
      {trigger}
      {open && (
        <Menu
          me={me}
          setActiveGroup={setActiveGroup}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/** Colored identity tile — stable hash color per group id, like the
 *  per-subscription dots. White initial on the colored ground. */
function GroupTile({ id, name, size = "sm" }: { id: string; name: string; size?: "sm" | "xs" }) {
  return (
    <span
      aria-hidden="true"
      className={
        "flex shrink-0 items-center justify-center rounded-[5px] font-medium text-white " +
        (size === "sm" ? "size-5 text-2xs" : "size-4 text-[9px]")
      }
      style={{ backgroundColor: subscriptionColor(id) }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function Menu({
  me,
  setActiveGroup,
  onClose,
}: {
  me:             NonNullable<ReturnType<typeof useAuth>["me"]>;
  setActiveGroup: (id: string) => Promise<void>;
  onClose:        () => void;
}) {
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [composing, setComposing]     = useState(false);

  async function pick(id: string, active: boolean) {
    if (active) {
      onClose();
      return;
    }
    if (switchingId) return;
    setSwitchingId(id);
    try {
      await setActiveGroup(id); // reloads the page on success
    } catch {
      setSwitchingId(null);
    }
  }

  return (
    <div
      role="menu"
      className="absolute left-0 top-full z-50 mt-1 w-60 rounded-lg border border-hairline bg-white py-1 shadow-pop"
    >
      <div className="px-3 pb-1 pt-1 text-2xs font-medium uppercase tracking-micro text-ink-faint">
        Groups
      </div>
      <ul className="max-h-64 overflow-y-auto">
        {me.groups.map((g) => {
          const active = g.id === me.active_group.id;
          const switching = switchingId === g.id;
          return (
            <li key={g.id}>
              <button
                type="button"
                role="menuitem"
                onClick={() => void pick(g.id, active)}
                disabled={switchingId !== null && !switching}
                className={
                  "mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition " +
                  (active ? "font-medium text-ink " : "text-ink-dim hover:bg-subtle hover:text-ink ") +
                  (switching ? "opacity-60" : "disabled:opacity-40")
                }
              >
                <GroupTile id={g.id} name={g.name} />
                <span className="min-w-0 flex-1 truncate">{g.name}</span>
                <span className="shrink-0 text-xs text-ink-faint">
                  {switching ? "switching…" : g.role}
                </span>
                {active && (
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="size-3.5 shrink-0 text-accent"
                    aria-hidden="true"
                  >
                    <polyline points="3 8.5 6.5 12 13 4.5" />
                  </svg>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="my-1 border-t border-hairline" />

      {composing ? (
        <GroupComposer
          onCreated={(id) => void setActiveGroup(id)}
          onCancel={() => setComposing(false)}
        />
      ) : (
        <>
          <Link
            to="/members"
            role="menuitem"
            onClick={onClose}
            className="mx-1 flex w-[calc(100%-0.5rem)] items-center rounded-md px-2 py-1.5 text-sm text-ink-dim transition hover:bg-subtle hover:text-ink"
          >
            Manage members
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => setComposing(true)}
            className="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink-dim transition hover:bg-subtle hover:text-ink"
          >
            <span
              aria-hidden="true"
              className="flex size-5 shrink-0 items-center justify-center rounded-[5px] border border-dashed border-ink-faint/60 text-xs leading-none text-ink-faint"
            >
              +
            </span>
            New group
          </button>
        </>
      )}
    </div>
  );
}

/** Inline create form at the menu foot — replaces the browser prompt().
 *  Enter creates, Escape backs out to the menu without closing it. */
function GroupComposer({
  onCreated,
  onCancel,
}: {
  onCreated: (id: string) => void;
  onCancel:  () => void;
}) {
  const [name, setName]   = useState("");
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const g = await api.createGroup(name.trim());
      onCreated(g.id); // switches + reloads
    } catch (err) {
      setError(err instanceof ApiError ? err.code : "something went wrong");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="px-2 pb-1 pt-0.5">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
        placeholder="Group name"
        maxLength={100}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- appears on
        // explicit "New group" intent; focusing the field continues it.
        autoFocus
        aria-label="New group name"
        className="h-8 w-full rounded-md border border-hairline bg-white px-2.5 text-sm text-ink placeholder:text-ink-faint transition hover:border-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
      />
      {error && <p className="mt-1 px-0.5 text-xs text-pace-red">{error}</p>}
      <div className="mt-1.5 flex justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className={buttonClass("ghost", "sm")}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className={buttonClass("primary", "sm")}
        >
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
    </form>
  );
}
