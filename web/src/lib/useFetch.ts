import { useEffect, useState } from "react";

import { ApiError } from "./api";

export type FetchState<T> =
  | { status: "loading" }
  | { status: "ok"; data: T }
  | { status: "error"; error: Error };

/**
 * Tiny replacement for react-query. Cancels stale results when deps change,
 * exposes a discriminated `status` so pages can `switch` over it cleanly.
 *
 * Pass a stable `fn` (e.g. a function constructed inside a `useCallback`
 * or referencing only deps in `deps`) — `fn` itself is not included in the
 * dependency list to keep callers from re-running on every render.
 */
export function useFetch<T>(fn: () => Promise<T>, deps: unknown[]): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    fn().then(
      (data) => {
        if (!cancelled) setState({ status: "ok", data });
      },
      (err: unknown) => {
        if (cancelled) return;
        const error = err instanceof Error ? err : new Error(String(err));
        setState({ status: "error", error });
      },
    );

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}

/** True iff an error came from the API with status 404. */
export function isNotFound(err: Error): boolean {
  return err instanceof ApiError && err.status === 404;
}
