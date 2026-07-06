import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { api } from "../lib/api";
import type { SubscriptionInput } from "../lib/api";
import { isNotFound, useFetch } from "../lib/useFetch";
import SubscriptionForm from "../components/SubscriptionForm";
import UsageEditor from "../components/UsageEditor";

export default function SubscriptionEdit() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate    = useNavigate();
  const [refreshKey, setRefreshKey] = useState(0);

  const subState    = useFetch(() => api.getSubscription(id),         [id, refreshKey]);
  const eventsState = useFetch(() => api.listSubscriptionEvents(id), [id, refreshKey]);

  if (subState.status === "loading") return <Skeleton />;
  if (subState.status === "error") {
    return isNotFound(subState.error)
      ? <NotFound id={id} />
      : <ErrorBox title="Couldn't load subscription" detail={subState.error.message} />;
  }

  const sub = subState.data;
  // Any linked event (pending or accepted) locks the tracking mode — matches
  // the backend's `any_for_subscription` check.
  const hasUsages =
    eventsState.status === "ok" && eventsState.data.length > 0;

  const initial: SubscriptionInput = {
    name:          sub.name,
    quantity:      sub.quantity,
    tracking_mode: sub.tracking_mode,
    start_date:    sub.start_date,
    expires_at:    sub.expires_at,
    notes:         sub.notes,
    categories:    sub.categories,
    price_cents:   sub.price_cents,
    currency:      sub.currency,
  };

  async function handleSubmit(input: SubscriptionInput) {
    const updated = await api.updateSubscription(id, input);
    navigate(`/subscriptions/${updated.id}`);
  }

  const isDuration = sub.tracking_mode === "duration";

  return (
    <div className="space-y-8">
      <div className="border-b border-hairline pb-4">
        <span className="text-xs text-ink-faint">Editing</span>
        <h1 className="mt-1 text-xl font-medium tracking-tight text-ink">
          {sub.name}
        </h1>
      </div>

      <SubscriptionForm
        initial={initial}
        lockTrackingMode={hasUsages}
        submitLabel="Save changes"
        onSubmit={handleSubmit}
        onCancel={() => navigate(`/subscriptions/${id}`)}
      />

      {!isDuration && (
        <UsageEditor
          subscriptionId={sub.id}
          timeKnown={sub.tracking_mode === "hours"}
          onChange={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Skeleton() {
  return (
    <div className="space-y-8" aria-busy="true">
      <div>
        <div className="h-3 w-16 animate-pulse rounded-sm bg-ink/5" />
        <div className="mt-2 h-7 w-56 animate-pulse rounded-sm bg-ink/5" />
      </div>
      <div className="space-y-4">
        <div className="h-8 w-full animate-pulse rounded-sm bg-ink/5" />
        <div className="h-8 w-1/2 animate-pulse rounded-sm bg-ink/5" />
        <div className="h-20 w-full animate-pulse rounded-sm bg-ink/5" />
      </div>
    </div>
  );
}

function NotFound({ id }: { id: string }) {
  return (
    <div className="rounded-lg border border-hairline bg-subtle/40 py-12 text-center">
      <p className="text-base font-medium text-ink">No such subscription.</p>
      <p className="mt-1 text-sm text-ink-dim">
        <span className="num">{id}</span> may have been archived or deleted.
      </p>
    </div>
  );
}

function ErrorBox({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-pace-red/40 bg-pace-red/5 px-4 py-3">
      <p className="text-sm font-medium text-pace-red">{title}</p>
      <p className="mt-0.5 text-xs text-ink-dim">{detail}</p>
    </div>
  );
}
