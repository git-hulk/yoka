import { useNavigate } from "react-router-dom";

import { api } from "../../lib/api";
import type { ExpenseInput } from "../../lib/api";
import ExpenseForm from "./ExpenseForm";

export default function ExpenseNew() {
  const navigate = useNavigate();

  async function handleSubmit(input: ExpenseInput) {
    await api.createExpense(input);
    navigate("/finance");
  }

  return (
    <div className="space-y-10">
      <div className="border-b border-hairline pb-4">
        <span className="text-[11px] uppercase tracking-micro text-ink-faint">
          new entry
        </span>
        <h1 className="serif mt-2 text-base font-bold leading-none text-ink">
          A one-off expense.
        </h1>
      </div>

      <ExpenseForm
        submitLabel="Add expense"
        onSubmit={handleSubmit}
        onCancel={() => navigate("/finance")}
      />
    </div>
  );
}
