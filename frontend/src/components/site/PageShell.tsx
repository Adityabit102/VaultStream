'use client';
import { ReactNode } from 'react';
import WorkspaceHeader from './WorkspaceHeader';
import AppBackground from './AppBackground';
import DynamicFooter from '@/components/DynamicFooter';

/** Standard authenticated-page frame: background, header, padded content, footer. */
export default function PageShell({
  children,
  maxWidth = 1180,
}: {
  children: ReactNode;
  maxWidth?: number;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', padding: 16, gap: 14 }}>
      <AppBackground />
      <WorkspaceHeader />
      <main style={{ flex: 1, width: '100%', maxWidth, margin: '0 auto', padding: '12px 4px 32px' }}>
        {children}
      </main>
      <DynamicFooter />
    </div>
  );
}

export function PageHeading({ eyebrow, title, subtitle, action }: { eyebrow?: string; title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 28 }}>
      <div>
        {eyebrow && <div className="eyebrow" style={{ marginBottom: 10 }}>{eyebrow}</div>}
        <h1 style={{ fontSize: 'clamp(28px, 3.4vw, 40px)' }}>{title}</h1>
        {subtitle && <p style={{ marginTop: 10, fontSize: 15, color: 'var(--color-ink-soft)', maxWidth: 640, lineHeight: 1.6 }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
