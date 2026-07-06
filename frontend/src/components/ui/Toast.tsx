// App-level toast stack, Linear-style: dark surface, bottom-left, one line,
// optional action button (the undo affordance for deletes). Kept deliberately
// small — no variants, no icons, no queueing policy beyond "newest at the
// bottom, each dismisses itself".

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface ToastInput {
  message: string;
  /** Label + handler render an action button, e.g. Undo. */
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
  /** Auto-dismiss delay. Defaults to 6s; actions get time to be noticed. */
  durationMs?: number;
}

interface ToastRecord extends ToastInput {
  id: number;
}

const ToastContext = createContext<((t: ToastInput) => void) | null>(null);

export function useToast(): (t: ToastInput) => void {
  const push = useContext(ToastContext);
  if (!push) throw new Error("useToast must be used inside <ToastProvider>");
  return push;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (t: ToastInput) => {
      const id = nextId.current++;
      setToasts((ts) => [...ts, { ...t, id }]);
      window.setTimeout(() => dismiss(id), t.durationMs ?? 6000);
    },
    [dismiss],
  );

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="fixed bottom-4 left-4 z-[100] flex w-80 flex-col gap-2"
        >
          {toasts.map((t) => (
            <Toast key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

function Toast({ toast, onDismiss }: { toast: ToastRecord; onDismiss: () => void }) {
  return (
    <div
      role="status"
      className="animate-chipIn flex items-center gap-2 rounded-lg bg-ink py-2 pl-3 pr-2 text-sm text-white shadow-modal"
    >
      <span className="min-w-0 flex-1 truncate">{toast.message}</span>
      {toast.actionLabel && toast.onAction && (
        <button
          type="button"
          onClick={() => {
            onDismiss();
            void toast.onAction?.();
          }}
          className="inline-flex h-6 shrink-0 items-center rounded-md bg-white/10 px-2 text-xs font-medium text-white transition hover:bg-white/20"
        >
          {toast.actionLabel}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-white/60 transition hover:bg-white/10 hover:text-white"
      >
        <svg viewBox="0 0 16 16" className="size-3" aria-hidden="true">
          <path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
