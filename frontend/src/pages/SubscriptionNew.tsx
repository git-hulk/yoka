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
    <div className="space-y-10">
      <div className="border-b border-hairline pb-4">
        <span className="text-[11px] uppercase tracking-micro text-ink-faint">
          new entry
        </span>
        <h1 className="serif mt-2 text-base font-bold leading-none text-ink">
          A new subscription.
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
