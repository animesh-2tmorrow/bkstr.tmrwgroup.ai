"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  Masthead,
  MarketingFooter,
  Eyebrow,
  Pill,
  BookCover,
  Button,
} from "@/components/design";
import type { PillVariant } from "@/components/design";
import type { BookCoverPalette } from "@/components/design/book-cover";

// bkstr redesign PR 1 — public catalog.
//
// Reskin of the Stream H storefront (prior page used photographic
// thumbnails on horizontal cards w/ navy-on-cream CTAs). The new version:
//   - Editorial top chrome (Masthead) shared with `/`.
//   - Display-serif page title with eyebrow.
//   - Shelves filter (Pill primitive) + search + sort row.
//   - Vertical book grid using BookCover SVG (typographic) — no
//     photographic covers (HANDOFF.md §What NOT to do).
//   - Per-card Pill for domain category (color = book's palette column).
//   - Bottom CTA stack: lift placeholder + price + Buy/Owned button.
//
// PR 8 — palette + glyph now arrive on every BookWithPrice row from the
// API, sourced from the book's persistent palette/glyph columns. The
// previous client-side derivation via lib/books/cover-derive is gone;
// that helper module is deleted in this PR.
//
// The per-domain shelves filter still needs a palette per domain (for the
// active-pill color). Books in the same domain share the same palette by
// the migration's backfill heuristic, so we read the first book's palette
// per domain rather than re-deriving.

interface BookWithPrice {
  id: string;
  title: string;
  description: string | null;
  domain: string;
  // PR 8 — typographic cover drivers from the books table.
  palette: BookCoverPalette;
  glyph: string;
  unitAmountCents: number | null;
  stripePriceId: string | null;
  state: "for_sale" | "not_for_sale" | "granted";
  grantSource: string | null;
}

const MASTHEAD_NAV = [
  { label: "Home", href: "/" },
  { label: "Catalog", href: "/storefront", active: true },
  { label: "Docs", href: "/dashboard/docs" },
  { label: "Log in", href: "/login" },
];

// Map BookCover palette key → Pill variant. Lets the per-card domain pill
// share the cover's palette without an extra lookup.
const PALETTE_PILL: Record<BookCoverPalette, PillVariant> = {
  saffron: "saffron",
  forest: "forest",
  oxblood: "oxblood",
  indigo: "indigo",
  plum: "plum",
  slate: "slate",
};

function formatPrice(cents: number | null): string {
  if (!cents) return "Contact for pricing";
  return `$${(cents / 100).toFixed(2)}`;
}

