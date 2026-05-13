// Phase 6 Stream L (D18.1) — core skill zip-upload processing pipeline.
//
// Pure-ish: takes a Buffer + form fields, returns a tagged ProcessedSkillResult.
// NO DB writes, NO Stripe calls — those live in the route's skill-handler.ts.
//
// Pipeline (route-level MAX_ZIP_BYTES pre-check already done):
//   1. Open the zip via adm-zip (in-memory Buffer).
//   2. Enumerate non-directory entries; strip `__MACOSX/` siblings.
//   3. checkAggregateLimits + per-entry isSafeZipEntryName + checkEntrySize.
//   4. Resolve virtual root (≤3 levels of single-directory wrapping).
//   5. Find SKILL.md at the virtual root. If absent: check whether the zip
//      looks like a book (`manifest.yaml` + `chapters/` shape) → 400
//      BOOK_DETECTED; otherwise → 400 NO_SKILL_MD.
//   6. Strict-UTF-8-decode SKILL.md; parse frontmatter (require `name` +
//      `description`).
//   7. Walk the remaining files under the virtual root:
//        - skip `manifest.yaml` if present at virtual root (per D18.1 §3b —
//          SKILL.md wins, ignore manifest.yaml in ambiguous-zip case)
//        - reject any path outside the extension allowlist
//        - cap total file count at MAX_FILES_PER_SKILL
//        - strict-UTF-8 decode each (reject INVALID_UTF8 on failure)
//   8. Slug derivation: form `slug` wins; otherwise derive from frontmatter
//      `name` (lowercase, non-alphanumeric → `-`, strip leading/trailing `-`).
//   9. Hash via getVersionFilesConcat over sorted file drafts.
//
// Validation errors return a tagged rejection; exceptions are reserved for
// unexpected failures (parser bug, OOM).

import AdmZip from "adm-zip";
import { createHash, randomUUID } from "node:crypto";
import {
  isSafeZipEntryName,
  checkEntrySize,
  checkAggregateLimits,
  ZipValidationError,
} from "@/lib/zip/validate";
import {
  resolveVirtualRoot,
  applyVirtualRoot,
  VirtualRootTooDeepError,
} from "@/lib/zip/virtual-root";
import { isMacOsxEntry } from "@/lib/zip/macosx";
import { decodeStrictUtf8 } from "@/lib/zip/utf8";
import { MAX_FILES_PER_SKILL, getExtension, isAllowedExtension } from "./zip-validate";
import { parseSkillManifest } from "./frontmatter";
import { getVersionFilesConcat } from "./content";
import type {
  SkillZipFields,
  ProcessedSkillResult,
  SkillFileDraft,
  SkillSlugSource,
} from "./zip-upload.types";

const SLUG_REGEX = /^[a-z0-9-]+$/;
const SLUG_MAX = 128;

function deriveSlugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX);
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function decodeOrReject(
  entry: { getData: () => Buffer; entryName: string },
  relPathForError: string,
): string | { code: "INVALID_UTF8"; message: string } {
  try {
    return decodeStrictUtf8(entry.getData());
  } catch {
    return {
      code: "INVALID_UTF8",
      message: `File '${relPathForError}' is not valid UTF-8`,
    };
  }
}

