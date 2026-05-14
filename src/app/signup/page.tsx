import Link from "next/link";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { AuthShell, Eyebrow } from "@/components/design";

// bkstr redesign PR 2 — /signup.
//
// Editorial two-column layout per HANDOFF.md page-by-page §/signup.
// Left column: marketing pitch headline, prose, 2×2 stat grid, tenant
// logos row. Right column: serif heading, Google sign-up, terms note,
// cross-link to /login.
//
// SUBSCRIPTION COPY REMOVED PER HANDOFF.MD PRICING-CRITICAL:
//   "One subscription. Whole shelves of expertise." (reference auth.jsx:132)
//   -> "Sign up free. Own the books you buy." (one-time-per-book framing)
// "14-day free trial" (was on the old signup) -> "Free to join. Pay per book."
// "Start a trial" (was the login -> signup link) is now "Sign up free."
//
// AUTH SURFACE UNCHANGED: only Google OAuth. The reference's 2-step
// onboarding form (account → role/fleet/shelf) is intentionally omitted
// — those fields don't have backend persistence today and adding inputs
// without a write path would be misleading. See PR 2 commit message for
// the carry-forward note.

export const metadata = {
  title: "Sign up | bkstr",
};

const STATS = [
  { value: "+27%", label: "AVG LIFT, ALL TITLES" },
  { value: "84ms", label: "EDGE P95 LATENCY" },
  { value: "10", label: "TITLES IN PRINT" },
  { value: "1.2k", label: "AGENTS SUBSCRIBED" },
];

const TENANT_LOGOS: { name: string; cls: string }[] = [
  { name: "Etumos", cls: "font-serif italic text-[18px] text-ink-2" },
  { name: "Northpoint", cls: "font-sans font-bold text-[18px] text-ink-2" },
  { name: "Plait", cls: "font-mono text-sm text-ink-2 tracking-[0.04em]" },
  { name: "Helmsley", cls: "font-serif text-[18px] text-ink-2" },
];

export default function SignupPage() {
  return (
    <AuthShell
      side={
        <div>
          <Eyebrow>FOR PUBLISHERS, OPERATORS, AND THE AGENT-CURIOUS</Eyebrow>
          <h2 className="font-serif m-0 mt-4 mb-8 text-[36px] leading-[1.15] tracking-display">
            Sign up free.
            <br />
            <em className="italic">Own</em> the books you buy.
          </h2>
          <p className="text-ink-2 text-base leading-[1.6] font-serif">
            Sign up costs nothing. Browse the catalog, read excerpts, and check
            the lift scores before you buy. Each volume is a one-time purchase
            — no subscriptions, no seat math.
          </p>

          {/* 2×2 stat grid */}
          <div className="mt-10 grid grid-cols-2 gap-4">
            {STATS.map((s) => (
              <div key={s.label} className="border-t border-rule pt-3">
                <div className="font-serif text-[32px] leading-none tracking-display num">
                  {s.value}
                </div>
                <Eyebrow className="mt-1.5 block">{s.label}</Eyebrow>
              </div>
            ))}
          </div>

          {/* Tenant logos row */}
          <div className="mt-10 pt-5 border-t border-rule">
            <Eyebrow className="mb-3.5 block">TRUSTED BY</Eyebrow>
            <div className="flex gap-6 flex-wrap items-baseline">
              {TENANT_LOGOS.map((l) => (
                <span key={l.name} className={l.cls}>
                  {l.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      }
    >
      <Eyebrow>§ SIGN UP</Eyebrow>
      <h1 className="font-serif text-[40px] leading-[1.1] tracking-display m-0 mt-3 mb-2">
        Create your <em className="italic">imprint</em>
        <span className="text-saffron">.</span>
      </h1>
      <p className="text-ink-3 text-[15px] mb-8">
        Free to join. Pay only for the books you buy.
      </p>

      <GoogleSignInButton label="Sign up with Google" />

      <p className="mt-4 text-xs text-ink-3 text-center">
        Email and password sign-in coming soon — use Google for now.
      </p>

      <p className="mt-8 text-sm text-ink-3 text-center">
        Already have an account?{" "}
        <Link href="/login" className="text-ink underline hover:no-underline">
          Log in
        </Link>
      </p>
      <p className="mt-4 text-[11px] text-ink-3 text-center leading-[1.5]">
        By continuing you agree to our{" "}
        <a href="#" className="underline">
          Terms
        </a>{" "}
        and the bkstr{" "}
        <a href="#" className="underline">
          Data Processing Agreement
        </a>
        .
      </p>
    </AuthShell>
  );
}
