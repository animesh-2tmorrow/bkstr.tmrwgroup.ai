// Phase 6 Stream L (D18.1) — shared types for the skill zip-upload pipeline.
// Mirrors books/zip-upload.types.ts in structure; the differences are:
//   - per-file (not per-chapter) shape
//   - slug source is binary (frontmatter | form), not the books 5-way enum
//   - manifest is REQUIRED (SKILL.md frontmatter) and supplies name + description
//   - extension allowlist is enforced (.md, .py, .sh, .json, .yaml)
//   - UTF-8 decode is STRICT (decodeStrictUtf8 — TextDecoder fatal:true)

/** Form fields accompanying a skill zip upload. In skill mode, title/domain/
 *  description are not collected from the form (manifest's `name` and
 *  `description` are authoritative). Only `slug` (optional) and `priceUsdCents`
 *  (required on new-skill branch) come from the form. */
export type SkillZipFields = {
  slug?: string;
  priceUsdCents?: number;
};

/** Draft for one SkillFile row. Path is relative to the virtual root —
 *  required for idempotency hash to be wrapping-dir-independent. */
export type SkillFileDraft = {
  /** 0-indexed: SKILL.md is order 0; rest alphabetical by `path`. */
  order: number;
  /** Relative to virtual root (e.g. "SKILL.md", "validate_book.py"). */
  path: string;
  /** Lowercased extension WITH leading dot (e.g. ".md", ".py"). */
  extension: string;
  /** Strict-UTF-8-decoded content. */
  content: string;
  byteSize: number;
  /** SHA-256 hex of this file's content. Stored per-file for future
   *  per-file integrity checks; not part of the upload-level hash. */
  contentHash: string;
};

/** Parsed SKILL.md frontmatter. Both required fields (`name`, `description`)
 *  are non-empty strings; raw preserves the full parsed YAML object so future
 *  fields (e.g. `dependencies`, `cover`) can be surfaced without re-parsing. */
export type SkillManifestParsed = {
  name: string;
  description: string;
  raw: Record<string, unknown>;
};

export type SkillManifestParseError = {
  code: "MISSING_FRONTMATTER" | "INVALID_FRONTMATTER" | "YAML_PARSE_ERROR";
  message: string;
};

/** Per the audit row's `slug_source` field. Binary, not the books 5-way
 *  (skills don't mix per-file slug derivation modes). */
export type SkillSlugSource = "frontmatter" | "form";

export type SkillUploadErrorCode =
  // route-level
  | "SKILL_TOO_LARGE"
  | "ZIP_PARSE_ERROR"
  // shared zip-validate.ts errors (propagate verbatim)
  | "TOO_MANY_ENTRIES"
  | "TOO_LARGE_UNCOMPRESSED"
  | "ENTRY_TOO_LARGE"
  | "UNSAFE_ENTRY_PATH"
  | "WRAPPING_TOO_DEEP"
  // skills-specific
  | "NO_SKILL_MD"
  | "MISSING_FRONTMATTER"
  | "INVALID_FRONTMATTER"
  | "YAML_PARSE_ERROR"
  | "DISALLOWED_EXTENSION"
  | "INVALID_UTF8"
  | "BOOK_DETECTED"
  | "TOO_MANY_FILES"
  | "MISSING_REQUIRED_FIELD"
  | "RACE_DETECTED";

/** Discriminated outcome of `processZipUpload` (skills). Pure-ish — no DB
 *  writes, no Stripe calls; route handler maps each kind to an HTTP response. */
export type ProcessedSkillResult =
  | {
      kind: "success";
      /** Pre-allocated UUID for the new SkillVersion row. */
      skillVersionId: string;
      /** Pre-allocated UUID for a Skill row IFF the slug doesn't exist; the
       *  route's authoritative inside-tx resolution may discard this. */
      skillIdIfNew: string;
      slug: string;
      name: string;
      description: string;
      files: SkillFileDraft[];
      totalBytes: number;
      /** Verbatim parsed SKILL.md frontmatter. Written to SkillVersion.manifest. */
      manifestJson: Record<string, unknown>;
      /** SHA-256 hex of `getVersionFilesConcat(files)` — wrapping-dir-
       *  independent (paths are relative to virtual root), suitable for direct
       *  comparison against persisted SkillVersion.normalizedHash. */
      normalizedHash: string;
      /** Wrapping prefix; null for flat zips. */
      virtualRoot: string | null;
      /** Audit-row field: how the slug was chosen. */
      slugSource: SkillSlugSource;
    }
  | { kind: "rejected"; status: number; code: SkillUploadErrorCode; error: string };
