// get-started Phase B — Playwright config for the /get-started screenshot
// capture pipeline. Three projects:
//
//   auth-setup → HEADED Chrome, captures a real Google OAuth session for
//                animesh@2tmorrow.com into storage-state.json. Run once
//                per cookie expiry (~30 days for NextAuth database-strategy
//                sessions). Never gated by storage state itself.
//
//   public     → Headless, no auth. Captures the 5 anonymous shots
//                (hero, storefront, book/skill detail, signup).
//
//   authed     → Headless, consumes storage-state.json. Captures the 4
//                signed-in shots (library, api-keys, api-access disclosure,
//                owned-state detail).
//
// Why these aren't wired with `dependsOn: ["auth-setup"]`:
//   - auth-setup is interactive and slow (operator types password + 2FA).
//   - We want `npm run screenshots` to be a fast no-prompt re-render.
//   - When the cookie expires, the authed project's beforeEach catches
//     the /login redirect and fails loud — operator then re-runs the
//     auth-setup script explicitly.
//
// All shots commit into public/get-started/0[1-9]-*.png so Next.js serves
// them at /get-started/*.png once the Phase C / D page lands.

import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const STORAGE_STATE = path.resolve(__dirname, "storage-state.json");

export default defineConfig({
  testDir: __dirname,
  outputDir: path.resolve(__dirname, "../../.playwright-results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  // 60s per test is generous for a screenshot + a few selectors; the
  // auth-setup project needs much longer (5 min OAuth window) and sets
  // its own timeout inline.
  timeout: 60_000,
  use: {
    baseURL: "https://bkstr.tmrwgroup.ai",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // Desktop Chrome carries its own viewport (1280x720) so the spread
    // MUST come before our 1440x900 override — otherwise dispatch's
    // viewport spec gets stomped and tsc -strict warns about it too.
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: "public",
      testMatch: /public-shots\.spec\.ts$/,
      // Defensive: ensure the public project never picks up a cookie
      // even if storage-state.json exists. Anonymous shots must be
      // anonymous.
      use: { storageState: { cookies: [], origins: [] } },
    },
    {
      name: "auth-setup",
      testMatch: /auth-setup\.ts$/,
      use: { headless: false },
      // 6 minute hard cap — 5 min OAuth window + 1 min buffer.
      timeout: 6 * 60 * 1000,
    },
    {
      name: "authed",
      testMatch: /authed-shots\.spec\.ts$/,
      use: { storageState: STORAGE_STATE },
    },
  ],
});
