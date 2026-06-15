import React, { createContext, useCallback, useContext, useState } from 'react';

type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastContextValue {
  /** Show a toast. Copy is sentence case (e.g. "Deployed", "Domain connected"). */
  toast: (message: string, tone?: ToastTone) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let counter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = ++counter;
      setItems((prev) => [...prev, { id, tone, message }]);
      window.setTimeout(() => remove(id), 4000);
    },
    [remove],
  );

  const success = useCallback((m: string) => toast(m, 'success'), [toast]);
  const error = useCallback((m: string) => toast(m, 'error'), [toast]);

  return (
    <ToastContext.Provider value={{ toast, success, error }}>
      {children}
      {/* Viewport — sits above the bottom tab bar, safe-area aware. */}
      <div
        className="fixed inset-x-0 z-[100] flex flex-col items-center gap-2 px-4 pointer-events-none"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 5.5rem)' }}
      >
        {items.map((t) => (
          <ToastCard key={t.id} item={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const accent =
    item.tone === 'success'
      ? 'border-live/40 text-live'
      : item.tone === 'error'
        ? 'border-red-500/40 text-red-400'
        : 'border-hairline text-ink';
  return (
    <button
      onClick={onClose}
      className={`pointer-events-auto w-full max-w-sm flex items-center gap-3 rounded-xl bg-surface-800 border ${accent} px-4 py-3 shadow-card animate-fade-up text-left`}
    >
      <span className="shrink-0">
        {item.tone === 'success' ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : item.tone === 'error' ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8h.01M11 12h1v4h1" />
          </svg>
        )}
      </span>
      <span className="text-sm text-ink font-medium">{item.message}</span>
    </button>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