export async function processZipUpload(
  buffer: Buffer,
  formFields: SkillZipFields,
): Promise<ProcessedSkillResult> {
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

  // ─── 2. Enumerate + strip __MACOSX/ ─────────────────────────────────────
  const allEntries = zip
    .getEntries()
    .filter((e) => !e.isDirectory)
    .filter((e) => !isMacOsxEntry(e.entryName));

  // ─── 3. Validate caps + paths ───────────────────────────────────────────
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

  // ─── 4. Resolve virtual root ────────────────────────────────────────────
  let virtualRoot: string;
  try {
    virtualRoot = resolveVirtualRoot(allEntries);
  } catch (err) {
    if (err instanceof VirtualRootTooDeepError) {
      return { kind: "rejected", status: 400, code: "WRAPPING_TOO_DEEP", error: err.message };
    }
    throw err;
  }

  // ─── 5. Find SKILL.md ───────────────────────────────────────────────────
  const skillMdEntryName = applyVirtualRoot(virtualRoot, "SKILL.md");
  const skillMdEntry = allEntries.find((e) => e.entryName === skillMdEntryName);
  if (!skillMdEntry) {
    // BOOK_DETECTED disambiguation: presence of manifest.yaml + chapters/ shape
    // without SKILL.md is the wrong-route signal (D18.1 §3d).
    const manifestEntryName = applyVirtualRoot(virtualRoot, "manifest.yaml");
    const chaptersDirPrefix = applyVirtualRoot(virtualRoot, "chapters/");
    const hasManifest = allEntries.some((e) => e.entryName === manifestEntryName);
    const hasChaptersDir = allEntries.some((e) => e.entryName.startsWith(chaptersDirPrefix));
    if (hasManifest && hasChaptersDir) {
      return {
        kind: "rejected",
        status: 400,
        code: "BOOK_DETECTED",
        error:
          "This looks like a book (manifest.yaml + chapters/) — upload via /api/books/new with Book mode, not /api/skills/new.",
      };
    }
    return {
      kind: "rejected",
      status: 400,
      code: "NO_SKILL_MD",
      error: virtualRoot
        ? `Zip has no SKILL.md at the virtual root '${virtualRoot}'`
        : "Zip has no SKILL.md at the root",
    };
  }

  // ─── 6. Decode + parse SKILL.md frontmatter ─────────────────────────────
  const skillMdDecoded = decodeOrReject(skillMdEntry, "SKILL.md");
  if (typeof skillMdDecoded !== "string") {
    return { kind: "rejected", status: 400, code: skillMdDecoded.code, error: skillMdDecoded.message };
  }
  const manifest = parseSkillManifest(skillMdDecoded);
  if ("code" in manifest) {
    return { kind: "rejected", status: 400, code: manifest.code, error: manifest.message };
  }

  // ─── 7. Walk other files ────────────────────────────────────────────────
  // Only files under the virtual root; skip SKILL.md (already processed) and
  // manifest.yaml if present (D18.1 §3b — SKILL.md wins).
  const manifestEntryName = applyVirtualRoot(virtualRoot, "manifest.yaml");
  const candidateEntries = allEntries.filter(
    (e) =>
      e.entryName.startsWith(virtualRoot) &&
      e.entryName !== skillMdEntryName &&
      e.entryName !== manifestEntryName,
  );

  // Cap total file count (SKILL.md + candidates).
  if (1 + candidateEntries.length > MAX_FILES_PER_SKILL) {
    return {
      kind: "rejected",
      status: 400,
      code: "TOO_MANY_FILES",
      error: `Zip contains too many files (${1 + candidateEntries.length}) — limit is ${MAX_FILES_PER_SKILL}`,
    };
  }

  // Per-entry extension check (reject early to avoid wasted decoding).
  for (const e of candidateEntries) {
    const relPath = e.entryName.slice(virtualRoot.length);
    if (!isAllowedExtension(relPath)) {
      return {
        kind: "rejected",
        status: 400,
        code: "DISALLOWED_EXTENSION",
        error: `File '${relPath}' has a disallowed extension (allowed: .md, .py, .sh, .json, .yaml)`,
      };
    }
  }

  // Sort remaining files alphabetically by relative path; SKILL.md = order 0.
  const sortedCandidates = [...candidateEntries].sort((a, b) =>
    a.entryName < b.entryName ? -1 : a.entryName > b.entryName ? 1 : 0,
  );

  const files: SkillFileDraft[] = [];
  files.push({
    order: 0,
    path: "SKILL.md",
    extension: ".md",
    content: skillMdDecoded,
    byteSize: Buffer.byteLength(skillMdDecoded, "utf8"),
    contentHash: sha256Hex(skillMdDecoded),
  });

  let order = 1;
  for (const e of sortedCandidates) {
    const relPath = e.entryName.slice(virtualRoot.length);
    const decoded = decodeOrReject(e, relPath);
    if (typeof decoded !== "string") {
      return { kind: "rejected", status: 400, code: decoded.code, error: decoded.message };
    }
    files.push({
      order: order++,
      path: relPath,
      extension: getExtension(relPath),
      content: decoded,
      byteSize: Buffer.byteLength(decoded, "utf8"),
      contentHash: sha256Hex(decoded),
    });
  }

  // ─── 8. Slug derivation ─────────────────────────────────────────────────
  let slug: string;
  let slugSource: SkillSlugSource;
  if (formFields.slug) {
    const trimmed = formFields.slug.trim().toLowerCase();
    if (!SLUG_REGEX.test(trimmed) || trimmed.length > SLUG_MAX) {
      return {
        kind: "rejected",
        status: 400,
        code: "MISSING_REQUIRED_FIELD",
        error: `Slug '${trimmed}' must match /^[a-z0-9-]+$/ and be 1..${SLUG_MAX} chars`,
      };
    }
    slug = trimmed;
    slugSource = "form";
  } else {
    slug = deriveSlugFromName(manifest.name);
    if (slug.length === 0) {
      return {
        kind: "rejected",
        status: 400,
        code: "MISSING_REQUIRED_FIELD",
        error: `Could not derive a slug from frontmatter name '${manifest.name}' — provide an explicit slug in the form`,
      };
    }
    slugSource = "frontmatter";
  }

  // ─── 9. Hash + total bytes ──────────────────────────────────────────────
  const totalBytes = files.reduce((acc, f) => acc + f.byteSize, 0);
  const normalizedHash = sha256Hex(getVersionFilesConcat(files));

  return {
    kind: "success",
    skillVersionId: randomUUID(),
    skillIdIfNew: randomUUID(),
    slug,
    name: manifest.name,
    description: manifest.description,
    files,
    totalBytes,
    manifestJson: manifest.raw,
    normalizedHash,
    virtualRoot: virtualRoot.length === 0 ? null : virtualRoot,
    slugSource,
  };
}
