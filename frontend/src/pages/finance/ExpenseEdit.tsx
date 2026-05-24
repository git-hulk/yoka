import { useNavigate, useParams } from "react-router-dom";

import { api, ApiError } from "../../lib/api";
import type { ExpenseInput } from "../../lib/api";
import { useFetch } from "../../lib/useFetch";
import ExpenseForm from "./ExpenseForm";

export default function ExpenseEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const state = useFetch(
    () => api.getExpense(id!),
    [id],
  );

  if (state.status === "loading") {
    return <Skeleton />;
  }
  if (state.status === "error") {
    const notFound = state.error instanceof ApiError && state.error.status === 404;
    return (
      <div className="space-y-6">
        <h1 className="serif text-base font-bold text-ink">
          {notFound ? "Expense not found." : "Couldn't load expense."}
        </h1>
        <p className="text-sm text-ink-dim">{state.error.message}</p>
      </div>
    );
  }

  const e = state.data;
  const initial: ExpenseInput = {
    occurred_on:  e.occurred_on,
    amount_cents: e.amount_cents,
    currency:     e.currency,
    category:     e.category,
    notes:        e.notes,
  };

  async function handleSubmit(input: ExpenseInput) {
    await api.updateExpense(id!, input);
    navigate("/finance");
  }

  async function handleDelete() {
    if (!window.confirm("Delete this expense?")) return;
    await api.deleteExpense(id!);
    navigate("/finance");
  }

  return (
    <div className="space-y-10">
      <div className="flex items-end justify-between gap-4 border-b border-hairline pb-4">
        <div>
          <span className="text-[11px] uppercase tracking-micro text-ink-faint">
            edit expense
          </span>
          <h1 className="serif mt-2 text-base font-bold leading-none text-ink">
            Adjust the entry.
          </h1>
        </div>
        <button
          type="button"
          onClick={handleDelete}
          className="text-[11px] uppercase tracking-micro text-ink-faint transition hover:text-pace-red"
        >
          delete
        </button>
      </div>

      <ExpenseForm
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
