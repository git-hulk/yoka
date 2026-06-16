// Self-signup: email + password. Creates a personal group server-side and
// lands the user logged in. Visual treatment mirrors Login so the two pages
// feel like a pair.

import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

const MIN_PASSWORD_LEN = 8;

export default function Register() {
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
      await api.register(email, password);
      await refresh();
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        const map: Record<string, string> = {
          email_taken:        "An account with that email already exists. Try signing in.",
          email_required:     "Email is required.",
          password_too_short: `Password must be at least ${MIN_PASSWORD_LEN} characters.`,
        };
        setError(map[err.code] ?? "Could not create the account. Try again.");
      } else {
        setError("Network error. Try again.");
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="serif text-2xl font-semibold tracking-tight text-ink">Create account</h1>
      <p className="mt-1 text-sm text-ink-dim">
        You’ll get a personal group to start with. You can invite others or join their groups later.
      </p>

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
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LEN}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-md border border-hairline bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          <span className="mt-1 block text-xs text-ink-faint">
            At least {MIN_PASSWORD_LEN} characters.
          </span>
        </label>

        {error && (
          <div className="rounded-md border border-pace-red/30 bg-pace-red/5 px-3 py-2 text-sm text-pace-red">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex h-10 w-full items-center justify-center rounded-md bg-accent px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-accent/90 disabled:opacity-60"
        >
          {submitting ? "Creating…" : "Create account"}
        </button>

        <p className="text-center text-sm text-ink-dim">
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
