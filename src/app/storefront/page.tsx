"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSession } from "next-auth/react";

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

// Generate a consistent pastel background colour from a domain string.
// Used for the placeholder tile when no cover image is uploaded.
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

function CoverImage({ book }: { book: BookWithPrice }) {
  const [imgError, setImgError] = useState(false);

  if (book.coverImageUrl && !imgError) {
    return (
      <div className="relative w-full h-40 rounded-lg overflow-hidden mb-4">
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

  // Fallback: domain-initial tile
  const initial = book.domain.charAt(0).toUpperCase();
  const bg = domainColour(book.domain);
  return (
    <div
      className="w-full h-40 rounded-lg mb-4 flex items-center justify-center"
      style={{ backgroundColor: bg }}
    >
      <span className="text-4xl font-bold text-gray-600 opacity-60 select-none">
        {initial}
      </span>
    </div>
  );
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
      window.location.href = "/login";
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

  const formatPrice = (cents: number | null) => {
    if (!cents) return "Contact for pricing";
    return `$${(cents / 100).toFixed(2)}`;
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF6EC]">
      {/* Header */}
      <header className="p-6 flex justify-between items-center bg-[#FAF6EC]/80 backdrop-blur-sm sticky top-0 z-10 border-b border-[#E5DCC8]">
        <div className="text-2xl font-bold tracking-tighter serif italic">
          bkstr
          <span
            className="text-gray-400 font-normal text-lg not-italic"
            style={{ fontFamily: "'Inter', sans-serif" }}
          >
            .tmrwgroup.ai
          </span>
        </div>
        <nav className="space-x-6 text-sm font-semibold flex items-center">
          {session ? (
            <>
              <Link href="/dashboard" className="text-gray-600 hover:text-black transition-colors">
                Dashboard
              </Link>
              <span className="text-gray-400">|</span>
              <span className="text-gray-600 text-xs">{session.user?.email}</span>
            </>
          ) : (
            <>
              <Link href="/login" className="text-gray-600 hover:text-black transition-colors">
                Log in
              </Link>
              <Link
                href="/signup"
                className="accent-bg text-[#FAF6EC] px-5 py-2.5 rounded-sm hover:bg-black transition-colors"
              >
                Sign up
              </Link>
            </>
          )}
        </nav>
      </header>

      {/* Main Content */}
      <main className="flex-grow px-6 py-16 max-w-7xl mx-auto w-full">
        {/* Hero */}
        <section className="text-center max-w-3xl mx-auto mb-16">
          <h1 className="text-5xl md:text-6xl font-bold leading-tight mb-6">
            Compressed Knowledge for AI Agents
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            Purchase domain expertise packaged as high-density, machine-first books. Equip your agents
            with the exact context they need to perform measurably better.
          </p>
        </section>

        {/* Books Grid */}
        <section>
          {loading ? (
            <div className="text-center py-12">
              <p className="text-gray-500">Loading books…</p>
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-red-600">Error: {error}</p>
            </div>
          ) : books.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500">No books available at this time.</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {books.map((book) => (
                <div
                  key={book.id}
                  className="bg-white border border-[#E5DCC8] p-6 rounded-xl hover:shadow-lg transition-shadow flex flex-col"
                >
                  {/* Cover Image or Placeholder */}
                  <CoverImage book={book} />

                  {/* Domain Badge */}
                  <div className="mb-3">
                    <span className="bg-[#EAE2D0] text-xs font-bold px-3 py-1 rounded text-gray-700">
                      {book.domain}
                    </span>
                  </div>

                  {/* Title */}
                  <h3 className="text-lg font-bold mb-2 text-gray-900">{book.title}</h3>

                  {/* Description */}
                  {book.description ? (
                    <p className="text-sm text-gray-600 mb-4 flex-grow line-clamp-3">
                      {book.description}
                    </p>
                  ) : (
                    <p className="text-sm text-gray-400 mb-4 flex-grow italic">No description yet.</p>
                  )}

                  {/* Price */}
                  <div className="mb-5">
                    <div className="text-2xl font-bold text-gray-900">
                      {formatPrice(book.unitAmountCents)}
                    </div>
                    <p className="text-xs text-gray-500">One-time purchase</p>
                  </div>

                  {/* Action Button */}
                  {book.state === "granted" ? (
                    <div className="bg-[#EAE2D0] text-gray-700 px-4 py-3 rounded-lg font-semibold text-center text-sm">
                      ✓ Already Owned
                      {book.grantSource && (
                        <span className="text-xs text-gray-500 ml-1">({book.grantSource.toLowerCase()})</span>
                      )}
                    </div>
                  ) : book.state === "for_sale" ? (
                    <button
                      onClick={() => handleBuyNow(book.id)}
                      disabled={purchasingBookId === book.id}
                      className="w-full accent-bg text-[#FAF6EC] px-4 py-3 rounded-lg font-bold hover:bg-black transition-colors disabled:opacity-50 text-sm"
                    >
                      {purchasingBookId === book.id
                        ? "Processing…"
                        : `Buy Now — ${formatPrice(book.unitAmountCents)}`}
                    </button>
                  ) : (
                    <button
                      disabled
                      className="w-full bg-gray-200 text-gray-500 px-4 py-3 rounded-lg font-bold cursor-not-allowed text-sm"
                    >
                      Not Available
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-[#EFE8D8] border-t border-[#E5DCC8] py-8 px-6 mt-16">
        <div className="max-w-7xl mx-auto text-center text-sm text-gray-600">
          <p>&copy; 2026 Tmrwgroup. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
