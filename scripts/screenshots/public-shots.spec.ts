// get-started Phase B — 5 anonymous shots for /get-started page embedding.
//
// Runs headless, no cookie. Each test navigates a public URL, waits for
// fonts + initial render to settle, and screenshots the viewport
// (1440x900). Output: public/get-started/0[1-5]-*.png.
//
// Per dispatch: "Capture full-page where it makes sense (storefront grid
// scrolls; capture the visible viewport not the full scroll)." → viewport
// screenshots only; no fullPage capture.

import { test } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const OUT_DIR = path.resolve(__dirname, "../../public/get-started");

// Ensure the output dir exists before the first screenshot — Playwright's
// page.screenshot() doesn't auto-mkdir.
test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
});

// settleForCapture — wait for the network to quiet AND give web fonts a
// tick to swap. Tailwind ships system-stack fallbacks but the editorial
// serif (page.tsx h1s) is web-loaded; a 250ms tick after networkidle
// avoids the FOIT/FOUT artifact in the screenshot.
async function settleForCapture(page: import("@playwright/test").Page) {
  // 'load' is reliable; 'networkidle' is flaky when the page keeps a
  // persistent connection (e.g. NextAuth session refresh on signed-in
  // pages, or future analytics beacons). The DOM is rendered well
  // before networkidle would fire, so we don't strictly need it.
  await page.waitForLoadState("load", { timeout: 30_000 });
  await page.evaluate(async () => {
    if ("fonts" in document) {
      // @ts-expect-error — fonts is a runtime FontFaceSet on document
      await document.fonts.ready;
    }
  });
  // Best-effort networkidle, with a tight cap.
  await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => {});
  await page.waitForTimeout(250);
}

test("01-hero", async ({ page }) => {
  await page.goto("/");
  await settleForCapture(page);
  // Dispatch: "top of page through 'How to Get Started · 3 STEPS'" — clip
  // from y=0 to the bottom of the section that owns that eyebrow (the
  // 3-step walkthrough block on the homepage; src/app/page.tsx:306-408).
  // Falls back to a viewport-sized shot if the locator can't be found
  // (defensive — page copy could be reordered in a future redesign).
  const eyebrow = page.getByText("HOW TO GET STARTED · 3 STEPS").first();
  const eyebrowBox = await eyebrow.boundingBox().catch(() => null);
  if (eyebrowBox) {
    const section = eyebrow.locator("xpath=ancestor::section[1]");
    const sectionBox = await section.boundingBox().catch(() => null);
    if (sectionBox) {
      await page.screenshot({
        path: path.join(OUT_DIR, "01-hero.png"),
        fullPage: true,
        clip: {
          x: 0,
          y: 0,
          width: 1440,
          // +24px tail so the section's bottom padding isn't visually clipped
          height: Math.ceil(sectionBox.y + sectionBox.height + 24),
        },
      });
      return;
    }
  }
  // Fallback path — viewport only.
  await page.screenshot({ path: path.join(OUT_DIR, "01-hero.png") });
});

test("02-storefront", async ({ page }) => {
  await page.goto("/storefront");
  await settleForCapture(page);
  // Dispatch: "must show at least 2 books + 2 skills visible". The
  // 1440x900 viewport only fits ONE row of covers because BookCover at
  // grid-default size is ~600px tall — three covers per row = max 3 items
  // per viewport. We need at least 2 books + 2 skills (4 items min), so a
  // viewport-only shot can't satisfy the dispatch.
  //
  // Approach: fullPage clip from y=0 to the bottom of the 6th cover (two
  // full rows of 3 covers). That gives us 6 items, which with the current
  // catalog order (skills first by kind, then books) lands as
  // skill+skill+book / skill+book+book = 3 books + 3 skills. Comfortably
  // over the 2+2 floor and leaves headroom if the sort changes.
  //
  // Width stays 1440 (the viewport). Height clamps to the 6th card's
  // bottom edge — derived dynamically so it survives card-size tweaks in
  // future redesign phases.
  const sixthCard = page.locator("a[href^='/storefront/']").nth(5);
  const box = await sixthCard.boundingBox().catch(() => null);
  if (box) {
    await page.screenshot({
      path: path.join(OUT_DIR, "02-storefront.png"),
      fullPage: true,
      clip: {
        x: 0,
        y: 0,
        width: 1440,
        height: Math.ceil(box.y + box.height + 32),
      },
    });
    return;
  }
  // Fallback: empirical clip if the cards locator doesn't resolve.
  await page.screenshot({
    path: path.join(OUT_DIR, "02-storefront.png"),
    fullPage: true,
    clip: { x: 0, y: 0, width: 1440, height: 1600 },
  });
});

test("03-book-detail", async ({ page }) => {
  await page.goto("/storefront/self-upgrade-engineer");
  await settleForCapture(page);
  await page.screenshot({ path: path.join(OUT_DIR, "03-book-detail.png") });
});

test("04-skill-detail", async ({ page }) => {
  await page.goto("/storefront/eval-runner");
  await settleForCapture(page);
  await page.screenshot({ path: path.join(OUT_DIR, "04-skill-detail.png") });
});

test("05-signup", async ({ page }) => {
  await page.goto("/signup");
  await settleForCapture(page);
  await page.screenshot({ path: path.join(OUT_DIR, "05-signup.png") });
});
