// bkstr redesign PR 4 — collapsible file list for skill cards.
//
// Server-rendered <details> — no client JS for the disclosure (matches
// the pattern used on /dashboard/library's API-access expander). Used by
// both /skills (per-card) and /skills/[slug] (full-bleed).
//
// File-extension labels replace the reference's emoji indicators
// (📄 / {} / py / •) per HANDOFF.md "no emoji in product copy" rule —
// short uppercase mono labels keep the editorial typography intact.

import { Eyebrow } from "@/components/design";

const EXTENSION_LABEL: Record<string, string> = {
  ".md": "MD",
  ".py": "PY",
  ".sh": "SH",
  ".json": "JSON",
  ".yaml": "YAML",
  ".yml": "YAML",
};

function extLabel(extension: string): string {
  return EXTENSION_LABEL[extension.toLowerCase()] ?? extension.replace(".", "").toUpperCase().slice(0, 4);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function SkillFilesDetails({
  files,
  defaultOpen = false,
}: {
  files: { path: string; extension: string; byteSize: number }[];
  /** Render the disclosure pre-expanded — used on the detail page where
   *  the file list is the centerpiece. The card listing keeps it closed
   *  so the grid stays compact. */
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen || undefined}
      className="font-mono text-[11px] group"
    >
      <summary className="cursor-pointer text-ink-3 hover:text-ink uppercase tracking-eyebrow text-[11px] list-none flex items-center gap-2">
        <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
          ▸
        </span>
        {files.length} {files.length === 1 ? "file" : "files"} in archive
      </summary>
      <div className="mt-3 bg-ink p-3.5 border border-rule">
        <Eyebrow className="text-paper-3 mb-2 block">ARCHIVE CONTENTS</Eyebrow>
        <ul className="space-y-1">
          {files.map((f) => (
            <li
              key={f.path}
              className="grid grid-cols-[2.5rem_1fr_auto] gap-3 items-baseline text-paper-3"
            >
              <span className="text-paper-3/60 text-[10px] uppercase tracking-wider">
                {extLabel(f.extension)}
              </span>
              <span className="truncate">{f.path}</span>
              <span className="text-paper-3/60 text-[10px] tabular-nums">
                {formatBytes(f.byteSize)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
