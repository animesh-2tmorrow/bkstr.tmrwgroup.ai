"use client";

import { useState } from "react";
import Link from "next/link";
import type { BookAccessState, CatalogAccessEntry } from "@/lib/dashboard/queries";
import { formatUsdCents } from "@/lib/format/currency";

// Phase 4 Stream C (CC-12 / D11.12) — shared Access cell extracted from
// books-table.tsx so the Active Books table and the Library table render the
// per-row Buy / Granted / Not-for-sale state identically. The cell's
// state machine is the same as it was in books-table.tsx pre-refactor:
//
//   access?.state === "granted"                              → green pill
//   access?.state === "for_sale" && unitAmountCents != null  → Buy button
//   anything else (incl. undefined access, not_for_sale,     → muted italic
//     for_sale with null unitAmountCents)                       "Not for sale"
//
// `showActions` toggles the View + Download links on granted rows. Active
// Books (the agent-fleet framing) leaves them off; Library turns them on.
//
// redesign(10)/3 — kind-aware extension for the library merge. The new
// canonical signature is { kind, itemId, itemSlug?, access }. Legacy
// callers (books-table.tsx — Active Books, books-only by design) keep
// passing `bookId` + `BookAccessState`; the component maps them to the
// new shape internally. Default kind="book" preserves legacy semantics.
//
// Skill rows on the library table route View/Download links to skill
// endpoints when granted; Buy POSTs {skill_id} instead of {book_id}.

type AccessLike = BookAccessState | CatalogAccessEntry | undefined;

export function AccessCell({
  bookId,
  itemId,
  itemSlug,
  kind = "book",
  access,
  showActions = false,
}: {
  // Legacy alias — Active Books page still uses this name. New callers
  // (library-table for skills) pass `kind` + `itemId` instead.
  bookId?: string;
  itemId?: string;
  // Slug is required for skill rows' download endpoint (/api/skills/<slug>/
  // download takes a slug, not an id). Book download takes a UUID id.
  itemSlug?: string;
  kind?: "book" | "skill";
  access: AccessLike;
  showActions?: boolean;
}) {
  const id = itemId ?? bookId ?? "";
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleBuy() {
    setError(null);
    setBuying(true);
    try {
      const body: Record<string, string> =
        kind === "book" ? { book_id: id } : { skill_id: id };
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      if (!json.url) throw new Error("Checkout response missing url");
      window.location.href = json.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start checkout");
      setBuying(false);
    }
  }

  if (access?.state === "granted") {
    // View + Download targets differ by kind:
    //   book:  /api/books/<id>/view + /api/books/<id>/download    (UUID-based, session-cookie)
    //   skill: /storefront/<slug>   + /api/skills/<slug>/download (slug-based)
    // Book download is rate-limited (5/day); skill download has no per-day
    // cap (re-archived in-memory on each request).
    const viewHref =
      kind === "book"
        ? `/api/books/${id}/view`
        : itemSlug
          ? `/storefront/${encodeURIComponent(itemSlug)}`
          : "#";
    const downloadHref =
      kind === "book"
        ? `/api/books/${id}/download`
        : itemSlug
          ? `/api/skills/${encodeURIComponent(itemSlug)}/download`
          : "#";
    return (
      <div className="flex flex-col gap-2">
        <span className="inline-flex items-center gap-1.5 bg-green-50 text-green-700 px-2.5 py-1 rounded-md text-xs font-semibold w-fit border border-green-100">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
          Access granted
        </span>
        {showActions && (
          <div className="flex items-center gap-3">
            <Link
              href={viewHref}
              target={kind === "book" ? "_blank" : undefined}
              rel={kind === "book" ? "noopener noreferrer" : undefined}
              className="text-xs font-semibold text-gray-700 underline hover:no-underline hover:text-black transition-colors"
            >
              View
            </Link>
            <Link
              href={downloadHref}
              className="text-xs font-semibold text-gray-700 underline hover:no-underline hover:text-black transition-colors"
            >
              Download
            </Link>
          </div>
        )}
      </div>
    );
  }

  if (access?.state === "for_sale" && access.unitAmountCents !== null) {
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={handleBuy}
          disabled={buying}
          className="inline-flex items-center bg-gray-900 text-[#FAF6EC] px-3.5 py-1.5 rounded-lg text-xs font-bold hover:bg-black transition-colors shadow-sm disabled:opacity-50 w-fit whitespace-nowrap"
        >
          {buying ? "Loading…" : `Buy — ${formatUsdCents(access.unitAmountCents)}`}
        </button>
        {error && <span className="text-xs text-red-600 mt-0.5">{error}</span>}
      </div>
    );
  }

  return <span className="text-xs text-gray-400 italic">Not for sale</span>;
}
