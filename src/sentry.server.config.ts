// monitoring(1a) — Sentry server-side init.
//
// Loaded by src/instrumentation.ts's register() hook when
// NEXT_RUNTIME === "nodejs". Covers API route handlers, server
// components, and SSR.
//
// DSN source: NEXT_PUBLIC_SENTRY_DSN, not a runtime SENTRY_DSN. The
// operator decision was to build-inline the DSN — one var set once in
// the CodeBuild environment covers client + server + edge, so there is
// no /etc/bkstr/sentry.env to stage and no start.sh change. The DSN is
// public-key-like (safe to embed in shipped bundles), so build-inlining
// it carries no secret-exposure cost.

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Capture 10% of transactions for performance monitoring. Dispatch
  // floor — do not drop below 0.1; tune up as traffic grows.
  tracesSampleRate: 0.1,

  environment:
    process.env.NODE_ENV === "production" ? "production" : "development",

  // Production builds only — dev noise is unhelpful and burns quota.
  enabled: process.env.NODE_ENV === "production",
});
