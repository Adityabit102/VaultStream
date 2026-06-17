'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import Logo from './Logo';

export default function SiteNav() {
  const [scrolled, setScrolled] = useState(false);
  const { user, signOut } = useAuth();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        display: 'flex',
        justifyContent: 'center',
        padding: scrolled ? '12px 20px' : '20px',
        transition: 'padding 0.4s ease',
      }}
    >
      <nav
        className={scrolled ? 'glass' : ''}
        style={{
          width: '100%',
          maxWidth: 1180,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: scrolled ? '12px 22px' : '14px 8px',
          borderRadius: 999,
          transition: 'all 0.4s ease',
          border: scrolled ? undefined : '1px solid transparent',
        }}
      >
        <Link
          href="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            textDecoration: 'none',
            color: 'var(--color-ink)',
          }}
        >
          <Logo size={32} />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 19 }}>
            VaultStream
          </span>
        </Link>

        <div
          style={{ display: 'flex', alignItems: 'center', gap: 28 }}
          className="nav-links"
        >
          <a href="#platform" className="nav-link">Platform</a>
          <a href="#pipeline" className="nav-link">How it works</a>
          <a href="#metrics" className="nav-link">Performance</a>
          <a href="#faq" className="nav-link">FAQ</a>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {user ? (
            <>
              <Link href="/workspace" className="btn btn-ghost" style={{ padding: '10px 18px', fontSize: 13 }}>
                Workspace
              </Link>
              <button onClick={() => signOut()} className="btn btn-primary" style={{ padding: '10px 18px', fontSize: 13 }}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="nav-link" style={{ fontWeight: 600 }}>
                Log in
              </Link>
              <Link href="/signup" className="btn btn-primary" style={{ padding: '10px 20px', fontSize: 13 }}>
                Get started
              </Link>
            </>
          )}
        </div>
      </nav>

      <style jsx>{`
        .nav-link {
          color: var(--color-ink-soft);
          text-decoration: none;
          font-size: 14px;
          font-weight: 500;
          transition: color 0.2s ease;
        }
        .nav-link:hover {
          color: var(--color-ink);
        }
        @media (max-width: 860px) {
          .nav-links {
            display: none !important;
          }
        }
      `}</style>
    </header>
  );
}
