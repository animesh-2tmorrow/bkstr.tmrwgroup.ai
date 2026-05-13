// Phase 6 Stream L (D18.1) — shared zip size caps.
//
// Extracted from src/lib/books/zip-validate.ts per follow-up #116 (now closed
// by this commit). Single source of truth consumed by the book upload pipeline,
// the skill upload pipeline (Stream L commit 3), AND the new-book form's
// client-side UX hint (which had its own duplicated literal before this extract).
//
// The original constants — same names, same values, same comments — are kept
// as-is. src/lib/books/zip-validate.ts now re-exports from this module so its
// existing callers (zip-handler.ts, zip-upload.ts, zip-validate.test.ts) keep
// working without import-path churn. New code should import directly from here.

/** Compressed-archive ceiling. Pre-checked at the route boundary against the
 *  multipart `File.size` BEFORE the zip parser is constructed — the cheapest
 *  possible reject. */
export const MAX_ZIP_BYTES = 10 * 1024 * 1024; // 10 MB

/** Entry count ceiling. Defends against a malicious "huge central directory"
 *  that costs the parser a lot to enumerate even before any decompression. */
export const MAX_ENTRIES = 500;

/** Per-entry uncompressed size ceiling. Matches the existing CONTENT_MAX in
 *  /api/books/new (1,000,000 chars ≈ 1 MB) so the legacy JSON path and the
 *  zip-uploaded chapters share the same per-item fairness limit. */
export const MAX_PER_ENTRY_BYTES = 1 * 1024 * 1024; // 1 MB

/** Aggregate uncompressed size ceiling. Decompression-bomb defense — a 10 MB
 *  zip with a 1:100 compression ratio expands to 1 GB; this cap rejects long
 *  before that happens. Tightening would also reject pathological-but-legitimate
 *  long-form content, so we sit at 20 MB (2x the compressed cap) for v1. */
export const MAX_TOTAL_UNCOMPRESSED_BYTES = 20 * 1024 * 1024; // 20 MB

/** Bundled object form for callers that prefer one import; the named exports
 *  above remain the canonical handles. */
export const ZIP_LIMITS = {
  MAX_ZIP_BYTES,
  MAX_ENTRIES,
  MAX_PER_ENTRY_BYTES,
  MAX_TOTAL_UNCOMPRESSED_BYTES,
} as const;
