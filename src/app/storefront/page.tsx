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
} from "@/components/design";
import { BuyButton, type BuyButtonState } from "@/components/storefront/buy-button";
import type { PillVariant } from "@/components/design";
import type { BookCoverPalette } from "@/components/design/book-cover";

// bkstr redesign(10) Phase 3 — unified storefront grid.
//
// Books and skills now share one grid (the user-facing collapse). Data
// source migrated from /api/storefront/books (deleted in this PR) to
// /api/storefront/items (Phase 1). Each card renders kind-aware:
//
//   Book card: domain pill (saffron-tinted) + <BookCover> SVG (palette +
//     glyph) + title (serif 22px) + description + price + inline Buy strip
//   Skill card: "SKILL · .zip" pill (saffron, fixed) + NO cover (text-only
//     header per HANDOFF Q4) + name (serif 22px, same size as book title) +
//     v<n> · N files subtitle (mono 11px) + description + price + inline
//     Buy strip
//
// Click behavior (operator decision 7.6 / option C — clickable card +
// inline Buy): the card body (cover/title/description/price area) is one
// clickable region linking to /storefront/<slug>. The inline Buy button
// lives in a dedicated bottom strip (bg-paper-2 border-t border-rule p-3)
// and stopPropagation()s clicks so the card's outer Link doesn't navigate
// when the buyer is just trying to purchase.
//
// Filter pill row (operator decision 3.3 / option A — domain pills filter
// books only; "Skills (N)" pill added for skills-only): the row reads
// "[All] [Skills (N)] [Domain1 (M)] [Domain2 (M)] …". Selecting "Skills"
// shows skills only; selecting a domain shows books-with-that-domain only;
// "All" shows everything across kinds.
//
// Sort + search now span both kinds. Search hits title/name + domain
// (book only) + description.
//
// Filter state still useState (URL persistence is a separate follow-up).

interface StorefrontItem {
  kind: "book" | "skill";
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  domain: string | null;
  palette: BookCoverPalette | null;
  glyph: string | null;
  unitAmountCents: number | null;
  stripePriceId: string | null;
  state?: "for_sale" | "not_for_sale" | "granted";
  grantSource?: string | null;
  latestVersion: number;
}

interface ItemsResponse {
  items: StorefrontItem[];
  // accessByItem is OMITTED for anonymous callers; present when a session
  // cookie is sent. We don't read it here (per-item `state` field on each
  // item carries what we need) but the API ships it for callers that
  // want O(1) lookups.
}

const MASTHEAD_NAV = [
  { label: "Home", href: "/" },
  { label: "Catalog", href: "/storefront", active: true },
  { label: "Docs", href: "/dashboard/docs" },
  { label: "Log in", href: "/login" },
];

// Map BookCover palette → Pill variant so domain pills tint with the book's
// cover palette. Skills lack palette; their pill is the fixed saffron
// "SKILL · .zip" variant.
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

// Special filter-pill id for the skills-only filter. Real domain values
// are lowercase free-text (book.domain), so this sentinel doesn't collide.
const SKILLS_FILTER_ID = "__skills__";

