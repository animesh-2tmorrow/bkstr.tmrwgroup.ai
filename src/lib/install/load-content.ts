// Move 1 — unified content loader for the install endpoint.
//
// Given a resolved item ({ kind, id }), returns the file bodies as a
// kind-agnostic Array<{ path, content }> for the tarball builder.
//
// STORAGE: content is read DIRECTLY from the `content` text columns —
// book_chapters.content / book_versions.content / skill_files.content.
// We deliberately do NOT branch on book_versions.content_uri's scheme.
// The S3 pre-check (2026-05-16) found 0 ACTIVE books stored in S3 — every
// one is inline. Reading `content` directly and throwing on empty means a
// book genuinely migrated to S3 later fails LOUD here
// (EmptyInstallContentError → 404) rather than silently shipping an empty
// tarball.

import { prisma } from "@/lib/db";

export class EmptyInstallContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmptyInstallContentError";
  }
}

export type InstallFile = { path: string; content: string };

export async function loadContent(
  kind: "book" | "skill",
  id: string,
): Promise<InstallFile[]> {
  return kind === "skill" ? loadSkillContent(id) : loadBookContent(id);
}

async function loadSkillContent(skillId: string): Promise<InstallFile[]> {
  const version = await prisma.skillVersion.findFirst({
    where: { skillId },
    orderBy: { version: "desc" },
    select: {
      files: {
        orderBy: { path: "asc" },
        select: { path: true, content: true },
      },
    },
  });
  if (!version || version.files.length === 0) {
    throw new EmptyInstallContentError("Skill has no installable files");
  }
  for (const f of version.files) {
    if (f.content.length === 0) {
      throw new EmptyInstallContentError(`Skill file ${f.path} has empty content`);
    }
  }
  return version.files.map((f) => ({ path: f.path, content: f.content }));
}

async function loadBookContent(bookId: string): Promise<InstallFile[]> {
  const version = await prisma.bookVersion.findFirst({
    where: { bookId },
    orderBy: { version: "desc" },
    select: {
      content: true,
      manifest: true,
      chapters: {
        orderBy: { order: "asc" },
        select: { slug: true, content: true },
      },
    },
  });
  if (!version) {
    throw new EmptyInstallContentError("Book has no version");
  }

  // Multi-chapter shape: one file per chapter. BookChapter has no `path`
  // column (the dispatch's `chapter.path` does not exist), so the path is
  // derived exactly the way GET /api/books/[id]/files derives it:
  // manifest.chapters[i].file when the manifest declares it, otherwise
  // chapters/<chapter-slug>.md.
  if (version.chapters.length > 0) {
    const manifestObj = (version.manifest ?? null) as Record<string, unknown> | null;
    const manifestChapters = Array.isArray(manifestObj?.chapters)
      ? (manifestObj!.chapters as Array<Record<string, unknown>>)
      : null;
    return version.chapters.map((c, idx) => {
      if (c.content.length === 0) {
        throw new EmptyInstallContentError(`Book chapter ${c.slug} has empty content`);
      }
      const decl = manifestChapters?.[idx];
      const declaredPath = typeof decl?.file === "string" ? decl.file : null;
      return {
        path: declaredPath ?? `chapters/${c.slug}.md`,
        content: c.content,
      };
    });
  }

  // Legacy single-blob shape — content inline on book_versions.content.
  // Per the dispatch, the single file is named SKILL.md so the install
  // tarball is uniform across kinds.
  if (typeof version.content === "string" && version.content.length > 0) {
    return [{ path: "SKILL.md", content: version.content }];
  }

  // No chapters AND no inline content — either a genuinely empty version
  // or a book whose content lives only in S3 (content_uri). The S3
  // pre-check found none today; if one ever appears this is the loud fail.
  throw new EmptyInstallContentError(
    "Book has no inline content (chapters empty and book_versions.content empty)",
  );
}
