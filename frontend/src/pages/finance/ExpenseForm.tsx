// Shared form for one-off expenses. ExpenseNew and ExpenseEdit wrap it
// with the right submit + cancel handlers.

import { useState } from "react";

import { api, ApiError } from "../../lib/api";
import type { ExpenseInput } from "../../lib/api";
import CategoriesPicker from "../../components/CategoriesPicker";
import { minorPerMajor } from "../../lib/pace";
import { CURRENCIES } from "../../lib/types";
import type { Currency } from "../../lib/types";
import { useFetch } from "../../lib/useFetch";
import { inputClass, textareaClass } from "../../components/ui/Input";
import { buttonClass } from "../../components/ui";

interface Props {
  initial?:    ExpenseInput;
  submitLabel: string;
  onSubmit:    (input: ExpenseInput) => Promise<void>;
  onCancel:    () => void;
}

const BLANK: ExpenseInput = {
  occurred_on:  today(),
  amount_cents: 0,
  currency:     "SGD",
  category:     "",
  notes:        null,
};

export default function ExpenseForm({
  initial, submitLabel, onSubmit, onCancel,
}: Props) {
  const [occurredOn, setOccurredOn] = useState(initial?.occurred_on ?? BLANK.occurred_on);
  const [currency,   setCurrency]   = useState<Currency>(initial?.currency ?? BLANK.currency);
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
  const canSubmit     = !submitting && occurredOn !== "" && amountValid;

  const step = currency === "JPY" ? "1" : "0.01";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        occurred_on:  occurredOn,
        amount_cents: Math.round((amountNum as number) * minorPerMajor(currency)),
        currency,
        category:     category[0] ?? "",
        notes:        notes.trim() === "" ? null : notes.trim(),
      });
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          <Field label="Date" htmlFor="occurred_on">
            <input
              id="occurred_on"
              type="date"
              required
              value={occurredOn}
              onChange={(e) => setOccurredOn(e.target.value)}
              className={`${inputClass} num tabular-nums`}
            />
          </Field>
          <Field label={`Amount (${currency})`} htmlFor="amount">
            <div className="flex items-stretch gap-2">
              <input
                id="amount"
                type="number"
                required
                min={0}
                step={step}
                inputMode={currency === "JPY" ? "numeric" : "decimal"}
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder={currency === "JPY" ? "5000" : "12.50"}
                className={`${inputClass} num tabular-nums`}
                autoFocus
              />
              <CurrencySelect value={currency} onChange={setCurrency} />
            </div>
          </Field>
        </div>

        <Field label="Category" htmlFor="category" hint="One tag">
          <CategoriesPicker
            id="category"
            mode="single"
            values={category}
            onChange={setCategory}
            options={categorySuggestions}
            placeholder={
              categorySuggestions.length > 0 ? "Pick or create" : "Food"
            }
          />
        </Field>

        <Field label="Notes" htmlFor="notes" hint="Optional">
          <textarea
            id="notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What was this expense for?"
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
          className={buttonClass("secondary")}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className={buttonClass("primary")}
        >
          {submitting ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------

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
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium text-ink-dim">{label}</span>
        {hint && <span className="text-xs text-ink-faint">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "amount_must_be_positive": return "Amount must be greater than 0.";
      case "currency_unsupported":    return "That currency isn't supported.";
      case "not_found":               return "Expense not found.";
      default:                        return `Couldn't save (${err.code}).`;
    }
  }
  return err instanceof Error ? err.message : "Couldn't save.";
}