function humanDomain(domain: string): string {
  return domain
    .split(/[-_]/)
    .map((word) => {
      const upper = ["ci", "cd", "api", "aws", "tdd", "qa", "ui", "ux", "ai", "ml"];
      return upper.includes(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

type SortKey = "featured" | "price-asc" | "price-desc" | "newest";

const SORT_LABELS: Record<SortKey, string> = {
  featured: "FEATURED",
  "price-asc": "PRICE ↑",
  "price-desc": "PRICE ↓",
  newest: "NEWEST",
};

export default function StorefrontPage() {
  const { data: session, status } = useSession();
  const [books, setBooks] = useState<BookWithPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [purchasingBookId, setPurchasingBookId] = useState<string | null>(null);

  // Filter / sort / search state — URL-less for now; can promote to
  // ?domain=&q=&sort= search params in a later polish pass if shareable
  // filtered views become important.
  const [activeDomain, setActiveDomain] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortKey>("featured");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const run = async () => {
      try {
        const response = await fetch("/api/storefront/books");
        if (!response.ok) throw new Error("Failed to fetch books");
        const data = (await response.json()) as BookWithPrice[];
        setBooks(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

  // Build the shelves filter row — distinct domain values + their counts.
  // Per-domain palette comes from the first matching book; the migration
  // backfills books in the same domain to the same palette, so the lookup
  // is stable. PR 8 dropped the client-side derivePalette helper.
  const domains = useMemo(() => {
    const counts = new Map<string, number>();
    const paletteByDomain = new Map<string, BookCoverPalette>();
    for (const b of books) {
      counts.set(b.domain, (counts.get(b.domain) ?? 0) + 1);
      if (!paletteByDomain.has(b.domain)) {
        paletteByDomain.set(b.domain, b.palette);
      }
    }
    return [
      { id: "all", label: "All catalog", count: books.length, palette: null as BookCoverPalette | null },
      ...Array.from(counts.entries()).map(([id, count]) => ({
        id,
        label: humanDomain(id),
        count,
        palette: paletteByDomain.get(id) ?? null,
      })),
    ];
  }, [books]);

  const filtered = useMemo(() => {
    let bs = books;
    if (activeDomain !== "all") bs = bs.filter((b) => b.domain === activeDomain);
    if (query) {
      const q = query.toLowerCase();
      bs = bs.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          b.domain.toLowerCase().includes(q) ||
          (b.description ?? "").toLowerCase().includes(q),
      );
    }
    if (sortBy === "price-asc") {
      bs = [...bs].sort((a, b) => (a.unitAmountCents ?? 0) - (b.unitAmountCents ?? 0));
    } else if (sortBy === "price-desc") {
      bs = [...bs].sort((a, b) => (b.unitAmountCents ?? 0) - (a.unitAmountCents ?? 0));
    }
    // 'featured' and 'newest' fall through to the server-provided order
    // (currently insertion order from /api/storefront/books).
    return bs;
  }, [books, activeDomain, sortBy, query]);

  const handleBuyNow = async (bookId: string) => {
    if (status !== "authenticated") {
      window.location.href = "/login?callbackUrl=/storefront";
      return;
    }
    setPurchasingBookId(bookId);
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: bookId }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        alert(`Error: ${errorData.error}`);
        setPurchasingBookId(null);
        return;
      }
      const { url } = await response.json();
      window.location.href = url;
    } catch (err) {
      alert(err instanceof Error ? err.message : "Checkout failed");
      setPurchasingBookId(null);
    }
  };

  // Right-slot in the masthead changes by auth state.
  const rightSlot = session ? (
    <Link
      href="/dashboard"
      className="text-sm text-ink-2 hover:text-ink transition-colors"
    >
      Dashboard
    </Link>
  ) : (
    <Link
      href="/signup"
      className="inline-flex items-center justify-center px-3 py-1.5 text-xs font-medium bg-ink text-paper border border-ink hover:bg-ink-2 transition-colors"
    >
      Sign up free
    </Link>
  );

  return (
    <div className="min-h-screen flex flex-col bg-paper">
      <Masthead navItems={MASTHEAD_NAV} rightSlot={rightSlot} />

      <main className="flex-grow max-w-[1280px] mx-auto px-8 w-full">
        {/* Page header */}
        <section className="pt-14 pb-6">
          <Eyebrow className="block">§ THE CATALOG</Eyebrow>
          <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-14 items-end mt-3">
            <h1 className="font-serif text-[clamp(36px,4.4vw,56px)] leading-[1.05] tracking-display m-0">
              The shelves in print.
              <br />
              <em className="italic">Every category</em> your fleet reads.
            </h1>
            <p className="font-serif italic text-ink-2 text-base leading-[1.6] m-0 max-w-[44ch]">
              Each title is editorially indexed, density-tested for token
              efficiency, and priced per volume — a one-time purchase, never a
              subscription.
            </p>
          </div>
        </section>

        {/* Filter / search / sort row */}
        <div className="border-t-2 border-ink border-b border-rule py-4 flex gap-4 items-center flex-wrap">
          <Eyebrow>SHELVES</Eyebrow>
          <div className="flex gap-1.5 flex-wrap flex-1">
            {domains.map((d) => {
              const isActive = activeDomain === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setActiveDomain(d.id)}
                  className={[
                    "inline-flex items-center gap-1.5 rounded-full border",
                    "px-2.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em]",
                    "transition-colors",
                    isActive
                      ? "bg-ink text-paper border-ink"
                      : "bg-transparent text-ink-2 border-rule hover:border-ink",
                  ].join(" ")}
                >
                  {d.label}
                  <span className="opacity-60 ml-1">{d.count}</span>
                </button>
              );
            })}
          </div>
          <div className="flex gap-2.5 items-center">
            {/* PR 9 a11y — aria-label closes the placeholder-only loophole
                so screen readers announce the input's purpose; visible
                label would add chrome we don't want in this filter row. */}
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search titles & domains..."
              aria-label="Search catalog by title or domain"
              className="font-sans text-[13px] py-2 px-3 bg-paper border border-rule outline-none w-60 focus:border-ink"
            />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              aria-label="Sort catalog"
              className="font-mono text-[11px] tracking-[1px] py-2 px-2.5 bg-paper border border-rule uppercase focus:border-ink outline-none"
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  SORT · {SORT_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Result count strip */}
        <div className="py-4 flex justify-between items-baseline">
          <Eyebrow>
            {filtered.length} {filtered.length === 1 ? "VOLUME" : "VOLUMES"} ·
            SORTED BY {SORT_LABELS[sortBy]}
          </Eyebrow>
          <Eyebrow className="text-ink-3">PRICES IN USD · BILLED VIA STRIPE</Eyebrow>
        </div>

        {/* Grid */}
        <section className="pt-6 pb-20">
          {loading ? (
            <div className="text-center py-16 text-ink-3 text-sm">
              <div className="inline-block w-6 h-6 border-2 border-rule border-t-ink rounded-full animate-spin" />
              <p className="mt-4">Loading books…</p>
            </div>
          ) : error ? (
            <div className="text-center py-16">
              <p className="text-status-err text-sm">{error}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-ink-3">
              No volumes match those filters yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-12">
              {filtered.map((book) => {
                const pillVariant = PALETTE_PILL[book.palette];
                const isOwned = book.state === "granted";
                const isForSale = book.state === "for_sale";
                return (
                  <article key={book.id} className="flex flex-col">
                    <BookCover
                      book={{
                        title: book.title,
                        glyph: book.glyph,
                        domain: book.domain,
                        palette: book.palette,
                        vol: "Vol. 01",
                        version: "v1",
                        author: "—",
                      }}
                      size="lg"
                      className="w-full h-auto"
                    />
                    <div className="mt-5 pb-3">
                      <div className="flex justify-between items-baseline gap-2">
                        <Pill variant={pillVariant}>{humanDomain(book.domain)}</Pill>
                        <Eyebrow className="text-ink-3">V1</Eyebrow>
                      </div>
                      <h2 className="font-serif text-[22px] leading-[1.15] text-ink tracking-tight mt-3">
                        {book.title}
                      </h2>
                      {book.description ? (
                        <p className="text-ink-3 text-[13.5px] leading-[1.5] mt-3 mb-0 line-clamp-3">
                          {book.description}
                        </p>
                      ) : null}
                    </div>
                    <div className="mt-auto pt-3.5 border-t border-rule flex justify-between items-baseline">
                      <div>
                        <Eyebrow className="text-ink-3">PRICE</Eyebrow>
                      </div>
                      <div className="text-right">
                        <div className="font-serif text-[24px] num">
                          {formatPrice(book.unitAmountCents)}
                        </div>
                        {book.unitAmountCents ? (
                          <Eyebrow className="text-ink-3">One-time purchase</Eyebrow>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3.5">
                      {isOwned ? (
                        <div className="block bg-paper-2 border border-rule text-center py-3 text-sm font-medium text-ink">
                          ✓ Already owned
                        </div>
                      ) : isForSale ? (
                        <Button
                          type="button"
                          onClick={() => handleBuyNow(book.id)}
                          disabled={purchasingBookId === book.id}
                          size="md"
                          className="w-full"
                        >
                          {purchasingBookId === book.id
                            ? "Processing…"
                            : `Buy — ${formatPrice(book.unitAmountCents)} →`}
                        </Button>
                      ) : (
                        <div className="block border border-rule text-center py-3 text-sm text-ink-3">
                          Not available
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
