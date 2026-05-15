"use client";

// bkstr redesign PR 4 — skill Buy/Download/Sign-in CTA, restyled.
//
// Three terminal states (per Stream L D18.1 design):
//   - signedIn=false              -> "Sign in to buy"  (links to /login)
//   - alreadyOwns=true            -> "Download (.zip)" (anchor to download endpoint)
//   - signedIn=true && for sale   -> "Buy now — $X.XX" (POST /api/checkout, Stripe redirect)
//   - priceCents=null             -> "Not available — pricing not configured"
//
// All four states render as a full-width inline-flex bar at the bottom of
// the detail card. Square corners, design-system ink-on-paper for primary,
// muted ink-3 for the not-configured state, status-err inline for the
// error toast.

import { useState } from "react";

export function SkillBuyButton({
  skillId,
  slug,
  priceCents,
  alreadyOwns,
  signedIn,
}: {
  skillId: string;
  slug: string;
  priceCents: number | null;
  alreadyOwns: boolean;
  signedIn: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!signedIn) {
    return (
      <a
        href={`/login?callbackUrl=/skills/${encodeURIComponent(slug)}`}
        className={ROW + " " + PRIMARY}
      >
        Sign in to buy →
      </a>
    );
  }

  if (alreadyOwns) {
    return (
      <a
        href={`/api/skills/${encodeURIComponent(slug)}/download`}
        className={ROW + " " + PRIMARY}
      >
        ↓ Download (.zip)
      </a>
    );
  }

  if (priceCents == null) {
    return (
      <div
        className={ROW + " bg-paper-2 text-ink-3"}
        aria-disabled="true"
      >
        Not available — pricing not configured
      </div>
    );
  }

  async function onBuy() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skill_id: skillId }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !body.url) {
        throw new Error(body.error ?? `Checkout failed (HTTP ${res.status})`);
      }
      window.location.href = body.url;
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
          : `Buy now — $${(priceCents / 100).toFixed(2)} →`}
      </button>
      {error && (
        <p className="px-8 py-3 text-xs text-status-err bg-paper-2 border-t border-rule">
          {error}
        </p>
      )}
    </>
  );
}

// Shared bar shape across all four states — keeps padding/typography
// identical so the visual height doesn't jump when the state flips.
const ROW =
  "block w-full text-center py-4 text-sm font-sans font-medium tracking-tight transition-colors";
const PRIMARY = "bg-ink text-paper hover:bg-ink-2";
