"use client";

import { useState } from "react";
import { formatUsdCents } from "@/lib/format/currency";
import { ArchiveBookButton } from "@/components/dashboard/admin/archive-book-modal";

// Phase 4 Stream B — BookRow gains optional `description` + `publisherUserId`
// fields forward-friendly for Stream C's Library view, which will display the
// description alongside Publisher metadata. The form itself only reads
// id/title/slug/domain/unitAmountCents/stripePriceId/updatedAt — the extra
// fields are passed through unread.
//
// Phase 5 Stream E (D15.5) — `status` is included so the per-row Archive /
// Unarchive button renders the right state. Pricing surface is the v1
// archive button placement (Q2). Price-edit stays visible on ARCHIVED
// rows (Q9) so publishers may adjust price before unarchiving.
type BookRow = {
  id: string;
  title: string;
  slug: string;
  domain: string;
  status?: string;
  description?: string | null;
  publisherUserId?: string | null;
  unitAmountCents: number | null;
  stripePriceId: string | null;
  updatedAt: string | null;
};

export function PricingForm({
  books,
  isPublisher = false,
}: {
  books: BookRow[];
  // Phase 4 Stream B — when true, the empty-state copy nudges the publisher
  // toward /dashboard/books/new (the create surface introduced by Stream B).
  // ADMIN gets the legacy import-book wording.
  isPublisher?: boolean;
}) {
  const [selectedBookId, setSelectedBookId] = useState<string>(books[0]?.id ?? "");
  const [priceDollars, setPriceDollars] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!selectedBookId) {
      setError("Pick a book to price.");
      return;
    }
    const dollars = Number(priceDollars);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setError("Price must be a positive dollar amount.");
      return;
    }
    // Convert dollars to cents — round to handle minor float artifacts in the
    // input value (e.g. "9.99" → 999, not 998.9999...).
    const cents = Math.round(dollars * 100);

    setSubmitting(true);
    try {
      const res = await fetch("/api/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: selectedBookId, unit_amount_cents: cents }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setSuccessMessage(
        `Saved. New Stripe Price created and ${formatUsdCents(cents)} is now active. Refresh to see updated row.`,
      );
      setPriceDollars("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <form
        onSubmit={handleSubmit}
        className="bg-[#FAF6EC] border border-[#E5DCC8] rounded-xl shadow-sm p-6 space-y-4"
      >
        <div>
          <label htmlFor="book" className="block text-sm font-semibold text-gray-700 mb-1">
            Book
          </label>
          <select
            id="book"
            value={selectedBookId}
            onChange={(e) => setSelectedBookId(e.target.value)}
            className="w-full px-3 py-2 border border-[#E5DCC8] rounded-lg bg-white text-sm"
            disabled={books.length === 0 || submitting}
          >
            {books.length === 0 ? (
              <option value="">
                {isPublisher
                  ? "No books yet — create one at /dashboard/books/new"
                  : "No books yet — import one first"}
              </option>
            ) : (
              books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title} ({b.slug})
                  {b.unitAmountCents !== null ? ` — currently ${formatUsdCents(b.unitAmountCents)}` : ""}
                </option>
              ))
            )}
          </select>
        </div>
        <div>
          <label htmlFor="price" className="block text-sm font-semibold text-gray-700 mb-1">
            Price (USD)
          </label>
          <div className="flex items-center gap-2">
            <span className="text-gray-500">$</span>
            <input
              id="price"
              type="number"
              step="0.01"
              min="0.01"
              value={priceDollars}
              onChange={(e) => setPriceDollars(e.target.value)}
              placeholder="9.99"
              className="flex-grow px-3 py-2 border border-[#E5DCC8] rounded-lg bg-white text-sm"
              disabled={submitting || books.length === 0}
              required
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Submitting creates a new Stripe Price. The previous Price stays in Stripe (immutable);
            only this book&apos;s active pointer changes.
          </p>
        </div>
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 rounded-lg">
            {error}
          </div>
        )}
        {successMessage && (
          <div className="bg-green-50 border border-green-200 text-green-800 text-sm px-4 py-3 rounded-lg">
            {successMessage}
          </div>
        )}
        <button
          type="submit"
          disabled={submitting || books.length === 0}
          className="bg-black text-[#FAF6EC] px-4 py-2 rounded-lg text-sm font-bold hover:bg-black shadow-sm disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Save price"}
        </button>
      </form>

      <div className="bg-[#FAF6EC] border border-[#E5DCC8] rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#EFE8D8] border-b border-[#E5DCC8]">
            <tr>
              <th className="px-6 py-4 font-semibold text-gray-600">Book</th>
              <th className="px-6 py-4 font-semibold text-gray-600">Status</th>
              <th className="px-6 py-4 font-semibold text-gray-600">Current price</th>
              <th className="px-6 py-4 font-semibold text-gray-600">Stripe Price ID</th>
              <th className="px-6 py-4 font-semibold text-gray-600">Last updated</th>
              <th className="px-6 py-4 font-semibold text-gray-600 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5DCC8]">
            {books.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                  {isPublisher
                    ? "No books yet. Create one at /dashboard/books/new."
                    : "No books yet. Import one with `npm run import-book` first."}
                </td>
              </tr>
            )}
            {books.map((b) => (
              <tr key={b.id}>
                <td className="px-6 py-4">
                  <div className="font-medium text-gray-900">{b.title}</div>
                  <div className="text-xs text-gray-500 font-mono mt-1">
                    {b.slug} <span className="text-gray-400">·</span> {b.domain}
                  </div>
                </td>
                <td className="px-6 py-4 font-mono text-xs uppercase">
                  {b.status ?? "—"}
                </td>
                <td className="px-6 py-4 font-medium">
                  {b.unitAmountCents !== null ? (
                    formatUsdCents(b.unitAmountCents)
                  ) : (
                    <span className="text-gray-400 italic">Not for sale</span>
                  )}
                </td>
                <td className="px-6 py-4 font-mono text-xs text-gray-700">
                  {b.stripePriceId ?? <span className="text-gray-400">—</span>}
                </td>
                <td className="px-6 py-4 text-xs text-gray-600">
                  {b.updatedAt ? new Date(b.updatedAt).toLocaleString() : "—"}
                </td>
                <td className="px-6 py-4 text-right">
                  {b.status ? (
                    <ArchiveBookButton
                      book={{ id: b.id, slug: b.slug, title: b.title, status: b.status }}
                    />
                  ) : (
                    <span className="text-xs text-gray-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
