// Phase 6 Stream K (D17.1) — composed zip security layer.
//
// Four caps, each addressing a distinct adversarial vector. Composed (not a
// single mega-function) so each cap is independently testable and a bug in one
// doesn't compromise the others. Called from processZipUpload in a linear
// sequence: route-level pre-check (MAX_ZIP_BYTES, by the route before the zip
// parser is instantiated) → open central directory → checkAggregateLimits
// (BEFORE any per-entry decompression so a bomb is rejected before we allocate
// memory for its contents) → per-entry loop: isSafeZipEntryName →
// checkEntrySize → only then read the entry's content.
//
// Cap values are named exports (per Gate 3 ask (a)) — no scattered magic
// numbers across files; downstream code imports the constants here.

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

export type ZipValidationErrorCode =
  | "TOO_MANY_ENTRIES"
  | "TOO_LARGE_UNCOMPRESSED"
  | "ENTRY_TOO_LARGE"
  | "UNSAFE_ENTRY_PATH";

export class ZipValidationError extends Error {
  constructor(
    public code: ZipValidationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ZipValidationError";
  }
}

/**
 * Path validation — rejects zip-slip, absolute paths, drive-letter prefixes,
 * control characters, and `..` segments. We never use entry names as
 * filesystem paths (in-memory processing only), but a `../` entry could still
 * poison our slug/storage abstractions if it propagated. Reject early.
 */
export function isSafeZipEntryName(name: string): boolean {
  if (typeof name !== "string") return false;
  if (name.length === 0 || name.length > 1024) return false;
  // Absolute paths (POSIX or Windows).
  if (name.startsWith("/") || name.startsWith("\\")) return false;
  // Drive-letter prefix (e.g. "C:foo").
  if (/^[a-zA-Z]:/.test(name)) return false;
  // Control characters anywhere.
  if (/[\x00-\x1f\x7f]/.test(name)) return false;
  // Path segments — split on both separators, reject "..".
  const parts = name.split(/[/\\]/);
  for (const p of parts) {
    if (p === "..") return false;
  }
  return true;
}

/**
 * Per-entry uncompressed size — throws ENTRY_TOO_LARGE.
 *
 * The size here is the uncompressed size from the zip's central directory; it
 * is read BEFORE the entry's content is decompressed so a malicious entry that
 * declares its uncompressed size truthfully (i.e. most non-bomb-style attacks)
 * is rejected without paying decompression cost. A liar that claims a small
 * size and then expands further is bounded by the lib's decompressor; if that
 * becomes a concern we'd add post-decompression length verification.
 */
export function checkEntrySize(entry: { name: string; size: number }): void {
  if (entry.size > MAX_PER_ENTRY_BYTES) {
    throw new ZipValidationError(
      "ENTRY_TOO_LARGE",
      `Entry '${entry.name}' is too large (${entry.size} bytes) — per-file limit is ${MAX_PER_ENTRY_BYTES} bytes`,
    );
  }
}

/**
 * Aggregate caps — entry count and total uncompressed bytes. Called ONCE,
 * immediately after the central directory is read, BEFORE any per-entry
 * decompression. Throws TOO_MANY_ENTRIES or TOO_LARGE_UNCOMPRESSED.
 */
export function checkAggregateLimits(entries: { size: number }[]): void {
  if (entries.length > MAX_ENTRIES) {
    throw new ZipValidationError(
      "TOO_MANY_ENTRIES",
      `Zip contains too many entries (${entries.length}) — limit is ${MAX_ENTRIES}`,
    );
  }
  let total = 0;
  for (const e of entries) total += e.size;
  if (total > MAX_TOTAL_UNCOMPRESSED_BYTES) {
    throw new ZipValidationError(
      "TOO_LARGE_UNCOMPRESSED",
      `Zip total uncompressed size (${total} bytes) exceeds ${MAX_TOTAL_UNCOMPRESSED_BYTES} bytes`,
    );
  }
}
