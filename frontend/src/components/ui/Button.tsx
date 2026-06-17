'use client';
import Link from 'next/link';
import { ReactNode } from 'react';

type Variant = 'primary' | 'ghost' | 'gold';

interface BaseProps {
  variant?: Variant;
  children: ReactNode;
  className?: string;
}

const cls = (variant: Variant = 'primary', extra = '') =>
  `btn btn-${variant} ${extra}`.trim();

export function Button({
  variant = 'primary',
  children,
  className = '',
  ...rest
}: BaseProps & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={cls(variant, className)} {...rest}>
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = 'primary',
  children,
  className = '',
  href,
  ...rest
}: BaseProps & { href: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <Link href={href} className={cls(variant, className)} {...rest}>
      {children}
    </Link>
  );
}
