import { useState } from "react";

import { ApiError } from "../lib/api";
import type { PackageInput } from "../lib/api";
import { minorPerMajor } from "../lib/pace";
import { CURRENCIES } from "../lib/types";
import type { Currency } from "../lib/types";

interface Props {
  initial?:    PackageInput;
  /** When true, the units/hours toggle is disabled. Edit mode locks this
   *  field once any usage exists — flipping it would silently re-interpret
   *  historical amounts. */
  lockTimeKnown?: boolean;
  submitLabel: string;
  onSubmit:    (input: PackageInput) => Promise<void>;
  onCancel:    () => void;
}

const BLANK: PackageInput = {
  name:        "",
  quantity:    1,
  time_known:  false,
  start_date:  today(),
  expires_at:  defaultExpiry(),
  notes:       null,
  category:    null,
  price_cents: null,
  currency:    "USD",
};

export default function PackageForm({
  initial,
  lockTimeKnown = false,
  submitLabel,
  onSubmit,
  onCancel,
}: Props) {
  const [name,       setName]      = useState(initial?.name      ?? BLANK.name);
  const [quantity,   setQuantity]  = useState<string>(
    initial ? String(initial.quantity) : String(BLANK.quantity),
  );
  const [timeKnown,  setTimeKnown] = useState(initial?.time_known ?? BLANK.time_known);
  const [startDate,  setStartDate] = useState(initial?.start_date ?? BLANK.start_date);
  const [expiresAt,  setExpiresAt] = useState(initial?.expires_at ?? BLANK.expires_at);
  const [notes,      setNotes]     = useState(initial?.notes      ?? "");
  const [category,   setCategory]  = useState(initial?.category   ?? "");
  const [currency,   setCurrency]  = useState<Currency>(
    initial?.currency ?? BLANK.currency,
  );
  const [priceStr,   setPriceStr]  = useState<string>(
    initial?.price_cents != null
      ? (initial.price_cents / minorPerMajor(initial.currency ?? "USD")).toString()
      : "",
  );

  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const qNum = Number(quantity);
  const priceTrimmed = priceStr.trim();
  const pNum  = priceTrimmed === "" ? null : Number(priceTrimmed);
  const priceValid =
    pNum === null || (Number.isFinite(pNum) && pNum >= 0);
  const datesValid = startDate !== "" && expiresAt !== "" && startDate <= expiresAt;
  const canSubmit =
    !submitting &&
    name.trim() !== "" &&
    Number.isFinite(qNum) &&
    qNum > 0 &&
    datesValid &&
    priceValid;

  const priceStep = currency === "JPY" ? "1" : "0.01";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        name:        name.trim(),
        quantity:    qNum,
        time_known:  timeKnown,
        start_date:  startDate,
        expires_at:  expiresAt,
        notes:       notes.trim() === "" ? null : notes.trim(),
        category:    category.trim() === "" ? null : category.trim(),
        price_cents:
          pNum === null
            ? null
            : Math.round(pNum * minorPerMajor(currency)),
        currency,
      });
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-10">
      <div className="space-y-8">
        <Field label="Name" htmlFor="name">
          <input
            id="name"
            type="text"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Anthropic credits"
            className={`${inputClass} serif text-2xl italic placeholder:not-italic placeholder:text-ink-faint`}
          />
        </Field>

        <Field
          label="Tracks"
          hint={
            lockTimeKnown
              ? "locked — usages already recorded"
              : "what the quantity counts"
          }
        >
          <Segmented
            value={timeKnown ? "hours" : "units"}
            disabled={lockTimeKnown}
            options={[
              { value: "units", label: "units" },
              { value: "hours", label: "hours" },
            ]}
            onChange={(v) => setTimeKnown(v === "hours")}
          />
        </Field>

        <div className="grid grid-cols-2 gap-x-8 gap-y-8">
          <Field label="Quantity" htmlFor="quantity">
            <input
              id="quantity"
              type="number"
              required
              min={0}
              step="0.01"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className={`${inputClass} num tabular-nums`}
            />
          </Field>
          <Field label="Starts" htmlFor="start_date">
            <input
              id="start_date"
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={`${inputClass} num tabular-nums`}
            />
          </Field>
          <Field label="Expires" htmlFor="expires_at">
            <input
              id="expires_at"
              type="date"
              required
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className={`${inputClass} num tabular-nums`}
            />
          </Field>

          <Field label="Category" htmlFor="category" hint="optional">
            <input
              id="category"
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Yoga"
              className={inputClass}
            />
          </Field>

          <Field label={`Price (${currency})`} htmlFor="price" hint="optional">
            <div className="flex items-baseline gap-2">
              <input
                id="price"
                type="number"
                min={0}
                step={priceStep}
                inputMode={currency === "JPY" ? "numeric" : "decimal"}
                value={priceStr}
                onChange={(e) => setPriceStr(e.target.value)}
                placeholder={currency === "JPY" ? "18000" : "180"}
                className={`${inputClass} num tabular-nums`}
              />
              <CurrencySelect value={currency} onChange={setCurrency} />
            </div>
          </Field>
        </div>

        <Field label="Notes" htmlFor="notes" hint="optional">
          <textarea
            id="notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What is this pack for?"
            className={`${inputClass} resize-y`}
          />
        </Field>
      </div>

      {error && (
        <div className="border-y border-pace-red/40 bg-pace-red/5 px-1 py-4">
          <p className="text-sm font-semibold text-pace-red">{error}</p>
        </div>
      )}

      <div className="flex items-center justify-end gap-6 border-t border-hairline pt-6">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="text-[11px] uppercase tracking-micro text-ink-dim transition hover:text-ink disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="group inline-flex items-baseline gap-2 bg-accent px-5 py-2.5 text-sm font-medium text-canvas transition hover:bg-ink disabled:cursor-not-allowed disabled:bg-ink-faint"
        >
          {submitting ? "Saving…" : submitLabel}
          <span
            aria-hidden="true"
            className="text-base leading-none transition-transform duration-300 group-hover:translate-x-0.5"
          >
            →
          </span>
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------

