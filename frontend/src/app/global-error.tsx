'use client';
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: 'linear-gradient(160deg, #faf6f1 0%, #f4ecf6 55%, #eef4fb 100%)',
          color: '#241a33',
        }}
      >
        <div style={{ textAlign: 'center', padding: 32, maxWidth: 440 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h1 style={{ fontSize: 26, marginBottom: 12 }}>Something went wrong</h1>
          <p style={{ color: '#5b5168', marginBottom: 24, lineHeight: 1.6 }}>
            An unexpected error occurred. Our team has been notified.
          </p>
          {/* Plain anchor is correct here — global-error renders outside the router. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            style={{
              display: 'inline-block',
              padding: '12px 24px',
              borderRadius: 999,
              background: 'linear-gradient(120deg, #8b7cf6 0%, #f3a8c6 100%)',
              color: '#fff',
              textDecoration: 'none',
              fontWeight: 600,
            }}
          >
            Return home
          </a>
        </div>
      </body>
    </html>
  );
}
