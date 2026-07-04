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
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <div className="space-y-4">
        <Field label="Name" htmlFor="name">
          <input
            id="name"
            type="text"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Anthropic credits"
            className={inputClass}
          />
        </Field>

        <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-[1fr_8rem] sm:items-end">
          <Field
            label="Tracks"
            hint={
              lockTrackingMode
                ? "Fixed once a usage is logged"
                : isDuration
                  ? "Tallied by the day"
                  : "Tallied by usage"
            }
          >
            <Segmented
              value={trackingMode}
              disabled={lockTrackingMode}
              options={[
                { value: "units",    label: "Units" },
                { value: "hours",    label: "Hours" },
                { value: "duration", label: "Duration" },
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

        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
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

          <Field label="Categories" htmlFor="category" hint="Up to 3">
            <CategoriesPicker
              id="category"
              values={categories}
              onChange={setCategories}
              options={categorySuggestions}
              placeholder={
                categorySuggestions.length > 0 ? "Pick or create" : "Yoga"
              }
            />
          </Field>

          <Field label={`Price (${currency})`} htmlFor="price">
            <div className="flex items-stretch gap-2">
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

        <Field label="Notes" htmlFor="notes" hint="Optional">
          <textarea
            id="notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What is this subscription for?"
            className={`${textareaClass} resize-y`}
          />
        </Field>
      </div>

      {error && (
        <div className="rounded-lg border border-pace-red/40 bg-pace-red/5 px-4 py-3">
          <p className="text-sm font-medium text-pace-red">{error}</p>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-hairline pt-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="inline-flex h-8 items-center rounded-md border border-hairline bg-white px-3 text-sm font-medium text-ink transition hover:bg-subtle disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex h-8 items-center rounded-md border border-accent bg-accent px-3 text-sm font-medium text-white transition hover:bg-accent-deep disabled:cursor-not-allowed disabled:border-ink-faint disabled:bg-ink-faint"
        >
          {submitting ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------

// GH-style boxed inputs: hairline border, 6px radius, 32px height, 14px Inter,
// accent focus ring (2px accent-soft for the GH glow effect).
const inputClass =
  "h-8 w-full rounded-md border border-hairline bg-white px-2.5 text-sm text-ink " +
  "placeholder:text-ink-faint outline-none transition " +
  "hover:border-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft";

const textareaClass =
  "w-full rounded-md border border-hairline bg-white px-2.5 py-2 text-sm text-ink " +
  "placeholder:text-ink-faint outline-none transition " +
  "hover:border-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft";

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
        h-8 cursor-pointer rounded-md border border-hairline bg-white px-2 text-sm
        font-medium text-ink-dim outline-none transition
        hover:border-ink-faint hover:text-ink focus:border-accent focus:ring-2 focus:ring-accent-soft
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
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium text-ink-dim">{label}</span>
        {hint && <span className="text-xs text-ink-faint">{hint}</span>}
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
      className={
        "inline-flex h-8 rounded-md border border-hairline bg-white p-0.5 " +
        (disabled ? "opacity-50" : "")
      }
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
              "inline-flex items-center rounded-[5px] px-2.5 text-sm font-medium transition " +
              (active
                ? "bg-accent-soft text-accent"
                : "text-ink-dim hover:bg-subtle hover:text-ink") +
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
