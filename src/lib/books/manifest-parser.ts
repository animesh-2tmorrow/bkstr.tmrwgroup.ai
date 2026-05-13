// Phase 6 Stream K (D17.1) — pure manifest.yaml parser.
// Phase 6 Stream K.1 (D17.2) — chapter entry validation relaxed: require at
// least one of file: or slug: per chapter. Slug derivation:
//   - both file: and slug: present  → use both verbatim  (mode: "explicit")
//   - only file:                    → slug = basename without extension,
//                                     NO OQ-1 prefix stripping
//                                     (mode: "file_only")
//   - only slug:                    → file derived at the resolution layer
//                                     as `chapters/{slug}.md`
//                                     (mode: "slug_only")
//   - neither                       → reject (CHAPTER_MISSING_FILE_AND_SLUG)
// After per-chapter derivation, duplicate slugs (e.g. two chapters with
// file: "ch00.md" and file: "subdir/ch00.md" both deriving "ch00") are
// rejected pre-emptively as DUPLICATE_SLUG_AFTER_DERIVATION.
//
// The aggregate slugDerivationMode is "manifest_explicit" / "...derived_from_file"
// / "...derived_from_slug" if all chapters share the same source mode, else
// "mixed" (D-K.1.5 permits mixing; observability, not enforcement).
//
// Minimum-subset strictness per OQ-2 remains: require valid YAML + a non-empty
// ordered `chapters` list. Everything else (title/slug/domain/description/
// audience/tokenEstimate/conventions/version) is optional with form fallback
// at the route boundary (D-K3). Strictness can ratchet up as authoring
// tooling settles (follow-ups #111 / #120 / #121).

import { parse as parseYaml } from "yaml";
import type {
  ManifestParsed,
  ManifestParseError,
  ManifestChapterDecl,
} from "./zip-upload.types";

const KNOWN_CHAPTER_KEYS = new Set([
  "slug",
  "file",
  "title",
  "tokenEstimate",
  "token_estimate",
  "audience",
  "accessPattern",
  "access_pattern",
]);

type ChapterSourceMode = "explicit" | "file_only" | "slug_only";

/** Derive a slug from a manifest `file:` path. Returns the file's basename
 *  minus the .md/.markdown extension. NO OQ-1 prefix stripping — manifest
 *  authors want filename fidelity (the leading "ch00-" often encodes ordering
 *  and is intentional). Per D-K.1's filename-fallback-mode vs manifest-mode
 *  split. */
function slugFromFilePath(filePath: string): string {
  const lastSep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const basename = lastSep >= 0 ? filePath.slice(lastSep + 1) : filePath;
  return basename.replace(/\.(md|markdown)$/i, "");
}

