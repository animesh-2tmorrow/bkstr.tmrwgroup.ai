import { Fragment } from "react";
import Link from "next/link";
import type {
  LibraryItem,
  CatalogAccessEntry,
} from "@/lib/dashboard/queries";
import { AccessCell } from "@/components/dashboard/access-cell";
import { ApiInstructionsBlock } from "@/components/dashboard/api-instructions-block";
import { formatUsdCents } from "@/lib/format/currency";
import { BookCover, Eyebrow, Pill } from "@/components/design";
import type { BookCoverPalette } from "@/components/design/book-cover";

// bkstr redesign PR 3 — Library table.
//
// Restyled with design tokens; structure unchanged: per-row title (cover
// + slug + domain), description, publisher, price, AccessCell.
// Tab switching stays URL-driven (?filter=…) per Stream C / CC-13.
// Curl-example details block stays inside the row, restyled as an
// editorial frame.
//
// redesign(10)/3 — kind-aware. Books render with <BookCover> SVG + domain;
// skills render with "SKILL · .zip" pill + version/file subtitle, no
// cover (typographic per HANDOFF Q4). Per-row <ApiInstructionsBlock>
// passes kind so books get files-primary + Q&A-advanced; skills get
// files-only. Map keys on `${kind}:${id}` per CatalogAccessEntry shape.

export type LibraryFilter = "active" | "browse" | "all";

const FILTERS: ReadonlyArray<{ key: LibraryFilter; label: string }> = [
  { key: "active", label: "Active" },
  { key: "browse", label: "Browse" },
  { key: "all", label: "All" },
];

// Map key shape — keeps the kind:id form readable at the call site.
function keyOf(item: { kind: LibraryItem["kind"]; id: string }): string {
  return `${item.kind}:${item.id}`;
}

export function LibraryTable({
  subscriberId,
  items,
  accessByItem,
  filter,
}: {
  subscriberId: string | null;
  items: LibraryItem[];
  accessByItem: Map<string, CatalogAccessEntry> | undefined;
  filter: LibraryFilter;
}) {
  const filtered = items.filter((it) => {
    const access = accessByItem?.get(keyOf(it));
    if (filter === "active") return access?.state === "granted";
    if (filter === "browse") return access?.state === "for_sale";
    return true;
  });

  // Per-tab counts for the labels — "Active 3 / Browse 7 / All 10".
  // Counts now span books + skills (the dispatch's user-visible collapse).
  const counts = {
    active: items.filter((it) => accessByItem?.get(keyOf(it))?.state === "granted").length,
    browse: items.filter((it) => accessByItem?.get(keyOf(it))?.state === "for_sale").length,
    all: items.length,
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

      {/* Empty state — copy now includes both kinds */}
      {filtered.length === 0 ? (
        <div className="bg-paper border border-rule p-8 text-center text-ink-3 mt-6">
          {filter === "active"
            ? "Nothing in your library yet. Browse the catalog to purchase a book or skill."
            : filter === "browse"
              ? "No items currently for sale that you don't already have access to."
              : "No items in the catalog yet."}
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
              {filtered.map((item, idx) => {
                const access = accessByItem?.get(keyOf(item));
                const priceCents = access?.unitAmountCents ?? null;
                const granted = access?.state === "granted";
                const isLast = idx === filtered.length - 1;
                // Phase 2b.3 — the "▸ API access" disclosure renders as a
                // full-width detail row BELOW the main row (colSpan over
                // all 5 columns), NOT trapped inside the narrow w-[26%]
                // Title cell. The narrow cell was squeezing the install
                // command into an unreadable character-wrapped strip.
                const hasDisclosure = granted && subscriberId !== null;
                return (
                  <Fragment key={keyOf(item)}>
                    <tr
                      className={
                        "transition-colors hover:bg-paper-2 align-top " +
                        (hasDisclosure || isLast ? "" : "border-b border-rule")
                      }
                    >
                      {/* Title cell — single <BookCover> render for both
                          kinds (redesign(10)/6). Skills pass "SKILL" as
                          the imprint-bar domain; books pass their actual
                          domain. The "SKILL · .zip" pill discriminates
                          kind, cover unifies. */}
                      <td className="px-4 py-4">
                        <div className="flex gap-3.5 items-start">
                          <div className="shrink-0">
                            {item.palette && item.glyph ? (
                              <BookCover
                                book={{
                                  title: item.displayName,
                                  glyph: item.glyph,
                                  domain: item.domain ?? "SKILL",
                                  palette: item.palette as BookCoverPalette,
                                  vol: "Vol. 01",
                                  version: `v${item.latestVersion || 1}`,
                                  author: "—",
                                }}
                                size="xs"
                                flat
                              />
                            ) : null}
                          </div>
                          <div className="min-w-0">
                            <div className="font-serif text-[15.5px] tracking-tight text-ink">
                              {item.displayName}
                            </div>
                            <div className="font-mono text-[11px] text-ink-3 mt-1 flex items-center gap-2 flex-wrap">
                              {item.kind === "skill" ? (
                                <Pill variant="saffron">SKILL · .zip</Pill>
                              ) : null}
                              <span>{item.slug}</span>
                              {item.kind === "book" && item.domain ? (
                                <>
                                  <span className="text-ink-4">·</span>
                                  <span>{item.domain}</span>
                                </>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </td>
                      {/* Description */}
                      <td className="px-4 py-4 text-ink-2 leading-[1.5]">
                        {item.description ? (
                          <span className="line-clamp-3">
                            {item.description}
                          </span>
                        ) : (
                          <span className="text-ink-4">—</span>
                        )}
                      </td>
                      {/* Publisher */}
                      <td className="px-4 py-4">
                        <div className="text-ink-2">{item.publisherName}</div>
                      </td>
                      {/* Price */}
                      <td className="px-4 py-4 text-right">
                        {priceCents !== null ? (
                          <span className="font-serif text-[18px] text-ink num">
                            {formatUsdCents(priceCents)}
                          </span>
                        ) : (
                          <span className="text-ink-4">—</span>
                        )}
                      </td>
                      {/* Access cell — kind-aware View/Download targets */}
                      <td className="px-4 py-4">
                        <AccessCell
                          kind={item.kind}
                          itemId={item.id}
                          itemSlug={item.slug}
                          access={access}
                          showActions
                        />
                      </td>
                    </tr>
                    {/* Full-width API-access detail row — spans all 5
                        columns so the install command has room to render
                        on one or two lines instead of a narrow strip. */}
                    {granted && subscriberId && (
                      <tr className={isLast ? "" : "border-b border-rule"}>
                        <td colSpan={5} className="px-4 pb-4">
                          <details className="text-xs">
                            <summary className="cursor-pointer text-ink-3 hover:text-ink font-mono uppercase tracking-eyebrow text-[11px]">
                              ▸ API access
                            </summary>
                            <div className="mt-3 bg-ink p-3 border border-rule">
                              <ApiInstructionsBlock
                                kind={item.kind}
                                itemId={item.id}
                                itemSlug={item.slug}
                                subscriberId={subscriberId}
                                apiKey=""
                                isFree={
                                  priceCents == null || priceCents === 0
                                }
                                compact
                              />
                            </div>
                          </details>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > 0 ? (
        <div className="mt-3 text-ink-3 text-xs flex justify-between items-baseline">
          <Eyebrow>
            SHOWING {filtered.length} OF {items.length} VOLUMES · YOU OWN{" "}
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
