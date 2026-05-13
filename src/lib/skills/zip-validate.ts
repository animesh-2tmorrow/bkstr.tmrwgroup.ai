// Phase 6 Stream L (D18.1) — skill-specific validation constants.
//
// The four shared zip caps (MAX_ZIP_BYTES, MAX_ENTRIES, MAX_PER_ENTRY_BYTES,
// MAX_TOTAL_UNCOMPRESSED_BYTES) live in @/lib/zip/limits per #116. This module
// adds the skill-only caps + extension allowlist.

/** Maximum files in a single skill upload. Cap is much smaller than books'
 *  MAX_ENTRIES=500 because skills are small bundles by design (Zach's
 *  files.zip is 7 files). Revisit after first 5 real skills uploaded. */
export const MAX_FILES_PER_SKILL = 50;

/** Allowed file extensions inside a skill zip. Configurable allowlist;
 *  rejects executables, binaries, archives. Lowercased; matched
 *  case-insensitively. */
export const SKILL_EXTENSION_ALLOWLIST = [".md", ".py", ".sh", ".json", ".yaml"] as const;

export type SkillFileExtension = (typeof SKILL_EXTENSION_ALLOWLIST)[number];

/** Lowercased extension WITH leading dot, or empty string if none. */
export function getExtension(path: string): string {
  const lastDot = path.lastIndexOf(".");
  const lastSep = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (lastDot < 0 || lastDot < lastSep) return "";
  return path.slice(lastDot).toLowerCase();
}

export function isAllowedExtension(path: string): boolean {
  const ext = getExtension(path);
  return (SKILL_EXTENSION_ALLOWLIST as readonly string[]).includes(ext);
}
