// get-started Phase B — interactive auth-setup.
//
// Launches headed Chromium, navigates to /login, clicks "Continue with
// Google", and waits up to 5 minutes for the operator to complete Google
// OAuth (password + 2FA) in the live browser window. Once the redirect
// lands on /dashboard, captures the live session cookie set into
// scripts/screenshots/storage-state.json.
//
// IMPORTANT: storage-state.json contains a live
// __Secure-next-auth.session-token cookie that grants full account access.
// It is .gitignored. NEVER commit it. If you suspect leakage, revoke it
// by signing the account out at /api/auth/signout (which invalidates the
// Session row in the DB) and re-running this script.
//
// Re-run when:
//   - storage-state.json doesn't exist
//   - authed-shots.spec.ts fails because /dashboard/* redirected to /login
//   - more than ~30 days have elapsed (NextAuth session row TTL)
//
// Command:  npm run screenshots:auth-setup
//
// Env vars (both optional — defaults preserve the original behavior):
//   AUTH_SETUP_EMAIL   — the Google account to sign in as
//                        (default: animesh@2tmorrow.com)
//   AUTH_SETUP_OUTPUT  — where to write the captured session JSON
//                        (default: scripts/screenshots/storage-state.json)
// Lets one script capture sessions for multiple personas (subscriber,
// publisher) without a code edit per run.

import { test, expect } from "@playwright/test";

const TARGET_EMAIL = process.env.AUTH_SETUP_EMAIL ?? "animesh@2tmorrow.com";
const STORAGE_STATE_PATH =
  process.env.AUTH_SETUP_OUTPUT ?? "scripts/screenshots/storage-state.json";
const OAUTH_WINDOW_MS = 5 * 60 * 1000;

test(`capture session cookie for ${TARGET_EMAIL}`, async ({
  page,
  context,
}) => {
  test.setTimeout(6 * 60 * 1000);

  await page.goto("/login");
  await expect(
    page.getByRole("button", { name: /continue with google/i }),
  ).toBeVisible();

  // eslint-disable-next-line no-console
  console.log("\n=== AUTH SETUP ===");
  // eslint-disable-next-line no-console
  console.log("A Chromium window is now open at /login.");
  // eslint-disable-next-line no-console
  console.log("Click 'Continue with Google' and sign in as:");
  // eslint-disable-next-line no-console
  console.log("  " + TARGET_EMAIL);
  // eslint-disable-next-line no-console
  console.log(
    `Waiting up to ${OAUTH_WINDOW_MS / 1000}s for the /dashboard redirect…\n`,
  );

  // Don't auto-click the OAuth button — let the operator do it. Some
  // 2FA flows are sensitive to "fresh user action" heuristics and a
  // Playwright-triggered click can land in a different OAuth challenge
  // path. Operator's hands stay on the wheel.
  await page.waitForURL(/\/dashboard(?:\?|\/|$)/, { timeout: OAUTH_WINDOW_MS });

  // Sanity gate: the right account signed in. The dashboard UserBlock chip
  // shows the signed-in email; if it's the wrong account we want to fail
  // BEFORE writing storageState so a misclick doesn't leave a stale cookie
  // for the wrong identity on disk.
  await expect(page.getByText(TARGET_EMAIL).first()).toBeVisible({
    timeout: 10_000,
  });

  await context.storageState({ path: STORAGE_STATE_PATH });
  // eslint-disable-next-line no-console
  console.log(`\n✓ Session captured → ${STORAGE_STATE_PATH}`);
});
