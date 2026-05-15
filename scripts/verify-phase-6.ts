// redesign(10) Phase 6 verification harness.
//
// Calls resolveSlug() on the three prod skills and prints their derived
// {palette, glyph} pair. Runs each resolve twice to confirm determinism
// (same input → same output, every call).
//
// Run via `npx tsx scripts/verify-phase-6.ts` against the prod DATABASE_URL.

import { resolveSlug } from "../src/lib/storefront/resolve-slug";
import { deriveSkillCover } from "../src/lib/storefront/skill-cover";
import { prisma } from "../src/lib/db";

const SKILL_SLUGS = ["eval-runner", "action-plan", "notebook-skill"];

async function main() {
  console.log("=== resolveSlug() against the three prod skills ===");
  console.log();

  for (const slug of SKILL_SLUGS) {
    try {
      const a = await resolveSlug(slug);
      const b = await resolveSlug(slug);
      if (!a || !b) {
        console.log(`[${slug}] FAIL — resolved to null`);
        continue;
      }
      if (a.kind !== "skill") {
        console.log(`[${slug}] FAIL — resolved kind=${a.kind} (expected skill)`);
        continue;
      }

      const det =
        a.palette === b.palette && a.glyph === b.glyph
          ? "DETERMINISTIC"
          : "NON-DETERMINISTIC (BUG)";

      console.log(
        `[${slug}] palette=${a.palette}  glyph=${a.glyph}  displayName="${a.displayName}"  [${det}]`,
      );
    } catch (err) {
      console.log(
        `[${slug}] FAIL — threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log();
  console.log("=== sanity: deriveSkillCover() direct calls (no DB) ===");
  for (const slug of SKILL_SLUGS) {
    // Use the slug as both arguments to confirm the hash logic is stable
    // independently of any DB state.
    const d = deriveSkillCover(slug, slug);
    console.log(`  deriveSkillCover(${slug!.padEnd(20)}, ${slug}) → ${JSON.stringify(d)}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("HARNESS CRASH:", err);
  process.exit(2);
});
