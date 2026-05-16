// monitoring(1a) — Sentry edge-runtime init.
//
// Loaded by src/instrumentation.ts's register() hook when
// NEXT_RUNTIME === "edge". bkstr has no edge middleware today; this is
// shipped for completeness so a future middleware addition is covered
// without a follow-up dispatch.
//
// Same NEXT_PUBLIC_SENTRY_DSN build-inline rationale as
// sentry.server.config.ts.

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  tracesSampleRate: 0.1,

  environment:
    process.env.NODE_ENV === "production" ? "production" : "development",

  enabled: process.env.NODE_ENV === "production",
});
