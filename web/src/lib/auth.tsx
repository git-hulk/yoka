// AuthProvider + useAuth.
//
// Loads `GET /me` once at mount; exposes `{ me, role, refresh, logout,
// setActiveGroup }`. A global UNAUTHORIZED_EVENT (dispatched by api.ts on
// any 401) clears the cached me — the RequireAuth guard then bounces the user
// to /login.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { api, ApiError, UNAUTHORIZED_EVENT } from "./api";
import type { Me } from "./types";

interface AuthContextValue {
  /** `undefined` while still loading the first /me; `null` if anonymous. */
  me:              Me | null | undefined;
  refresh:         () => Promise<void>;
  logout:          () => Promise<void>;
  /** Switch the active group server-side and reload to refetch every page. */
  setActiveGroup:  (group_id: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const m = await api.me();
      setMe(m);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setMe(null);
      else setMe(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Any 401 from anywhere in the app → clear `me` so RequireAuth triggers.
  useEffect(() => {
    const onUnauth = () => setMe(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauth);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauth);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Best-effort: even if the server hates us, clear local state.
    }
    setMe(null);
    navigate("/login", { replace: true });
  }, [navigate]);

  const setActiveGroup = useCallback(async (group_id: string) => {
    await api.setActiveGroup(group_id);
    // Refetch every page's data by reloading. Cleaner than threading a "group
    // version" through every useFetch dep list.
    window.location.reload();
  }, []);

  return (
    <AuthContext.Provider value={{ me, refresh, logout, setActiveGroup }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth used outside of <AuthProvider>");
  return ctx;
}
