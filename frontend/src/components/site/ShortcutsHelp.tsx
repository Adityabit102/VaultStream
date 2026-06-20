'use client';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Global',
    items: [
      ['⌘ K', 'Open command palette'],
      ['?', 'Toggle this shortcuts panel'],
      ['Esc', 'Close any overlay'],
    ],
  },
  {
    title: 'Workspace',
    items: [
      ['↑ / ↓', 'Move selection through the alert feed'],
      ['F', 'Freeze the selected account'],
      ['E', 'Escalate / raise the selected alert'],
    ],
  },
];

/** Global keyboard-shortcuts reference, toggled with `?`. Mounted in layout. */
export default function ShortcutsHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 320, background: 'rgba(47,55,42,0.32)', backdropFilter: 'blur(6px)', display: 'grid', placeItems: 'center', padding: 20 }}
        >
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="glass"
            style={{ width: '100%', maxWidth: 480, borderRadius: 20, padding: 28 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ fontSize: 20 }}>Keyboard shortcuts</h3>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--color-ink-faint)', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
              {GROUPS.map((g) => (
                <div key={g.title}>
                  <div className="eyebrow" style={{ marginBottom: 12, fontSize: 10 }}>{g.title}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {g.items.map(([key, desc]) => (
                      <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
                        <span style={{ fontSize: 13.5, color: 'var(--color-ink-soft)' }}>{desc}</span>
                        <kbd style={{ fontFamily: 'var(--font-mono)', fontSize: 12, padding: '4px 10px', borderRadius: 8, background: 'var(--color-surface-2)', border: '1px solid var(--color-line-strong)', color: 'var(--color-ink)', whiteSpace: 'nowrap' }}>{key}</kbd>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
