import { useNavigate } from "react-router-dom";

import { api } from "../lib/api";
import type { PackageInput } from "../lib/api";
import PackageForm from "../components/PackageForm";

export default function PackageNew() {
  const navigate = useNavigate();

  async function handleSubmit(input: PackageInput) {
    const created = await api.createPackage(input);
    navigate(`/packages/${created.id}`);
  }

  return (
    <div className="space-y-10">
      <div className="border-b border-hairline pb-4">
        <span className="text-[10px] uppercase tracking-micro text-ink-faint">
          new entry
        </span>
        <h1 className="serif mt-2 text-5xl leading-none text-ink">
          A new pack.
        </h1>
      </div>

      <PackageForm
        submitLabel="Create"
        onSubmit={handleSubmit}
        onCancel={() => navigate("/")}
      />
    </div>
  );
}
