// TEMPORARY — monitoring(1a) Sentry wire-up verification endpoint.
//
// GET throws an uncaught error so we can confirm end-to-end that the
// Sentry server-side integration captures it on prod (the request
// lifecycle error is forwarded by the onRequestError hook in
// src/instrumentation.ts).
//
// This file is deleted in commit 2 of the monitoring/phase-1a-sentry
// branch, immediately after the Sentry UI shows the captured issue.
// It MUST NOT survive to a stable release — a public endpoint that
// always 500s is a standing liability.

export async function GET() {
  throw new Error("bkstr sentry-test error — verifying wire-up on prod");
}
