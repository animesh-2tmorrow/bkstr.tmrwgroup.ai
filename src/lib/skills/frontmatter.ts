// Phase 6 Stream L (D18.1) — SKILL.md frontmatter parser.
//
// Skills require a YAML frontmatter block at the top of SKILL.md with at least
// `name` and `description`. The parser mirrors books/manifest-parser.ts in
// shape (returns ManifestParsed | ManifestParseError tagged union) but is
// skill-specific:
//   - SKILL.md must START with "---" (no leading content allowed before the
//     frontmatter fence — Anthropic skill convention).
//   - `name` and `description` are both required, non-empty strings.
//   - Anything else parseable is preserved in `.raw` for future surfacing
//     (e.g. `dependencies`, `cover`) without re-parsing.

import { parse as parseYaml } from "yaml";
import type { SkillManifestParsed, SkillManifestParseError } from "./zip-upload.types";

export function parseSkillManifest(
  skillMdContent: string,
): SkillManifestParsed | SkillManifestParseError {
  if (!skillMdContent.startsWith("---")) {
    return {
      code: "MISSING_FRONTMATTER",
      message: "SKILL.md must begin with a YAML frontmatter block delimited by '---'",
    };
  }
  // Find the closing fence. Accept '---' on its own line; offset 3 to skip the
  // opening fence so we don't match against itself.
  const closeIdx = skillMdContent.indexOf("\n---", 3);
  if (closeIdx < 0) {
    return {
      code: "MISSING_FRONTMATTER",
      message: "SKILL.md frontmatter is not closed (expected closing '---' on its own line)",
    };
  }
  const frontText = skillMdContent.slice(3, closeIdx).trim();

  let raw: unknown;
  try {
    raw = parseYaml(frontText);
  } catch (err) {
    return {
      code: "YAML_PARSE_ERROR",
      message:
        err instanceof Error
          ? `Invalid YAML in SKILL.md frontmatter: ${err.message}`
          : "Invalid YAML in SKILL.md frontmatter",
    };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      code: "INVALID_FRONTMATTER",
      message: "SKILL.md frontmatter must be a YAML mapping (object) at the top level",
    };
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.name !== "string" || obj.name.length === 0) {
    return {
      code: "INVALID_FRONTMATTER",
      message: "SKILL.md frontmatter is missing required field 'name' (must be a non-empty string)",
    };
  }
  if (typeof obj.description !== "string" || obj.description.length === 0) {
    return {
      code: "INVALID_FRONTMATTER",
      message:
        "SKILL.md frontmatter is missing required field 'description' (must be a non-empty string)",
    };
  }
  return {
    name: obj.name,
    description: obj.description,
    raw: obj,
  };
}
