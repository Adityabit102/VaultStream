'use client';
import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type ToastType = 'safe' | 'warn' | 'alert' | 'info';
interface Toast { id: string; message: string; type: ToastType; title?: string }

interface ToastCtx { toast: (message: string, type?: ToastType, title?: string) => void }

const Ctx = createContext<ToastCtx>({ toast: () => {} });

const COLOR: Record<ToastType, string> = {
  safe: 'var(--color-safe)', warn: 'var(--color-warn)', alert: 'var(--color-alert)', info: 'var(--color-violet)',
};

/** Global transient toasts. Mounted once in the root layout; call via useToast(). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: ToastType = 'info', title?: string) => {
    const id = Math.random().toString(36).slice(2);
    setItems((prev) => [...prev, { id, message, type, title }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 400, display: 'flex', flexDirection: 'column', gap: 10, pointerEvents: 'none' }}>
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 16, x: 16 }}
              animate={{ opacity: 1, y: 0, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              className="glass"
              style={{ padding: '13px 18px', borderRadius: 14, borderLeft: `3px solid ${COLOR[t.type]}`, maxWidth: 340, pointerEvents: 'auto' }}
            >
              {t.title && <div className="eyebrow" style={{ fontSize: 10, marginBottom: 4 }}>{t.title}</div>}
              <div className="data" style={{ fontSize: 13.5, color: 'var(--color-ink)' }}>{t.message}</div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