// Underline-style fields: paper feel. Border only at the bottom.
const inputClass =
  "w-full bg-transparent border-b border-hairline px-0 py-2 text-base text-ink " +
  "placeholder:text-ink-faint outline-none transition " +
  "hover:border-ink-faint focus:border-accent";

function CurrencySelect({
  value, onChange,
}: {
  value:    Currency;
  onChange: (c: Currency) => void;
}) {
  return (
    <select
      aria-label="currency"
      value={value}
      onChange={(e) => onChange(e.target.value as Currency)}
      className="
        cursor-pointer border-b border-hairline bg-transparent py-2 pl-1 pr-5 text-sm
        font-medium uppercase tracking-wider text-ink-dim
        outline-none transition hover:border-ink-faint hover:text-ink focus:border-accent
      "
    >
      {CURRENCIES.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

function Field({
  label, htmlFor, hint, children,
}: {
  label:    string;
  htmlFor?: string;
  hint?:    string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="block">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[10px] uppercase tracking-micro text-ink-faint">
          {label}
        </span>
        {hint && (
          <span className="serif text-xs italic text-ink-faint">{hint}</span>
        )}
      </div>
      {children}
    </label>
  );
}

interface SegmentedOption {
  value: string;
  label: string;
}

function Segmented({
  value, options, onChange, disabled = false,
}: {
  value:    string;
  options:  SegmentedOption[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      className={`inline-flex gap-6 ${disabled ? "opacity-50" : ""}`}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={
              "pb-2 text-sm border-b transition " +
              (active
                ? "serif italic text-ink border-ink"
                : "text-ink-faint border-hairline hover:text-ink-dim hover:border-ink-faint") +
              (disabled ? " cursor-not-allowed" : "")
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

function defaultExpiry(): string {
  // 90 days out — typical pack duration; user can adjust.
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 90);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "name_required":             return "Name is required.";
      case "quantity_must_be_positive": return "Quantity must be greater than 0.";
      case "currency_unsupported":      return "That currency isn't supported.";
      case "start_date_after_expires_at":
        return "Start date must be on or before the expiry date.";
      case "time_known_locked":
        return "Can't change units once usages are recorded.";
      case "not_found":                 return "Package not found.";
      default:                          return `Couldn't save (${err.code}).`;
    }
  }
  return err instanceof Error ? err.message : "Couldn't save.";
}
