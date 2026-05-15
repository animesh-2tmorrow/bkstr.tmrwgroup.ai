// get-started Phase B — 4 auth-gated shots, signed in as animesh@2tmorrow.com.
//
// Consumes storage-state.json captured by auth-setup.ts. If the cookie is
// missing or expired, the first navigation will redirect to /login; the
// beforeEach guard catches that and fails the test with a clear message
// pointing the operator at the auth-setup re-run.
//
// Output: public/get-started/0[6-9]-*.png.

import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const OUT_DIR = path.resolve(__dirname, "../../public/get-started");
const SCREENSHOT_KEY_NAME = "Screenshots";

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
});

async function settleForCapture(page: import("@playwright/test").Page) {
  // 'load' is reliable; 'networkidle' is flaky on signed-in dashboard
  // pages (NextAuth client-side session refresh keeps the connection
  // warm enough to never hit the 500ms idle floor). The page DOM is
  // rendered well before networkidle would fire, so we don't need it.
  await page.waitForLoadState("load", { timeout: 30_000 });
  // Web fonts: wait for FontFaceSet.ready so the editorial serif h1
  // doesn't paint as the system fallback in the capture.
  await page.evaluate(async () => {
    if ("fonts" in document) {
      // @ts-expect-error — fonts is a runtime FontFaceSet on document
      await document.fonts.ready;
    }
  });
  // Best-effort networkidle, but don't fail the test if it never settles.
  await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => {});
  await page.waitForTimeout(250);
}

test.beforeEach(async ({ page }) => {
  // Prove the cookie is live before each shot. If we land on /login,
  // the storageState is stale — fail loud so the operator knows to
  // re-run `npm run screenshots:auth-setup`.
  await page.goto("/dashboard/library");
  await expect(
    page,
    "Session cookie expired or missing — run `npm run screenshots:auth-setup`",
  ).not.toHaveURL(/\/login/, { timeout: 15_000 });
});

test("06-library", async ({ page }) => {
  // Force ?filter=all so the shot shows both owned (3) and browse (8)
  // items — the dispatch wants "All filter tabs visible" + a representative
  // catalog. Default landing is also ?filter=all per page.tsx fallback but
  // explicit-is-better.
  await page.goto("/dashboard/library?filter=all");
  await settleForCapture(page);
  await page.screenshot({ path: path.join(OUT_DIR, "06-library.png") });
});

test("07-api-keys", async ({ page }) => {
  // Step 1: ensure a "Screenshots"-named key exists. If a prior run
  // already created one, skip creation (idempotent re-run).
  await page.goto("/dashboard/api-keys");
  await settleForCapture(page);

  const existing = page.locator("td", { hasText: SCREENSHOT_KEY_NAME }).first();
  const hasExisting = await existing.isVisible().catch(() => false);

  if (!hasExisting) {
    await page.getByRole("button", { name: "Generate new key" }).click();
    await page.locator("#key-name").fill(SCREENSHOT_KEY_NAME);
    // Submit. The Generate button is `type="submit"` inside the form;
    // role+name match the visible label.
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    // "show" stage opens — confirm the checkbox and click Done.
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Done" }).click();
    // List refreshes; wait for the new row to appear.
    await expect(
      page.locator("td", { hasText: SCREENSHOT_KEY_NAME }).first(),
    ).toBeVisible({ timeout: 10_000 });
    // A small settle after the refresh so the row paint is stable.
    await page.waitForTimeout(250);
  }

  await page.screenshot({ path: path.join(OUT_DIR, "07-api-keys.png") });
});

test("08-api-disclosure", async ({ page }) => {
  // Active filter shows only owned rows — guarantees a row with an
  // expandable "▸ API access" details element exists.
  await page.goto("/dashboard/library?filter=active");
  await settleForCapture(page);

  // The summary text is literal "▸ API access" (library-table.tsx:172).
  // first() picks the topmost owned row, which is whatever the catalog
  // sort puts at row 0 (book/skill kind-insensitive).
  const summary = page.getByText("▸ API access").first();
  await expect(summary).toBeVisible();
  await summary.click();

  // Wait for the curl block inside the expanded <details>. The block
  // shows a "curl" command + masked api-key. We assert on "curl " to be
  // safe across kind-specific copy variants.
  await expect(page.locator("pre", { hasText: /curl /i }).first()).toBeVisible({
    timeout: 5_000,
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT_DIR, "08-api-disclosure.png") });
});

test("09-owned-detail", async ({ page }) => {
  await page.goto("/storefront/eval-runner");
  await settleForCapture(page);

  // Owned-state proof: BuyButton renders "↓ Get Started" anchor instead
  // of "Buy now". Per buy-button.tsx:67-70 (state === "owned" branch).
  await expect(page.getByText(/Get Started/).first()).toBeVisible();
  // Belt-and-braces: no "Buy now" button should be on the page for owners.
  await expect(page.getByRole("button", { name: /buy now/i })).toHaveCount(0);

  // The owned-state visual differs from #04 only BELOW the 900px fold:
  // the "↓ Get Started" anchor bar + §GET STARTED panel with masked
  // api-key + curl. Clip down to the bottom of section#get-started so
  // the dispatch's "buy button replaced with '↓ Get Started' + inline
  // install panel" is captured in one frame.
  const section = page.locator("section#get-started");
  const sectionBox = await section.boundingBox().catch(() => null);
  if (sectionBox) {
    await page.screenshot({
      path: path.join(OUT_DIR, "09-owned-detail.png"),
      fullPage: true,
      clip: {
        x: 0,
        y: 0,
        width: 1440,
        height: Math.ceil(sectionBox.y + sectionBox.height + 32),
      },
    });
    return;
  }
  // Fallback: viewport only.
  await page.screenshot({ path: path.join(OUT_DIR, "09-owned-detail.png") });
});
