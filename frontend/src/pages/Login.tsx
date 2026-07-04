// Email + password sign-in. On success, refresh AuthProvider and navigate
// home. Layout matches the existing form/card style — paper canvas, hairline
// borders, accent-green primary button.

import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

export default function Login() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.login(email, password);
      await refresh();
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.code === "invalid_credentials"
          ? "Email or password is incorrect."
          : "Something went wrong. Try again.");
      } else {
        setError("Network error. Try again.");
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="text-2xl font-medium tracking-tight text-ink">Sign in</h1>
      <p className="mt-1 text-sm text-ink-dim">Welcome back. Sign in to continue.</p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <label className="block">
          <span className="block text-sm font-medium text-ink">Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded-md border border-hairline bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-ink">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-md border border-hairline bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
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
          {submitting ? "Signing in…" : "Sign in"}
        </button>

        <p className="text-center text-sm text-ink-dim">
          Don’t have an account?{" "}
          <Link to="/register" className="font-medium text-accent hover:underline">
            Create one
          </Link>
        </p>
      </form>
    </div>
  );
}
