import { useNavigate } from "react-router-dom";

import { api } from "../../lib/api";
import type { RecurringExpenseInput } from "../../lib/api";
import RecurringExpenseForm from "./RecurringExpenseForm";

export default function RecurringExpenseNew() {
  const navigate = useNavigate();

  async function handleSubmit(input: RecurringExpenseInput) {
    await api.createRecurringExpense(input);
    navigate("/finance");
  }

  return (
    <div className="space-y-10">
      <div className="border-b border-hairline pb-4">
        <span className="text-[11px] uppercase tracking-micro text-ink-faint">
          new rule
        </span>
        <h1 className="serif mt-2 text-base font-bold leading-none text-ink">
          A recurring expense.
        </h1>
      </div>

      <RecurringExpenseForm
        submitLabel="Add rule"
        onSubmit={handleSubmit}
        onCancel={() => navigate("/finance")}
      />
    </div>
  );
}
