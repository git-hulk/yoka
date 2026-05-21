import { lazy, Suspense, useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";

import Sidebar from "./components/Sidebar";
import Home from "./pages/Home";

const SubscriptionDetail = lazy(() => import("./pages/SubscriptionDetail"));
const SubscriptionEdit   = lazy(() => import("./pages/SubscriptionEdit"));
const SubscriptionNew    = lazy(() => import("./pages/SubscriptionNew"));
const Calendar           = lazy(() => import("./pages/Calendar"));

const STORAGE_KEY = "yoka:sidebar";

function initialCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "1") return true;
  if (stored === "0") return false;
  return window.innerWidth < 768;
}

export default function App() {
  const [collapsed, setCollapsed] = useState<boolean>(initialCollapsed);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  return (
    <div className="flex min-h-dvh">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
      />

      <main className="flex min-h-dvh flex-1 flex-col">
        {/* Mobile-only top bar: the sidebar is fully hidden when collapsed
            on mobile, so we surface a menu button to reopen it. On desktop
            the icon rail is always visible and carries its own toggle. */}
        {collapsed && (
          <div className="border-b border-hairline md:hidden">
            <div className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-6 pt-7 pb-5 sm:px-8">
              <button
                type="button"
                onClick={() => setCollapsed(false)}
                aria-label="Show sidebar"
                className="group inline-flex items-center gap-2 text-[11px] uppercase tracking-micro text-ink-dim transition hover:text-accent"
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="size-4 text-ink-faint transition group-hover:text-accent"
                  aria-hidden="true"
                >
                  <line x1="3"  y1="5"  x2="13" y2="5" />
                  <line x1="3"  y1="8"  x2="13" y2="8" />
                  <line x1="3"  y1="11" x2="13" y2="11" />
                </svg>
                menu
              </button>
              <span className="serif text-base leading-none text-accent">
                YOKA
              </span>
            </div>
          </div>
        )}

        <div className="mx-auto w-full max-w-5xl flex-1 px-6 pt-10 pb-20 sm:px-10">
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/"                        element={<Home />} />
              <Route path="/subscriptions/new"       element={<SubscriptionNew />} />
              <Route path="/subscriptions/:id"       element={<SubscriptionDetail />} />
              <Route path="/subscriptions/:id/edit"  element={<SubscriptionEdit />} />
              <Route path="/calendar"                element={<Calendar />} />
            </Routes>
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
