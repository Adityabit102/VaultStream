import Link from 'next/link';
import Logo from './Logo';

export default function SiteFooter() {
  const cols: { title: string; links: { label: string; href: string }[] }[] = [
    {
      title: 'Platform',
      links: [
        { label: 'Live Workspace', href: '/workspace' },
        { label: 'Model Lab', href: '/lab' },
        { label: 'Admin Console', href: '/admin' },
      ],
    },
    {
      title: 'Company',
      links: [
        { label: 'About', href: '#' },
        { label: 'Security', href: '#' },
        { label: 'Careers', href: '#' },
      ],
    },
    {
      title: 'Resources',
      links: [
        { label: 'Documentation', href: '#' },
        { label: 'API Reference', href: '#' },
        { label: 'Status', href: '#' },
      ],
    },
  ];

  return (
    <footer style={{ position: 'relative', borderTop: '1px solid var(--color-line)', marginTop: 40 }}>
      <div
        className="section"
        style={{
          paddingTop: 72,
          paddingBottom: 48,
          display: 'grid',
          gridTemplateColumns: '1.4fr 1fr 1fr 1fr',
          gap: 40,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Logo size={30} />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 19 }}>
              VaultStream
            </span>
          </div>
          <p style={{ color: 'var(--color-ink-soft)', fontSize: 14, lineHeight: 1.6, maxWidth: 280 }}>
            Real-time fraud intelligence for modern financial institutions. Score every
            transaction in under 30 milliseconds.
          </p>
        </div>

        {cols.map((c) => (
          <div key={c.title}>
            <div className="eyebrow" style={{ marginBottom: 18 }}>{c.title}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {c.links.map((l) => (
                <Link
                  key={l.label}
                  href={l.href}
                  style={{ color: 'var(--color-ink-soft)', textDecoration: 'none', fontSize: 14 }}
                >
                  {l.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div
        className="section"
        style={{
          paddingTop: 24,
          paddingBottom: 40,
          borderTop: '1px solid var(--color-line)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <span style={{ color: 'var(--color-ink-faint)', fontSize: 13 }}>
          © {new Date().getFullYear()} VaultStream. Crafted for real-time decisioning.
        </span>
        <span className="data" style={{ color: 'var(--color-ink-faint)', fontSize: 12 }}>
          XGBoost · IEEE-CIS · Kafka · Redis · FastAPI · Next.js
        </span>
      </div>
    </footer>
  );
}
