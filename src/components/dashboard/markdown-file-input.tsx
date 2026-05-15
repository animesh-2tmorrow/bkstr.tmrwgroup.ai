"use client";

import { useRef, useState } from "react";

// Phase 5 Stream I (D15.13) — client component: choose a .md file on the
// new-book form's Content field as an alternative to pasting markdown.
//
// Behaviour mirrors the Cover Image / Zip inputs on the same form:
//   - Hidden <input type="file"> triggered by clicking a dashed-border zone.
//   - Click-only, NO drag-and-drop — kept symmetric across all file inputs
//     on the form. If drag-drop is ever wanted it goes on ALL inputs in a
//     separate stream; we do not introduce asymmetry where one file input
//     has it and the others don't.
//   - The file is read entirely in the browser via FileReader.readAsText; the
//     decoded text is handed to the parent via onContentLoaded, which sets the
//     Content textarea value. There is NO server endpoint and NO multipart
//     upload — file pick is UI sugar over the textarea, nothing more. The
//     existing POST /api/books/new handler and its server-side validation
//     (1M-char content cap, slug uniqueness, Stripe-first atomicity) run
//     unchanged after submit, whether the content was pasted or file-loaded.
//
// bkstr redesign PR 6 — restyled with design tokens. The 📄 emoji is
// replaced with a mono "MD" label per HANDOFF.md ("no emoji in product copy").

const ALLOWED_EXTENSIONS = [".md", ".markdown"];
const MAX_CONTENT_CHARS = 1_000_000; // same cap the Content field enforces; server re-checks on submit

function hasAllowedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

interface MarkdownFileInputProps {
  onContentLoaded: (content: string, filename: string) => void;
  currentFilename?: string;
  onClear: () => void;
  disabled?: boolean;
}

export function MarkdownFileInput({
  onContentLoaded,
  currentFilename,
  onClear,
  disabled = false,
}: MarkdownFileInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [sizeLabel, setSizeLabel] = useState<string | null>(null);

  function handleFile(file: File) {
    setError(null);

    // Extension is the PRIMARY (and only hard) gate. We deliberately do NOT
    // gate on MIME type: Windows — and other OSes — frequently report no MIME
    // type for .md files (and sometimes report application/octet-stream), so a
    // hard MIME check would reject perfectly valid markdown uploads. The
    // file.type, when present, is at most informational. .txt is rejected here
    // because a publisher would just paste a .txt rather than upload it.
    if (!hasAllowedExtension(file.name)) {
      setError("Wrong file type — choose a .md or .markdown file.");
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => {
      setError("Could not read that file — try again, or paste the content below.");
    };
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      if (text.length > MAX_CONTENT_CHARS) {
        setError(
          `File too large (${text.length.toLocaleString()} chars — limit is ${MAX_CONTENT_CHARS.toLocaleString()} characters).`,
        );
        return;
      }
      setSizeLabel(`${(file.size / 1024).toFixed(0)} KB`);
      onContentLoaded(text, file.name);
    };
    reader.readAsText(file, "utf-8");
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function clearSelection() {
    setError(null);
    setSizeLabel(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    onClear();
  }

  return (
    <div>
      <label className="block font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 mb-1.5">
        Upload a markdown file <span className="text-ink-4 normal-case tracking-normal">(optional)</span>
      </label>

      {currentFilename ? (
        <div className="flex items-start gap-4 p-4 bg-paper border border-rule">
          <span className="font-mono text-[10px] tracking-wider text-ink-3 bg-paper-2 border border-rule px-2 py-1 shrink-0">MD</span>
          <div className="flex flex-col gap-2 pt-0.5">
            <p className="font-serif text-ink text-sm">{currentFilename}</p>
            {sizeLabel && <p className="font-mono text-[11px] text-ink-3">{sizeLabel}</p>}
            <button
              type="button"
              onClick={clearSelection}
              disabled={disabled}
              className="text-xs text-status-err hover:text-ink font-mono uppercase tracking-eyebrow text-left"
            >
              Clear file
            </button>
          </div>
        </div>
      ) : (
        <div
          onClick={() => !disabled && fileInputRef.current?.click()}
          className="border-2 border-dashed border-rule p-6 text-center cursor-pointer hover:border-ink hover:bg-paper-2 transition-colors bg-paper"
        >
          <span className="inline-block font-mono text-[10px] tracking-wider text-ink-3 bg-paper-2 border border-rule px-2 py-1 mb-3">MD</span>
          <p className="font-serif text-ink text-sm">Click to choose a .md file</p>
          <p className="font-mono text-[11px] text-ink-3 mt-1">
            .md or .markdown — fills the Content field below; you can edit it after
          </p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown"
        onChange={onInputChange}
        className="hidden"
        disabled={disabled}
      />

      {error && <p className="text-xs text-status-err font-mono mt-1">{error}</p>}
    </div>
  );
}
