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
    <div className="space-y-6">
      <div className="border-b border-hairline pb-4">
        <span className="text-xs text-ink-faint">New rule</span>
        <h1 className="mt-1 text-xl font-medium tracking-tight text-ink">
          New recurring expense
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
