"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSession } from "next-auth/react";

// Phase 5 Stream H.4 (D15.12) — restore horizontal card layout to match
// the actual reference screenshot (Manus's Q1 answer was wrong; the
// screenshot itself shows horizontal cards, not vertical).
//
// Final layout — H.2 horizontal structure + H.3 styling tokens:
//
//   ┌──────────────────────────────────────────────┐
//   │  ┌──────┐  Badge                             │
//   │  │      │  Title (font-serif bold upright)   │
//   │  │ Cvr  │  Description (3 lines)             │
//   │  │ 3:4  │                                    │
//   │  │      │  $5.00                             │
//   │  │      │  One-time purchase                 │
//   │  └──────┘                                    │
//   ├──────────────────────────────────────────────┤
//   │           Buy Now — $5.00 (navy)             │
//   └──────────────────────────────────────────────┘
//
// All other style tokens unchanged from H.3:
//   - Navy CTA #0D1B2A / hover #051B2A
//   - Per-category badge colors (Manus's locked spec)
//   - Card rounded-lg, border #E5DCC8, overflow-hidden
//   - Title font-serif font-bold UPRIGHT (italic only on wordmark)
//   - Hero: single-line serif heading, one-sentence subtitle
//   - Header: non-sticky, flush against page background
//   - Loading spinner muted gray
//   - Already Owned: full-width bottom pill #F5F1E8 + #10B981 check
//   - Not Available: full-width bottom pill gray + lock SVG

interface BookWithPrice {
  id: string;
  title: string;
  description: string | null;
  domain: string;
  coverImageUrl: string | null;
  unitAmountCents: number | null;
  stripePriceId: string | null;
  state: "for_sale" | "not_for_sale" | "granted";
  grantSource: string | null;
}

function domainColour(domain: string): string {
  const palette = [
    "#D4E4F7", "#D4F0E4", "#F7E4D4", "#EAD4F7",
    "#F7D4E4", "#F7F0D4", "#D4F7F0", "#F0D4F7",
  ];
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    hash = domain.charCodeAt(i) + ((hash << 5) - hash);
  }
  return palette[Math.abs(hash) % palette.length];
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

const BADGE_BY_DOMAIN: Record<string, { label: string; bg: string; text: string }> = {
  "ci-diagnostics":      { label: "DevOps",                  bg: "bg-blue-50",     text: "text-blue-700" },
  "docker-patterns":     { label: "DevOps",                  bg: "bg-blue-50",     text: "text-blue-700" },
  "developer-marketing": { label: "Engineering Leadership",  bg: "bg-orange-50",   text: "text-orange-700" },
  "gifgrep":             { label: "Developer Tools",         bg: "bg-purple-50",   text: "text-purple-700" },
  "dogfood":             { label: "Product Management",      bg: "bg-indigo-50",   text: "text-indigo-700" },
  "node-connect":        { label: "Backend Development",     bg: "bg-cyan-50",     text: "text-cyan-700" },
};

function domainBadge(domain: string): { label: string; bg: string; text: string } {
  return BADGE_BY_DOMAIN[domain] ?? {
    label: humanDomain(domain),
    bg: "bg-gray-50",
    text: "text-gray-700",
  };
}

function CoverImage({ book }: { book: BookWithPrice }) {
  const [imgError, setImgError] = useState(false);

  // Stream H.5 — cover is full-bleed within its column (no rounded corners
  // of its own; the card's `overflow-hidden rounded-lg` clips the top-left
  // and bottom-left to match card edges). Sizing comes from the parent
  // column's `aspect-[3/4]` so the image fills naturally.
  if (book.coverImageUrl && !imgError) {
    return (
      <Image
        src={book.coverImageUrl}
        alt={`${book.title} cover`}
        fill
        className="object-cover"
        onError={() => setImgError(true)}
        sizes="(max-width: 768px) 40vw, (max-width: 1024px) 20vw, 160px"
      />
    );
  }

  const initial = book.domain.charAt(0).toUpperCase();
  const bg = domainColour(book.domain);
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ backgroundColor: bg }}
    >
      <span className="text-5xl font-bold text-gray-500 opacity-50 select-none tracking-tighter">
        {initial}
      </span>
    </div>
  );
}

function formatPrice(cents: number | null): string {
  if (!cents) return "Contact for pricing";
  return `$${(cents / 100).toFixed(2)}`;
}

