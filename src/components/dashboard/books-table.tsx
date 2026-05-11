"use client";

import Link from "next/link";
import type { BookWithMetrics, BookAccessState } from "@/lib/dashboard/queries";
import { AccessCell } from "@/components/dashboard/access-cell";

// Phase 4 Stream C (CC-12 / D11.12) — the Buy / Granted / Not-for-sale
// rendering moved to <AccessCell /> so the Library table renders the same
// states identically. The per-row "View fetches" link and the agent-fleet
// columns stay here; Active Books is observability-of-fleet, not
// consumption-of-content. The Library route turns on showActions to surface
// View + Download links inline.

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
  if (books.length === 0) {
    return (
      <div className="bg-[#FAF6EC] border border-[#E5DCC8] rounded-xl shadow-sm p-8 text-center text-gray-500">
        No books yet. The first book will appear here once it&apos;s imported.
      </div>
    );
  }

  return (
    <div>
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
                    <AccessCell bookId={b.id} access={access} />
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
