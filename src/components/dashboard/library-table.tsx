import Link from "next/link";
import type { LibraryBook, BookAccessState } from "@/lib/dashboard/queries";
import { AccessCell } from "@/components/dashboard/access-cell";
import { ApiInstructionsBlock } from "@/components/dashboard/api-instructions-block";
import { formatUsdCents } from "@/lib/format/currency";
import { BookCover, Eyebrow } from "@/components/design";
import { bookToCoverData } from "@/lib/books/cover-derive";

// bkstr redesign PR 3 — Library table.
//
// Restyled with design tokens; structure unchanged: per-row title (cover
// + slug + domain), description, publisher, price, AccessCell.
// Tab switching stays URL-driven (?filter=…) per Stream C / CC-13.
// Curl-example details block stays inside the row, restyled as an
// editorial frame.
//
// Tab pill row replaces the rounded-lg paper-2 nav from Stream H — now
// a flush 3-segment switch with mono labels inside an ink hairline
// border, matching reference pages.jsx:144-178.

export type LibraryFilter = "active" | "browse" | "all";

const FILTERS: ReadonlyArray<{ key: LibraryFilter; label: string }> = [
  { key: "active", label: "Active" },
  { key: "browse", label: "Browse" },
  { key: "all", label: "All" },
];

export function LibraryTable({
  subscriberId,
  books,
  accessByBook,
  filter,
}: {
  subscriberId: string | null;
  books: LibraryBook[];
  accessByBook: Map<string, BookAccessState> | undefined;
  filter: LibraryFilter;
}) {
  const filtered = books.filter((b) => {
    const access = accessByBook?.get(b.id);
    if (filter === "active") return access?.state === "granted";
    if (filter === "browse") return access?.state === "for_sale";
    return true;
  });

  // Per-tab counts for the labels — so "Active 3 / Browse 7 / All 10".
  const counts = {
    active: books.filter((b) => accessByBook?.get(b.id)?.state === "granted").length,
    browse: books.filter((b) => accessByBook?.get(b.id)?.state === "for_sale").length,
    all: books.length,
  };

  return (
    <div>
      {/* Tab strip — flush 3-segment switch */}
      <div className="flex items-center gap-3.5 pb-4 border-b border-rule">
        <div className="inline-flex border border-rule overflow-hidden">
          {FILTERS.map((f, i) => {
            const isActive = f.key === filter;
            return (
              <Link
                key={f.key}
                href={`/dashboard/library?filter=${f.key}`}
                className={[
                  "px-4 py-2 text-[13.5px] font-sans transition-colors",
                  i < FILTERS.length - 1 ? "border-r border-rule" : "",
                  isActive
                    ? "bg-ink text-paper"
                    : "bg-transparent text-ink-2 hover:bg-paper",
                ].join(" ")}
              >
                {f.label}{" "}
                <span className="opacity-60 font-mono text-[11px] ml-1">
                  {counts[f.key]}
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Empty state — same copy as Stream C, restyled */}
      {filtered.length === 0 ? (
        <div className="bg-paper border border-rule p-8 text-center text-ink-3 mt-6">
          {filter === "active"
            ? "No books with access granted yet. Browse the catalog to purchase a book."
            : filter === "browse"
              ? "No books currently for sale that you don't already have access to."
              : "No books in the catalog yet."}
        </div>
      ) : (
        <div className="bg-paper border-l border-r border-b border-rule overflow-hidden">
          <table className="w-full text-left text-[13.5px]">
            <thead>
              <tr className="border-b border-ink">
                <Th className="w-[26%]">Title</Th>
                <Th className="w-[34%]">Description</Th>
                <Th>Publisher</Th>
                <Th className="text-right">Price</Th>
                <Th>Access</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b, idx) => {
                const access = accessByBook?.get(b.id);
                const priceCents = access?.unitAmountCents ?? null;
                const granted = access?.state === "granted";
                const isLast = idx === filtered.length - 1;
                return (
                  <tr
                    key={b.id}
                    className={
                      "transition-colors hover:bg-paper-2 align-top " +
                      (isLast ? "" : "border-b border-rule")
                    }
                  >
                    <td className="px-4 py-4">
                      <div className="flex gap-3.5 items-start">
                        <div className="shrink-0">
                          <BookCover
                            book={bookToCoverData({
                              title: b.title,
                              domain: b.domain,
                            })}
                            size="xs"
                            flat
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="font-serif text-[15.5px] tracking-tight text-ink">
                            {b.title}
                          </div>
                          <div className="font-mono text-[11px] text-ink-3 mt-1">
                            {b.slug}{" "}
                            <span className="text-ink-4">·</span> {b.domain}
                          </div>
                          {granted && subscriberId && (
                            <details className="mt-3 text-xs">
                              <summary className="cursor-pointer text-ink-3 hover:text-ink font-mono uppercase tracking-eyebrow text-[11px]">
                                ▸ API access
                              </summary>
                              <div className="mt-3 bg-ink p-3 border border-rule overflow-x-auto">
                                <ApiInstructionsBlock
                                  subscriberId={subscriberId}
                                  bookId={b.id}
                                  bookSlug={b.slug}
                                  compact
                                />
                              </div>
                            </details>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-ink-2 leading-[1.5]">
                      {b.description ? (
                        <span className="line-clamp-3">{b.description}</span>
                      ) : (
                        <span className="text-ink-4">—</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div className="text-ink-2">{b.publisherName}</div>
                    </td>
                    <td className="px-4 py-4 text-right">
                      {priceCents !== null ? (
                        <span className="font-serif text-[18px] text-ink num">
                          {formatUsdCents(priceCents)}
                        </span>
                      ) : (
                        <span className="text-ink-4">—</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <AccessCell bookId={b.id} access={access} showActions />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > 0 ? (
        <div className="mt-3 text-ink-3 text-xs flex justify-between items-baseline">
          <Eyebrow>
            SHOWING {filtered.length} OF {books.length} VOLUMES · YOU OWN{" "}
            {counts.active}
          </Eyebrow>
          <Eyebrow>ALL PRICES USD · 14-DAY REFUND</Eyebrow>
        </div>
      ) : null}
    </div>
  );
}

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
