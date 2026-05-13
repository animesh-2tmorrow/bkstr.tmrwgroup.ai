// Phase 6 Stream K (D17.1) — core zip-upload processing pipeline.
// Phase 6 Stream K.1 (D17.2) — virtual-root resolution + __MACOSX strip.
//
// Pure-ish: takes a Buffer + form fields, returns a tagged ZipUploadResult.
// NO DB writes, NO Stripe calls — those live in the route's zip-handler.ts.
//
// Pipeline (route-level MAX_ZIP_BYTES pre-check already done):
//   1. Open the zip via adm-zip (in-memory Buffer input).
//   2. Enumerate non-directory entries; STRIP `__MACOSX/`-prefixed entries
//      at the very top so resource-fork garbage doesn't pollute anything
//      downstream (validation, virtual-root detection, filename-fallback).
//      [K.1 / option β per Gate 1 reply]
//   3. checkAggregateLimits — entry count + total uncompressed (BEFORE any
//      per-entry decompression so a bomb is rejected without allocation).
//   4. Per-entry: isSafeZipEntryName + checkEntrySize. Path validation runs
//      on the RAW entry name; wrapping prefixes are safe paths.
//   5. Resolve virtual root — if the zip wraps everything under a single
//      directory (≤3 levels deep), that directory becomes the prefix all
//      subsequent path resolution operates against. [K.1]
//   6. Skill detection (`${virtualRoot}SKILL.md` with YAML 'name:' frontmatter).
//   7. Manifest detection + parse (yaml@2.9.0, minimum-subset strictness;
//      K.1: chapter entries require file: or slug:, not both).
//   8. Chapter resolution (paths prefixed with virtualRoot):
//        - manifest present  → manifest.chapters[]; resolve file via
//                              explicit `file:` first, then `chapters/{slug}.md`.
//        - manifest absent   → deriveChaptersFromFilenames over entries
//                              under virtualRoot (filename sort).
//   9. Per-chapter content read + non-empty check.
//  10. Merge metadata: manifest first, form fallback, then required-field check.
//  11. Hash drafts via normalizedChapterHash (matches getVersionContent's
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
  SlugDerivationMode,
  ZipUploadErrorCode,
} from "./zip-upload.types";

const SLUG_REGEX = /^[a-z0-9-]+$/;
const SLUG_MAX = 128;

// Phase 6 Stream K.1 (D17.2) — virtual-root descent cap. 0,1,2,3 levels of
// wrapping accepted; a 4th descent throws WRAPPING_TOO_DEEP. The cap is
// large enough for legitimate `outer/inner/book/` style hand-organized
// projects and small enough that a malicious deeply-nested zip can't waste
// our parser cycles.
const MAX_WRAPPING_DEPTH = 3 as const;

/** Phase 6 Stream K.1 — thrown by resolveVirtualRoot when wrapping nests past
 *  MAX_WRAPPING_DEPTH. Caught at the processZipUpload boundary and translated
 *  to a tagged ZipUploadResult rejection with code WRAPPING_TOO_DEEP. */
class VirtualRootTooDeepError extends Error {
  constructor(depth: number) {
    super(`Zip wrapping exceeds ${depth} levels of single-directory nesting`);
    this.name = "VirtualRootTooDeepError";
  }
}

/** Detect Anthropic skill packaging — SKILL.md at the virtual root with
 *  `name:` in YAML frontmatter. Per AD2 / D-K4: skills are a separate content
 *  class, so we hard-reject with a redirect message rather than silently
 *  storing them as a book. K.1 prefixes the path with virtualRoot so a skill
 *  bundled inside a wrapping directory is still detected. */
