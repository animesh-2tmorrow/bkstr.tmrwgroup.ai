// Phase 6 Stream K (D17.1) — shared types for the zip-upload pipeline.
// Kept in a separate file so the main logic file (zip-upload.ts) stays focused
// on the pipeline and the route handler (zip-handler.ts) can import the result
// shape without pulling in the pipeline's adm-zip / yaml deps for type-only use.

/**
 * Form fields accompanying a zip upload (multipart `request.formData()`).
 * All optional in zip mode per the locked Gate-2 decision (option (b)) — the
 * manifest may supply title/slug/domain/description, and the server falls back
 * to form fields per D-K3 ("manifest first, form fallback"). Price is form-
 * only by D-K3 and only required on the new-book branch.
 */
export type ZipUploadFields = {
  title?: string;
  slug?: string;
  domain?: string;
  description?: string;
  priceUsdCents?: number;
};

/**
 * Draft for one BookChapter row, ready to be written inside the transaction.
 * Mirrors the BookChapter Prisma model (D16.1) but lives in app-space until
 * the row is created.
 */
export type ChapterDraft = {
  order: number;
  slug: string;
  title: string | null;
  content: string;
  tokenEstimate: number | null;
  metadata: Record<string, unknown>;
};

/**
 * Parsed manifest.yaml shape (minimum-subset strictness per OQ-2). Only
 * `chapters` is required by the parser; everything else is optional and falls
 * back to form fields or sensible defaults at the route boundary.
 */
export type ManifestParsed = {
  chapters: ManifestChapterDecl[];
  title?: string;
  slug?: string;
  domain?: string;
  description?: string;
  audience?: string;
  tokenEstimate?: number;
  conventions?: Record<string, unknown>;
  version?: string | number;
  // Phase 6 Stream K.1 (D17.2) — aggregate slug-derivation mode across all
  // chapters. Computed by the parser from each chapter's source (explicit
  // file+slug, file-only, or slug-only). Surfaced in the audit row's
  // after_state.slug_derivation for observability. 'mixed' fires when chapters
  // within one manifest use different sources (permitted; observability, not
  // enforcement).
  slugDerivationMode: Exclude<SlugDerivationMode, "filename_fallback">;
  // The raw parsed JSON, preserved so it can be written to BookVersion.manifest
  // verbatim. Future readers (Stream M onward) decide what surfaces.
  raw: Record<string, unknown>;
};

/**
 * Phase 6 Stream K.1 (D17.2) — how the per-chapter slugs were chosen for a
 * given upload. Written to admin_actions.after_state.slug_derivation.
 */
export type SlugDerivationMode =
  | "manifest_explicit"            // every chapter had both file: and slug:
  | "manifest_derived_from_file"   // every chapter had file: only; slug = basename
  | "manifest_derived_from_slug"   // every chapter had slug: only; file = chapters/{slug}.md
  | "mixed"                        // chapters used a mix of the above
  | "filename_fallback";           // no manifest in the upload

export type ManifestChapterDecl = {
  slug: string;
  file?: string;
  title?: string;
  tokenEstimate?: number;
  audience?: string;
  accessPattern?: string;
  // Anything else the publisher put on the chapter entry — kept around for
  // BookChapter.metadata.
  extras: Record<string, unknown>;
};

export type ManifestParseError = {
  code:
    | "YAML_PARSE_ERROR"
    | "MISSING_CHAPTERS"
    | "INVALID_CHAPTERS_SHAPE"
    // Phase 6 Stream K.1 (D17.2) — chapter entry must specify file: or slug:
    // (or both); missing both is a hard reject. Replaces the Stream K
    // "missing slug" branch (which previously returned INVALID_CHAPTERS_SHAPE).
    | "CHAPTER_MISSING_FILE_AND_SLUG"
    // Phase 6 Stream K.1 (D17.2) — derived slugs (from file basenames) can
    // collide across chapters; check after derivation, name both offenders.
    | "DUPLICATE_SLUG_AFTER_DERIVATION";
  message: string;
};

/**
 * Discriminated outcome of `processZipUpload` (D17.1, T3 — tagged union for
 * expected business outcomes; exceptions only for unexpected failures). The
 * route handler maps each kind to an HTTP response.
 */
export type ZipUploadResult =
  | {
      kind: "success";
      /** Pre-allocated UUID for the new BookVersion row (D11.8 pattern). */
      bookVersionId: string;
      /** Pre-allocated UUID for a Book row IFF the slug doesn't exist; the
       *  route's authoritative inside-tx resolution may discard this. */
      bookIdIfNew: string;
      slug: string;
      title: string;
      description: string | null;
      domain: string;
      chapters: ChapterDraft[];
      totalBytes: number;
      /** Whether the upload carried a manifest.yaml (informational, surfaced
       *  in the audit row). */
      manifestPresent: boolean;
      /** Verbatim parsed manifest, or {} if none. Written to BookVersion.manifest. */
      manifestJson: Record<string, unknown>;
      /** sha256 hex of `chapters.sortByOrder.map(c.content).join("\n\n")` —
       *  matches `getVersionContent`'s output for chapterized versions, so
       *  the same comparator works for both legacy-blob and chapterized
       *  existing-version idempotency checks. */
      draftHash: string;
      /** Phase 6 Stream K.1 (D17.2) — wrapping prefix used during path
       *  resolution (e.g. "nqa1-agent-qa-manual/"); null for flat zips.
       *  Surfaced in audit row's after_state.virtual_root. */
      virtualRoot: string | null;
      /** Phase 6 Stream K.1 (D17.2) — how chapter slugs were chosen for this
       *  upload. Surfaced in audit row's after_state.slug_derivation. */
      slugDerivation: SlugDerivationMode;
    }
  | { kind: "rejected"; status: number; code: ZipUploadErrorCode; error: string };

export type ZipUploadErrorCode =
  | "ZIP_TOO_LARGE"
  | "ZIP_PARSE_ERROR"
  | "TOO_MANY_ENTRIES"
  | "TOO_LARGE_UNCOMPRESSED"
  | "ENTRY_TOO_LARGE"
  | "UNSAFE_ENTRY_PATH"
  | "SKILL_DETECTED"
  | "MANIFEST_INVALID"
  | "CHAPTER_FILE_MISSING"
  | "CHAPTER_EMPTY"
  | "NO_CHAPTERS_FOUND"
  | "MISSING_REQUIRED_FIELD"
  // Phase 6 Stream K.1 (D17.2) — added codes.
  // WRAPPING_TOO_DEEP fires when the zip nests a single directory >3 levels
  // (zip-validate domain). CHAPTER_MISSING_FILE_AND_SLUG +
  // DUPLICATE_SLUG_AFTER_DERIVATION propagate from the manifest-parser as
  // themselves (granular codes, not collapsed to MANIFEST_INVALID); the
  // existing parser codes still collapse for regression-zero on Stream K
  // tests — see follow-up #120 for the long-term granularity ratchet.
  | "WRAPPING_TOO_DEEP"
  | "CHAPTER_MISSING_FILE_AND_SLUG"
  | "DUPLICATE_SLUG_AFTER_DERIVATION";
