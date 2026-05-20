import { lazy, Suspense, useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";

import Sidebar from "./components/Sidebar";
import Home from "./pages/Home";

const PackageDetail = lazy(() => import("./pages/PackageDetail"));
const PackageEdit   = lazy(() => import("./pages/PackageEdit"));
const PackageNew    = lazy(() => import("./pages/PackageNew"));

const STORAGE_KEY = "yoka:sidebar";

function initialOpen(): boolean {
  if (typeof window === "undefined") return true;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "0") return false;
  if (stored === "1") return true;
  return window.innerWidth >= 768;
}

export default function App() {
  const [open, setOpen] = useState<boolean>(initialOpen);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
  }, [open]);

  return (
    <div className="flex min-h-dvh">
      <Sidebar open={open} onClose={() => setOpen(false)} />

      <main className="flex min-h-dvh flex-1 flex-col">
        {!open && (
          <div className="border-b border-hairline">
            <div className="mx-auto flex max-w-5xl items-baseline justify-between gap-6 px-6 pt-7 pb-5 sm:px-8">
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="inline-flex items-baseline gap-1.5 text-[11px] uppercase tracking-micro text-ink-dim transition hover:text-accent"
              >
                <span aria-hidden="true">→</span>
                packages
              </button>
              <span className="serif text-base italic leading-none text-accent">
                yoka
              </span>
            </div>
          </div>
        )}

        <div className="mx-auto w-full max-w-5xl flex-1 px-6 pt-10 pb-20 sm:px-10">
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/"                   element={<Home />} />
              <Route path="/packages/new"       element={<PackageNew />} />
              <Route path="/packages/:id"       element={<PackageDetail />} />
              <Route path="/packages/:id/edit"  element={<PackageEdit />} />
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
