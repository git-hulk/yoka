// Redeem an invite link. The preview endpoint is public, so we can render
// the group name + role even before the recipient has an account.

import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { InvitePreview } from "../lib/types";

export default function AcceptInvite() {
  const { token = "" } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [preview, setPreview] = useState<InvitePreview | null | "missing">(null);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.showInvite(token).then(
      (p) => setPreview(p),
      () => setPreview("missing"),
    );
  }, [token]);

  if (preview === null) {
    return (
      <div className="mx-auto mt-16 max-w-sm" aria-busy="true">
        <div className="h-4 w-32 animate-pulse rounded bg-ink/5" />
        <div className="mt-3 h-8 w-3/4 animate-pulse rounded bg-ink/5" />
      </div>
    );
  }
  if (preview === "missing") {
    return (
      <div className="mx-auto mt-16 max-w-sm">
        <h1 className="text-2xl font-medium tracking-tight text-ink">Invite not found</h1>
        <p className="mt-2 text-sm text-ink-dim">
          This link is invalid or no longer exists. Ask the person who shared it for a new one.
        </p>
      </div>
    );
  }
  if (preview.status !== "pending") {
    const copy =
      preview.status === "accepted"
        ? "This invite has already been redeemed."
        : preview.status === "revoked"
          ? "This invite has been revoked."
          : "This invite has expired.";
    return (
      <div className="mx-auto mt-16 max-w-sm">
        <h1 className="text-2xl font-medium tracking-tight text-ink">Invite unavailable</h1>
        <p className="mt-2 text-sm text-ink-dim">{copy}</p>
      </div>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.acceptInvite(token, password);
      await refresh();
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        const map: Record<string, string> = {
          password_too_short:      "Password must be at least 8 characters.",
          invite_expired:          "This invite has expired.",
          invite_already_redeemed: "This invite has already been used.",
        };
        setError(map[err.code] ?? "Could not accept invite. Try again.");
      } else {
        setError("Network error. Try again.");
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="text-2xl font-medium tracking-tight text-ink">
        Join {preview.group_name}
      </h1>
      <p className="mt-1 text-sm text-ink-dim">
        Invited as <span className="font-medium text-ink">{preview.email}</span> ·{" "}
        <span className="font-medium text-ink">{preview.role}</span>
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <label className="block">
          <span className="block text-sm font-medium text-ink">Choose a password</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-md border border-hairline bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          <span className="mt-1 block text-xs text-ink-faint">At least 8 characters.</span>
        </label>

        {error && (
          <div className="rounded-md border border-pace-red/30 bg-pace-red/5 px-3 py-2 text-sm text-pace-red">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex h-10 w-full items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-white shadow-sm transition hover:bg-accent-deep disabled:opacity-60"
        >
          {submitting ? "Joining…" : "Accept invite"}
        </button>
      </form>
    </div>
  );
}
