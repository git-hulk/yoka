import { useEffect, useMemo, useRef, useState } from "react";

interface Props {
  id?:      string;
  values:   readonly string[];
  options:  readonly string[];          // existing categories from other subscriptions
  onChange: (values: string[]) => void;
  max?:     number;
  placeholder?: string;
}

const DEFAULT_MAX = 3;

/**
 * Multi-value combobox: selected categories render as inline removable
 * tags, with a typing buffer + dropdown for adding more (existing suggestions
 * or freshly created). Capped at `max` (default 3). Follows the ARIA 1.2
 * combobox pattern with virtual focus via `aria-activedescendant`.
 *
 * Already-selected values are filtered out of the dropdown; case-insensitive
 * exact matches are treated as duplicates.
 */
export default function CategoriesPicker({
  id, values, options, onChange, max = DEFAULT_MAX, placeholder,
}: Props) {
  const rootRef  = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [current, setCurrent] = useState("");
  const [open,    setOpen]    = useState(false);
  const [active,  setActive]  = useState(-1);

  const atMax = values.length >= max;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setActive(-1);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const trimmed = current.trim();
  const lcQuery = trimmed.toLowerCase();
  const selectedLc = useMemo(
    () => new Set(values.map((v) => v.toLowerCase())),
    [values],
  );

  // Suggestions = existing options minus already-selected, then filtered
  // by the typing buffer.
  const filtered = useMemo(() => {
    const remaining = options.filter((o) => !selectedLc.has(o.toLowerCase()));
    if (lcQuery === "") return remaining;
    return remaining.filter((o) => o.toLowerCase().includes(lcQuery));
  }, [options, selectedLc, lcQuery]);

  const exactInExisting = useMemo(
    () => options.some((o) => o.toLowerCase() === lcQuery),
    [options, lcQuery],
  );
  const exactInSelected = selectedLc.has(lcQuery);

  const showCreate = trimmed !== "" && !exactInExisting && !exactInSelected;
  const itemCount  = filtered.length + (showCreate ? 1 : 0);
  const hasMenu    = itemCount > 0;

  function add(value: string) {
    const t = value.trim();
    if (t === "")                        return;
    if (selectedLc.has(t.toLowerCase())) return;
    if (values.length >= max)            return;
    onChange([...values, t]);
    setCurrent("");
    setActive(-1);
    setOpen(false);
    inputRef.current?.focus();
  }

  function remove(value: string) {
    onChange(values.filter((v) => v !== value));
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) { setOpen(true); setActive(itemCount > 0 ? 0 : -1); return; }
      setActive((a) => (itemCount === 0 ? -1 : (a + 1) % itemCount));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); setActive(itemCount - 1); return; }
      setActive((a) => (itemCount === 0 ? -1 : a <= 0 ? itemCount - 1 : a - 1));
    } else if (e.key === "Enter") {
      if (open && active >= 0 && active < itemCount) {
        e.preventDefault();
        if (active < filtered.length) add(filtered[active]);
        else if (showCreate)          add(trimmed);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setActive(-1);
      }
    } else if (e.key === "Backspace" && current === "" && values.length > 0) {
      // Backspace in an empty buffer peels off the last chip — a keyboard
      // escape hatch matching multi-select convention.
      e.preventDefault();
      onChange(values.slice(0, -1));
    }
  }

  const listId   = id ? `${id}-listbox` : "categories-listbox";
  const activeId = open && active >= 0 ? `${listId}-opt-${active}` : undefined;

  return (
    <div ref={rootRef} className="relative">
      <div
        className={
          "flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-hairline " +
          "pr-7 transition focus-within:border-accent hover:border-ink-faint"
        }
      >
        {values.map((v) => (
          <Chip key={v} value={v} onRemove={() => remove(v)} />
        ))}

        {!atMax && (
          <input
            ref={inputRef}
            id={id}
            type="text"
            role="combobox"
            autoComplete="off"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={activeId}
            value={current}
            onChange={(e) => {
              setCurrent(e.target.value);
              setOpen(true);
              setActive(-1);
            }}
            onClick={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={values.length === 0 ? placeholder : undefined}
            className="
              min-w-[6rem] flex-1 bg-transparent py-2 text-base text-ink
              placeholder:text-ink-faint outline-none
            "
          />
        )}

        {atMax && (
          <span className="serif py-2 text-xs italic text-ink-faint">
            max {max} reached
          </span>
        )}
      </div>

      {!atMax && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? "close categories" : "open categories"}
          onClick={() => {
            setOpen((o) => !o);
            inputRef.current?.focus();
          }}
          className={
            "absolute bottom-0 right-0 top-0 flex w-5 items-center justify-center " +
            "text-xs text-ink-faint transition-transform duration-200 ease-out " +
            "hover:text-ink " +
            (open ? "rotate-180" : "")
          }
        >
          ▾
        </button>
      )}

      {open && !atMax && hasMenu && (
        <ul
          id={listId}
          role="listbox"
          className="
            absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto
            border border-hairline bg-surface py-1 shadow-page
          "
        >
          {filtered.map((opt, i) => {
            const isActive = active === i;
            return (
              <li
                key={opt}
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={isActive}
                onMouseDown={(e) => { e.preventDefault(); add(opt); }}
                onMouseEnter={() => setActive(i)}
                className={
                  "cursor-pointer px-3 py-1.5 text-sm transition-colors " +
                  (isActive
                    ? "bg-accent-soft text-accent"
                    : "text-ink hover:bg-accent-soft")
                }
              >
                <Highlighted text={opt} query={trimmed} />
              </li>
            );
          })}

          {showCreate && (
            <li
              id={`${listId}-opt-${filtered.length}`}
              role="option"
              aria-selected={active === filtered.length}
              onMouseDown={(e) => { e.preventDefault(); add(trimmed); }}
              onMouseEnter={() => setActive(filtered.length)}
              className={
                "cursor-pointer px-3 py-1.5 text-sm transition-colors " +
                (filtered.length > 0 ? "mt-1 border-t border-hairline pt-2 " : "") +
                (active === filtered.length
                  ? "bg-accent-soft text-accent"
                  : "text-ink-dim hover:bg-accent-soft hover:text-ink")
              }
            >
              <span className="serif italic">create</span>
              <span className="ml-1.5 text-ink">"{trimmed}"</span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function Chip({ value, onRemove }: { value: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Remove ${value}`}
      className="group inline-flex items-baseline gap-1 py-2 text-sm transition"
    >
      <span className="text-ink transition group-hover:text-pace-red">
        {value}
      </span>
      <span
        aria-hidden="true"
        className="text-[11px] text-ink-faint transition group-hover:text-pace-red"
      >
        ×
      </span>
    </button>
  );
}

/** Emphasize the matched substring inside an option label. */
function Highlighted({ text, query }: { text: string; query: string }) {
  if (query === "") return <>{text}</>;
  const lc = text.toLowerCase();
  const start = lc.indexOf(query.toLowerCase());
  if (start < 0) return <>{text}</>;
  const end = start + query.length;
  return (
    <>
      {text.slice(0, start)}
      <span className="font-semibold text-ink">{text.slice(start, end)}</span>
      {text.slice(end)}
    </>
  );
}
