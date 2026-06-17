'use client';
import { CSSProperties } from 'react';

/** Shimmer placeholder. Pass width/height or className for layout. */
export function Skeleton({
  width = '100%',
  height = 16,
  radius = 8,
  style,
  className = '',
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

/** A stack of skeleton rows, e.g. for a list or table placeholder. */
export function SkeletonRows({ rows = 5, height = 44, gap = 10 }: { rows?: number; height?: number; gap?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height={height} radius={12} />
      ))}
    </div>
  );
}
