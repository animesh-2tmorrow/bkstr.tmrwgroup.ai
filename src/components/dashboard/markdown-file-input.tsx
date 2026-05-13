"use client";

import { useRef, useState } from "react";

// Phase 5 Stream I (D15.13) — client component: choose a .md file on the
// new-book form's Content field as an alternative to pasting markdown.
//
// Behaviour mirrors the Cover Image input on the same form (NewBookForm):
//   - Hidden <input type="file"> triggered by clicking a dashed-border zone.
//   - Click-only, NO drag-and-drop — kept symmetric with the cover input on
//     purpose. If drag-drop is ever wanted it goes on BOTH inputs together in
//     a separate stream; we do not introduce asymmetry where one file input
//     has it and the other doesn't.
//   - The file is read entirely in the browser via FileReader.readAsText; the
//     decoded text is handed to the parent via onContentLoaded, which sets the
//     Content textarea value. There is NO server endpoint and NO multipart
//     upload — file pick is UI sugar over the textarea, nothing more. The
//     existing POST /api/books/new handler and its server-side validation
//     (1M-char content cap, slug uniqueness, Stripe-first atomicity) run
//     unchanged after submit, whether the content was pasted or file-loaded.

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
      <label className="block text-sm font-semibold text-gray-700 mb-1">
        Upload a markdown file <span className="font-normal text-gray-500">(optional)</span>
      </label>

      {currentFilename ? (
        <div className="flex items-start gap-4">
          <div className="text-3xl flex-shrink-0">📄</div>
          <div className="flex flex-col gap-2 pt-1">
            <p className="text-sm text-gray-700 font-medium">{currentFilename}</p>
            {sizeLabel && <p className="text-xs text-gray-500">{sizeLabel}</p>}
            <button
              type="button"
              onClick={clearSelection}
              disabled={disabled}
              className="text-xs text-red-600 hover:text-red-800 font-semibold underline text-left"
            >
              Clear file
            </button>
          </div>
        </div>
      ) : (
        <div
          onClick={() => !disabled && fileInputRef.current?.click()}
          className="border-2 border-dashed border-[#E5DCC8] rounded-xl p-6 text-center cursor-pointer hover:border-gray-400 hover:bg-[#F5F0E4] transition-colors"
        >
          <div className="text-3xl mb-2">📄</div>
          <p className="text-sm font-semibold text-gray-700">Click to choose a .md file</p>
          <p className="text-xs text-gray-500 mt-1">
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

      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
