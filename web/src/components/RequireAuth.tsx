// Route guard: shows children when authenticated, redirects to /login while
// the auth check is still resolving children render the route fallback to
// avoid an empty-frame flash.

import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../lib/auth";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const location = useLocation();

  if (me === undefined) {
    return (
      <div className="space-y-6" aria-busy="true">
        <div className="h-3 w-24 animate-pulse rounded-sm bg-ink/5" />
        <div className="h-10 w-1/2 animate-pulse rounded-sm bg-ink/5" />
      </div>
    );
  }
  if (me === null) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return <>{children}</>;
}
