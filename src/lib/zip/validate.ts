// Phase 6 Stream L (D18.1) — shared zip-entry validation layer.
//
// Extracted from src/lib/books/zip-validate.ts per follow-up #116. The
// composed-not-monolithic discipline from Stream K stands: each cap is its
// own function with its own error code so a bug in one doesn't compromise
// the others, and each is independently unit-testable.
//
// Books and skills both consume these. src/lib/books/zip-validate.ts is a
// re-export shim that keeps existing callers working.

import { MAX_ENTRIES, MAX_PER_ENTRY_BYTES, MAX_TOTAL_UNCOMPRESSED_BYTES } from "./limits";

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
