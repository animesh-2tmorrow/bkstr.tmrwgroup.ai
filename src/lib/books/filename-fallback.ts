// Phase 6 Stream K (D17.1) — pure filename-sort fallback chapter derivation.
//
// Per OQ-1 (d) (Gate 2 approved): when no manifest.yaml is present, walk every
// .md / .markdown entry in the zip, sort lexicographically by full path, and
// produce one ChapterDraft per file with:
//   - order  = index in the sorted list (0-based)
//   - slug   = basename stripped of a leading numeric prefix
//              (/^(?:ch?)?\d+[-_]\s*/i — i.e. optional 'c'/'ch', required
//              digits, required '-' or '_'), then the file extension removed.
//              Acceptance cases at Gate 2: 'ch00-core.md' → 'core',
//              '01_intro.md' → 'intro', 'overview.md' → 'overview'.
//   - title  = null  (first-H1 enrichment deferred — follow-up #112)
//   - content placeholder = ""  (the caller reads the entry content and fills it)
//
// Non-markdown entries (.txt, .yaml, .png, README, etc.) are skipped — they are
// not chapters.

import type { ChapterDraft } from "./zip-upload.types";

const CHAPTER_FILE_RE = /\.(md|markdown)$/i;
const PREFIX_STRIP_RE = /^(?:ch?)?\d+[-_]\s*/i;

/**
 * Returns chapter drafts derived from zip entry names alone. The `content`
 * field is left as the empty string here — the caller reads each entry's
 * content via the zip parser and writes it back. The shape is otherwise
 * complete and the order field is final.
 */
export function deriveChaptersFromFilenames(
  entries: ReadonlyArray<{ name: string }>,
): ChapterDraft[] {
  const markdown = entries.filter((e) => CHAPTER_FILE_RE.test(e.name));
  markdown.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return markdown.map((e, index): ChapterDraft => {
    // basename: last segment after / or \
    const lastSep = Math.max(e.name.lastIndexOf("/"), e.name.lastIndexOf("\\"));
    const base = lastSep >= 0 ? e.name.slice(lastSep + 1) : e.name;
    // strip extension
    const withoutExt = base.replace(CHAPTER_FILE_RE, "");
    // strip prefix per OQ-1 (d)
    const slug = withoutExt.replace(PREFIX_STRIP_RE, "");
    return {
      order: index,
      slug: slug.length > 0 ? slug : withoutExt,
      title: null,
      content: "",
      tokenEstimate: null,
      metadata: { source: "filename-fallback", originalPath: e.name },
    };
  });
}
