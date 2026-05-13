// Phase 6 Stream L (D18.1) — single read path for a SkillVersion's content,
// canonicalized for idempotency hashing.
//
// Mirrors books/content.ts's getVersionContent in role: produces the
// deterministic string a SkillVersion's hash is computed over. The hash
// itself is stored in `skill_versions.normalized_hash` and compared at
// upload time to short-circuit identical re-uploads.
//
// Path is included in the canonical form (unlike books, which join chapter
// contents alone) so renaming a file IS a content change in skill semantics
// — a `helper.py` moved to `lib/helper.py` should produce a different hash.
// Wrapping-directory-independent because `path` is stored relative to the
// virtual root (D18.1 §0 lock).

export function getVersionFilesConcat(
  files: ReadonlyArray<{ path: string; content: string; order: number }>,
): string {
  return files
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((f) => `${f.path}\n${f.content}`)
    .join("\n\n");
}
