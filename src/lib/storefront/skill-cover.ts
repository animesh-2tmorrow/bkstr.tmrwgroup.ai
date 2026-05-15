// redesign(10)/6 — deterministic skill-cover derivation.
//
// Phase 3 collapsed books and skills into one catalog grid, but skill
// cards rendered with a text-only paper-colored placeholder (no
// <BookCover> SVG) while books got the full typographic cover. From the
// user's perspective the visual collapse felt incomplete. Phase 6 closes
// that gap by deriving {palette, glyph} for skills from their persisted
// (slug, name) pair so they render through the same <BookCover>
// component as books. No schema change required.
//
// Determinism is the contract: same (slug, name) → same (palette, glyph)
// across calls, across servers, across releases. Without that property,
// a skill's cover would shimmer between renders, which is worse than
// having no cover at all.
//
// The hash is a tiny FNV-1a-ish 32-bit shift-and-XOR — not
// cryptographically interesting, just deterministically spreading slug
// strings across the six palette buckets evenly enough. Glyph is the
// first ASCII letter of the skill's `name` (preferred — operator-typed,
// often Title Case), falling back to `slug` (kebab-case), falling back
// to "S" for the pathological case (skill named with only punctuation
// + a slug with the same). The fallback is `'S'` rather than `'?'`
// because skills are a known content class — `'?'` reads as missing
// data, `'S'` reads as "skill cover for an oddly-named skill".
//
// When Skill grows its own palette/glyph columns (operator follow-up
// #B — migration PR), this helper is the migration's backfill source:
// run `deriveSkillCover(s.slug, s.name)` over every skill, write the
// result to the new columns, then this file deletes.

import type { BookCoverPalette } from "@/components/design/book-cover";

// The six-palette set from books — same as src/components/design/book-cover.tsx
// BookCoverPalette union. Order matters for determinism: changing the
// order would re-shuffle every existing skill's palette. If a new
// palette is ever added, APPEND it; don't insert in the middle.
const PALETTES: ReadonlyArray<BookCoverPalette> = [
  "saffron",
  "forest",
  "oxblood",
  "indigo",
  "plum",
  "slate",
];

export function deriveSkillCover(
  slug: string,
  name: string,
): { palette: BookCoverPalette; glyph: string } {
  // FNV-1a-ish 32-bit hash over slug. The `| 0` coercion forces a
  // signed-int 32-bit result on every iteration, which is what makes
  // this deterministic across V8 versions / Node versions (no BigInt,
  // no f64 surprises). Math.abs handles the negative case from the
  // sign bit so the modulo lands in [0, PALETTES.length).
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = ((hash << 5) - hash + slug.charCodeAt(i)) | 0;
  }
  const palette = PALETTES[Math.abs(hash) % PALETTES.length];

  // Glyph: first alphabetical character of name, uppercased. Falls back
  // to the first letter of slug, then "S". `name` is preferred because
  // it's operator-typed (often Title Case, often more descriptive than
  // the slug); slug is dashed lowercase. The match is `[a-zA-Z]` not
  // `[A-Za-z]` to be order-clear about case.
  const nameMatch = name.match(/[a-zA-Z]/);
  const slugMatch = slug.match(/[a-zA-Z]/);
  const glyph = (nameMatch?.[0] ?? slugMatch?.[0] ?? "S").toUpperCase();

  return { palette, glyph };
}
