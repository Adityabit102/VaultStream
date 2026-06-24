'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type Theme = 'light' | 'dark';
interface ThemeCtx {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}

const Ctx = createContext<ThemeCtx>({ theme: 'light', toggle: () => {}, setTheme: () => {} });

/** Inline script applied before paint to avoid a flash of the wrong theme. */
export const themeNoFlashScript = `(function(){try{var t=localStorage.getItem('vs_theme')||'light';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light');

  // Sync from what the no-flash script already applied.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const current = (document.documentElement.getAttribute('data-theme') as Theme) || 'light';
    setThemeState(current);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const apply = (t: Theme) => {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('vs_theme', t); } catch { /* ignore */ }
    setThemeState(t);
  };

  return (
    <Ctx.Provider value={{ theme, toggle: () => apply(theme === 'dark' ? 'light' : 'dark'), setTheme: apply }}>
      {children}
    </Ctx.Provider>
  );
}

export const useTheme = () => useContext(Ctx);

/** Compact theme toggle button for headers. */
export function ThemeToggle({ size = 36 }: { size?: number }) {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label="Toggle theme"
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        border: '1px solid var(--color-line-strong)',
        background: 'var(--color-surface)',
        color: 'var(--color-ink)',
        cursor: 'pointer',
        fontSize: size * 0.46,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}
