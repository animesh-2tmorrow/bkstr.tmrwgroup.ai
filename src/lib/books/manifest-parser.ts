// Phase 6 Stream K (D17.1) — pure manifest.yaml parser.
//
// Minimum-subset strictness per OQ-2 (Gate 2): require valid YAML + a
// non-empty ordered `chapters` list whose entries each have a `slug` (string).
// Everything else (title, slug, domain, description, audience, tokenEstimate,
// conventions, version) is optional with sensible fallbacks resolved at the
// route boundary (manifest first, form fallback per D-K3). Strictness can
// ratchet up as authoring tooling settles (follow-up — see #111 ratchets).
//
// Returns either ManifestParsed or ManifestParseError — exceptions are reserved
// for unexpected failures (a YAML parser bug, an OOM). Expected-business
// outcomes are tagged.

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
  for (let i = 0; i < chaptersRaw.length; i++) {
    const entry = chaptersRaw[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return {
        code: "INVALID_CHAPTERS_SHAPE",
        message: `manifest.chapters[${i}] must be a mapping with at least a 'slug' field`,
      };
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.slug !== "string" || e.slug.length === 0) {
      return {
        code: "INVALID_CHAPTERS_SHAPE",
        message: `manifest.chapters[${i}] is missing a string 'slug'`,
      };
    }
    const extras: Record<string, unknown> = {};
    for (const k of Object.keys(e)) {
      if (!KNOWN_CHAPTER_KEYS.has(k)) extras[k] = e[k];
    }
    chapters.push({
      slug: e.slug,
      file: typeof e.file === "string" ? e.file : undefined,
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

  return {
    chapters,
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
