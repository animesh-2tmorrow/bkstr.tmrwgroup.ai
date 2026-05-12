import Link from "next/link";
import { StatusBadge } from "@/components/dashboard/status-badge";
import type { FetchLogRow } from "@/lib/dashboard/queries";

const QUERY_TRUNCATE_AT = 80;

function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  // Stream H.1 — stable ISO date avoids React #418 hydration mismatch
  // (toLocaleDateString rendered different strings on server vs client).
  // NOTE: the title= tooltip on the cell still uses toLocaleString and is
  // tracked separately as follow-up #104.
  return d.toISOString().slice(0, 10);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export function FetchLogsTable({
  rows,
  filterBookTitle,
  filterBookId,
}: {
  rows: FetchLogRow[];
  filterBookTitle: string | null;
  filterBookId: string | null;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">
          Showing {rows.length} most recent {rows.length === 1 ? "fetch" : "fetches"}
          {rows.length === 100 ? " (cap)" : ""}
        </p>
        {filterBookId && (
          <span className="inline-flex items-center gap-2 bg-[#EAE2D0] text-gray-700 px-3 py-1.5 rounded-lg text-xs font-bold">
            Book: {filterBookTitle ?? "Unknown"}
            <Link
              href="/dashboard/fetch-logs"
              className="text-gray-600 hover:text-gray-900 font-bold"
              aria-label="Remove filter"
            >
              ×
            </Link>
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="bg-[#FAF6EC] border border-[#E5DCC8] rounded-xl shadow-sm p-8 text-center text-gray-500">
          No fetches yet{filterBookId ? " for this book" : ""}.
        </div>
      ) : (
        <div className="bg-[#FAF6EC] border border-[#E5DCC8] rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#EFE8D8] border-b border-[#E5DCC8]">
              <tr>
                <th className="px-6 py-4 font-semibold text-gray-600">Time</th>
                <th className="px-6 py-4 font-semibold text-gray-600">Book</th>
                <th className="px-6 py-4 font-semibold text-gray-600">Query</th>
                <th className="px-6 py-4 font-semibold text-gray-600">Status</th>
                <th className="px-6 py-4 font-semibold text-gray-600 text-right">Latency</th>
                <th className="px-6 py-4 font-semibold text-gray-600 text-right">Tokens in</th>
                <th className="px-6 py-4 font-semibold text-gray-600 text-right">Tokens out</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5DCC8]">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-[#F5F0E6] transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span title={r.createdAt.toLocaleString()}>{relativeTime(r.createdAt)}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-medium text-gray-900">{r.bookTitle}</div>
                    <div className="text-xs text-gray-500 font-mono mt-0.5">v{r.bookVersion}</div>
                  </td>
                  <td className="px-6 py-4 max-w-md">
                    <span title={r.query} className="font-mono text-xs text-gray-700">
                      {truncate(r.query, QUERY_TRUNCATE_AT)}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-6 py-4 text-right font-medium compressed-text">
                    {r.latencyMs == null ? "—" : `${r.latencyMs.toLocaleString()}ms`}
                  </td>
                  <td className="px-6 py-4 text-right font-medium compressed-text">
                    {r.inputTokens == null ? "—" : r.inputTokens.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-right font-medium compressed-text">
                    {r.outputTokens == null ? "—" : r.outputTokens.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
