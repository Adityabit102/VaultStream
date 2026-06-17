'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import Link from 'next/link';
import AuthShell, { Field, Notice } from '@/components/site/AuthShell';
import { Badge } from '@/components/ui';
import AccessGranted from '@/components/site/AccessGranted';
import { AnimatePresence } from 'framer-motion';

const DEMO = [
  { role: 'admin' as const, name: 'System Admin', email: 'admin@vaultstream.demo', tone: 'warn' as const },
  { role: 'analyst' as const, name: 'Fraud Analyst', email: 'analyst@vaultstream.demo', tone: 'safe' as const },
  { role: 'viewer' as const, name: 'Read-Only Viewer', email: 'viewer@vaultstream.demo', tone: 'neutral' as const },
];

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [granted, setGranted] = useState<null | string>(null);
  const router = useRouter();
  const { user, signInMock, isMock } = useAuth();

  useEffect(() => {
    if (user && granted === null) router.push('/workspace');
  }, [user, router, granted]);

  const roleFor = (e: string): 'analyst' | 'admin' | 'viewer' =>
    e.includes('admin') ? 'admin' : e.includes('viewer') ? 'viewer' : 'analyst';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      if (isMock) {
        if (password !== 'demo1234') {
          setError('Invalid password. For demo accounts use "demo1234".');
          setLoading(false);
          return;
        }
        const role = roleFor(email);
        signInMock(email, role);
        setGranted(role); // play access-granted transition, then route
      } else {
        const { supabase } = await import('@/lib/supabaseClient');
        if (supabase) {
          const { error: err } = await supabase.auth.signInWithPassword({ email, password });
          if (err) setError(err.message);
          else setGranted(roleFor(email));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleMagicLink = async () => {
    setError(null);
    setSuccess(null);
    if (!/\S+@\S+\.\S+/.test(email)) {
      setError('Please enter a valid email address first.');
      return;
    }
    setLoading(true);
    try {
      if (isMock) {
        setSuccess(`Mock magic link sent to ${email}. Redirecting…`);
        setTimeout(() => {
          signInMock(email, roleFor(email));
          router.push('/workspace');
        }, 1400);
      } else {
        const { supabase } = await import('@/lib/supabaseClient');
        if (supabase) {
          const { error: err } = await supabase.auth.signInWithOtp({
            email,
            options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
          });
          if (err) setError(err.message);
          else setSuccess(`Magic link sent to ${email}. Check your inbox.`);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send magic link');
    } finally {
      setLoading(false);
    }
  };

  const quickFill = (e: string) => {
    setEmail(e);
    setPassword('demo1234');
    setError(null);
  };

  return (
    <>
    <AnimatePresence>
      {granted && <AccessGranted role={granted} onDone={() => router.push('/workspace')} />}
    </AnimatePresence>
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your fraud operations workspace."
      aside={
        <div>
          <h2 style={{ color: '#fff', fontSize: 34, lineHeight: 1.15, marginBottom: 18 }}>
            Decisions in milliseconds, trust by design.
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.9)', fontSize: 16, lineHeight: 1.6 }}>
            Every transaction scored, explained and actioned in real time — backed by an
            XGBoost model with 0.92 validation AUC.
          </p>
          <div style={{ display: 'flex', gap: 12, marginTop: 28 }}>
            {['0.92 AUC', '<30ms p95', '1.1% FPR'].map((s) => (
              <span key={s} className="data" style={{ padding: '8px 14px', borderRadius: 999, background: 'rgba(255,255,255,0.22)', color: '#fff', fontSize: 13 }}>
                {s}
              </span>
            ))}
          </div>
        </div>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      {success && <Notice tone="success">{success}</Notice>}

      <form onSubmit={handleSubmit}>
        <Field label="Work email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" required />
        <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        <button type="submit" disabled={loading} className="btn btn-primary" style={{ width: '100%', marginTop: 6 }}>
          {loading ? 'Authenticating…' : 'Log in to VaultStream'}
        </button>
      </form>

      <button onClick={handleMagicLink} disabled={loading} className="btn btn-ghost" style={{ width: '100%', marginTop: 12 }}>
        Send a magic link instead
      </button>

      {isMock && (
        <div className="lux-card" style={{ marginTop: 26, padding: 18 }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>Quick demo login</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {DEMO.map((d) => (
              <button
                key={d.role}
                onClick={() => quickFill(d.email)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', borderRadius: 12, border: '1px solid var(--color-line)', background: 'var(--color-surface-2)', cursor: 'pointer', textAlign: 'left' }}
              >
                <span style={{ fontWeight: 600, fontSize: 14 }}>{d.name}</span>
                <Badge tone={d.tone}>{d.role}</Badge>
              </button>
            ))}
          </div>
          <p style={{ marginTop: 12, fontSize: 12, color: 'var(--color-ink-faint)' }}>
            Password for all demo accounts: <span className="data">demo1234</span>
          </p>
        </div>
      )}

      <p style={{ marginTop: 26, fontSize: 14, color: 'var(--color-ink-soft)' }}>
        No account? <Link href="/signup" style={{ color: 'var(--color-violet)', fontWeight: 600, textDecoration: 'none' }}>Get started free →</Link>
      </p>
    </AuthShell>
    </>
  );
}
