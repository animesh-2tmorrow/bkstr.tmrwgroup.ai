// Requires `npx prisma generate` to have run (post-Stream-J Prisma client; the
// BookChapter type imported below is emitted by that step).
import type { BookChapter } from "@/generated/prisma/client";
import { loadBookContent, type LoadableBookVersion } from "@/lib/storage/book-content";

// Phase 6 Stream J (D16.1) — single read path for a BookVersion's content.
// A version is either legacy single-blob (no chapters → delegate to the D9.2
// dual-storage seam, loadBookContent) or multi-chapter (chapters present →
// assemble in `order`). New multi-chapter versions don't exist until Stream K
// ships, so until then this always takes the loadBookContent branch in
// production; the chapter-assembly branch is exercised only by tests.

// Chapter join separator. "\n\n" = a blank line between chapters; markdown-
// natural. Stream K should revisit this if the manifest declares chapter-
// rendering semantics (e.g. per-chapter "# {title}" headers) — at which point
// this hardcoded constant becomes a parameter derived from the manifest. Not in
// Stream J's scope: Stream J has no manifest-aware code paths yet.
const CHAPTER_SEPARATOR = "\n\n";

type ChapterForAssembly = Pick<BookChapter, "order" | "content">;
type VersionWithChapters = LoadableBookVersion & { chapters?: ChapterForAssembly[] };

/**
 * Resolve a book version's content.
 *
 * - Multi-chapter version (chapters present and non-empty): returns the
 *   chapters' content concatenated in `order`, separated by CHAPTER_SEPARATOR.
 *   Throws if any chapter row has empty content — that's a data-integrity
 *   condition (a multi-chapter version should never carry an empty chapter).
 * - Legacy single-blob version (no chapters): delegates to loadBookContent,
 *   preserving the D9.2 s3://-or-inline precedence rule.
 *
 * Callers must select the version's `chapters` ordered by `order` (or omit the
 * relation entirely for the legacy path); see the agent/fetch, books/download
 * and books/view routes.
 */
export async function getVersionContent(version: VersionWithChapters): Promise<string> {
  if (version.chapters && version.chapters.length > 0) {
    const ordered = [...version.chapters].sort((a, b) => a.order - b.order);
    for (const chapter of ordered) {
      if (!chapter.content || chapter.content.length === 0) {
        throw new Error(
          `book_version ${version.id} chapter order=${chapter.order} has empty content — multi-chapter content must be non-empty per row`,
        );
      }
    }
    return ordered.map((chapter) => chapter.content).join(CHAPTER_SEPARATOR);
  }
  return loadBookContent(version);
}
