"use client";

import { useState } from "react";
import Link from "next/link";
import type { BookAccessState } from "@/lib/dashboard/queries";
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
// This keeps the component cell-level shared without forcing both surfaces
// to grow each other's affordances.

export function AccessCell({
  bookId,
  access,
  showActions = false,
}: {
  bookId: string;
  access: BookAccessState | undefined;
  showActions?: boolean;
}) {
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleBuy() {
    setError(null);
    setBuying(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: bookId }),
      });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (!body.url) throw new Error("Checkout response missing url");
      window.location.href = body.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start checkout");
      setBuying(false);
    }
  }

  if (access?.state === "granted") {
    return (
      <div className="flex flex-col gap-2">
        <span className="inline-flex items-center gap-1.5 bg-green-50 text-green-700 px-2.5 py-1 rounded-md text-xs font-semibold w-fit border border-green-100">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
          Access granted
        </span>
        {showActions && (
          <div className="flex items-center gap-3">
            <Link
              href={`/api/books/${bookId}/view`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold text-gray-700 underline hover:no-underline hover:text-black transition-colors"
            >
              View
            </Link>
            <Link
              href={`/api/books/${bookId}/download`}
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
