'use client';
import Link from 'next/link';
import { ReactNode } from 'react';
import dynamic from 'next/dynamic';
import Logo from './Logo';

const AuthScene = dynamic(() => import('@/components/three/AuthScene'), { ssr: false, loading: () => null });

export default function AuthShell({
  title,
  subtitle,
  children,
  aside,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', position: 'relative', overflow: 'hidden' }}>
      <div className="aurora-blob" style={{ width: 520, height: 520, background: 'var(--color-violet-soft)', top: -160, left: -120 }} />
      <div className="aurora-blob" style={{ width: 420, height: 420, background: 'var(--color-rose-soft)', bottom: -160, left: 200 }} />

      {/* Form column */}
      <div style={{ flex: '1 1 50%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, position: 'relative', zIndex: 1 }}>
        <div style={{ width: '100%', maxWidth: 420 }}>
          <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'var(--color-ink)', marginBottom: 36 }}>
            <Logo size={32} />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20 }}>VaultStream</span>
          </Link>

          <h1 style={{ fontSize: 34, marginBottom: 10 }}>{title}</h1>
          {subtitle && <p style={{ color: 'var(--color-ink-soft)', marginBottom: 30, fontSize: 15 }}>{subtitle}</p>}

          {children}
        </div>
      </div>

      {/* Aside / brand column */}
      <div
        className="auth-aside"
        style={{
          flex: '1 1 50%',
          position: 'relative',
          zIndex: 1,
          background: 'var(--grad-aurora)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 48,
          overflow: 'hidden',
        }}
      >
        {/* Interactive 3D vault key behind the aside copy */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, opacity: 0.92 }}>
          <AuthScene />
        </div>
        <div style={{ maxWidth: 440, position: 'relative', zIndex: 1, pointerEvents: 'none' }}>{aside}</div>
      </div>

      <style jsx>{`
        @media (max-width: 900px) {
          .auth-aside { display: none; }
        }
      `}</style>
    </div>
  );
}

export function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label style={{ display: 'block', marginBottom: 16 }}>
      <span className="eyebrow" style={{ display: 'block', marginBottom: 8, letterSpacing: '0.1em' }}>{label}</span>
      <input
        {...props}
        style={{
          width: '100%',
          padding: '13px 16px',
          borderRadius: 14,
          border: '1px solid var(--color-line-strong)',
          background: 'var(--color-surface)',
          color: 'var(--color-ink)',
          fontSize: 15,
          fontFamily: 'var(--font-sans)',
          outline: 'none',
          ...props.style,
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--color-violet)')}
        onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--color-line-strong)')}
      />
    </label>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' | 'success' }) {
  const colors = {
    info: { bg: 'var(--color-sky-soft)', fg: '#2c6a92', bd: 'var(--color-sky)' },
    error: { bg: 'var(--color-alert-soft)', fg: '#b23a54', bd: 'var(--color-alert)' },
    success: { bg: 'var(--color-safe-soft)', fg: '#277a55', bd: 'var(--color-safe)' },
  }[tone];
  return (
    <div style={{ padding: '12px 16px', borderRadius: 12, background: colors.bg, color: colors.fg, border: `1px solid ${colors.bd}`, fontSize: 13.5, marginBottom: 16, lineHeight: 1.5 }}>
      {children}
    </div>
  );
}
