// Phase 6 Stream K (D17.1) — chapter-content hash primitive.
//
// Used for two things:
//  (1) Idempotency check: the zip handler compares
//      sha256(normalized draft content) against
//      sha256(await getVersionContent(latestVersion)).
//      `getVersionContent` for a chapterized version is
//      chapters.sortByOrder.map(c.content).join("\n\n"), so this normalization
//      MUST match exactly — same separator, same ordering, same encoding.
//  (2) Debugging/audit: future surfaces may want a content-fingerprint.
//
// Separator stays in sync with src/lib/books/content.ts's CHAPTER_SEPARATOR.
// If that changes, both must change together; cross-ref the test.

import { createHash } from "node:crypto";

const CHAPTER_SEPARATOR = "\n\n";

export function normalizedChapterHash(
  drafts: ReadonlyArray<{ order: number; content: string }>,
): string {
  const ordered = [...drafts].sort((a, b) => a.order - b.order);
  const text = ordered.map((c) => c.content).join(CHAPTER_SEPARATOR);
  return createHash("sha256").update(text, "utf8").digest("hex");
}
