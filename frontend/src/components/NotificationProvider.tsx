'use client';
import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

export interface Notification {
  id: string;
  entity_id: string;
  transaction_id?: string;
  risk_score: number;
  risk_label: string;
  ts: number;
  read?: boolean;
}

interface NotificationCtx {
  items: Notification[];
  unread: number;
  push: (n: Omit<Notification, 'ts' | 'read'>) => void;
  markAllRead: () => void;
  clear: () => void;
}

const Ctx = createContext<NotificationCtx>({
  items: [],
  unread: 0,
  push: () => {},
  markAllRead: () => {},
  clear: () => {},
});

const MAX = 40;

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Notification[]>([]);

  const push = useCallback((n: Omit<Notification, 'ts' | 'read'>) => {
    setItems((prev) => {
      if (prev.some((p) => p.id === n.id)) return prev;
      return [{ ...n, ts: Date.now(), read: false }, ...prev].slice(0, MAX);
    });
  }, []);

  const markAllRead = useCallback(() => {
    setItems((prev) => prev.map((p) => ({ ...p, read: true })));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const unread = items.filter((i) => !i.read).length;

  return (
    <Ctx.Provider value={{ items, unread, push, markAllRead, clear }}>
      {children}
    </Ctx.Provider>
  );
}

export const useNotifications = () => useContext(Ctx);
