// monitoring(1a) — Next.js instrumentation hook.
//
// Next.js calls register() once per runtime at server boot. We lazy-
// import the matching Sentry config so the nodejs config never loads in
// the edge runtime and vice versa.
//
// onRequestError forwards errors thrown inside React Server Components,
// SSR, and route handlers to Sentry. This is the Next.js 15 hook that
// catches nested-render errors the pre-v8 Sentry setups missed — it is
// the reason this wire-up uses the v10 instrumentation layout rather
// than the dispatch's stale sentry.{server,edge}.config-only layout.

import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
