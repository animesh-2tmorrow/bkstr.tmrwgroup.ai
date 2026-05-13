"use client";

// Phase 6 Stream L (D18.1) — skill Buy/Download/Sign-in CTA. Client component
// because Buy posts to /api/checkout and follows the Stripe redirect, and
// because we render different button states based on session + grant.

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
        href="/login"
        className="block bg-[#0D1B2A] hover:bg-[#051B2A] text-white text-center py-3.5 text-sm font-bold"
      >
        Sign in to buy
      </a>
    );
  }

  if (alreadyOwns) {
    return (
      <a
        href={`/api/skills/${encodeURIComponent(slug)}/download`}
        className="block bg-[#0D1B2A] hover:bg-[#051B2A] text-white text-center py-3.5 text-sm font-bold"
      >
        Download (.zip)
      </a>
    );
  }

  if (priceCents == null) {
    return (
      <div className="block bg-gray-200 text-gray-500 text-center py-3.5 text-sm font-bold">
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
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
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
        className="block w-full bg-[#0D1B2A] hover:bg-[#051B2A] disabled:opacity-50 text-white py-3.5 text-sm font-bold"
      >
        {busy ? "Redirecting to Stripe…" : `Buy now — $${(priceCents / 100).toFixed(2)}`}
      </button>
      {error && (
        <p className="px-8 py-3 text-xs text-red-600 bg-red-50 border-t border-red-100">{error}</p>
      )}
    </>
  );
}
