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
    <div className="space-y-6">
      <div className="border-b border-hairline pb-4">
        <span className="text-xs text-ink-faint">New entry</span>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">
          New expense
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