export default function StorefrontPage() {
  const { data: session, status } = useSession();
  const [books, setBooks] = useState<BookWithPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [purchasingBookId, setPurchasingBookId] = useState<string | null>(null);

  useEffect(() => {
    const fetchBooks = async () => {
      try {
        const response = await fetch("/api/storefront/books");
        if (!response.ok) throw new Error("Failed to fetch books");
        const data = await response.json();
        setBooks(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    };
    fetchBooks();
  }, []);

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

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF6EC]">
      {/* ── Header — non-sticky, no border ── */}
      <header className="px-8 py-6 flex justify-between items-center">
        <Link href="/storefront" className="no-underline">
          <span className="font-serif italic text-2xl font-bold text-gray-900 tracking-tight">
            bkstr.tmrwgroup.ai
          </span>
        </Link>

        <nav className="flex items-center gap-6 text-sm font-semibold">
          {session ? (
            <>
              <Link
                href="/dashboard"
                className="text-gray-600 hover:text-gray-900 transition-colors"
              >
                Dashboard
              </Link>
              <span className="text-gray-300">|</span>
              <span className="text-gray-500 text-xs font-normal">{session.user?.email}</span>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="text-gray-600 hover:text-gray-900 transition-colors"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="bg-[#0D1B2A] text-[#FAF6EC] px-5 py-2.5 rounded-md text-sm font-semibold hover:bg-[#051B2A] transition-colors"
              >
                Sign up
              </Link>
            </>
          )}
        </nav>
      </header>

      {/* ── Main ── */}
      <main className="flex-grow px-6 pb-14 max-w-screen-2xl mx-auto w-full">
        {/* Hero — single-line serif heading, one-sentence subtitle */}
        <section className="text-center max-w-4xl mx-auto mt-8 mb-14">
          <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl font-bold leading-tight tracking-tight mb-5 text-gray-900">
            Compressed Knowledge for AI Agents
          </h1>
          <p className="text-lg text-gray-500 leading-relaxed">
            Purchase domain expertise packaged as high-density, machine-first books.
          </p>
        </section>

        {/* Books Grid */}
        <section>
          {loading ? (
            <div className="text-center py-16">
              <div className="inline-block w-6 h-6 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
              <p className="text-gray-400 mt-4 text-sm">Loading books…</p>
            </div>
          ) : error ? (
            <div className="text-center py-16">
              <p className="text-red-500 text-sm">Failed to load books. Please refresh.</p>
            </div>
          ) : books.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-gray-400 text-sm">No books available at this time.</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
              {books.map((book) => {
                const badge = domainBadge(book.domain);
                return (
                  <article
                    key={book.id}
                    className="bg-white border border-[#E5DCC8] rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-200 flex flex-col h-full"
                  >
                    {/* TOP: horizontal flex — cover-left full-bleed, content-right padded.
                        Stream H.5: removed padding from the top container + removed cover
                        column's internal aspect wrapper so the image flushes to the card's
                        left and top edges (clipped by parent overflow-hidden).
                        Stream H.7: `items-start` keeps cover at its natural 3:4 aspect
                        instead of stretching to match content height — creates the
                        white-space gap below the cover before the bottom CTA, matching
                        the reference screenshot.
                        Stream H.8: `pb-6` on the top flex container adds 24px below the
                        tallest column (cover or content) before the bottom CTA — gives
                        visible breathing room matching the reference. */}
                    <div className="flex flex-grow items-start pb-6">
                      {/* Cover column: ~40% of card width, 3:4 portrait, full-bleed.
                          relative + aspect-[3/4] so `<Image fill>` knows the column geometry. */}
                      <div className="relative w-2/5 flex-shrink-0 aspect-[3/4] bg-gray-50">
                        <CoverImage book={book} />
                      </div>

                      {/* Content column: padded */}
                      <div className="flex-1 p-5 flex flex-col min-w-0">
                        {/* Badge */}
                        <div className="mb-2">
                          <span
                            className={`inline-block ${badge.bg} ${badge.text} text-xs font-medium px-2.5 py-1 rounded-full`}
                          >
                            {badge.label}
                          </span>
                        </div>

                        {/* Title — upright bold serif, larger */}
                        <h2 className="font-serif text-xl font-bold text-gray-900 mb-2 leading-snug">
                          {book.title}
                        </h2>

                        {/* Description */}
                        <p className="text-sm text-gray-500 mb-4 flex-grow line-clamp-3 leading-relaxed">
                          {book.description ?? "No description yet."}
                        </p>

                        {/* Price — stacked at bottom of content column */}
                        <div className="mt-auto">
                          <div className="text-2xl font-bold text-gray-900 leading-none">
                            {formatPrice(book.unitAmountCents)}
                          </div>
                          {book.unitAmountCents && (
                            <div className="text-xs text-gray-400 mt-1">One-time purchase</div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* BOTTOM: full-width CTA, flush against card edges */}
                    {book.state === "granted" ? (
                      <div className="bg-[#F5F1E8] py-3 px-6 text-center text-sm font-bold text-gray-700 flex items-center justify-center gap-2">
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="#10B981"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2.5}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                        Already Owned
                      </div>
                    ) : book.state === "for_sale" ? (
                      <button
                        onClick={() => handleBuyNow(book.id)}
                        disabled={purchasingBookId === book.id}
                        className="w-full bg-[#0D1B2A] hover:bg-[#051B2A] text-[#FAF6EC] py-3 px-6 font-bold text-sm tracking-wide transition-colors disabled:opacity-50"
                      >
                        {purchasingBookId === book.id
                          ? "Processing…"
                          : `Buy Now — ${formatPrice(book.unitAmountCents)}`}
                      </button>
                    ) : (
                      <div className="bg-gray-100 py-3 px-6 text-center text-sm font-bold text-gray-500 flex items-center justify-center gap-2">
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 11c0-1.1.9-2 2-2s2 .9 2 2v3M5 11h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2v-8a2 2 0 012-2z"
                          />
                        </svg>
                        Not Available
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-[#E5DCC8] py-8 px-6 mt-12">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-gray-400">
          <span>&copy; 2026 Tmrwgroup. All rights reserved.</span>
          <div className="flex gap-6">
            <Link href="/about" className="hover:text-gray-600 transition-colors">About</Link>
            <Link href="/login" className="hover:text-gray-600 transition-colors">Log in</Link>
            <Link href="/signup" className="hover:text-gray-600 transition-colors">Sign up</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
