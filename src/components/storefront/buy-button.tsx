"use client";

// redesign(10) Phase 2 — unified Buy / Get Started CTA, kind-aware.
//
// Promoted from src/app/skills/[slug]/buy-button.tsx (PR 4) and parameter-
// ized on kind ("book" | "skill"). The original `SkillBuyButton` stays in
// place during Phase 2 — /skills/[slug] still serves the old detail page;
// Phase 3 migrates that route to a redirect and deletes the old file.
//
// Four states (caller passes state explicitly — page-level access lookup
// drives this):
//   - anon       → "Sign in to buy →" (anchor to /login?callbackUrl=...)
//   - for_sale   → "Buy now — $X.XX →" (POST /api/checkout, Stripe redirect)
//   - owned      → "↓ Get Started" — scroll-to-anchor on the same page's
//                   <section id="get-started"> panel (rendered by the
//                   detail page when state === "owned")
//   - no_price   → "Not available — pricing not configured" (disabled chrome)
//
// All four render as a full-width bar with identical padding so the visual
// height doesn't jump as state flips between renders.
//
// Checkout body uses `{book_id}` or `{skill_id}` per kind; the /api/checkout
// route accepts the XOR shape (verified in Phase 1 schema check).

import { useState } from "react";

export type BuyButtonState = "anon" | "for_sale" | "owned" | "no_price";

export function BuyButton({
  kind,
  itemId,
  itemSlug,
  unitAmountCents,
  state,
}: {
  kind: "book" | "skill";
  itemId: string;
  itemSlug: string;
  unitAmountCents: number | null;
  // stripePriceId is intentionally not in the props — the checkout route
  // resolves the Stripe Price ID server-side from book_id/skill_id, so the
  // client doesn't need to forward it. Kept absent to keep the prop set
  // minimal.
  stripePriceId?: string | null;
  state: BuyButtonState;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state === "anon") {
    return (
      <a
        href={`/login?callbackUrl=/storefront/${encodeURIComponent(itemSlug)}`}
        className={ROW + " " + PRIMARY}
      >
        Sign in to buy →
      </a>
    );
  }

  if (state === "owned") {
    // Scroll-to-anchor on the same page. The detail-page renders the
    // <section id="get-started"> panel below the manifest when
    // state === "owned"; this anchor jumps the viewport to it without a
    // navigation. Keeps the CTA visible at the top of the page for owners
    // (don't make them scroll past the manifest before knowing what to do).
    return (
      <a href="#get-started" className={ROW + " " + PRIMARY}>
        ↓ Get Started
      </a>
    );
  }

  if (state === "no_price" || unitAmountCents == null) {
    return (
      <div className={ROW + " bg-paper-2 text-ink-3"} aria-disabled="true">
        Not available — pricing not configured
      </div>
    );
  }

  // state === "for_sale"
  async function onBuy() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, string> =
        kind === "book" ? { book_id: itemId } : { skill_id: itemId };
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !json.url) {
        throw new Error(json.error ?? `Checkout failed (HTTP ${res.status})`);
      }
      window.location.href = json.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={onBuy}
        disabled={busy}
        className={ROW + " " + PRIMARY + " disabled:opacity-50 cursor-pointer"}
      >
        {busy
          ? "Redirecting to Stripe…"
          : `Buy now — $${(unitAmountCents! / 100).toFixed(2)} →`}
      </button>
      {error && (
        <p className="px-8 py-3 text-xs text-status-err bg-paper-2 border-t border-rule">
          {error}
        </p>
      )}
    </>
  );
}

// Shared bar shape across all states — keeps padding/typography identical
// so the visual height doesn't jump when the state flips.
const ROW =
  "block w-full text-center py-4 text-sm font-sans font-medium tracking-tight transition-colors";
const PRIMARY = "bg-ink text-paper hover:bg-ink-2";
