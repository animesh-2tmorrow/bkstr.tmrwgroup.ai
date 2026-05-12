"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSession } from "next-auth/react";

// Phase 5 Stream H.2 (D15.10) — storefront redesign matching Manus's
// reference screenshot. Card layout switches from VERTICAL (cover-top,
// content-below) to HORIZONTAL (cover-left, content-right) so each book
// shows like a physical shelf card: portrait cover beside its metadata.
//
// Other refinements from Manus's design vs Stream H.1's first cut:
//   - Cover aspect changes from 4:3 landscape to 3:4 portrait (the S3
//     PNGs are already portrait-rendered book mockups; this lets them
//     display at their natural proportions).
//   - Per-category domain badges with pastel backgrounds (slug →
//     {label, colors} mapping; falls back to humanDomain() for any
//     unknown slug). Long-term — see follow-up #105 — the seed
//     books.domain column may move to the higher-level category labels
//     directly so this mapping isn't load-bearing.
//   - Header brand renders as one continuous bold italic line
//     "bkstr.tmrwgroup.ai" instead of split styling.
//   - CTA buttons use a dark navy (#1A2B4D) — matches the screenshot's
//     "Sign up" + "Buy Now" buttons more faithfully than gray-900.
//   - Grid breakpoints widen: 1 col mobile → 2 cols at md (768px) →
//     3 cols at xl (1280px) so horizontal cards never feel cramped.

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

// Deterministic pastel background for the fallback tile when a book has
// no cover image. Hash → palette index; same domain always picks the same
// colour so the tile is stable across renders.
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

// Humanize a slug-like domain string for fallback rendering.
// e.g. "ci-diagnostics" → "CI Diagnostics".
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

// Slug → display badge mapping. The seed books.domain column stores
// granular slugs (`ci-diagnostics`, `developer-marketing`, etc.); the
// display surface groups them into higher-level categories (DevOps,
// Engineering Leadership, etc.) per Manus's design. Per-category Tailwind
// pastel pairs picked so each badge is legible on white card backgrounds.
// Fallback: humanDomain() label on a neutral gray pill.
//
// Follow-up #105 tracks the option of moving these labels into the
// books.domain column itself, retiring this mapping.
const BADGE_BY_DOMAIN: Record<string, { label: string; bg: string; text: string }> = {
  "ci-diagnostics":      { label: "DevOps",                  bg: "bg-blue-50",     text: "text-blue-700" },
  "docker-patterns":     { label: "DevOps",                  bg: "bg-blue-50",     text: "text-blue-700" },
  "developer-marketing": { label: "Engineering Leadership",  bg: "bg-orange-50",   text: "text-orange-700" },
  "gifgrep":             { label: "Developer Tools",         bg: "bg-emerald-50",  text: "text-emerald-700" },
  "dogfood":             { label: "Product Management",      bg: "bg-pink-50",     text: "text-pink-700" },
  "node-connect":        { label: "Backend Development",     bg: "bg-indigo-50",   text: "text-indigo-700" },
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

  if (book.coverImageUrl && !imgError) {
    return (
      <div className="relative w-full aspect-[3/4] rounded-lg overflow-hidden">
        <Image
          src={book.coverImageUrl}
          alt={`${book.title} cover`}
          fill
          className="object-cover"
          onError={() => setImgError(true)}
          sizes="160px"
        />
      </div>
    );
  }

  // Fallback: domain-initial tile with pastel background
  const initial = book.domain.charAt(0).toUpperCase();
  const bg = domainColour(book.domain);
  return (
    <div
      className="w-full aspect-[3/4] rounded-lg flex items-center justify-center"
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
      {/* ── Header ── */}
      <header className="px-8 py-5 flex justify-between items-center bg-[#FAF6EC]/90 backdrop-blur-sm sticky top-0 z-10 border-b border-[#E5DCC8]">
        <Link href="/storefront" className="no-underline">
          <span className="text-2xl font-bold tracking-tighter serif italic text-gray-900">
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
                className="bg-[#1A2B4D] text-[#FAF6EC] px-5 py-2 rounded-md text-sm font-semibold hover:bg-[#0F1B33] transition-colors"
              >
                Sign up
              </Link>
            </>
          )}
        </nav>
      </header>

      {/* ── Main ── */}
      <main className="flex-grow px-6 py-14 max-w-6xl mx-auto w-full">
        {/* Hero */}
        <section className="text-center max-w-2xl mx-auto mb-14">
          <h1 className="text-5xl font-bold leading-tight tracking-tight mb-5 text-gray-900">
            Compressed Knowledge<br />for AI Agents
          </h1>
          <p className="text-lg text-gray-500 leading-relaxed">
            Purchase domain expertise packaged as high-density, machine-first books. Equip
            your agents with the exact context they need to perform measurably better.
          </p>
        </section>

        {/* Books Grid */}
        <section>
          {loading ? (
            <div className="text-center py-16">
              <div className="inline-block w-6 h-6 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin" />
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
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-8">
              {books.map((book) => {
                const badge = domainBadge(book.domain);
                return (
                  <article
                    key={book.id}
                    className="bg-white border border-[#E5DCC8] rounded-2xl p-5 flex gap-5 hover:shadow-md transition-shadow duration-200 h-full"
                  >
                    {/* Left: cover (3:4 portrait, fixed width) */}
                    <div className="w-36 flex-shrink-0">
                      <CoverImage book={book} />
                    </div>

                    {/* Right: content */}
                    <div className="flex-1 flex flex-col min-w-0">
                      {/* Domain badge — per-category color */}
                      <div className="mb-2">
                        <span
                          className={`inline-block ${badge.bg} ${badge.text} text-[11px] font-semibold px-2.5 py-1 rounded-full tracking-wide`}
                        >
                          {badge.label}
                        </span>
                      </div>

                      {/* Title */}
                      <h2 className="text-lg font-bold text-gray-900 mb-2 leading-snug">
                        {book.title}
                      </h2>

                      {/* Description */}
                      <p className="text-sm text-gray-500 mb-4 flex-grow line-clamp-3 leading-relaxed">
                        {book.description ?? "No description yet."}
                      </p>

                      {/* Price */}
                      <div className="mb-3">
                        <span className="text-2xl font-bold text-gray-900">
                          {formatPrice(book.unitAmountCents)}
                        </span>
                        {book.unitAmountCents && (
                          <span className="text-xs text-gray-400 ml-2">One-time purchase</span>
                        )}
                      </div>

                      {/* CTA */}
                      {book.state === "granted" ? (
                        <div className="flex items-center justify-center gap-2 bg-[#EFE8D8] text-gray-600 px-4 py-2.5 rounded-lg text-sm font-semibold">
                          <svg
                            className="w-4 h-4 text-green-600"
                            fill="none"
                            stroke="currentColor"
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
                          className="w-full bg-[#1A2B4D] text-[#FAF6EC] px-4 py-2.5 rounded-lg font-bold hover:bg-[#0F1B33] transition-colors disabled:opacity-50 text-sm tracking-wide"
                        >
                          {purchasingBookId === book.id
                            ? "Processing…"
                            : `Buy Now — ${formatPrice(book.unitAmountCents)}`}
                        </button>
                      ) : (
                        <button
                          disabled
                          className="w-full bg-[#EFE8D8] text-gray-400 px-4 py-2.5 rounded-lg font-bold cursor-not-allowed text-sm"
                        >
                          Not Available
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-[#E5DCC8] py-8 px-6 mt-12">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-gray-400">
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
