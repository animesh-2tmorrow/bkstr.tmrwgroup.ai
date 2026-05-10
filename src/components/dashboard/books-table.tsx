"use client";

import { useState } from "react";
import Link from "next/link";
import type { BookWithMetrics, BookAccessState } from "@/lib/dashboard/queries";
import { formatUsdCents } from "@/lib/format/currency";

function relativeTime(d: Date | null): string {
  if (!d) return "Never";
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return d.toLocaleDateString();
}

export function BooksTable({
  books,
  accessByBook,
}: {
  books: BookWithMetrics[];
  // Phase 3 Stream 3 — per-row access state. Map keyed by bookId. Optional so
  // an unauthenticated/no-subscriber render still works (status column shows
  // a neutral fallback). Computed via getBookAccessStates.
  accessByBook?: Map<string, BookAccessState>;
}) {
  const [buyingBookId, setBuyingBookId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleBuy(bookId: string) {
    setError(null);
    setBuyingBookId(bookId);
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
      setBuyingBookId(null);
    }
  }

  if (books.length === 0) {
    return (
      <div className="bg-[#FAF6EC] border border-[#E5DCC8] rounded-xl shadow-sm p-8 text-center text-gray-500">
        No books yet. The first book will appear here once it&apos;s imported.
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 rounded-lg">
          {error}
        </div>
      )}
      <div className="bg-[#FAF6EC] border border-[#E5DCC8] rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#EFE8D8] border-b border-[#E5DCC8]">
            <tr>
              <th className="px-6 py-4 font-semibold text-gray-600">Title</th>
              <th className="px-6 py-4 font-semibold text-gray-600">Latest version</th>
              <th className="px-6 py-4 font-semibold text-gray-600">Total fetches</th>
              <th className="px-6 py-4 font-semibold text-gray-600">Last 30d</th>
              <th className="px-6 py-4 font-semibold text-gray-600">Active agents (30d)</th>
              <th className="px-6 py-4 font-semibold text-gray-600">Last fetched</th>
              <th className="px-6 py-4 font-semibold text-gray-600">Access</th>
              <th className="px-6 py-4 font-semibold text-gray-600 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5DCC8]">
            {books.map((b) => {
              const access = accessByBook?.get(b.id);
              return (
                <tr key={b.id} className="hover:bg-[#F5F0E6] transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-bold text-gray-900">{b.title}</div>
                    <div className="text-xs text-gray-500 font-mono mt-1">
                      {b.slug} <span className="text-gray-400">·</span> {b.domain}
                    </div>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs">v{b.latestVersion}</td>
                  <td className="px-6 py-4 font-medium compressed-text">{b.totalFetches.toLocaleString()}</td>
                  <td className="px-6 py-4 font-medium compressed-text">{b.fetches30d.toLocaleString()}</td>
                  <td className="px-6 py-4 font-medium compressed-text">{b.activeAgents30d.toLocaleString()}</td>
                  <td className="px-6 py-4">
                    <span title={b.lastFetchedAt ? b.lastFetchedAt.toLocaleString() : ""}>
                      {relativeTime(b.lastFetchedAt)}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {access?.state === "granted" ? (
                      <span className="inline-flex items-center gap-1.5 bg-green-50 text-green-700 px-2 py-1 rounded text-xs font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                        Access granted
                      </span>
                    ) : access?.state === "for_sale" && access.unitAmountCents !== null ? (
                      <button
                        type="button"
                        onClick={() => handleBuy(b.id)}
                        disabled={buyingBookId === b.id}
                        className="inline-flex items-center bg-black text-[#FAF6EC] px-3 py-1.5 rounded text-xs font-bold hover:bg-black shadow-sm disabled:opacity-50"
                      >
                        {buyingBookId === b.id
                          ? "Loading…"
                          : `Buy — ${formatUsdCents(access.unitAmountCents)}`}
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400 italic">Not for sale</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link
                      href={`/dashboard/fetch-logs?book=${b.id}`}
                      className="text-black font-semibold underline hover:no-underline"
                    >
                      View fetches
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
