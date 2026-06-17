'use client';

/**
 * VaultStream mark — a custom "V" built as a funnel: two transaction streams
 * (the dotted inflow) converge through the V into a single decision point (the
 * dot at the vertex). Reads as a V, a vault, and a filtering funnel at once.
 */
export default function Logo({ size = 32, withWordmark = false }: { size?: number; withWordmark?: boolean }) {
  const gid = 'vs-logo-grad';
  const mark = (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-label="VaultStream">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8aa176" />
          <stop offset="1" stopColor="#cf9d7e" />
        </linearGradient>
      </defs>
      {/* Vault tile */}
      <rect x="0.5" y="0.5" width="39" height="39" rx="11" fill={`url(#${gid})`} />
      {/* Inflow streams */}
      <g stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity="0.55">
        <line x1="9" y1="10.5" x2="17" y2="10.5" strokeDasharray="1.5 2.5" />
        <line x1="23" y1="10.5" x2="31" y2="10.5" strokeDasharray="1.5 2.5" />
      </g>
      {/* The V funnel */}
      <path
        d="M9 14 L20 30 L31 14"
        stroke="#fff"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Inner echo */}
      <path d="M15 14 L20 22 L25 14" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
      {/* Decision point */}
      <circle cx="20" cy="31.5" r="2.4" fill="#fff" />
    </svg>
  );

  if (!withWordmark) return mark;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      {mark}
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: size * 0.6 }}>VaultStream</span>
    </span>
  );
}
