import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { api } from "../lib/api";
import type { PackageInput } from "../lib/api";
import { isNotFound, useFetch } from "../lib/useFetch";
import PackageForm from "../components/PackageForm";
import UsageEditor from "../components/UsageEditor";

export default function PackageEdit() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate    = useNavigate();
  const [refreshKey, setRefreshKey] = useState(0);

  const pkgState    = useFetch(() => api.getPackage(id),   [id, refreshKey]);
  const usagesState = useFetch(() => api.listUsages(id),   [id, refreshKey]);

  if (pkgState.status === "loading") return <Skeleton />;
  if (pkgState.status === "error") {
    return isNotFound(pkgState.error)
      ? <NotFound id={id} />
      : <ErrorBox title="Couldn't load package" detail={pkgState.error.message} />;
  }

  const pkg = pkgState.data;
  const hasUsages =
    usagesState.status === "ok" && usagesState.data.length > 0;

  const initial: PackageInput = {
    name:          pkg.name,
    quantity:      pkg.quantity,
    tracking_mode: pkg.tracking_mode,
    start_date:    pkg.start_date,
    expires_at:    pkg.expires_at,
    notes:         pkg.notes,
    categories:    pkg.categories,
    price_cents:   pkg.price_cents,
    currency:      pkg.currency,
  };

  async function handleSubmit(input: PackageInput) {
    const updated = await api.updatePackage(id, input);
    navigate(`/packages/${updated.id}`);
  }

  const isDuration = pkg.tracking_mode === "duration";

  return (
    <div className="space-y-12">
      <div className="border-b border-hairline pb-4">
        <span className="text-[11px] uppercase tracking-micro text-ink-faint">
          revising
        </span>
        <h1 className="serif mt-2 text-base font-bold leading-none text-ink">
          {pkg.name}
        </h1>
      </div>

      <PackageForm
        initial={initial}
        lockTrackingMode={hasUsages}
        submitLabel="Save changes"
        onSubmit={handleSubmit}
        onCancel={() => navigate(`/packages/${id}`)}
      />

      {!isDuration && (
        <UsageEditor
          packageId={pkg.id}
          timeKnown={pkg.tracking_mode === "hours"}
          onChange={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Skeleton() {
  return (
    <div className="space-y-12" aria-busy="true">
      <div>
        <div className="h-3 w-16 animate-pulse rounded-sm bg-ink/5" />
        <div className="mt-3 h-10 w-56 animate-pulse rounded-sm bg-ink/5" />
      </div>
      <div className="space-y-6">
        <div className="h-12 w-full animate-pulse rounded-sm bg-ink/5" />
        <div className="h-12 w-1/2 animate-pulse rounded-sm bg-ink/5" />
        <div className="h-20 w-full animate-pulse rounded-sm bg-ink/5" />
      </div>
    </div>
  );
}

function NotFound({ id }: { id: string }) {
  return (
    <div className="border-y border-hairline py-12 text-center">
      <p className="serif text-base italic font-semibold text-ink">No such package.</p>
      <p className="mt-3 text-sm text-ink-dim">
        <span className="num">{id}</span> may have been archived or deleted.
      </p>
    </div>
  );
}

function ErrorBox({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="border-y border-pace-red/40 bg-pace-red/5 px-1 py-5">
      <p className="text-sm font-semibold text-pace-red">{title}</p>
      <p className="mt-1 text-xs text-ink-dim">{detail}</p>
    </div>
  );
}
