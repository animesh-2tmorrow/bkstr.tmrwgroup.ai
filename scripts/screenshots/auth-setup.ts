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

import { test, expect } from "@playwright/test";
import path from "node:path";

const STORAGE_STATE = path.resolve(__dirname, "storage-state.json");
const OAUTH_WINDOW_MS = 5 * 60 * 1000;

test("capture session cookie for animesh@2tmorrow.com", async ({
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
  console.log("  animesh@2tmorrow.com");
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
  await expect(page.getByText("animesh@2tmorrow.com").first()).toBeVisible({
    timeout: 10_000,
  });

  await context.storageState({ path: STORAGE_STATE });
  // eslint-disable-next-line no-console
  console.log(`\n✓ Session captured → ${STORAGE_STATE}`);
});
