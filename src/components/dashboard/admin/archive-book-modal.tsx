"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Phase 5 Stream E (D15.5 / D12.10) — archive-book modal with typed-slug
// confirmation per the asymmetric-friction precedent at D12.10. Used by
// both publisher (/dashboard/pricing → POSTs to /api/publisher/...) and
// admin (/dashboard/admin/books → POSTs to /api/admin/...). The
// `adminMode` prop flips the URL.
//
// Archive is the destructive action (book disappears from the buyer-
// facing Library; ARCHIVED status). Unarchive is benign (one-click);
// rendered as a separate inline button rather than a modal.

type Book = {
  id: string;
  slug: string;
  title: string;
  status: string;
};

export function ArchiveBookButton({
  book,
  adminMode = false,
}: {
  book: Book;
  adminMode?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isArchived = book.status === "ARCHIVED";

  // Unarchive: benign single-click; no modal.
  async function handleUnarchive() {
    setSubmitting(true);
    setError(null);
    try {
      const url = adminMode
        ? `/api/admin/books/${book.id}/unarchive`
        : `/api/publisher/books/${book.id}/unarchive`;
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }
      router.refresh();
      setSubmitting(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unarchive failed");
      setSubmitting(false);
    }
  }

  if (isArchived) {
    return (
      <div>
        <button
          type="button"
          onClick={handleUnarchive}
          disabled={submitting}
          className="px-3 py-1 rounded-md text-xs font-bold bg-white border border-[#E5DCC8] text-gray-700 hover:bg-[#EAE2D0] disabled:opacity-50"
        >
          {submitting ? "Unarchiving…" : "Unarchive"}
        </button>
        {error && <div className="text-xs text-red-700 mt-1">{error}</div>}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3 py-1 rounded-md text-xs font-bold bg-white border border-red-200 text-red-700 hover:bg-red-50"
      >
        Archive
      </button>
      {open && (
        <ArchiveBookModal
          book={book}
          adminMode={adminMode}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ArchiveBookModal({
  book,
  adminMode,
  onClose,
}: {
  book: Book;
  adminMode: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [typedSlug, setTypedSlug] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slugMatches = typedSlug.trim().toLowerCase() === book.slug.toLowerCase();
  const submitDisabled = submitting || !slugMatches;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitDisabled) return;
    setSubmitting(true);
    setError(null);
    try {
      const url = adminMode
        ? `/api/admin/books/${book.id}/archive`
        : `/api/publisher/books/${book.id}/archive`;
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Archive failed");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-[#FAF6EC] border border-[#E5DCC8] rounded-xl shadow-xl p-6 w-full max-w-lg space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2 className="text-xl font-bold">Archive book</h2>
          <p className="text-xs text-gray-500 mt-1">
            <span className="font-mono font-bold">{book.title}</span>{" "}
            (<span className="font-mono">{book.slug}</span>)
          </p>
        </header>

        <div className="bg-red-50 border border-red-200 text-red-800 text-xs px-4 py-3 rounded-lg">
          <strong>This is a destructive change.</strong> Archived books
          disappear from the buyer-facing Library. Existing grants are
          preserved — buyers who own this book retain access via their
          Active Books tab. Type the book&apos;s slug below to confirm.
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            value={typedSlug}
            onChange={(e) => setTypedSlug(e.target.value)}
            placeholder={book.slug}
            className="w-full px-3 py-2 border border-[#E5DCC8] rounded-lg bg-white text-sm font-mono"
            disabled={submitting}
            autoComplete="off"
          />

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-lg text-sm font-bold text-gray-700 bg-white border border-[#E5DCC8] hover:bg-[#EAE2D0] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitDisabled}
              className="bg-black text-[#FAF6EC] px-4 py-2 rounded-lg text-sm font-bold hover:bg-black shadow-sm disabled:opacity-50"
            >
              {submitting ? "Archiving…" : "Archive book"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
