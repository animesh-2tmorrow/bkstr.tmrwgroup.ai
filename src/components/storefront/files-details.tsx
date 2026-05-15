// redesign(10) Phase 2 — shared file-manifest disclosure.
//
// Promoted from src/components/skills/skill-files-details.tsx (PR 4). The
// original stays in place during Phase 2 — /skills/[slug] still serves the
// old detail page; Phase 3 migrates that route to a redirect and deletes
// the old component.
//
// The skill-side version was already kind-agnostic (takes path + extension
// + byteSize per file) — this promotion just renames + adds an optional
// `title` prop so book chapter manifests can override the "ARCHIVE
// CONTENTS" eyebrow label (e.g. "BOOK CHAPTERS").
//
// Server-rendered <details> — no client JS for the disclosure (matches
// the pattern used on /dashboard/library's API-access expander). File
// contents are NEVER rendered here — paths + sizes only. The actual
// content lands via /api/{books|skills}/<slug>/files (auth-gated).

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
  return (
    EXTENSION_LABEL[extension.toLowerCase()] ??
    extension.replace(".", "").toUpperCase().slice(0, 4)
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function FilesDetails({
  files,
  title = "ARCHIVE CONTENTS",
  defaultOpen = false,
}: {
  files: { path: string; extension: string; byteSize: number }[];
  /** Eyebrow label inside the disclosure. Books pass "BOOK CHAPTERS"; skills
   *  let it default to "ARCHIVE CONTENTS" for parity with the prior
   *  skill-files-details surface. */
  title?: string;
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
        <Eyebrow className="text-paper-3 mb-2 block">{title}</Eyebrow>
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
