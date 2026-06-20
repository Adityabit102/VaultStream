'use client';
import { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';

interface Cmd { label: string; hint: string; href: string; icon: string }

const COMMANDS: Cmd[] = [
  { label: 'Home', hint: 'Landing page', href: '/', icon: '⌂' },
  { label: 'Workspace', hint: 'Live threat stream', href: '/workspace', icon: '◎' },
  { label: 'Analytics', hint: 'Fraud KPIs, cost & geo', href: '/analytics', icon: '◔' },
  { label: 'Fraud rings', hint: 'Link-analysis clusters', href: '/network', icon: '◈' },
  { label: 'Simulator', hint: 'What-if transaction scoring', href: '/simulator', icon: '⊹' },
  { label: 'Watchlist', hint: 'Blocklist of bad actors', href: '/watchlist', icon: '⛔' },
  { label: 'Rules', hint: 'Deterministic rule engine', href: '/rules', icon: '⚑' },
  { label: 'Model Lab', hint: 'Train & promote models', href: '/lab', icon: '⚗' },
  { label: 'Admin', hint: 'Users & audit trail', href: '/admin', icon: '⚙' },
  { label: 'Log in', hint: 'Sign in to VaultStream', href: '/login', icon: '→' },
];

/** ⌘K / Ctrl+K command palette for jumping between screens. Mounted globally. */
export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const results = useMemo(
    () => COMMANDS.filter((c) => (c.label + c.hint).toLowerCase().includes(query.toLowerCase())),
    [query]
  );

  const go = useCallback((href: string) => {
    setOpen(false);
    router.push(href);
  }, [router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery('');
        setActive(0);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && results[active]) { go(results[active].href); }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(47,55,42,0.32)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '14vh' }}
        >
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="glass"
            style={{ width: '100%', maxWidth: 520, borderRadius: 20, overflow: 'hidden' }}
          >
            <input
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onListKey}
              placeholder="Jump to…  (↑↓ to move, ⏎ to open)"
              style={{ width: '100%', padding: '16px 20px', border: 'none', borderBottom: '1px solid var(--color-line)', background: 'transparent', color: 'var(--color-ink)', fontSize: 15, outline: 'none', fontFamily: 'var(--font-sans)' }}
            />
            <div style={{ maxHeight: 320, overflowY: 'auto', padding: 8 }}>
              {results.length === 0 && <div style={{ padding: 18, color: 'var(--color-ink-faint)', fontSize: 14 }}>No matches.</div>}
              {results.map((c, i) => (
                <button
                  key={c.href}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(c.href)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '11px 14px', borderRadius: 12,
                    border: 'none', cursor: 'pointer', textAlign: 'left',
                    background: i === active ? 'var(--color-surface-2)' : 'transparent',
                  }}
                >
                  <span style={{ width: 28, height: 28, borderRadius: 9, background: 'var(--grad-violet-rose)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 14 }}>{c.icon}</span>
                  <span style={{ flex: 1 }}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-ink)', display: 'block' }}>{c.label}</span>
                    <span style={{ fontSize: 12, color: 'var(--color-ink-faint)' }}>{c.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
