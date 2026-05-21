import { useState } from "react";

import { api, ApiError } from "../lib/api";
import type { SubscriptionInput } from "../lib/api";
import { minorPerMajor } from "../lib/pace";
import { CURRENCIES } from "../lib/types";
import type { Currency, TrackingMode } from "../lib/types";
import { useFetch } from "../lib/useFetch";
import CategoriesPicker from "./CategoriesPicker";

interface Props {
  initial?:    SubscriptionInput;
  /** When true, the tracking-mode segmented is disabled. Edit mode locks
   *  this field once any usage exists — flipping it would silently
   *  re-interpret historical amounts (or strand them on a duration subscription). */
  lockTrackingMode?: boolean;
  submitLabel: string;
  onSubmit:    (input: SubscriptionInput) => Promise<void>;
  onCancel:    () => void;
}

const BLANK: SubscriptionInput = {
  name:          "",
  quantity:      1,
  tracking_mode: "units",
  start_date:    today(),
  expires_at:    defaultExpiry(),
  notes:         null,
  categories:    [],
  price_cents:   null,
  currency:      "USD",
};

export default function SubscriptionForm({
  initial,
  lockTrackingMode = false,
  submitLabel,
  onSubmit,
  onCancel,
}: Props) {
  const initialQuantity = initial?.quantity ?? BLANK.quantity;
  const [name,         setName]         = useState(initial?.name ?? BLANK.name);
  const [quantity,     setQuantity]     = useState<string>(
    initialQuantity != null ? String(initialQuantity) : String(BLANK.quantity),
  );
  const [trackingMode, setTrackingMode] = useState<TrackingMode>(
    initial?.tracking_mode ?? BLANK.tracking_mode,
  );
  const [startDate,    setStartDate]    = useState(initial?.start_date ?? BLANK.start_date);
  const [expiresAt,    setExpiresAt]    = useState(initial?.expires_at ?? BLANK.expires_at);
  const [notes,        setNotes]        = useState(initial?.notes      ?? "");
  const [categories,   setCategories]   = useState<string[]>(initial?.categories ?? []);
  const [currency,     setCurrency]     = useState<Currency>(
    initial?.currency ?? BLANK.currency,
  );
  const [priceStr,     setPriceStr]     = useState<string>(
    initial?.price_cents != null
      ? (initial.price_cents / minorPerMajor(initial.currency ?? "USD")).toString()
      : "",
  );

  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  // Existing categories, surfaced as suggestions on the category combobox.
  // Failure is silent — the input still accepts free text without them.
  const categoriesState = useFetch(() => api.listCategories(), []);
  const categorySuggestions =
    categoriesState.status === "ok" ? categoriesState.data : [];

  const isDuration   = trackingMode === "duration";
  const qNum         = Number(quantity);
  const quantityOk   = isDuration || (Number.isFinite(qNum) && qNum > 0);
  const priceTrimmed = priceStr.trim();
  const pNum         = priceTrimmed === "" ? null : Number(priceTrimmed);
  const priceValid   = pNum !== null && Number.isFinite(pNum) && pNum >= 0;
  const datesValid   = startDate !== "" && expiresAt !== "" && startDate <= expiresAt;
  const canSubmit    =
    !submitting &&
    name.trim() !== "" &&
    quantityOk &&
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
        name:          name.trim(),
        quantity:      isDuration ? null : qNum,
        tracking_mode: trackingMode,
        start_date:    startDate,
        expires_at:    expiresAt,
        notes:         notes.trim() === "" ? null : notes.trim(),
        categories:    categories,
        price_cents:   Math.round((pNum as number) * minorPerMajor(currency)),
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
            className={`${inputClass} serif text-base italic placeholder:not-italic placeholder:text-ink-faint`}
          />
        </Field>

        <div className="grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-[1fr_8rem] sm:items-end">
          <Field
            label="Tracks"
            hint={
              lockTrackingMode
                ? "fixed once a usage is logged"
                : isDuration
                  ? "tallied by the day"
                  : "tallied by usage"
            }
          >
            <Segmented
              value={trackingMode}
              disabled={lockTrackingMode}
              options={[
                { value: "units",    label: "units" },
                { value: "hours",    label: "hours" },
                { value: "duration", label: "duration" },
              ]}
              onChange={(v) => setTrackingMode(v as TrackingMode)}
            />
          </Field>
          {!isDuration && (
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
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-8">
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

          <Field label="Categories" htmlFor="category" hint="up to 3">
            <CategoriesPicker
              id="category"
              values={categories}
              onChange={setCategories}
              options={categorySuggestions}
              placeholder={
                categorySuggestions.length > 0 ? "pick or create" : "Yoga"
              }
            />
          </Field>

          <Field label={`Price (${currency})`} htmlFor="price">
            <div className="flex items-baseline gap-2">
              <input
                id="price"
                type="number"
                required
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
            placeholder="What is this subscription for?"
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
        <span className="text-[11px] uppercase tracking-micro text-ink-faint">
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
  // 90 days out — typical subscription duration; user can adjust.
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
      case "quantity_forbidden_for_duration":
        return "Duration subscriptions don't take a quantity.";
      case "currency_unsupported":      return "That currency isn't supported.";
      case "start_date_after_expires_at":
        return "Start date must be on or before the expiry date.";
      case "tracking_mode_locked":
        return "Can't change tracking mode once usages are recorded.";
      case "usages_forbidden_for_duration":
        return "Duration subscriptions don't track usages.";
      case "categories_too_many":
        return "Up to 3 categories.";
      case "price_required":
        return "Price is required.";
      case "price_cents_must_be_nonnegative":
        return "Price can't be negative.";
      case "not_found":                 return "Subscription not found.";
      default:                          return `Couldn't save (${err.code}).`;
    }
  }
  return err instanceof Error ? err.message : "Couldn't save.";
}
