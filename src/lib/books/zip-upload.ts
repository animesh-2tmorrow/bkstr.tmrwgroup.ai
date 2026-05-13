// Phase 6 Stream K (D17.1) — core zip-upload processing pipeline.
//
// Pure-ish: takes a Buffer + form fields, returns a tagged ZipUploadResult.
// NO DB writes, NO Stripe calls — those live in the route's zip-handler.ts.
//
// Pipeline (route-level MAX_ZIP_BYTES pre-check already done):
//   1. Open the zip via adm-zip (in-memory Buffer input).
//   2. Enumerate non-directory entries.
//   3. checkAggregateLimits — entry count + total uncompressed (BEFORE any
//      per-entry decompression so a bomb is rejected without allocation).
//   4. Per-entry: isSafeZipEntryName + checkEntrySize.
//   5. Skill detection (SKILL.md at zip root with YAML 'name:' frontmatter).
//   6. Manifest detection + parse (yaml@2.9.0, minimum-subset strictness).
//   7. Chapter resolution:
//        - manifest present  → manifest.chapters[]; resolve file path via
//                              explicit `file:` first, then `chapters/{slug}.md`.
//        - manifest absent   → deriveChaptersFromFilenames (filename sort).
//   8. Per-chapter content read + non-empty check.
//   9. Merge metadata: manifest first, form fallback, then required-field check.
//  10. Hash drafts via normalizedChapterHash (matches getVersionContent's
//      "\n\n" join — same comparator works for legacy-blob AND chapterized
//      existing versions when the route checks idempotency).
//
// Validation errors return ZipUploadResult kind="rejected" with a typed code +
// HTTP status. Exceptions are reserved for unexpected failures (a parser bug,
// an OOM); the route handler translates them to 500.

import AdmZip from "adm-zip";
import { randomUUID } from "node:crypto";
import { parseManifest } from "./manifest-parser";
import { deriveChaptersFromFilenames } from "./filename-fallback";
import {
  isSafeZipEntryName,
  checkEntrySize,
  checkAggregateLimits,
  ZipValidationError,
} from "./zip-validate";
import { normalizedChapterHash } from "./chapter-hash";
import type {
  ZipUploadFields,
  ZipUploadResult,
  ChapterDraft,
  ManifestParsed,
} from "./zip-upload.types";

const SLUG_REGEX = /^[a-z0-9-]+$/;
const SLUG_MAX = 128;

/** Detect Anthropic skill packaging — SKILL.md at zip root with `name:` in YAML
 *  frontmatter. Per AD2 / D-K4: skills are a separate content class, so we hard-
 *  reject with a redirect message rather than silently storing them as a book. */
function isSkillPackage(zip: AdmZip): boolean {
  const entry = zip.getEntries().find((e) => e.entryName === "SKILL.md");
  if (!entry || entry.isDirectory) return false;
  let text: string;
  try {
    text = zip.readAsText(entry, "utf8");
  } catch {
    return false;
  }
  // Frontmatter is `---\n…\n---\n`. We look for a `name:` key inside the first
  // fence. Anything else is the marker we trust for "this is a skill bundle."
  if (!text.startsWith("---")) return false;
  const closeIdx = text.indexOf("\n---", 3);
  if (closeIdx < 0) return false;
  const front = text.slice(3, closeIdx);
  return /^name\s*:/m.test(front);
}

function normalizeManifestFilePath(file: string): string {
  let p = file.trim();
  if (p.startsWith("./")) p = p.slice(2);
  if (p.startsWith("/")) p = p.slice(1);
  return p;
}

