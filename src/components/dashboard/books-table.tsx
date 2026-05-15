"use client";

import Link from "next/link";
import type { BookWithMetrics, BookAccessState } from "@/lib/dashboard/queries";
import { AccessCell } from "@/components/dashboard/access-cell";
import { BookCover, Eyebrow } from "@/components/design";
import type { BookCoverPalette } from "@/components/design/book-cover";

// bkstr redesign PR 3 — Active Books table.
//
// Restyle of the Stream H/Phase-3 table: design tokens (paper bg, ink
// borders, mono uppercase headers, no rounded corners), per-row
// xs-sized BookCover SVG (typographic — palette + glyph from columns).
// Inline 14-day sparkline. AccessCell preserved verbatim for the buy /
// granted status column.
//
// PR 8 — palette + glyph now flow from BookWithMetrics (sourced from
// the `books.palette` / `books.glyph` columns). Replaces the prior
// client-side bookToCoverData derivation.
//
// Sparkline data is OPTIONAL — pages that don't have time-series data
// pass undefined and the trend column renders "—". The `/dashboard`
// route's server component fetches sparklines via getBooksFetchSparklines
// in PR 3.

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
  sparklinesByBook,
}: {
  books: BookWithMetrics[];
  accessByBook?: Map<string, BookAccessState>;
  /** Per-book daily fetch counts (14-day window). Books without entries
   *  render an empty trend column. From getBooksFetchSparklines(). */
  sparklinesByBook?: Map<string, number[]>;
}) {
  if (books.length === 0) {
    return (
      <div className="bg-paper border border-rule p-8 text-center text-ink-3">
        No books yet. The first book will appear here once it&apos;s imported.
      </div>
    );
  }

  return (
    <div className="bg-paper border border-rule overflow-hidden">
      <table className="w-full text-left text-[13.5px]">
        <thead>
          <tr className="border-b border-ink">
            <Th className="w-[32%]">Title</Th>
            <Th>Version</Th>
            <Th className="text-right">30d fetches</Th>
            <Th>Trend</Th>
            <Th className="text-right">Agents</Th>
            <Th>Last fetched</Th>
            <Th>Access</Th>
            <Th className="text-right">{""}</Th>
          </tr>
        </thead>
        <tbody>
          {books.map((b, idx) => {
            const access = accessByBook?.get(b.id);
            const sparkData = sparklinesByBook?.get(b.id);
            const isOwned = access?.state === "granted";
            const isLast = idx === books.length - 1;
            return (
              <tr
                key={b.id}
                className={
                  "transition-colors hover:bg-paper-2 " +
                  (isLast ? "" : "border-b border-rule")
                }
              >
                <td className="px-4 py-3.5 align-top">
                  <div className="flex gap-3.5 items-center">
                    <div className="shrink-0">
                      <BookCover
                        book={{
                          title: b.title,
                          glyph: b.glyph,
                          domain: b.domain,
                          palette: b.palette as BookCoverPalette,
                          vol: "Vol. 01",
                          version: `v${b.latestVersion}`,
                          author: "—",
                        }}
                        size="xs"
                        flat
                      />
                    </div>
                    <div>
                      <div className="font-serif text-[15.5px] tracking-tight text-ink">
                        {b.title}
                      </div>
                      <div className="font-mono text-[11px] text-ink-3 mt-1">
                        {b.slug}{" "}
                        <span className="text-ink-4">·</span> {b.domain}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5 align-top">
                  <span className="font-mono text-xs text-ink-2">
                    v{b.latestVersion}
                  </span>
                </td>
                <td className="px-4 py-3.5 text-right num text-ink align-top">
                  {b.fetches30d.toLocaleString()}
                </td>
                <td className="px-4 py-3.5 align-middle">
                  {sparkData && sparkData.some((n) => n > 0) ? (
                    <SparkLine
                      data={sparkData}
                      color={isOwned ? "var(--status-ok)" : "var(--ink-3)"}
                    />
                  ) : (
                    <span className="text-ink-4 text-sm">—</span>
                  )}
                </td>
                <td className="px-4 py-3.5 text-right num text-ink-2 align-top">
                  {b.activeAgents30d}
                </td>
                <td className="px-4 py-3.5 align-top">
                  <span
                    className="font-mono text-xs text-ink-3"
                    title={b.lastFetchedAt ? b.lastFetchedAt.toLocaleString() : ""}
                  >
                    {relativeTime(b.lastFetchedAt)}
                  </span>
                </td>
                <td className="px-4 py-3.5 align-top">
                  <AccessCell bookId={b.id} access={access} />
                </td>
                <td className="px-4 py-3.5 text-right align-top">
                  <Link
                    href={`/dashboard/fetch-logs?book=${b.id}`}
                    className="text-saffron-dk text-sm underline hover:no-underline"
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
  );
}

// Standardised <th> shape — mono uppercase 10.5px tracking, ink-3 color.
function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={
        "px-4 py-3 font-mono font-medium text-[10.5px] uppercase tracking-eyebrow text-ink-3 " +
        className
      }
    >
      {children}
    </th>
  );
}

// Inline SVG sparkline — same shape as src/components/design/stat-card.tsx's
// SparkLine helper. Co-locating a smaller variant here so the table doesn't
// need to import StatCard's internals; keeps the table self-contained.
function SparkLine({
  data,
  color,
  width = 80,
  height = 22,
}: {
  data: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;
  const pts = data
    .map(
      (d, i) =>
        `${i * stepX},${height - ((d - min) / range) * (height - 4) - 2}`,
    )
    .join(" L ");
  const path = `M ${pts}`;
  const lastX = (data.length - 1) * stepX;
  const lastY =
    height - ((data[data.length - 1] - min) / range) * (height - 4) - 2;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      style={{ color }}
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastX} cy={lastY} r="1.8" fill="currentColor" />
    </svg>
  );
}
