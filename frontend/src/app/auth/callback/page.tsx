'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import AuthShell, { Notice } from '@/components/site/AuthShell';

export default function AuthCallback() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        if (!supabase) {
          router.push('/workspace');
          return;
        }
        const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
        if (sessionErr) {
          setError(sessionErr.message);
          return;
        }
        if (session) {
          router.push('/workspace');
          return;
        }
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
          if (s) router.push('/workspace');
        });
        const timeout = setTimeout(() => {
          subscription.unsubscribe();
          router.push('/workspace');
        }, 5000);
        return () => {
          subscription.unsubscribe();
          clearTimeout(timeout);
        };
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Callback failed');
      }
    };
    handleCallback();
  }, [router]);

  return (
    <AuthShell
      title={error ? 'Authentication error' : 'Verifying session…'}
      subtitle={error ? undefined : 'Establishing your secure connection. One moment.'}
      aside={
        <div>
          <h2 style={{ color: '#fff', fontSize: 34, lineHeight: 1.15 }}>Securing your session.</h2>
        </div>
      }
    >
      {error ? (
        <>
          <Notice tone="error">{error}</Notice>
          <button onClick={() => router.push('/login')} className="btn btn-ghost" style={{ width: '100%' }}>
            Back to sign in
          </button>
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--color-ink-soft)' }}>
          <span style={{ width: 18, height: 18, borderRadius: 999, border: '2px solid var(--color-violet-soft)', borderTopColor: 'var(--color-violet)', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
          Connecting…
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
    </AuthShell>
  );
}
