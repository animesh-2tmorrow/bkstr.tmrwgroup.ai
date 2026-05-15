import Link from "next/link";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import {
  AuthShell,
  Eyebrow,
  BookCover,
  type BookCoverData,
} from "@/components/design";
import { topRecentBooks } from "@/lib/dashboard/queries";

// bkstr redesign PR 2 — /login.
//
// Editorial two-column layout per HANDOFF.md page-by-page §/login.
// Left rail (originally): pull-quote + attribution + 3 mini covers.
// Right rail: serif heading, Google sign-in, cross-link to /signup.
//
// AUTH SURFACE UNCHANGED: only Google OAuth is wired. Email/password
// stays as honest UX copy.
//
// redesign(10)/4 — honesty pass:
//   - Pull-quote + Lena Park byline REMOVED entirely (operator decision
//     7.7 option A — replace with live shelf strip).
//   - SHELF_COVERS hardcoded array (3 fabricated covers with fake version
//     strings + authors) REPLACED with topRecentBooks(3) from queries.ts.
//   - "TODAY ON THE SHELF" eyebrow + 1-line caption framing per operator
//     decision 7.7.
//   - Page becomes an async server component to fetch the live shelf.

export const metadata = {
  title: "Log in | bkstr",
};

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Defensive: if the catalog query fails, render the page without the
  // shelf strip rather than 500. The Google sign-in CTA stays.
  let shelf: BookCoverData[] = [];
  try {
    const rows = await topRecentBooks(3);
    shelf = rows.map((b) => ({
      title: b.title,
      glyph: b.glyph,
      palette: b.palette,
      // BookCover requires `domain` for the top imprint bar text; use
      // the slug's first segment as a passable substitute when we
      // didn't fetch domain. (topRecentBooks selects only the cover-
      // critical fields — passing slug-first-segment keeps the cover
      // editorially complete without adding a domain column to the
      // query.)
      domain: b.slug.split("-")[0] ?? "bkstr",
      vol: "Vol. 01",
      // Real version + author would require an extra query; the cover
      // SVG handles missing values without breaking. v1 is a safe
      // floor since every ACTIVE book has at least one BookVersion.
      version: "v1",
      author: "—",
    }));
  } catch (err) {
    console.error("[login] topRecentBooks failed; rendering without shelf strip:", err);
  }

  return (
    <AuthShell
      side={
        <div>
          {/* redesign(10)/4 — pull-quote ("Lena Park, Northpoint") removed.
              The fabricated testimonial + fabricated byline don't belong
              on the login page. The shelf row below is the live
              replacement (operator decision 7.7 option A). */}
          {shelf.length > 0 ? (
            <div>
              <Eyebrow>TODAY ON THE SHELF</Eyebrow>
              <div className="flex gap-3.5 mt-3.5">
                {shelf.map((book, i) => (
                  // BookCover.key on glyph is fragile when two recent
                  // books share a first letter; use index for uniqueness
                  // in the small N=3 case.
                  <BookCover key={`${book.glyph}-${i}`} book={book} size="sm" flat />
                ))}
              </div>
              <p className="font-serif italic text-ink-3 text-sm leading-[1.55] mt-5 max-w-[40ch]">
                Three recent additions to the catalog. Browse the full shelf
                once you&apos;re signed in.
              </p>
            </div>
          ) : (
            // Fallback when catalog is empty (or query failed). Keep the
            // left rail from collapsing; surface a minimal editorial line.
            <div>
              <Eyebrow>WELCOME BACK</Eyebrow>
              <p className="font-serif italic text-ink-2 text-base leading-[1.55] mt-3.5 max-w-[42ch]">
                Sign in to pick up where your agents left off — manage API
                keys, review fetch logs, or buy your next volume.
              </p>
            </div>
          )}
        </div>
      }
    >
      <Eyebrow>§ LOG IN</Eyebrow>
      <h1 className="font-serif text-[44px] leading-[1.1] tracking-display m-0 mt-3 mb-2">
        Welcome back<span className="text-saffron">.</span>
      </h1>
      <p className="text-ink-3 text-[15px] mb-8">
        Pick up where your agents left off.
      </p>

      <GoogleSignInButton label="Continue with Google" />

      <p className="mt-4 text-xs text-ink-3 text-center">
        Email and password sign-in coming soon — use Google for now.
      </p>

      <p className="mt-8 text-sm text-ink-3 text-center">
        New here?{" "}
        <Link href="/signup" className="text-ink underline hover:no-underline">
          Sign up free
        </Link>{" "}
        · No card to browse.
      </p>
    </AuthShell>
  );
}