function isSkillPackage(zip: AdmZip, virtualRoot: string): boolean {
  const target = `${virtualRoot}SKILL.md`;
  const entry = zip.getEntries().find((e) => e.entryName === target);
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

/** Phase 6 Stream K.1 (D17.2) — try to descend exactly one level from `prefix`.
 *  Returns the new prefix (with trailing "/") if the current level has exactly
 *  one directory and no files, AND that directory contains either manifest.yaml
 *  at its root or ≥1 .md/.markdown at any depth. Returns null otherwise
 *  (wrapping invariant broken — a sibling file or sibling directory exists, or
 *  the candidate directory doesn't look like a book). */
function tryDescendOne(
  entries: ReadonlyArray<{ entryName: string }>,
  prefix: string,
): string | null {
  const tops = new Set<string>();
  let hasRootFile = false;

  for (const e of entries) {
    if (!e.entryName.startsWith(prefix)) continue;
    const rest = e.entryName.slice(prefix.length);
    if (rest.length === 0) continue;
    const slashIdx = rest.indexOf("/");
    if (slashIdx < 0) {
      // file directly at this level — sibling to any candidate dir → not wrapping
      hasRootFile = true;
      tops.add(rest);
    } else {
      tops.add(rest.slice(0, slashIdx));
    }
  }

  if (hasRootFile) return null;
  if (tops.size !== 1) return null;

  const [dirName] = [...tops];
  const nextPrefix = `${prefix}${dirName}/`;
  const hasManifest = entries.some((e) => e.entryName === `${nextPrefix}manifest.yaml`);
  const hasMd = entries.some(
    (e) => e.entryName.startsWith(nextPrefix) && /\.(md|markdown)$/i.test(e.entryName),
  );
  if (!hasManifest && !hasMd) return null;
  return nextPrefix;
}

/** Resolve the virtual root prefix for a zip. Returns "" for a flat zip;
 *  returns the deepest stable single-directory prefix otherwise (e.g.
 *  "nqa1-agent-qa-manual/"). Throws VirtualRootTooDeepError if descent would
 *  continue past MAX_WRAPPING_DEPTH. */
function resolveVirtualRoot(entries: ReadonlyArray<{ entryName: string }>): string {
  let prefix = "";
  for (let descended = 0; descended < MAX_WRAPPING_DEPTH; descended++) {
    const next = tryDescendOne(entries, prefix);
    if (next === null) return prefix;
    prefix = next;
  }
  // We descended MAX_WRAPPING_DEPTH times. If one more descent is still
  // possible, the zip is wrapped too deeply.
  if (tryDescendOne(entries, prefix) !== null) {
    throw new VirtualRootTooDeepError(MAX_WRAPPING_DEPTH);
  }
  return prefix;
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

  // ─── 2. Enumerate entries + strip __MACOSX/ ─────────────────────────────
  // K.1 (option β per Gate 1 reply): macOS Finder zips carry __MACOSX/
  // resource-fork siblings; resource-fork files can have .md extensions and
  // would otherwise leak into filename-fallback (or skew virtual-root
  // detection's top-level uniqueness check). Strip them at the very top —
  // silent normalization, no audit-row signal needed.
  const allEntries = zip
    .getEntries()
    .filter((e) => !e.isDirectory)
    .filter((e) => !e.entryName.startsWith("__MACOSX/"));

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

  // ─── 5. Resolve virtual root (K.1 / D17.2) ──────────────────────────────
  // Flat zips return "" → behavior identical to Stream K. Wrapped zips return
  // a prefix with trailing "/"; all subsequent path resolution operates
  // relative to this prefix.
  let virtualRoot: string;
  try {
    virtualRoot = resolveVirtualRoot(allEntries);
  } catch (err) {
    if (err instanceof VirtualRootTooDeepError) {
      return {
        kind: "rejected",
        status: 400,
        code: "WRAPPING_TOO_DEEP",
        error: err.message,
      };
    }
    throw err;
  }

  // ─── 6. Skill detection (at virtual root) ───────────────────────────────
  if (isSkillPackage(zip, virtualRoot)) {
    return {
      kind: "rejected",
      status: 400,
      code: "SKILL_DETECTED",
      error:
        "This looks like an Anthropic skill, not a book. Skills are a separate content class — see Stream L (not yet shipped).",
    };
  }

  // ─── 7. Manifest parse (optional, at virtual root) ──────────────────────
  const manifestEntry = allEntries.find((e) => e.entryName === `${virtualRoot}manifest.yaml`);
  let manifest: ManifestParsed | null = null;
  if (manifestEntry) {
    const yamlText = zip.readAsText(manifestEntry, "utf8");
    const parsed = parseManifest(yamlText);
    if ("code" in parsed) {
      // K.1 hybrid error-code propagation: new granular codes propagate as
      // themselves; existing parser codes collapse to MANIFEST_INVALID to
      // preserve the Stream K test "rejects manifest with empty chapters[]
      // list (MANIFEST_INVALID via INVALID_CHAPTERS_SHAPE)" exactly.
      // Follow-up #120 tracks the long-term granularity ratchet.
      const responseCode: ZipUploadErrorCode =
        parsed.code === "CHAPTER_MISSING_FILE_AND_SLUG" ||
        parsed.code === "DUPLICATE_SLUG_AFTER_DERIVATION"
          ? parsed.code
          : "MANIFEST_INVALID";
      return {
        kind: "rejected",
        status: 400,
        code: responseCode,
        error: parsed.message,
      };
    }
    manifest = parsed;
  }

  // ─── 7. Chapter resolution ──────────────────────────────────────────────
  const drafts: ChapterDraft[] = [];

  if (manifest) {
    // Manifest-declared chapters: resolve each entry to a file in the zip.
    // K.1 — every lookup path is prefixed with virtualRoot. For flat zips
    // that's the empty string and behavior is identical to Stream K.
    for (let i = 0; i < manifest.chapters.length; i++) {
      const decl = manifest.chapters[i];
      const candidates: string[] = [];
      if (decl.file) {
        candidates.push(`${virtualRoot}${normalizeManifestFilePath(decl.file)}`);
      }
      candidates.push(`${virtualRoot}chapters/${decl.slug}.md`);

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
    // No manifest: filename-sort fallback. K.1 — restrict to entries under
    // the virtual root so junk outside the wrap (impossible after the
    // __MACOSX strip, but defense-in-depth) can't pollute the chapter list.
    const stubs = deriveChaptersFromFilenames(
      allEntries
        .filter((e) => e.entryName.startsWith(virtualRoot))
        .map((e) => ({ name: e.entryName })),
    );
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

  // K.1 (D17.2) — slug_derivation aggregate for the audit row. Filename-
  // fallback is its own mode; otherwise the parser already computed the
  // aggregate across manifest chapters (explicit / file_only / slug_only /
  // mixed).
  const slugDerivation: SlugDerivationMode = manifest
    ? manifest.slugDerivationMode
    : "filename_fallback";

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
    virtualRoot: virtualRoot.length === 0 ? null : virtualRoot,
    slugDerivation,
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
