import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

interface ToastContextValue {
  toast: (title: string, kind?: ToastKind, description?: string) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);

  const toast = useCallback(
    (title: string, kind: ToastKind = 'success', description?: string) => {
      const id = ++counter;
      setItems((current) => [...current.slice(-3), { id, kind, title, description }]);
      window.setTimeout(() => remove(id), 4800);
    },
    [remove],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (title, description) => toast(title, 'success', description),
      error: (title, description) => toast(title, 'error', description),
      info: (title, description) => toast(title, 'info', description),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(92vw,380px)] flex-col gap-2">
          {items.map((item) => (
            <div
              key={item.id}
              className={`pointer-events-auto animate-fade-up overflow-hidden rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-xl ${
                item.kind === 'success'
                  ? 'border-mint/25 bg-[#08130f]/95'
                  : item.kind === 'error'
                    ? 'border-rose/30 bg-[#160b0f]/95'
                    : 'border-cyan/25 bg-[#081017]/95'
              }`}
              role="status"
            >
              <div className="flex items-start gap-3">
                <div
                  className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                    item.kind === 'success'
                      ? 'bg-mint/15 text-mint'
                      : item.kind === 'error'
                        ? 'bg-rose/15 text-rose'
                        : 'bg-cyan/15 text-cyan'
                  }`}
                >
                  {item.kind === 'success' ? (
                    <CheckCircle2 size={16} />
                  ) : item.kind === 'error' ? (
                    <AlertTriangle size={16} />
                  ) : (
                    <Info size={16} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{item.title}</p>
                  {item.description ? <p className="mt-0.5 text-xs leading-relaxed text-muted">{item.description}</p> : null}
                </div>
                <button
                  type="button"
                  onClick={() => remove(item.id)}
                  className="rounded-lg p-1 text-faint transition hover:bg-white/5 hover:text-soft"
                  aria-label="Dismiss notification"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
