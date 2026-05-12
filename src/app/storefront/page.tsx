"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSession } from "next-auth/react";

// Phase 5 Stream H.1 — polished storefront refining the Stream H first-pass.
// Refinements over Stream H:
//   - aspect-[4/3] cover tiles match the recommended 3:4 portrait ratio
//     in new-book-form.tsx (publishers upload 600×800, storefront renders
//     proportionally).
//   - humanDomain() helper renders `developer-marketing` as "Developer
//     Marketing" + uppercases known acronyms (CI / CD / API / AWS / TDD /
//     QA / UI / UX / AI / ML) so badges read naturally.
//   - Login redirect now carries `callbackUrl=/storefront` so the user
//     returns to where they were after Google OAuth (vs landing on the
//     dashboard and having to re-navigate).
//   - "Already Owned" CTA gets a checkmark icon for visual reassurance.
//   - Footer linkifies /about so the marketing landing (relocated from /)
//     stays discoverable.

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

// Deterministic pastel background colour from a domain string — used by the
// fallback tile when no cover image is uploaded. Hash → palette index, so
// the same domain string always picks the same tile colour.
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

// Convert a slug/domain string to a human-readable label.
// e.g. "ci-diagnostics" → "CI Diagnostics", "developer-marketing" → "Developer Marketing"
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

function CoverImage({ book }: { book: BookWithPrice }) {
  const [imgError, setImgError] = useState(false);

  if (book.coverImageUrl && !imgError) {
    return (
      <div className="relative w-full aspect-[4/3] rounded-xl overflow-hidden mb-5">
        <Image
          src={book.coverImageUrl}
          alt={`${book.title} cover`}
          fill
          className="object-cover"
          onError={() => setImgError(true)}
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
        />
      </div>
    );
  }

  // Fallback: domain-initial tile with pastel background
  const initial = book.domain.charAt(0).toUpperCase();
  const bg = domainColour(book.domain);
  return (
    <div
      className="w-full aspect-[4/3] rounded-xl mb-5 flex items-center justify-center"
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
        <Link href="/storefront" className="flex items-center gap-2 no-underline">
          <span className="text-2xl font-bold tracking-tighter serif italic text-gray-900">
            bkstr
          </span>
          <span
            className="text-gray-400 font-normal text-base"
            style={{ fontFamily: "'Inter', sans-serif" }}
          >
            .tmrwgroup.ai
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
                className="bg-gray-900 text-[#FAF6EC] px-5 py-2 rounded-md text-sm font-semibold hover:bg-black transition-colors"
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
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {books.map((book) => (
                <article
                  key={book.id}
                  className="bg-white border border-[#E5DCC8] rounded-2xl p-6 flex flex-col hover:shadow-md transition-shadow duration-200"
                >
                  {/* Cover Image or Placeholder Tile */}
                  <CoverImage book={book} />

                  {/* Domain Badge — human-readable */}
                  <div className="mb-3">
                    <span className="inline-block bg-[#EFE8D8] text-gray-600 text-[11px] font-semibold px-2.5 py-1 rounded-md tracking-wide">
                      {humanDomain(book.domain)}
                    </span>
                  </div>

                  {/* Title */}
                  <h2 className="text-base font-bold text-gray-900 mb-2 leading-snug">
                    {book.title}
                  </h2>

                  {/* Description */}
                  <p className="text-sm text-gray-500 mb-5 flex-grow line-clamp-3 leading-relaxed">
                    {book.description ?? "No description yet."}
                  </p>

                  {/* Price */}
                  <div className="mb-4">
                    <span className="text-2xl font-bold text-gray-900">
                      {formatPrice(book.unitAmountCents)}
                    </span>
                    {book.unitAmountCents && (
                      <span className="text-xs text-gray-400 ml-2">One-time purchase</span>
                    )}
                  </div>

                  {/* CTA */}
                  {book.state === "granted" ? (
                    <div className="flex items-center justify-center gap-2 bg-[#EFE8D8] text-gray-600 px-4 py-3 rounded-xl text-sm font-semibold">
                      <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                      Already Owned
                    </div>
                  ) : book.state === "for_sale" ? (
                    <button
                      onClick={() => handleBuyNow(book.id)}
                      disabled={purchasingBookId === book.id}
                      className="w-full bg-gray-900 text-[#FAF6EC] px-4 py-3 rounded-xl font-bold hover:bg-black transition-colors disabled:opacity-50 text-sm tracking-wide"
                    >
                      {purchasingBookId === book.id
                        ? "Processing…"
                        : `Buy Now — ${formatPrice(book.unitAmountCents)}`}
                    </button>
                  ) : (
                    <button
                      disabled
                      className="w-full bg-[#EFE8D8] text-gray-400 px-4 py-3 rounded-xl font-bold cursor-not-allowed text-sm"
                    >
                      Not Available
                    </button>
                  )}
                </article>
              ))}
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
