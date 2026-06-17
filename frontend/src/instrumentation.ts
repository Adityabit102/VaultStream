import * as Sentry from "@sentry/nextjs";

export function register() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;
  if (dsn && !dsn.includes("your-sentry-dsn")) {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      Sentry.init({
        dsn,
        tracesSampleRate: 1.0,
        debug: false,
      });
    }

    if (process.env.NEXT_RUNTIME === "edge") {
      Sentry.init({
        dsn,
        tracesSampleRate: 1.0,
        debug: false,
      });
    }
  }
}
