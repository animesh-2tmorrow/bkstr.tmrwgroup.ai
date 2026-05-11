"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminGrantRow } from "@/lib/dashboard/queries";
// See admin-grants-table.tsx — enums-only import keeps Prisma runtime out
// of the client bundle.
import { GrantSource } from "@/generated/prisma/enums";

// Phase 4.5 Stream F — revoke-grant modal. Soft-revoke per D12.6 — the
// row stays in access_grants with revoked_at populated; un-revoke is
// psql-only (Q-F5).
//
// Confirmation pattern (D12.10): simple OK/Cancel. Soft-revoke is
// reversible (operator un-revokes via psql), so the low-friction shape is
// appropriate. The per-source warning copy is the asymmetric-friction
// concession — SEED revocation specifically unblocks checkout per D10.2
// (docs/operations.md:287-288), so the operator needs to see the side
// effect before clicking OK.

function sourceWarning(source: GrantSource): string {
  switch (source) {
    case GrantSource.SEED:
      // D10.2 — any active grant blocks Stripe Checkout; SEED rows can
      // be load-bearing for that block. Revoking unblocks checkout.
      return "This grant is SEED — revoking it unblocks the subscriber's Stripe Checkout for this book (per D10.2 / docs/operations.md).";
    case GrantSource.PUBLISHER_OWN:
      // PUBLISHER_OWN is the grant a publisher relies on to read their
      // own book via requireBookAccess. Revoking removes that path.
      return "This grant is PUBLISHER_OWN — revoking it removes the publisher's own access to this book via /api/books/[id]/view + /download.";
    case GrantSource.SUBSCRIPTION:
      return "This grant is SUBSCRIPTION — revoking it terminates the subscriber's tier-based access. Future Stripe webhook events for the same subscription will write a new grant row.";
    case GrantSource.PURCHASE:
      return "This grant is PURCHASE — revoking it removes the subscriber's paid one-time access. Stripe is NOT refunded automatically; that's a manual operator action in the Stripe Dashboard.";
    case GrantSource.MANUAL:
      return "This grant is MANUAL (operator-issued, e.g. comp ticket) — revoking it ends the comp.";
    default:
      return "";
  }
}

export function RevokeGrantModal({
  grant,
  onClose,
}: {
  grant: AdminGrantRow;
  onClose: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/grants/${grant.id}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      startTransition(() => {
        router.refresh();
        onClose();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#FAF6EC] border border-[#E5DCC8] rounded-xl shadow-xl max-w-lg w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-2">
          Revoke {grant.source} grant on &ldquo;{grant.bookTitle}&rdquo; for{" "}
          {grant.subscriberEmail}?
        </h2>
        <p className="text-xs text-gray-500 font-mono mb-4">
          grant_id: {grant.id}
        </p>

        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-3 rounded-lg mb-4">
          {sourceWarning(grant.source)}
        </div>

        <p className="text-sm text-gray-700">
          Soft-revoke only — the row is preserved with{" "}
          <code>revoked_at = NOW()</code> per D12.6. To re-issue, operator
          must run <code>UPDATE access_grants SET revoked_at = NULL WHERE id = &apos;{grant.id}&apos;</code>{" "}
          via psql (Q-F5; not a UI action).
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 rounded-lg mt-4">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting || isPending}
            className="px-4 py-2 rounded-lg text-sm font-bold text-gray-700 hover:bg-[#EAE2D0] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || isPending}
            className="bg-black text-[#FAF6EC] px-4 py-2 rounded-lg text-sm font-bold hover:bg-black shadow-sm disabled:opacity-50"
          >
            {submitting || isPending ? "Revoking…" : "Revoke"}
          </button>
        </div>
      </div>
    </div>
  );
}
