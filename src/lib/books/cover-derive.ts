// bkstr redesign — temporary cover-data derivation helpers for PR 1.
//
// The `palette` and `glyph` columns on books arrive in PR 8
// (redesign/8-covers-data). Until then, the new <BookCover> primitive
// needs values derived from existing book fields (title, domain).
// This file holds the derivation logic in one place so PR 8 can delete
// it cleanly — every callsite imports from here, the migration replaces
// callsites with column reads, this file disappears.
//
// Goals:
//  - Deterministic. Same (title, domain) -> same cover, so the catalog
//    grid is stable across renders / refreshes.
//  - Even palette spread. Six palettes; we want roughly even
//    distribution across the 10 production books rather than 9 saffron.
//  - Safe glyph fallback. Single uppercase ASCII-ish letter; non-alpha
//    titles get "?".

import type { BookCoverPalette } from '@/components/design/book-cover';

const PALETTES: readonly BookCoverPalette[] = [
  'saffron',
  'forest',
  'oxblood',
  'indigo',
  'plum',
  'slate',
] as const;

/**
 * Derive a stable palette from a book's domain (or title fallback).
 *
 * Uses a tiny FNV-1a-ish hash over the input so palette assignment is
 * deterministic but mixes well across short domain strings. The mod-6
 * collision rate on the 10 production books is acceptable for v0.
 */
export function derivePalette(domain: string): BookCoverPalette {
  let hash = 2166136261;
  for (let i = 0; i < domain.length; i++) {
    hash ^= domain.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Unsigned-shift to avoid negative-modulo surprises.
  return PALETTES[(hash >>> 0) % PALETTES.length];
}

/**
 * Derive the cover's hero glyph — the title's first uppercase ASCII
 * letter. Non-alpha titles (e.g. "12-factor") return "?".
 */
export function deriveGlyph(title: string): string {
  const match = title.match(/[A-Za-z]/);
  return match ? match[0].toUpperCase() : '?';
}

/**
 * Convenience — build the minimal BookCoverData shape from a production
 * book record (which doesn't yet have palette/glyph/vol/version/tokens/
 * compression/chapters). Optional fields are left undefined; the
 * <BookCover> component renders sensible defaults for missing values.
 *
 * The output type intentionally mirrors a subset of BookCoverData so
 * callers can spread / extend safely.
 */
export function bookToCoverData(book: {
  title: string;
  domain: string;
  /** Optional override — once PR 8 adds the column, callers can pass it. */
  palette?: BookCoverPalette;
  /** Optional override — once PR 8 adds the column, callers can pass it. */
  glyph?: string;
}) {
  return {
    title: book.title,
    glyph: book.glyph ?? deriveGlyph(book.title),
    domain: book.domain,
    palette: book.palette ?? derivePalette(book.domain),
    // Placeholder values until PR 8 fleshes out the schema.
    vol: 'Vol. 01',
    version: 'v1',
    author: '—',
  } as const;
}
