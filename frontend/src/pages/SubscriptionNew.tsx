import { useNavigate } from "react-router-dom";

import { api } from "../lib/api";
import type { SubscriptionInput } from "../lib/api";
import SubscriptionForm from "../components/SubscriptionForm";

export default function SubscriptionNew() {
  const navigate = useNavigate();

  async function handleSubmit(input: SubscriptionInput) {
    const created = await api.createSubscription(input);
    navigate(`/subscriptions/${created.id}`);
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-hairline pb-4">
        <span className="text-xs text-ink-faint">New entry</span>
        <h1 className="mt-1 text-xl font-medium tracking-tight text-ink">
          New subscription
        </h1>
      </div>

      <SubscriptionForm
        submitLabel="Create"
        onSubmit={handleSubmit}
        onCancel={() => navigate("/")}
      />
    </div>
  );
}
