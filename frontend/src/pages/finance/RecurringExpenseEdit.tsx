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
      <div className="space-y-3">
        <h1 className="text-xl font-medium tracking-tight text-ink">
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hairline pb-4">
        <div>
          <span className="text-xs text-ink-faint">Edit rule</span>
          <h1 className="mt-1 text-xl font-medium tracking-tight text-ink">
            Tune the cadence
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {r.archived_at === null && (
            <button
              type="button"
              onClick={handleArchive}
              className="inline-flex h-8 items-center rounded-md border border-hairline bg-white px-3 text-sm font-medium text-ink transition hover:bg-subtle"
            >
              Archive
            </button>
          )}
          <button
            type="button"
            onClick={handleDelete}
            className="inline-flex h-8 items-center rounded-md border border-pace-red/30 bg-white px-3 text-sm font-medium text-pace-red transition hover:bg-pace-red/5"
          >
            Delete
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
