import { useEffect, useMemo, useState } from "react";

import { ApiError, api } from "../lib/api";
import { formatUsageDay, formatUsageTime } from "../lib/pace";
import type { CalendarEvent, Usage } from "../lib/types";
import { eventToUsage } from "../lib/types";

interface Props {
  subscriptionId: string;
  /** Affects unit suffix on amounts and amount-input step. */
  timeKnown: boolean;
  /** Called after any successful add/delete so the parent can refetch
   *  derived subscription fields (consumed, remaining, status). */
  onChange?: () => void;
}

/** Burn-down history for one subscription. Backed by events: only events
 *  with `status === "accepted"` count as usages, and the editor surfaces
 *  exactly those. New entries are created as accepted events. */
export default function UsageEditor({ subscriptionId, timeKnown, onChange }: Props) {
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEvents(null);
    setLoadError(null);
    api.listSubscriptionEvents(subscriptionId).then(
      (data) => { if (!cancelled) setEvents(data); },
      (err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => { cancelled = true; };
  }, [subscriptionId]);

  // Project events → usage rows. Pending/declined events live on the
  // calendar but stay out of this list — only accepted burns show here.
  const items: Usage[] | null = useMemo(() => {
    if (events === null) return null;
    return events.flatMap((e) => {
      const u = eventToUsage(e);
      return u ? [u] : [];
    });
  }, [events]);

  async function addUsage(amount: number, notes: string | null) {
    const created = await api.createEvent({
      title:           null,
      start_at:        new Date().toISOString(),
      end_at:          null,
      status:          "accepted",
      subscription_id: subscriptionId,
      amount,
      notes,
    });
    setEvents((prev) => (prev ? [created, ...prev] : [created]));
    onChange?.();
  }

  async function deleteUsage(usageId: string) {
    await api.deleteEvent(usageId);
    setEvents((prev) => prev?.filter((e) => e.id !== usageId) ?? null);
    onChange?.();
  }

  async function updateUsage(usageId: string, amount: number, notes: string | null) {
    // PUT-style update: send the whole event back. We need the original row
    // to preserve title/start_at/end_at — the editor only changes amount+notes.
    const original = events?.find((e) => e.id === usageId);
    if (!original) throw new Error("usage not found");
    const updated = await api.updateEvent(usageId, {
      title:           original.title,
      start_at:        original.start_at,
      end_at:          original.end_at,
      status:          original.status,
      subscription_id: original.subscription_id,
      amount,
      notes,
    });
    setEvents((prev) => prev?.map((e) => (e.id === usageId ? updated : e)) ?? null);
    onChange?.();
  }

  return (
    <section>
      <div className="flex items-baseline justify-between border-b border-hairline pb-3">
        <h2 className="serif text-base italic font-semibold text-ink">Usage</h2>
        {items && items.length > 0 && (
          <span className="num text-[11px] uppercase tracking-micro text-ink-faint">
            {items.length} {items.length === 1 ? "entry" : "entries"}
          </span>
        )}
      </div>

      {items === null && !loadError && (
        <p className="serif py-6 text-center text-base italic text-ink-faint">
          loading…
        </p>
      )}

      {loadError && (
        <div className="border-b border-pace-red/40 px-1 py-5">
          <p className="text-sm font-semibold text-pace-red">
            Couldn't load usage history
          </p>
          <p className="mt-1 text-xs text-ink-dim">{loadError}</p>
        </div>
      )}

      {items && items.length > 0 && (
        <ul className="divide-y divide-hairline">
          {items.map((u) => (
            <li key={u.id}>
              <Row
                usage={u}
                timeKnown={timeKnown}
                onDelete={deleteUsage}
                onUpdate={updateUsage}
              />
            </li>
          ))}
        </ul>
      )}

      {items && items.length === 0 && (
        <p className="serif py-6 text-center text-base italic text-ink-faint">
          no usages yet.
        </p>
      )}

      <AddForm
        key={items?.length ?? 0}
        timeKnown={timeKnown}
        onAdd={addUsage}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------

function Row({
  usage, timeKnown, onDelete, onUpdate,
}: {
  usage:    Usage;
  timeKnown: boolean;
  onDelete: (id: string) => Promise<void>;
  onUpdate: (id: string, amount: number, notes: string | null) => Promise<void>;
}) {
  const [editing,  setEditing]  = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete(usage.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete.");
      setDeleting(false);
    }
  }

  if (editing) {
    return (
      <EditRow
        usage={usage}
        timeKnown={timeKnown}
        onCancel={() => { setEditing(false); setError(null); }}
        onSave={async (amount, notes) => {
          await onUpdate(usage.id, amount, notes);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <div className="group grid grid-cols-[auto_1fr_auto_auto_1.5rem] items-baseline gap-4 py-4">
      <span className="serif text-sm italic text-ink-dim">
        {formatUsageDay(usage.created_at)}
      </span>
      <span className="truncate text-sm text-ink-dim">
        {composeDetail(usage)}
      </span>
      <span className="num text-base font-medium tabular-nums text-ink">
        {formatAmount(usage.amount)}{timeKnown ? "h" : ""}
      </span>
      <button
        type="button"
        onClick={() => { setEditing(true); setError(null); }}
        aria-label="edit usage entry"
        className="
          text-[11px] uppercase tracking-micro text-ink-faint opacity-0 transition
          group-hover:opacity-100 hover:text-accent focus-visible:opacity-100
        "
      >
        edit
      </button>
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        aria-label="delete usage entry"
        className="
          text-base leading-none text-ink-faint opacity-0 transition
          group-hover:opacity-100 hover:text-pace-red focus-visible:opacity-100
          disabled:opacity-50
        "
      >
        ×
      </button>

      {error && (
        <p className="col-span-5 mt-1 text-xs text-pace-red">{error}</p>
      )}
    </div>
  );
}

function EditRow({
  usage, timeKnown, onCancel, onSave,
}: {
  usage:    Usage;
  timeKnown: boolean;
  onCancel: () => void;
  onSave:   (amount: number, notes: string | null) => Promise<void>;
}) {
  const [amountStr, setAmountStr] = useState(String(usage.amount));
  const [notes,     setNotes]     = useState(usage.notes ?? "");
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const amount = Number(amountStr);
  const canSave =
    !saving &&
    amountStr.trim() !== "" &&
    Number.isFinite(amount) &&
    amount > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(amount, notes.trim() === "" ? null : notes.trim());
    } catch (err) {
      setError(saveErrorMessage(err));
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid grid-cols-[auto_1fr_6rem_auto_auto] items-baseline gap-4 py-4"
    >
      <span className="serif text-sm italic text-ink-dim">
        {formatUsageDay(usage.created_at)}
      </span>
      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="notes (optional)"
        aria-label="notes"
        className={inputClass}
      />
      <input
        type="number"
        min={0}
        step={timeKnown ? "0.01" : "1"}
        inputMode={timeKnown ? "decimal" : "numeric"}
        value={amountStr}
        onChange={(e) => setAmountStr(e.target.value)}
        autoFocus
        aria-label="amount"
        className={inputClass + " num tabular-nums text-right"}
      />
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        className="text-[11px] uppercase tracking-micro text-ink-faint transition hover:text-ink disabled:opacity-50"
      >
        cancel
      </button>
      <button
        type="submit"
        disabled={!canSave}
        className="
          text-[11px] uppercase tracking-micro text-accent transition hover:text-ink
          disabled:cursor-not-allowed disabled:text-ink-faint
        "
      >
        {saving ? "saving…" : "save"}
      </button>

      {error && (
        <p className="col-span-5 mt-1 text-xs text-pace-red">{error}</p>
      )}
    </form>
  );
}

function AddForm({
  timeKnown, onAdd,
}: {
  timeKnown: boolean;
  onAdd:    (amount: number, notes: string | null) => Promise<void>;
}) {
  const [amountStr, setAmountStr] = useState("");
  const [notes,     setNotes]     = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const amount = Number(amountStr);
  const canSubmit =
    !submitting &&
    amountStr.trim() !== "" &&
    Number.isFinite(amount) &&
    amount > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onAdd(amount, notes.trim() === "" ? null : notes.trim());
      setAmountStr("");
      setNotes("");
    } catch (err) {
      setError(addErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-6 border-t border-hairline pt-5"
    >
      <p className="text-[11px] uppercase tracking-micro text-ink-faint">
        + add usage
      </p>
      <div className="mt-3 grid grid-cols-[6rem_1fr_auto] items-baseline gap-4">
        <input
          type="number"
          min={0}
          step={timeKnown ? "0.01" : "1"}
          inputMode={timeKnown ? "decimal" : "numeric"}
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          placeholder={timeKnown ? "1.5" : "1"}
          aria-label="amount"
          className={inputClass + " num tabular-nums"}
        />
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="notes (optional)"
          aria-label="notes"
          className={inputClass}
        />
        <button
          type="submit"
          disabled={!canSubmit}
          className="
            inline-flex items-baseline gap-1.5 border-b border-ink pb-0.5 text-sm font-medium
            text-ink transition hover:border-accent hover:text-accent
            disabled:cursor-not-allowed disabled:border-hairline disabled:text-ink-faint
          "
        >
          {submitting ? "adding…" : "add"}
          <span aria-hidden="true">→</span>
        </button>
      </div>
      {error && (
        <p className="mt-2 text-xs text-pace-red">{error}</p>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------

const inputClass =
  "w-full bg-transparent border-b border-hairline px-0 py-2 text-base text-ink " +
  "placeholder:text-ink-faint outline-none transition " +
  "hover:border-ink-faint focus:border-accent";

function composeDetail(u: Usage): string {
  const time  = formatUsageTime(u.created_at);
  const notes = u.notes?.trim();
  if (time && notes) return `${time} · ${notes}`;
  return time || notes || "";
}

function formatAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function addErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "amount_must_be_positive":          return "Amount must be greater than 0.";
      case "events_forbidden_for_duration":    return "This subscription tracks duration, not usage.";
      case "subscription_amount_mismatch":     return "Both amount and subscription are required.";
      case "not_found":                        return "Subscription not found.";
      default:                                 return `Couldn't add (${err.code}).`;
    }
  }
  return err instanceof Error ? err.message : "Couldn't add usage.";
}

function saveErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "amount_must_be_positive": return "Amount must be greater than 0.";
      case "not_found":               return "Usage no longer exists.";
      default:                        return `Couldn't save (${err.code}).`;
    }
  }
  return err instanceof Error ? err.message : "Couldn't save usage.";
}
