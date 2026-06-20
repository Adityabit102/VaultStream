'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useRole } from '@/components/RoleProvider';
import { ThemeToggle } from '@/components/ThemeProvider';
import NotificationBell from './NotificationBell';
import Logo from './Logo';

export default function WorkspaceHeader({ modelHash }: { modelHash?: string | null }) {
  const { user, signOut } = useAuth();
  const { isAdmin, role } = useRole();
  const pathname = usePathname();
  const isAnalyst = role === 'analyst' || role === 'admin';

  const navItems = [
    { href: '/workspace', label: 'Workspace' },
    { href: '/analytics', label: 'Analytics' },
    { href: '/network', label: 'Rings' },
    { href: '/simulator', label: 'Simulator' },
    ...(isAnalyst ? [{ href: '/batch', label: 'Batch' }, { href: '/watchlist', label: 'Watchlist' }] : []),
    { href: '/rules', label: 'Rules' },
    { href: '/status', label: 'Status' },
    ...(isAdmin ? [{ href: '/lab', label: 'Model Lab' }, { href: '/admin', label: 'Admin' }] : []),
  ];

  return (
    <header
      className="glass"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 22px',
        borderRadius: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'var(--color-ink)' }}>
          <Logo size={28} />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 17 }}>VaultStream</span>
        </Link>
        {modelHash && (
          <span className="badge badge-neutral" style={{ fontSize: 10 }}>model v{modelHash}</span>
        )}
        <nav style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {navItems.map((n) => {
            const active = pathname === n.href;
            return (
              <Link
                key={n.href}
                href={n.href}
                style={{
                  padding: '7px 12px',
                  borderRadius: 999,
                  fontSize: 12.5,
                  fontWeight: 600,
                  textDecoration: 'none',
                  color: active ? '#fff' : 'var(--color-ink-soft)',
                  background: active ? 'var(--grad-violet-rose)' : 'transparent',
                }}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <NotificationBell />
        <ThemeToggle />
        {user ? (
          <>
            <Link href="/settings" title="Settings" aria-label="Settings"
              style={{ width: 36, height: 36, borderRadius: 999, border: '1px solid var(--color-line-strong)', background: 'var(--color-surface)', color: 'var(--color-ink)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, textDecoration: 'none', boxShadow: 'var(--shadow-sm)' }}>
              ⚙
            </Link>
            <div style={{ textAlign: 'right', lineHeight: 1.2 }}>
              <div className="data" style={{ fontSize: 12, color: 'var(--color-ink)' }}>{user.email}</div>
              <div className="eyebrow" style={{ fontSize: 9 }}>{role}</div>
            </div>
            <button onClick={() => signOut()} className="btn btn-ghost" style={{ padding: '8px 16px', fontSize: 12 }}>
              Sign out
            </button>
          </>
        ) : (
          <>
            <Link href="/login" className="btn btn-ghost" style={{ padding: '8px 16px', fontSize: 12 }}>Log in</Link>
            <Link href="/signup" className="btn btn-primary" style={{ padding: '8px 16px', fontSize: 12 }}>Get started</Link>
          </>
        )}
      </div>
    </header>
  );
}