export async function processZipUpload(
  buffer: Buffer,
  formFields: ZipUploadFields,
): Promise<ZipUploadResult> {
  // ─── 1. Open zip ────────────────────────────────────────────────────────
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch (err) {
    return {
      kind: "rejected",
      status: 400,
      code: "ZIP_PARSE_ERROR",
      error: `Failed to read zip: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }

  // ─── 2. Enumerate entries ───────────────────────────────────────────────
  const allEntries = zip.getEntries().filter((e) => !e.isDirectory);

  // ─── 3, 4. Validate caps + paths ────────────────────────────────────────
  try {
    checkAggregateLimits(allEntries.map((e) => ({ size: e.header.size })));
    for (const e of allEntries) {
      if (!isSafeZipEntryName(e.entryName)) {
        return {
          kind: "rejected",
          status: 400,
          code: "UNSAFE_ENTRY_PATH",
          error: `Entry '${e.entryName}' has an unsafe path (zip-slip, absolute, drive-letter, or control characters)`,
        };
      }
      checkEntrySize({ name: e.entryName, size: e.header.size });
    }
  } catch (err) {
    if (err instanceof ZipValidationError) {
      return { kind: "rejected", status: 400, code: err.code, error: err.message };
    }
    throw err;
  }

  // ─── 5. Skill detection ─────────────────────────────────────────────────
  if (isSkillPackage(zip)) {
    return {
      kind: "rejected",
      status: 400,
      code: "SKILL_DETECTED",
      error:
        "This looks like an Anthropic skill, not a book. Skills are a separate content class — see Stream L (not yet shipped).",
    };
  }

  // ─── 6. Manifest parse (optional) ───────────────────────────────────────
  const manifestEntry = allEntries.find((e) => e.entryName === "manifest.yaml");
  let manifest: ManifestParsed | null = null;
  if (manifestEntry) {
    const yamlText = zip.readAsText(manifestEntry, "utf8");
    const parsed = parseManifest(yamlText);
    if ("code" in parsed) {
      return {
        kind: "rejected",
        status: 400,
        code: "MANIFEST_INVALID",
        error: parsed.message,
      };
    }
    manifest = parsed;
  }

  // ─── 7. Chapter resolution ──────────────────────────────────────────────
  const drafts: ChapterDraft[] = [];

  if (manifest) {
    // Manifest-declared chapters: resolve each entry to a file in the zip.
    for (let i = 0; i < manifest.chapters.length; i++) {
      const decl = manifest.chapters[i];
      const candidates: string[] = [];
      if (decl.file) candidates.push(normalizeManifestFilePath(decl.file));
      candidates.push(`chapters/${decl.slug}.md`);

      const resolved = candidates.find((path) =>
        allEntries.some((e) => e.entryName === path),
      );
      if (!resolved) {
        return {
          kind: "rejected",
          status: 400,
          code: "CHAPTER_FILE_MISSING",
          error: `Manifest declares chapter '${decl.slug}' but no matching file found (tried: ${candidates.join(", ")})`,
        };
      }
      const entry = allEntries.find((e) => e.entryName === resolved)!;
      const content = zip.readAsText(entry, "utf8");
      if (content.length === 0) {
        return {
          kind: "rejected",
          status: 400,
          code: "CHAPTER_EMPTY",
          error: `Chapter '${decl.slug}' (file '${resolved}') is empty — chapters must have non-empty content`,
        };
      }
      drafts.push({
        order: i,
        slug: decl.slug,
        title: decl.title ?? null,
        content,
        tokenEstimate: decl.tokenEstimate ?? null,
        metadata: {
          ...decl.extras,
          ...(decl.audience !== undefined ? { audience: decl.audience } : {}),
          ...(decl.accessPattern !== undefined ? { accessPattern: decl.accessPattern } : {}),
          source: "manifest",
          originalPath: resolved,
        },
      });
    }
  } else {
    // No manifest: filename-sort fallback.
    const stubs = deriveChaptersFromFilenames(allEntries.map((e) => ({ name: e.entryName })));
    if (stubs.length === 0) {
      return {
        kind: "rejected",
        status: 400,
        code: "NO_CHAPTERS_FOUND",
        error: "Zip contains no .md/.markdown files (and no manifest.yaml declares any chapters)",
      };
    }
    for (const stub of stubs) {
      const originalPath = stub.metadata.originalPath as string;
      const entry = allEntries.find((e) => e.entryName === originalPath)!;
      const content = zip.readAsText(entry, "utf8");
      if (content.length === 0) {
        return {
          kind: "rejected",
          status: 400,
          code: "CHAPTER_EMPTY",
          error: `Chapter file '${originalPath}' is empty — chapters must have non-empty content`,
        };
      }
      drafts.push({ ...stub, content });
    }
  }

  // Slug uniqueness within a single upload — duplicate chapter slugs would
  // violate book_chapters' @@unique([bookVersionId, slug]) at write time.
  const seenSlugs = new Set<string>();
  for (const d of drafts) {
    if (seenSlugs.has(d.slug)) {
      return {
        kind: "rejected",
        status: 400,
        code: "MANIFEST_INVALID",
        error: `Duplicate chapter slug '${d.slug}' in upload — chapter slugs must be unique within a version`,
      };
    }
    seenSlugs.add(d.slug);
  }

  // ─── 8. Merge metadata (manifest first, form fallback) ──────────────────
  // Title / slug / domain are required; description is optional.
  const title = pickStr(manifest?.title, formFields.title);
  const slug = pickStr(manifest?.slug, formFields.slug);
  const domain = pickStr(manifest?.domain, formFields.domain);
  const description = pickStrOrNull(manifest?.description, formFields.description);

  if (!title) {
    return {
      kind: "rejected",
      status: 400,
      code: "MISSING_REQUIRED_FIELD",
      error: "Missing required field: title. Either include it in manifest.yaml or fill in the form field.",
    };
  }
  if (!slug) {
    return {
      kind: "rejected",
      status: 400,
      code: "MISSING_REQUIRED_FIELD",
      error: "Missing required field: slug. Either include it in manifest.yaml or fill in the form field.",
    };
  }
  if (!SLUG_REGEX.test(slug) || slug.length > SLUG_MAX) {
    return {
      kind: "rejected",
      status: 400,
      code: "MISSING_REQUIRED_FIELD",
      error: `Slug '${slug}' must match /^[a-z0-9-]+$/ and be 1..${SLUG_MAX} chars (whether from manifest or form)`,
    };
  }
  if (!domain) {
    return {
      kind: "rejected",
      status: 400,
      code: "MISSING_REQUIRED_FIELD",
      error: "Missing required field: domain. Either include it in manifest.yaml or fill in the form field.",
    };
  }

  // ─── 9. Hash + total bytes ──────────────────────────────────────────────
  const draftHash = normalizedChapterHash(drafts);
  let totalBytes = 0;
  for (const d of drafts) totalBytes += Buffer.byteLength(d.content, "utf8");

  return {
    kind: "success",
    bookVersionId: randomUUID(),
    bookIdIfNew: randomUUID(),
    slug,
    title,
    description,
    domain,
    chapters: drafts,
    totalBytes,
    manifestPresent: manifest !== null,
    manifestJson: manifest?.raw ?? {},
    draftHash,
  };
}

function pickStr(...candidates: Array<string | undefined>): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return null;
}

function pickStrOrNull(...candidates: Array<string | undefined>): string | null {
  // Optional fields: first non-empty wins; otherwise null.
  return pickStr(...candidates);
}
