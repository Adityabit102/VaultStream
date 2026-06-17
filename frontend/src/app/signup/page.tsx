'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import Link from 'next/link';
import AuthShell, { Field, Notice } from '@/components/site/AuthShell';
import AccessGranted from '@/components/site/AccessGranted';
import { AnimatePresence } from 'framer-motion';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [granted, setGranted] = useState<null | string>(null);
  const router = useRouter();
  const { user, signInMock, isMock } = useAuth();

  useEffect(() => {
    if (user && granted === null) router.push('/workspace');
  }, [user, router, granted]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      if (isMock) {
        signInMock(email, 'analyst');
        setGranted('analyst'); // play access-granted transition, then route
      } else {
        const { supabase } = await import('@/lib/supabaseClient');
        if (supabase) {
          const { error: err } = await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
          });
          if (err) setError(err.message);
          else setSuccess('Registration successful! Check your email to confirm.');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
    <AnimatePresence>
      {granted && <AccessGranted role={granted} onDone={() => router.push('/workspace')} />}
    </AnimatePresence>
    <AuthShell
      title="Get started free"
      subtitle="Create your VaultStream account in seconds."
      aside={
        <div>
          <h2 style={{ color: '#fff', fontSize: 34, lineHeight: 1.15, marginBottom: 18 }}>
            The fraud command center your team deserves.
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.9)', fontSize: 16, lineHeight: 1.6 }}>
            Live scoring, explainable decisions, a built-in model lab and one-click case
            actions — all in a single luminous workspace.
          </p>
          <ul style={{ listStyle: 'none', padding: 0, marginTop: 28, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {['Real-time streaming pipeline', 'Explainable ML decisions', 'Train & promote models in-app'].map((s) => (
              <li key={s} style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#fff', fontSize: 15 }}>
                <span style={{ width: 22, height: 22, borderRadius: 999, background: 'rgba(255,255,255,0.28)', display: 'grid', placeItems: 'center', fontSize: 13 }}>✓</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      {success && <Notice tone="success">{success}</Notice>}

      <form onSubmit={handleSubmit}>
        <Field label="Work email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" required />
        <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
        <Field label="Confirm password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" required />
        <button type="submit" disabled={loading} className="btn btn-primary" style={{ width: '100%', marginTop: 6 }}>
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p style={{ marginTop: 26, fontSize: 14, color: 'var(--color-ink-soft)' }}>
        Already have an account? <Link href="/login" style={{ color: 'var(--color-violet)', fontWeight: 600, textDecoration: 'none' }}>Log in →</Link>
      </p>
    </AuthShell>
    </>
  );
}
