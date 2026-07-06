import { lazy, Suspense, useEffect, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";

import RequireAuth from "./components/RequireAuth";
import Sidebar from "./components/Sidebar";
import { AuthProvider } from "./lib/auth";
import { ToastProvider } from "./components/ui/Toast";
import Home from "./pages/Home";
import Login from "./pages/Login";

const Register              = lazy(() => import("./pages/Register"));
const AcceptInvite          = lazy(() => import("./pages/AcceptInvite"));
const Members               = lazy(() => import("./pages/Members"));
const SubscriptionDetail    = lazy(() => import("./pages/SubscriptionDetail"));
const SubscriptionEdit      = lazy(() => import("./pages/SubscriptionEdit"));
const SubscriptionNew       = lazy(() => import("./pages/SubscriptionNew"));
const Calendar              = lazy(() => import("./pages/Calendar"));
const Timeline              = lazy(() => import("./pages/Timeline"));
const FinanceHome           = lazy(() => import("./pages/finance/FinanceHome"));
const ExpenseNew            = lazy(() => import("./pages/finance/ExpenseNew"));
const ExpenseEdit           = lazy(() => import("./pages/finance/ExpenseEdit"));
const RecurringExpenseNew   = lazy(() => import("./pages/finance/RecurringExpenseNew"));
const RecurringExpenseEdit  = lazy(() => import("./pages/finance/RecurringExpenseEdit"));

const STORAGE_KEY = "yoka:sidebar";

function initialCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "1") return true;
  if (stored === "0") return false;
  return window.innerWidth < 768;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </AuthProvider>
  );
}

function Shell() {
  const [collapsed, setCollapsed] = useState<boolean>(initialCollapsed);
  const location = useLocation();
  const isAuthPage =
    location.pathname === "/login" ||
    location.pathname === "/register" ||
    location.pathname.startsWith("/accept-invite");

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  if (isAuthPage) {
    // Standalone pages — no sidebar, full canvas.
    return (
      <div className="min-h-dvh bg-canvas px-6 py-12">
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/accept-invite/:token" element={<AcceptInvite />} />
          </Routes>
        </Suspense>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
      />

      <main className="flex min-h-dvh flex-1 flex-col">
        {collapsed && (
          <div className="border-b border-hairline md:hidden">
            <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
              <button
                type="button"
                onClick={() => setCollapsed(false)}
                aria-label="Show sidebar"
                className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-dim transition hover:bg-subtle hover:text-ink"
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="size-4"
                  aria-hidden="true"
                >
                  <line x1="3"  y1="5"  x2="13" y2="5" />
                  <line x1="3"  y1="8"  x2="13" y2="8" />
                  <line x1="3"  y1="11" x2="13" y2="11" />
                </svg>
                Menu
              </button>
              <span className="text-sm font-medium tracking-tight text-accent">
                YOKA
              </span>
            </div>
          </div>
        )}

        <div className="mx-auto w-full max-w-5xl flex-1 px-6 pt-8 pb-12 sm:px-8">
          <Suspense fallback={<RouteFallback />}>
            <RequireAuth>
              <Routes>
                <Route path="/"                                  element={<Home />} />
                <Route path="/subscriptions/new"                 element={<SubscriptionNew />} />
                <Route path="/subscriptions/:id"                 element={<SubscriptionDetail />} />
                <Route path="/subscriptions/:id/edit"            element={<SubscriptionEdit />} />
                <Route path="/calendar"                          element={<Calendar />} />
                <Route path="/timeline"                          element={<Timeline />} />
                <Route path="/finance"                           element={<FinanceHome />} />
                <Route path="/finance/expenses/new"              element={<ExpenseNew />} />
                <Route path="/finance/expenses/:id/edit"         element={<ExpenseEdit />} />
                <Route path="/finance/recurring-expenses/new"    element={<RecurringExpenseNew />} />
                <Route path="/finance/recurring-expenses/:id/edit" element={<RecurringExpenseEdit />} />
                <Route path="/members"                           element={<Members />} />
              </Routes>
            </RequireAuth>
          </Suspense>
        </div>
      </main>
    </div>
  );
}

function RouteFallback() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="h-3 w-24 animate-pulse rounded-sm bg-ink/5" />
      <div className="h-10 w-1/2 animate-pulse rounded-sm bg-ink/5" />
    </div>
  );
}
