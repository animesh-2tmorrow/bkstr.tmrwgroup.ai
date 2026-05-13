// Phase 6 Stream L (D18.1) — shared virtual-root resolution.
//
// Lifted from src/lib/books/zip-upload.ts where it lived as private helpers
// (`tryDescendOne`, `resolveVirtualRoot`, `VirtualRootTooDeepError`). Now
// exported for both book and skill upload pipelines.
//
// Algorithm (unchanged from K.1): if the zip's root contains exactly one
// directory entry AND that directory contains either manifest.yaml at its
// root OR ≥1 .md/.markdown at any depth, descend; repeat up to
// MAX_WRAPPING_DEPTH levels; throw VirtualRootTooDeepError beyond. Flat zips
// (no single-directory wrap at root) return the empty prefix.
//
// `applyVirtualRoot(prefix, path)` centralizes the prefix-application pattern
// previously written inline as `${virtualRoot}${path}` template strings.
// Skills will use this on the SKILL.md / manifest.yaml / chapter-file lookups
// in Stream L commit 3.

/** Cap on single-directory wrapping descent. 0,1,2,3 levels accepted; a 4th
 *  descent throws VirtualRootTooDeepError. Large enough for legitimate
 *  `outer/inner/book/` style hand-organized projects; small enough that a
 *  malicious deeply-nested zip can't waste parser cycles. */
const MAX_WRAPPING_DEPTH = 3 as const;

/** Thrown by resolveVirtualRoot when wrapping nests past MAX_WRAPPING_DEPTH.
 *  Caught at the processZipUpload boundary in both book and skill pipelines
 *  and translated to a tagged rejection with code WRAPPING_TOO_DEEP. */
export class VirtualRootTooDeepError extends Error {
  constructor(depth: number) {
    super(`Zip wrapping exceeds ${depth} levels of single-directory nesting`);
    this.name = "VirtualRootTooDeepError";
  }
}

/** Try to descend exactly one level from `prefix`. Returns the new prefix
 *  (with trailing "/") if the current level has exactly one directory and no
 *  files, AND that directory contains either manifest.yaml at its root or ≥1
 *  .md/.markdown at any depth. Returns null otherwise (wrapping invariant
 *  broken — sibling file or sibling directory exists, or the candidate
 *  directory doesn't look like a book). */
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
export function resolveVirtualRoot(entries: ReadonlyArray<{ entryName: string }>): string {
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

/** Centralizes prefix application — `applyVirtualRoot("foo/", "SKILL.md")`
 *  returns `"foo/SKILL.md"`; `applyVirtualRoot("", "SKILL.md")` returns
 *  `"SKILL.md"`. The trivial string-concat is wrapped in a named function
 *  so call sites read as path-relative-to-virtual-root operations rather
 *  than implicit template strings. */
export function applyVirtualRoot(prefix: string, path: string): string {
  return `${prefix}${path}`;
}