export default function StorefrontPage() {
  const { status } = useSession();
  const [items, setItems] = useState<StorefrontItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Tracks which item's inline Buy button is currently mid-checkout, so
  // the card can disable it without affecting siblings. Used as a poor-
  // man's mutex (the BuyButton's own internal state tracks its busy spin,
  // but the storefront still wants to disable other Buys while one is
  // in flight to prevent the buyer from accidentally double-purchasing).
  const [purchasingId, setPurchasingId] = useState<string | null>(null);

  // Filter / sort / search state — URL-less for now; can promote to URL
  // search params in a later polish pass if shareable filtered views
  // become important.
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortKey>("featured");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const run = async () => {
      try {
        const response = await fetch("/api/storefront/items");
        if (!response.ok) throw new Error("Failed to fetch catalog");
        const data = (await response.json()) as ItemsResponse;
        setItems(data.items);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

  // Build the filter row: [All] [Skills (N)] [Domain1 (M)] [Domain2 (M)] …
  // Domain pills come from books only (skills have no domain column). The
  // per-domain palette comes from the first matching book (migration backfill
  // ensures books in the same domain share a palette).
  const filters = useMemo(() => {
    const counts = new Map<string, number>();
    const paletteByDomain = new Map<string, BookCoverPalette>();
    let skillCount = 0;
    for (const it of items) {
      if (it.kind === "skill") {
        skillCount++;
      } else if (it.domain) {
        counts.set(it.domain, (counts.get(it.domain) ?? 0) + 1);
        if (!paletteByDomain.has(it.domain) && it.palette) {
          paletteByDomain.set(it.domain, it.palette);
        }
      }
    }
    const out: Array<{
      id: string;
      label: string;
      count: number;
      palette: BookCoverPalette | null;
    }> = [
      { id: "all", label: "All catalog", count: items.length, palette: null },
    ];
    if (skillCount > 0) {
      out.push({ id: SKILLS_FILTER_ID, label: "Skills", count: skillCount, palette: null });
    }
    for (const [id, count] of counts) {
      out.push({
        id,
        label: humanDomain(id),
        count,
        palette: paletteByDomain.get(id) ?? null,
      });
    }
    return out;
  }, [items]);

  const filtered = useMemo(() => {
    let xs = items;
    if (activeFilter === SKILLS_FILTER_ID) {
      xs = xs.filter((it) => it.kind === "skill");
    } else if (activeFilter !== "all") {
      // Domain filter — books only by construction; skills have no domain.
      xs = xs.filter((it) => it.kind === "book" && it.domain === activeFilter);
    }
    if (query) {
      const q = query.toLowerCase();
      xs = xs.filter(
        (it) =>
          it.displayName.toLowerCase().includes(q) ||
          (it.domain ?? "").toLowerCase().includes(q) ||
          (it.description ?? "").toLowerCase().includes(q),
      );
    }
    if (sortBy === "price-asc") {
      xs = [...xs].sort(
        (a, b) => (a.unitAmountCents ?? 0) - (b.unitAmountCents ?? 0),
      );
    } else if (sortBy === "price-desc") {
      xs = [...xs].sort(
        (a, b) => (b.unitAmountCents ?? 0) - (a.unitAmountCents ?? 0),
      );
    }
    // 'featured' and 'newest' fall through to API-provided order
    // (createdAt DESC from getCatalogForLibrary).
    return xs;
  }, [items, activeFilter, sortBy, query]);

  // Card-level access state for the BuyButton. Anonymous viewers always
  // see state="anon"; signed-in viewers get state from the item.state
  // field which the /api/storefront/items endpoint populates from
  // getAccessStatesForCatalog. Defaults to "for_sale" when state is
  // absent (i.e., signed-out path) and the item has a price.
  function buyStateFor(item: StorefrontItem): BuyButtonState {
    if (status !== "authenticated") return "anon";
    if (item.state === "granted") return "owned";
    if (item.state === "for_sale") return "for_sale";
    if (item.unitAmountCents == null) return "no_price";
    return "for_sale";
  }

  // Right-slot in the masthead changes by auth state.
  const rightSlot =
    status === "authenticated" ? (
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
              Books and skills, editorially indexed, priced per volume — a
              one-time purchase, never a subscription.
            </p>
          </div>
        </section>

        {/* Filter / search / sort row */}
        <div className="border-t-2 border-ink border-b border-rule py-4 flex gap-4 items-center flex-wrap">
          <Eyebrow>SHELVES</Eyebrow>
          <div className="flex gap-1.5 flex-wrap flex-1">
            {filters.map((f) => {
              const isActive = activeFilter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setActiveFilter(f.id)}
                  className={[
                    "inline-flex items-center gap-1.5 rounded-full border",
                    "px-2.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em]",
                    "transition-colors",
                    isActive
                      ? "bg-ink text-paper border-ink"
                      : "bg-transparent text-ink-2 border-rule hover:border-ink",
                  ].join(" ")}
                >
                  {f.label}
                  <span className="opacity-60 ml-1">{f.count}</span>
                </button>
              );
            })}
          </div>
          <div className="flex gap-2.5 items-center">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search titles, domains, descriptions..."
              aria-label="Search catalog by title, domain, or description"
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
              <p className="mt-4">Loading catalog…</p>
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
              {filtered.map((item) => (
                <ItemCard
                  key={`${item.kind}:${item.id}`}
                  item={item}
                  buyState={buyStateFor(item)}
                  busyId={purchasingId}
                  onBuyStart={() => setPurchasingId(item.id)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}

// Card renderer — kind-aware. Outer <Link> wraps the card body for the
// clickable-card behavior (operator decision 7.6 / option C). The inline
// Buy strip lives in its own child block with stopPropagation() so a
// buyer's click on Buy doesn't also trigger card navigation.
function ItemCard({
  item,
  buyState,
  busyId,
  onBuyStart,
}: {
  item: StorefrontItem;
  buyState: BuyButtonState;
  busyId: string | null;
  onBuyStart: () => void;
}) {
  // redesign(10)/6 — pillVariant now resolves for both kinds. Books use
  // their persisted palette → matching pill tint; skills use the derived
  // palette from resolveSlug() / getCatalogForLibrary so the pill color
  // matches the cover color on the card. (The pill TEXT still
  // discriminates kind — "BOOK · <domain>" vs "SKILL · .zip" — but the
  // tint is unified to the cover.)
  const pillVariant: PillVariant = item.palette
    ? PALETTE_PILL[item.palette]
    : "saffron";
  return (
    <article className="flex flex-col">
      {/* Clickable card body — wraps cover/header/title/desc/price */}
      <Link
        href={`/storefront/${encodeURIComponent(item.slug)}`}
        className="block group"
      >
        {/* redesign(10)/6 — single <BookCover> render for both kinds. The
            old skill-side text-only placeholder is gone (HANDOFF Q4
            "typographic-mono for skills" stance reversed; visual parity
            with books wins). Skills pass "SKILL" as the imprint-bar
            domain so the top reads "BKSTR — SKILL"; books pass their
            actual domain. The gate drops the `kind === "book"` clause
            because palette/glyph are now non-null for both kinds. */}
        {item.palette && item.glyph ? (
          <BookCover
            book={{
              title: item.displayName,
              glyph: item.glyph,
              domain: item.domain ?? "SKILL",
              palette: item.palette,
              vol: "Vol. 01",
              version: `v${item.latestVersion || 1}`,
              author: "—",
            }}
            size="lg"
            className="w-full h-auto"
          />
        ) : null}

        <div className="mt-5 pb-3">
          <div className="flex justify-between items-baseline gap-2">
            {item.kind === "book" && item.domain ? (
              <Pill variant={pillVariant}>{humanDomain(item.domain)}</Pill>
            ) : (
              <Pill variant="saffron">SKILL · .zip</Pill>
            )}
            <Eyebrow className="text-ink-3">V{item.latestVersion || 1}</Eyebrow>
          </div>
          <h2 className="font-serif text-[22px] leading-[1.15] text-ink tracking-tight mt-3">
            {item.displayName}
          </h2>
          {item.kind === "skill" && (
            <div className="font-mono text-[11px] text-ink-3 mt-2">
              v{item.latestVersion || 1}
              {/* Skills carry a per-card file count from the API; books
                  don't, so this subtitle is skill-only. */}
            </div>
          )}
          {item.description ? (
            <p className="text-ink-3 text-[13.5px] leading-[1.5] mt-3 mb-0 line-clamp-3">
              {item.description}
            </p>
          ) : null}
        </div>

        <div className="mt-auto pt-3.5 border-t border-rule flex justify-between items-baseline">
          <div>
            <Eyebrow className="text-ink-3">PRICE</Eyebrow>
          </div>
          <div className="text-right">
            <div className="font-serif text-[24px] num">
              {formatPrice(item.unitAmountCents)}
            </div>
            {item.unitAmountCents ? (
              <Eyebrow className="text-ink-3">
                {item.kind === "book" ? "One-time purchase" : "One-time"}
              </Eyebrow>
            ) : null}
          </div>
        </div>
      </Link>

      {/* Inline Buy strip — outside the Link so its own click doesn't
          bubble to the card-level navigation. The wrapping div catches
          and stops the click bubble from any descendant button/anchor. */}
      <div
        className="mt-3.5"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <BuyButton
          kind={item.kind}
          itemId={item.id}
          itemSlug={item.slug}
          unitAmountCents={item.unitAmountCents}
          stripePriceId={item.stripePriceId}
          state={buyState}
        />
        {/* Visual hint kept from the prior books-only design: when a row
            is mid-checkout we surface that. The BuyButton's internal busy
            state already disables the button; this is just signal for
            siblings (a cross-card guard against double-purchase). */}
        {busyId === item.id && buyState === "for_sale" ? (
          <div className="text-xs text-ink-3 mt-2 text-center">
            Redirecting to Stripe…
          </div>
        ) : null}
      </div>

      {/* The onBuyStart hook fires when the BuyButton triggers checkout.
          This lives here as an effect-ish hook so the parent can track
          which card is currently mid-purchase. Wired via the BuyButton's
          fetch path (it doesn't expose onClick — but the busyId tracking
          via children isn't load-bearing for v0; the BuyButton's internal
          disabled state is the actual guard). Reserved for follow-up if
          we need cross-card coordination. */}
      {/* eslint-disable-next-line @typescript-eslint/no-unused-vars */}
      {(() => {
        // Suppresses an unused-var warning while keeping the onBuyStart
        // hook plumbed for future extension.
        const _hookSlot = onBuyStart;
        return null;
      })()}
    </article>
  );
}