export function parseManifest(yamlText: string): ManifestParsed | ManifestParseError {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (err) {
    return {
      code: "YAML_PARSE_ERROR",
      message: err instanceof Error ? `Invalid YAML: ${err.message}` : "Invalid YAML",
    };
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      code: "YAML_PARSE_ERROR",
      message: "Manifest must be a YAML mapping (object) at the top level",
    };
  }
  const obj = raw as Record<string, unknown>;

  if (!("chapters" in obj)) {
    return { code: "MISSING_CHAPTERS", message: "manifest.yaml is missing required 'chapters' key" };
  }
  const chaptersRaw = obj.chapters;
  if (!Array.isArray(chaptersRaw) || chaptersRaw.length === 0) {
    return {
      code: "INVALID_CHAPTERS_SHAPE",
      message: "manifest.chapters must be a non-empty list",
    };
  }

  const chapters: ManifestChapterDecl[] = [];
  const perChapterMode: ChapterSourceMode[] = [];
  for (let i = 0; i < chaptersRaw.length; i++) {
    const entry = chaptersRaw[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return {
        code: "INVALID_CHAPTERS_SHAPE",
        message: `manifest.chapters[${i}] must be a mapping with at least 'file' or 'slug'`,
      };
    }
    const e = entry as Record<string, unknown>;
    const hasSlug = typeof e.slug === "string" && (e.slug as string).length > 0;
    const hasFile = typeof e.file === "string" && (e.file as string).length > 0;

    // D-K.1.5 — at least one of file: or slug: must be present.
    if (!hasSlug && !hasFile) {
      return {
        code: "CHAPTER_MISSING_FILE_AND_SLUG",
        message: `manifest.chapters[${i}] must specify at least one of 'file' or 'slug'`,
      };
    }

    let derivedSlug: string;
    let mode: ChapterSourceMode;
    if (hasSlug && hasFile) {
      derivedSlug = e.slug as string;
      mode = "explicit";
    } else if (hasFile) {
      derivedSlug = slugFromFilePath(e.file as string);
      mode = "file_only";
    } else {
      derivedSlug = e.slug as string;
      mode = "slug_only";
    }
    if (derivedSlug.length === 0) {
      // Defensive: a file: like "chapters/.md" or "/" could derive an empty
      // basename. Reject rather than write an empty slug into book_chapters.
      return {
        code: "INVALID_CHAPTERS_SHAPE",
        message: `manifest.chapters[${i}] derived an empty slug from '${(e.file as string) ?? (e.slug as string)}'`,
      };
    }
    perChapterMode.push(mode);

    const extras: Record<string, unknown> = {};
    for (const k of Object.keys(e)) {
      if (!KNOWN_CHAPTER_KEYS.has(k)) extras[k] = e[k];
    }
    chapters.push({
      slug: derivedSlug,
      file: hasFile ? (e.file as string) : undefined,
      title: typeof e.title === "string" ? e.title : undefined,
      tokenEstimate:
        typeof e.tokenEstimate === "number"
          ? e.tokenEstimate
          : typeof e.token_estimate === "number"
            ? (e.token_estimate as number)
            : undefined,
      audience: typeof e.audience === "string" ? e.audience : undefined,
      accessPattern:
        typeof e.accessPattern === "string"
          ? e.accessPattern
          : typeof e.access_pattern === "string"
            ? (e.access_pattern as string)
            : undefined,
      extras,
    });
  }

  // D-K.1.6 — pre-emptive duplicate-slug check on derived slugs. Belt-and-
  // suspenders: zip-upload.ts:222–233 also catches dups post-drafts, but
  // catching here gives a more specific error message (names both offenders).
  const seen = new Map<string, number>();
  for (let i = 0; i < chapters.length; i++) {
    const prev = seen.get(chapters[i].slug);
    if (prev !== undefined) {
      return {
        code: "DUPLICATE_SLUG_AFTER_DERIVATION",
        message: `manifest.chapters[${prev}] and chapters[${i}] both resolve to slug '${chapters[i].slug}' after derivation — chapter slugs must be unique within a version`,
      };
    }
    seen.set(chapters[i].slug, i);
  }

  // Aggregate slug-derivation mode per D-K.1.9 / D17.2. 'mixed' fires when
  // chapters use different sources within the same manifest (permitted —
  // observability, not enforcement).
  const distinct = new Set(perChapterMode);
  const slugDerivationMode: ManifestParsed["slugDerivationMode"] =
    distinct.size > 1
      ? "mixed"
      : perChapterMode[0] === "explicit"
        ? "manifest_explicit"
        : perChapterMode[0] === "file_only"
          ? "manifest_derived_from_file"
          : "manifest_derived_from_slug";

  return {
    chapters,
    slugDerivationMode,
    title: typeof obj.title === "string" ? obj.title : undefined,
    slug: typeof obj.slug === "string" ? obj.slug : undefined,
    domain: typeof obj.domain === "string" ? obj.domain : undefined,
    description: typeof obj.description === "string" ? obj.description : undefined,
    audience: typeof obj.audience === "string" ? obj.audience : undefined,
    tokenEstimate:
      typeof obj.tokenEstimate === "number"
        ? obj.tokenEstimate
        : typeof obj.token_estimate === "number"
          ? (obj.token_estimate as number)
          : undefined,
    conventions:
      obj.conventions && typeof obj.conventions === "object" && !Array.isArray(obj.conventions)
        ? (obj.conventions as Record<string, unknown>)
        : undefined,
    version:
      typeof obj.version === "string" || typeof obj.version === "number"
        ? (obj.version as string | number)
        : undefined,
    raw: obj,
  };
}
