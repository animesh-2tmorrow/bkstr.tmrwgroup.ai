// redesign(10) Phase 1 — unified slug resolver for the merged catalog.
//
// `resolveSlug(slug)` returns a discriminated-union ResolvedItem covering
// both Book and Skill kinds. The unified /storefront/[slug] detail page
// (lands in Phase 5) consumes this; until then, the function is exercised
// only by the Phase 1 verification harness.
//
// Resolution order: book first, then skill (operator decision 7.5 v0 —
// "book wins" tiebreak; no current collisions exist in production data).
// If both kinds match the slug, the book is returned and a warning is
// logged. The DB-level cross-kind uniqueness constraint that would prevent
// this entirely is a separate future-PR item (operator decision 7.5
// option D). For today, the warning surfaces the collision in CloudWatch.
//
// Status filter: only ACTIVE items resolve. ARCHIVED + DRAFT both return
// null — the storefront surface only sells current inventory.

import { prisma } from "@/lib/db";
import type { BookCoverPalette } from "@/components/design/book-cover";
import { deriveSkillCover } from "./skill-cover";

export type StorefrontKind = "book" | "skill";

export type StorefrontFile = {
  path: string;
  extension: string;
  byteSize: number;
};

export type ResolvedItem = {
  kind: StorefrontKind;
  id: string;
  slug: string;
  displayName: string;          // book.title OR skill.name
  description: string | null;
  status: "ACTIVE" | "ARCHIVED" | "DRAFT";
  // Book-only fields; null for skills.
  domain: string | null;
  palette: BookCoverPalette | null;
  glyph: string | null;
  // Shared.
  unitAmountCents: number | null;
  stripePriceId: string | null;
  latestVersion: number;
  files: StorefrontFile[];
};

// Synthesize a StorefrontFile entry for a book chapter. Books don't carry
// per-chapter `path` / `extension` / `byteSize` columns the way SkillFile
// rows do, so we manufacture a sensible shape from the chapter slug +
// content. The `chapters/` prefix mirrors the path layout publishers use
// in zip uploads (Stream K manifest mode), so the file manifest preview
// is recognisable to operators who uploaded the source zip.
function chapterToFile(chapter: { slug: string; content: string }): StorefrontFile {
  return {
    path: `chapters/${chapter.slug}.md`,
    extension: ".md",
    // Buffer.byteLength gives the true UTF-8 byte count, which is what the
    // file manifest's "N B / N KB" formatter expects (matching SkillFile's
    // explicit byteSize column).
    byteSize: Buffer.byteLength(chapter.content, "utf8"),
  };
}

// Synthesize a single-file entry for legacy single-blob BookVersions (no
// chapters; content lives on the version row directly). Path is "content.md"
// rather than "chapters/X.md" to make the single-blob shape visible to the
// operator browsing the manifest.
function legacyContentToFile(content: string): StorefrontFile {
  return {
    path: "content.md",
    extension: ".md",
    byteSize: Buffer.byteLength(content, "utf8"),
  };
}

export async function resolveSlug(slug: string): Promise<ResolvedItem | null> {
  if (!slug || typeof slug !== "string") return null;
  const trimmed = slug.trim().toLowerCase();
  if (trimmed.length === 0) return null;

  // Query book + skill in parallel. Each subquery pulls the latest version
  // plus its files (chapters for book; SkillFile rows for skill). The cost
  // of running both even when one will be discarded is small — the second
  // query short-circuits to zero rows when no skill with that slug exists.
  const [book, skill] = await Promise.all([
    prisma.book.findFirst({
      where: { slug: trimmed, status: "ACTIVE" },
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        status: true,
        domain: true,
        palette: true,
        glyph: true,
        prices: {
          where: { currency: "USD" },
          select: { unitAmountCents: true, stripePriceId: true },
          take: 1,
        },
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: {
            version: true,
            content: true,
            chapters: {
              orderBy: { order: "asc" },
              select: { slug: true, content: true },
            },
          },
        },
      },
    }),
    prisma.skill.findFirst({
      where: { slug: trimmed, status: "ACTIVE" },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        status: true,
        price: { select: { unitAmountCents: true, stripePriceId: true } },
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: {
            version: true,
            files: {
              orderBy: { path: "asc" },
              select: { path: true, extension: true, byteSize: true },
            },
          },
        },
      },
    }),
  ]);

  // Both kinds matched — collision. Per operator decision 7.5 v0, book
  // wins. Warn loudly so operations can spot it in logs; the DB-level
  // cross-kind uniqueness constraint is a future-PR follow-up.
  if (book && skill) {
    console.warn(
      `[storefront/resolve-slug] Slug collision detected: "${trimmed}" matches both book (id=${book.id}) and skill (id=${skill.id}); resolving to book per v0 tiebreak.`,
    );
  }

  if (book) {
    const latest = book.versions[0];
    const price = book.prices[0] ?? null;
    let files: StorefrontFile[] = [];
    if (latest) {
      if (latest.chapters.length > 0) {
        files = latest.chapters.map(chapterToFile);
      } else if (latest.content && latest.content.length > 0) {
        files = [legacyContentToFile(latest.content)];
      }
    }
    return {
      kind: "book",
      id: book.id,
      slug: book.slug,
      displayName: book.title,
      description: book.description,
      status: book.status,
      domain: book.domain,
      // Book-side palette + glyph are NOT NULL with DB defaults (PR 8 migration
      // 20260515090000). Cast the string column to the BookCoverPalette literal
      // union — the migration's backfill heuristic + the form's validation
      // both restrict values to the 6-key set, so the cast is safe at runtime.
      palette: book.palette as BookCoverPalette,
      glyph: book.glyph,
      unitAmountCents: price?.unitAmountCents ?? null,
      stripePriceId: price?.stripePriceId ?? null,
      latestVersion: latest?.version ?? 0,
      files,
    };
  }

  if (skill) {
    const latest = skill.versions[0];
    const price = skill.price ?? null;
    // redesign(10)/6 — derive a (palette, glyph) pair deterministically
    // from (slug, name) so the skill renders through the same <BookCover>
    // SVG as books. Domain stays null because skills don't have a domain
    // column; the cover-side code uses a "SKILL" literal for the imprint
    // bar at render time. The HANDOFF Q4 "typographic-mono" stance for
    // skills was reversed in this phase — visual parity beats the
    // mono-only treatment now that books + skills live in one grid.
    const derived = deriveSkillCover(skill.slug, skill.name);
    return {
      kind: "skill",
      id: skill.id,
      slug: skill.slug,
      displayName: skill.name,
      description: skill.description,
      status: skill.status,
      // Skills still lack a domain column; the storefront / detail page
      // substitute a "SKILL" literal in the BookCover's `domain` prop at
      // render time so the imprint bar reads "BKSTR — SKILL".
      domain: null,
      palette: derived.palette,
      glyph: derived.glyph,
      unitAmountCents: price?.unitAmountCents ?? null,
      stripePriceId: price?.stripePriceId ?? null,
      latestVersion: latest?.version ?? 0,
      files: latest?.files ?? [],
    };
  }

  return null;
}
