import Link from "next/link";
import type { LibraryBook, BookAccessState } from "@/lib/dashboard/queries";
import { AccessCell } from "@/components/dashboard/access-cell";
import { ApiInstructionsBlock } from "@/components/dashboard/api-instructions-block";
import { formatUsdCents } from "@/lib/format/currency";

// Phase 4 Stream C (CC-12 + CC-13) — server-renderable Library table.
// Columns are consumption-shaped: Title / Description / Publisher / Price /
// Access cell (Buy / Granted + View + Download). Filter state lives in URL
// search params (?filter=active|browse|all) so the view is link-shareable
// and refresh-stable; the server reads searchParams in page.tsx and passes
// the filter literal down.
//
// On granted rows the API instructions block expands into a <details>
// element so curl + book_id are available without leaving the row. No
// client JS needed — the disclosure widget is built-in HTML behaviour.

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
    return true; // "all"
  });

  return (
    <div>
      <nav className="mb-6 inline-flex gap-1 p-1 rounded-lg bg-[#EFE8D8] border border-[#E5DCC8]">
        {FILTERS.map((f) => {
          const isActive = f.key === filter;
          const className = isActive
            ? "px-4 py-1.5 rounded-md text-xs font-bold bg-[#FAF6EC] text-black shadow-sm"
            : "px-4 py-1.5 rounded-md text-xs font-bold text-gray-600 hover:text-black";
          return (
            <Link key={f.key} href={`/dashboard/library?filter=${f.key}`} className={className}>
              {f.label}
            </Link>
          );
        })}
      </nav>

      {filtered.length === 0 ? (
        <div className="bg-[#FAF6EC] border border-[#E5DCC8] rounded-xl shadow-sm p-8 text-center text-gray-500">
          {filter === "active"
            ? "No books with access granted yet. Browse the catalog to purchase a book."
            : filter === "browse"
              ? "No books currently for sale that you don't already have access to."
              : "No books in the catalog yet."}
        </div>
      ) : (
        <div className="bg-[#FAF6EC] border border-[#E5DCC8] rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#EFE8D8] border-b border-[#E5DCC8]">
              <tr>
                <th className="px-6 py-4 font-semibold text-gray-600">Title</th>
                <th className="px-6 py-4 font-semibold text-gray-600">Description</th>
                <th className="px-6 py-4 font-semibold text-gray-600">Publisher</th>
                <th className="px-6 py-4 font-semibold text-gray-600">Price</th>
                <th className="px-6 py-4 font-semibold text-gray-600">Access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5DCC8]">
              {filtered.map((b) => {
                const access = accessByBook?.get(b.id);
                const priceCents = access?.unitAmountCents ?? null;
                const granted = access?.state === "granted";
                return (
                  <tr key={b.id} className="hover:bg-[#F5F0E6] transition-colors align-top">
                    <td className="px-6 py-4">
                      <div className="font-bold text-gray-900">{b.title}</div>
                      <div className="text-xs text-gray-500 font-mono mt-1">
                        {b.slug} <span className="text-gray-400">·</span> {b.domain}
                      </div>
                      {granted && subscriberId && (
                        <details className="mt-3 text-xs">
                          <summary className="cursor-pointer text-gray-600 hover:text-black font-semibold">
                            API access
                          </summary>
                          <div className="mt-3">
                            <ApiInstructionsBlock
                              subscriberId={subscriberId}
                              bookId={b.id}
                              bookSlug={b.slug}
                              compact
                            />
                          </div>
                        </details>
                      )}
                    </td>
                    <td className="px-6 py-4 max-w-md">
                      {b.description ? (
                        <span className="text-gray-700 line-clamp-3">{b.description}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-700">{b.publisherName}</td>
                    <td className="px-6 py-4 font-medium">
                      {priceCents !== null ? (
                        formatUsdCents(priceCents)
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <AccessCell bookId={b.id} access={access} showActions />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
