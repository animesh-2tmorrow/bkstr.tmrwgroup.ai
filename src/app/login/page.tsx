import Link from "next/link";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import {
  AuthShell,
  Eyebrow,
  BookCover,
  type BookCoverData,
} from "@/components/design";

// bkstr redesign PR 2 — /login.
//
// Editorial two-column layout per HANDOFF.md page-by-page §/login.
// Left column: pull-quote with saffron-emphasis on key phrase, attribution
// row (initial-glyph + serif name + eyebrow role), "ON THE SHELF THIS WEEK"
// strip with 3 mini covers.
// Right column: serif heading, Google sign-in button, cross-link to /signup.
//
// AUTH SURFACE UNCHANGED: only Google OAuth is wired. The reference's
// email/password form fields are intentionally omitted — they would
// require touching the auth flow per dispatch §constraints. The shipped
// surface is Google + value-prop copy + cross-link.
//
// Copy audit (per dispatch §6 / HANDOFF.md pricing-critical):
//   - "Start a trial" -> "Sign up free" (cross-link bottom)
//   - "Email and password sign-in coming soon—use Google for now" stays
//     as honest UX (we ship what we have).

export const metadata = {
  title: "Log in | bkstr",
};

// Mini-cover row on the left rail. Per reference auth.jsx:78-80,
// the books are BOOKS[0] / [2] / [4] from data.jsx — saffron M / forest Q
// / oxblood D. Hardcoded for visual stability; same lift-PR-8 path as
// SAMPLE_HERO_BOOKS in src/app/page.tsx.
const SHELF_COVERS: readonly BookCoverData[] = [
  {
    title: "Marketing Operations Playbook",
    glyph: "M",
    palette: "saffron",
    domain: "Marketing Ops",
    vol: "Vol. 01",
    version: "v2.3",
    author: "Etumos",
  },
  {
    title: "Agentic Quality Assurance",
    glyph: "Q",
    palette: "forest",
    domain: "Agent QA",
    vol: "Vol. 01",
    version: "v2",
    author: "M. Vasquez",
  },
  {
    title: "Developer Churn",
    glyph: "D",
    palette: "oxblood",
    domain: "Eng Leadership",
    vol: "Vol. 02",
    version: "v1",
    author: "J. Park",
  },
];

export default function LoginPage() {
  return (
    <AuthShell
      side={
        <div>
          <Eyebrow>FROM THE EDITORS</Eyebrow>
          <blockquote className="m-0 mt-5 font-serif italic text-[30px] leading-[1.25] text-ink tracking-tight">
            &ldquo;We stopped pasting playbooks into prompts. The agent just{" "}
            <em className="italic text-saffron">fetches the book</em> now — and
            our routing exceptions dropped by a third in a week.&rdquo;
          </blockquote>
          <div className="flex items-center gap-3 mt-7">
            <span
              aria-hidden
              className="w-9 h-9 rounded-full bg-ink text-paper flex items-center justify-center font-serif italic text-lg"
            >
              L
            </span>
            <div>
              <div className="font-serif text-[15px] text-ink">Lena Park</div>
              <Eyebrow>DIRECTOR · GROWTH OPS · NORTHPOINT</Eyebrow>
            </div>
          </div>

          <div className="mt-12 pt-6 border-t border-rule">
            <Eyebrow>ON THE SHELF · THIS WEEK</Eyebrow>
            <div className="flex gap-3.5 mt-3.5">
              {SHELF_COVERS.map((book) => (
                <BookCover key={book.glyph} book={book} size="sm" flat />
              ))}
            </div>
          </div>
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
