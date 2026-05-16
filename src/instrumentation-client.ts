// monitoring(1a) — Sentry client-side init.
//
// Loaded automatically by Next.js on the client. In Sentry SDK v9+ this
// file replaces the pre-v9 sentry.client.config.ts (the dispatch's
// example used the old name — corrected to the v10 layout).
//
// DSN comes from NEXT_PUBLIC_SENTRY_DSN, which Next.js inlines into the
// client bundle at BUILD time. bkstr builds in CodeBuild (not on EC2),
// so this value MUST be present in the CodeBuild environment — see
// buildspec.yml env/variables. If it were only in the EC2 runtime env,
// the client bundle would ship with dsn: undefined and browser error
// capture would silently never fire.

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // 10% of transactions for performance monitoring.
  tracesSampleRate: 0.1,

  // Session Replay is intentionally NOT enabled. At current scale (a
  // handful of active agents) there is nothing meaningful to replay, and
  // the replay integration is ~50-60 kB of client bundle. Re-enable when
  // there is real user traffic to reconstruct: add an
  //   integrations: [Sentry.replayIntegration()],
  // line plus `replaysOnErrorSampleRate: 1.0` (and keep
  // `replaysSessionSampleRate: 0` — never record whole sessions).

  // Drop noise from browser extensions, ad blockers, and benign races.
  ignoreErrors: [
    "Top.GG widget",
    "ResizeObserver loop limit exceeded",
    /^Script error\.?$/,
  ],

  environment:
    process.env.NODE_ENV === "production" ? "production" : "development",

  // Production builds only.
  enabled: process.env.NODE_ENV === "production",
});

// Instruments client-side App Router navigations so Sentry traces span
// route transitions.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
