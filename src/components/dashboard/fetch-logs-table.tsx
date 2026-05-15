import Link from "next/link";
import { StatusBadge } from "@/components/dashboard/status-badge";
import type { FetchLogRow } from "@/lib/dashboard/queries";

// bkstr redesign PR 7 — fetch logs table on design tokens.
// Square corners, hairline rules, mono uppercase column headers, hover
// bg-paper-2; compressed-text retained on numeric columns for tabular feel.

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
        <p className="font-mono text-[11px] tracking-eyebrow uppercase text-ink-3">
          Showing {rows.length} most recent {rows.length === 1 ? "fetch" : "fetches"}
          {rows.length === 100 ? " (cap)" : ""}
        </p>
        {filterBookId && (
          <span className="inline-flex items-center gap-2 bg-paper-2 border border-rule text-ink-2 px-3 py-1.5 font-mono text-[11px] tracking-eyebrow uppercase">
            Book: <span className="font-serif normal-case tracking-normal text-ink">{filterBookTitle ?? "Unknown"}</span>
            <Link
              href="/dashboard/fetch-logs"
              className="text-ink-3 hover:text-ink"
              aria-label="Remove filter"
            >
              ×
            </Link>
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="bg-paper border border-rule p-8 text-center text-ink-3 text-sm">
          No fetches yet{filterBookId ? " for this book" : ""}.
        </div>
      ) : (
        <div className="bg-paper border border-rule overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink">
                <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Time</th>
                <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Book</th>
                <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Query</th>
                <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Status</th>
                <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal text-right">Latency</th>
                <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal text-right">Tokens in</th>
                <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal text-right">Tokens out</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-rule hover:bg-paper-2 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap font-mono text-[11px] text-ink-3">
                    <span title={r.createdAt.toLocaleString()}>{relativeTime(r.createdAt)}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-serif text-ink">{r.bookTitle}</div>
                    <div className="font-mono text-[11px] text-ink-3 mt-0.5">v{r.bookVersion}</div>
                  </td>
                  <td className="px-6 py-4 max-w-md">
                    <span title={r.query} className="font-mono text-[11px] text-ink-2">
                      {truncate(r.query, QUERY_TRUNCATE_AT)}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-6 py-4 text-right font-mono text-[12px] text-ink num tabular-nums">
                    {r.latencyMs == null ? "—" : `${r.latencyMs.toLocaleString()}ms`}
                  </td>
                  <td className="px-6 py-4 text-right font-mono text-[12px] text-ink num tabular-nums">
                    {r.inputTokens == null ? "—" : r.inputTokens.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-right font-mono text-[12px] text-ink num tabular-nums">
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
