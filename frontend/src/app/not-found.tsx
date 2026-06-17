import Link from 'next/link';
import Logo from '@/components/site/Logo';

export default function NotFound() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 32, position: 'relative', overflow: 'hidden' }}>
      <div className="aurora-blob" style={{ width: 480, height: 480, background: 'var(--color-violet-soft)', top: -120, left: -100 }} />
      <div className="aurora-blob" style={{ width: 420, height: 420, background: 'var(--color-rose-soft)', bottom: -140, right: -120 }} />
      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', maxWidth: 440 }}>
        <div style={{ display: 'inline-flex', marginBottom: 24 }}><Logo size={48} /></div>
        <div className="data text-gradient" style={{ fontSize: 'clamp(64px, 12vw, 120px)', fontWeight: 600, lineHeight: 1 }}>404</div>
        <h1 style={{ fontSize: 28, margin: '12px 0 12px' }}>This page slipped the net</h1>
        <p style={{ color: 'var(--color-ink-soft)', fontSize: 16, lineHeight: 1.6, marginBottom: 28 }}>
          The route you’re after doesn’t exist — but the stream is still running.
        </p>
        <div style={{ display: 'inline-flex', gap: 12 }}>
          <Link href="/" className="btn btn-primary">Back home</Link>
          <Link href="/workspace" className="btn btn-ghost">Open workspace</Link>
        </div>
      </div>
    </div>
  );
}
