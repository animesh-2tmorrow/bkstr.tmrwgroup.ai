// redesign(10) Phase 1 verification harness.
//
// Smoke-tests the three new backend additions against whatever DATABASE_URL
// is configured. Run via `npx tsx scripts/verify-phase-1.ts`.
//
// Test cases (per dispatch):
//   1. resolveSlug("eval-runner")                        → kind="skill"
//   2. resolveSlug("agentic-qa-manual")      → kind="book", domain set
//   3. resolveSlug("nonexistent-slug-x9k2")              → null
//   4. getLandingStats()                                 → shape + numeric/null fields
//   5. getCatalogForLibrary()                            → array length >= 10 with kind discriminator
//   6. getAccessStatesForCatalog(<animesh@aimplemented>) → Map with at least one entry

import { resolveSlug } from "../src/lib/storefront/resolve-slug";
import {
  getLandingStats,
  getCatalogForLibrary,
  getAccessStatesForCatalog,
} from "../src/lib/dashboard/queries";
import { prisma } from "../src/lib/db";

type Outcome =
  | { test: string; pass: true; detail: string }
  | { test: string; pass: false; detail: string };

const out: Outcome[] = [];

function rec(test: string, pass: boolean, detail: string) {
  out.push({ test, pass, detail } as Outcome);
  const tag = pass ? "PASS" : "FAIL";
  console.log(`[${tag}] ${test}`);
  console.log(`        ${detail}`);
}

async function main() {
  // Test 1
  try {
    const r = await resolveSlug("eval-runner");
    if (r && r.kind === "skill" && r.displayName && r.files.length > 0) {
      rec(
        "resolveSlug('eval-runner')",
        true,
        `kind=${r.kind} id=${r.id.slice(0, 8)}... displayName="${r.displayName}" version=${r.latestVersion} files=${r.files.length}`,
      );
    } else if (r === null) {
      rec(
        "resolveSlug('eval-runner')",
        false,
        `returned null (slug not in DB? local-empty-DB?)`,
      );
    } else {
      rec(
        "resolveSlug('eval-runner')",
        false,
        `unexpected shape: kind=${r?.kind} displayName=${r?.displayName} files=${r?.files.length}`,
      );
    }
  } catch (err) {
    rec(
      "resolveSlug('eval-runner')",
      false,
      `threw: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Test 2
  try {
    const r = await resolveSlug("agentic-qa-manual");
    if (
      r &&
      r.kind === "book" &&
      r.domain &&
      r.palette &&
      r.glyph &&
      r.files.length > 0
    ) {
      rec(
        "resolveSlug('agentic-qa-manual')",
        true,
        `kind=${r.kind} displayName="${r.displayName}" domain="${r.domain}" palette=${r.palette} glyph=${r.glyph} files=${r.files.length}`,
      );
    } else if (r === null) {
      rec(
        "resolveSlug('agentic-qa-manual')",
        false,
        `returned null (slug not in DB?)`,
      );
    } else {
      rec(
        "resolveSlug('agentic-qa-manual')",
        false,
        `kind=${r?.kind} domain=${r?.domain} palette=${r?.palette} glyph=${r?.glyph} files=${r?.files.length}`,
      );
    }
  } catch (err) {
    rec(
      "resolveSlug('agentic-qa-manual')",
      false,
      `threw: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Test 3
  try {
    const r = await resolveSlug("nonexistent-slug-x9k2");
    if (r === null) {
      rec("resolveSlug('nonexistent-slug-x9k2')", true, "returned null as expected");
    } else {
      rec(
        "resolveSlug('nonexistent-slug-x9k2')",
        false,
        `unexpectedly resolved: ${JSON.stringify({ kind: r.kind, slug: r.slug })}`,
      );
    }
  } catch (err) {
    rec(
      "resolveSlug('nonexistent-slug-x9k2')",
      false,
      `threw: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Test 4 — landing stats (paste verbatim per dispatch)
  try {
    const s = await getLandingStats();
    const shapeOk =
      typeof s.titlesInPrint === "number" &&
      typeof s.activeAgents30d === "number" &&
      typeof s.tokensServed30d === "number" &&
      (s.fetchP95Ms === null || typeof s.fetchP95Ms === "number");
    rec(
      "getLandingStats()",
      shapeOk,
      `EXACT OBJECT (paste verbatim): ${JSON.stringify(s)}`,
    );
  } catch (err) {
    rec(
      "getLandingStats()",
      false,
      `threw: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Test 5
  try {
    const arr = await getCatalogForLibrary();
    const books = arr.filter((x) => x.kind === "book");
    const skills = arr.filter((x) => x.kind === "skill");
    const lenOk = arr.length >= 10;
    const discrOk =
      books.every((x) => x.kind === "book") &&
      skills.every((x) => x.kind === "skill");
    rec(
      "getCatalogForLibrary()",
      lenOk && discrOk,
      `total=${arr.length} books=${books.length} skills=${skills.length}; first 3 slugs: ${arr.slice(0, 3).map((i) => `${i.kind}:${i.slug}`).join(", ")}`,
    );
  } catch (err) {
    rec(
      "getCatalogForLibrary()",
      false,
      `threw: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Test 6 — needs a real subscriber id. Look up animesh@2tmorrow.com
  // (operator's email per memory) and use their subscriber id.
  try {
    const sub = await prisma.subscriber.findFirst({
      where: { user: { email: "animesh@2tmorrow.com" } },
      select: { id: true, email: true },
    });
    if (!sub) {
      rec(
        "getAccessStatesForCatalog(<operator subscriber>)",
        false,
        "operator subscriber not found in DB (animesh@2tmorrow.com)",
      );
    } else {
      const map = await getAccessStatesForCatalog(sub.id);
      const granted = Array.from(map.values()).filter((v) => v.state === "granted");
      const forSale = Array.from(map.values()).filter((v) => v.state === "for_sale");
      rec(
        "getAccessStatesForCatalog(<operator subscriber>)",
        map.size > 0,
        `subscriber=${sub.id.slice(0, 8)}... map size=${map.size} granted=${granted.length} for_sale=${forSale.length}; first granted: ${granted.slice(0, 3).map((g) => `${g.kind}:${g.id.slice(0, 8)}`).join(", ") || "(none)"}`,
      );
    }
  } catch (err) {
    rec(
      "getAccessStatesForCatalog(...)",
      false,
      `threw: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  await prisma.$disconnect();

  const fails = out.filter((o) => !o.pass).length;
  console.log();
  console.log("=".repeat(60));
  console.log(`${out.length - fails}/${out.length} tests passed`);
  if (fails > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("HARNESS CRASH:", err);
  process.exit(2);
});
