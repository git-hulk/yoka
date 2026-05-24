// Shared form for recurring-expense rules.

import { useState } from "react";

import { api, ApiError } from "../../lib/api";
import type { RecurringExpenseInput } from "../../lib/api";
import CategoriesPicker from "../../components/CategoriesPicker";
import { minorPerMajor } from "../../lib/pace";
import { CURRENCIES } from "../../lib/types";
import type { Cadence, Currency } from "../../lib/types";
import { useFetch } from "../../lib/useFetch";

interface Props {
  initial?:    RecurringExpenseInput;
  submitLabel: string;
  onSubmit:    (input: RecurringExpenseInput) => Promise<void>;
  onCancel:    () => void;
}

const BLANK: RecurringExpenseInput = {
  name:         "",
  amount_cents: 0,
  currency:     "SGD",
  category:     "",
  cadence:      "monthly",
  start_date:   today(),
  end_date:     null,
  notes:        null,
};

export default function RecurringExpenseForm({
  initial, submitLabel, onSubmit, onCancel,
}: Props) {
  const [name,       setName]       = useState(initial?.name ?? BLANK.name);
  const [currency,   setCurrency]   = useState<Currency>(initial?.currency ?? BLANK.currency);
  const [cadence,    setCadence]    = useState<Cadence>(initial?.cadence ?? BLANK.cadence);
  const [startDate,  setStartDate]  = useState(initial?.start_date ?? BLANK.start_date);
  const [endDate,    setEndDate]    = useState<string>(initial?.end_date ?? "");
  const [category,   setCategory]   = useState<string[]>(
    initial?.category && initial.category !== "" ? [initial.category] : [],
  );
  const [notes,      setNotes]      = useState<string>(initial?.notes ?? "");
  const [amountStr,  setAmountStr]  = useState<string>(
    initial && initial.amount_cents > 0
      ? (initial.amount_cents / minorPerMajor(initial.currency)).toString()
      : "",
  );

  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const categoriesState = useFetch(() => api.listCategories(), []);
  const categorySuggestions = categoriesState.status === "ok" ? categoriesState.data : [];

  const amountTrimmed = amountStr.trim();
  const amountNum     = amountTrimmed === "" ? null : Number(amountTrimmed);
  const amountValid   = amountNum !== null && Number.isFinite(amountNum) && amountNum > 0;
  const datesValid    = startDate !== "" && (endDate === "" || endDate >= startDate);
  const canSubmit     = !submitting && name.trim() !== "" && amountValid && datesValid;

  const step = currency === "JPY" ? "1" : "0.01";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        name:         name.trim(),
        amount_cents: Math.round((amountNum as number) * minorPerMajor(currency)),
        currency,
        category:     category[0] ?? "",
        cadence,
        start_date:   startDate,
        end_date:     endDate === "" ? null : endDate,
        notes:        notes.trim() === "" ? null : notes.trim(),
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
            placeholder="Rent"
            className={`${inputClass} serif text-base placeholder:text-ink-faint`}
          />
        </Field>

        <div className="grid grid-cols-2 gap-x-8 gap-y-8">
          <Field label={`Amount (${currency})`} htmlFor="amount">
            <div className="flex items-baseline gap-2">
              <input
                id="amount"
                type="number"
                required
                min={0}
                step={step}
                inputMode={currency === "JPY" ? "numeric" : "decimal"}
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder={currency === "JPY" ? "5000" : "1500"}
                className={`${inputClass} num tabular-nums`}
              />
              <CurrencySelect value={currency} onChange={setCurrency} />
            </div>
          </Field>
          <Field label="Cadence">
            <Segmented
              value={cadence}
              options={[
                { value: "monthly", label: "monthly" },
                { value: "yearly",  label: "yearly" },
              ]}
              onChange={(v) => setCadence(v as Cadence)}
            />
          </Field>
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
          <Field label="Ends" htmlFor="end_date" hint="optional">
            <input
              id="end_date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={`${inputClass} num tabular-nums`}
            />
          </Field>

          <Field label="Category" htmlFor="category" hint="one tag">
            <CategoriesPicker
              id="category"
              mode="single"
              values={category}
              onChange={setCategory}
              options={categorySuggestions}
              placeholder={
                categorySuggestions.length > 0 ? "pick or create" : "Housing"
              }
            />
          </Field>
        </div>

        <Field label="Notes" htmlFor="notes" hint="optional">
          <textarea
            id="notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Why this is recurring."
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
        <option key={c} value={c}>{c}</option>
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
          <span className="serif text-xs text-ink-faint">{hint}</span>
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
  value, options, onChange,
}: {
  value:    string;
  options:  SegmentedOption[];
  onChange: (v: string) => void;
}) {
  return (
    <div role="radiogroup" className="inline-flex gap-6">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={
              "pb-2 text-sm border-b transition " +
              (active
                ? "serif text-ink border-ink"
                : "text-ink-faint border-hairline hover:text-ink-dim hover:border-ink-faint")
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "name_required":           return "Name is required.";
      case "amount_must_be_positive": return "Amount must be greater than 0.";
      case "currency_unsupported":    return "That currency isn't supported.";
      case "end_date_before_start":   return "End date must be on or after the start date.";
      case "not_found":               return "Recurring expense not found.";
      default:                        return `Couldn't save (${err.code}).`;
    }
  }
  return err instanceof Error ? err.message : "Couldn't save.";
}
