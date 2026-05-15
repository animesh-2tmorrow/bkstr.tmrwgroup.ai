import Link from "next/link";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { AuthShell, Eyebrow } from "@/components/design";
import { getLandingStats } from "@/lib/dashboard/queries";

// bkstr redesign PR 2 — /signup.
//
// Editorial two-column layout per HANDOFF.md page-by-page §/signup.
// Left column: marketing pitch + 2-stat grid + tenant logos row.
// Right column: serif heading, Google sign-up, terms note, cross-link.
//
// SUBSCRIPTION COPY REMOVED PER HANDOFF.MD PRICING-CRITICAL (PR 2):
//   "One subscription. Whole shelves of expertise." (reference auth.jsx:132)
//   -> "Sign up free. Own the books you buy." (one-time-per-book framing)
// "14-day free trial" (was on the old signup) -> "Free to join. Pay per book."
// "Start a trial" (was the login -> signup link) is now "Sign up free."
//
// AUTH SURFACE UNCHANGED: only Google OAuth. The reference's 2-step
// onboarding form (account → role/fleet/shelf) is intentionally omitted
// — those fields don't have backend persistence today.
//
// redesign(10)/4 — honesty pass:
//   - STATS grid: hardcoded AVG LIFT +27% / EDGE P95 84ms / TITLES IN PRINT 10
//     / AGENTS SUBSCRIBED 1.2k → REPLACED with live values where available.
//     AVG LIFT (no telemetry table) + AGENTS SUBSCRIBED (small adoption
//     number) both REMOVED. Only TITLES IN PRINT + EDGE P95 remain; P95
//     is hidden when the filter returns null (no qualifying samples in 30d).
//   - TENANT_LOGOS row removed entirely (4 fabricated tenant names).
//   - Page becomes an async server component to fetch the live stats.

export const metadata = {
  title: "Sign up | bkstr",
};

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  // Defensive: if the stats query fails (Prisma error, DB unreachable), render
  // the page without the stats grid rather than 500. The signup is the
  // load-bearing CTA on this page — auth surface stays even when telemetry
  // is offline.
  let titlesInPrint: number | null = null;
  let fetchP95Ms: number | null = null;
  try {
    const stats = await getLandingStats();
    titlesInPrint = stats.titlesInPrint;
    fetchP95Ms = stats.fetchP95Ms;
  } catch (err) {
    console.error("[signup] getLandingStats failed; rendering without stats grid:", err);
  }

  // Compose only the stat tiles that have live values. With 0 or 1 real
  // tiles the grid would look awkward; we only render the grid block when
  // at least one tile materialized.
  const tiles: Array<{ value: string; label: string }> = [];
  if (titlesInPrint !== null) {
    tiles.push({ value: String(titlesInPrint), label: "TITLES IN PRINT" });
  }
  if (fetchP95Ms !== null) {
    // Round to integer ms for the display; sub-second resolution is below
    // the noise floor for a marketing surface.
    tiles.push({ value: `${Math.round(fetchP95Ms)}ms`, label: "EDGE P95 LATENCY · 30D" });
  }

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

          {/* Live stat tiles — rendered only when at least one materialized.
              Tailwind needs literal classnames for tree-shaking, so the
              column count is a ternary rather than a template literal. */}
          {tiles.length > 0 && (
            <div
              className={
                tiles.length >= 2
                  ? "mt-10 grid grid-cols-2 gap-4"
                  : "mt-10 grid grid-cols-1 gap-4"
              }
            >
              {tiles.map((t) => (
                <div key={t.label} className="border-t border-rule pt-3">
                  <div className="font-serif text-[32px] leading-none tracking-display num">
                    {t.value}
                  </div>
                  <Eyebrow className="mt-1.5 block">{t.label}</Eyebrow>
                </div>
              ))}
            </div>
          )}

          {/* redesign(10)/4 — fabricated tenant-logo row removed. Will reinstate
              when real partner logos exist with permission to display. */}
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
