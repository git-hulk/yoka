import { useNavigate, useParams } from "react-router-dom";

import { api, ApiError } from "../../lib/api";
import type { RecurringExpenseInput } from "../../lib/api";
import { useFetch } from "../../lib/useFetch";
import RecurringExpenseForm from "./RecurringExpenseForm";

export default function RecurringExpenseEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const state = useFetch(
    () => api.getRecurringExpense(id!),
    [id],
  );

  if (state.status === "loading") return <Skeleton />;
  if (state.status === "error") {
    const notFound = state.error instanceof ApiError && state.error.status === 404;
    return (
      <div className="space-y-6">
        <h1 className="serif text-base font-bold text-ink">
          {notFound ? "Recurring expense not found." : "Couldn't load."}
        </h1>
        <p className="text-sm text-ink-dim">{state.error.message}</p>
      </div>
    );
  }

  const r = state.data;
  const initial: RecurringExpenseInput = {
    name:         r.name,
    amount_cents: r.amount_cents,
    currency:     r.currency,
    category:     r.category,
    cadence:      r.cadence,
    start_date:   r.start_date,
    end_date:     r.end_date,
    notes:        r.notes,
  };

  async function handleSubmit(input: RecurringExpenseInput) {
    await api.updateRecurringExpense(id!, input);
    navigate("/finance");
  }

  async function handleArchive() {
    if (!window.confirm("Archive this rule? Past cycles stay visible; no new entries will be generated.")) return;
    await api.archiveRecurringExpense(id!);
    navigate("/finance");
  }

  async function handleDelete() {
    if (!window.confirm("Delete this rule entirely?")) return;
    await api.deleteRecurringExpense(id!);
    navigate("/finance");
  }

  return (
    <div className="space-y-10">
      <div className="flex items-end justify-between gap-4 border-b border-hairline pb-4">
        <div>
          <span className="text-[11px] uppercase tracking-micro text-ink-faint">
            edit rule
          </span>
          <h1 className="serif mt-2 text-base font-bold leading-none text-ink">
            Tune the cadence.
          </h1>
        </div>
        <div className="flex items-baseline gap-5">
          {r.archived_at === null && (
            <button
              type="button"
              onClick={handleArchive}
              className="text-[11px] uppercase tracking-micro text-ink-faint transition hover:text-accent"
            >
              archive
            </button>
          )}
          <button
            type="button"
            onClick={handleDelete}
            className="text-[11px] uppercase tracking-micro text-ink-faint transition hover:text-pace-red"
          >
            delete
          </button>
        </div>
      </div>

      <RecurringExpenseForm
        initial={initial}
        submitLabel="Save"
        onSubmit={handleSubmit}
        onCancel={() => navigate("/finance")}
      />
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="h-3 w-24 animate-pulse rounded-sm bg-ink/5" />
      <div className="h-10 w-1/2 animate-pulse rounded-sm bg-ink/5" />
    </div>
  );
}
