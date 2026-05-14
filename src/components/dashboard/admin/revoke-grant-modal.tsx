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
// Stream V (D19.x) — soft-rail asymmetric-friction upgrade. When the actor
// is revoking their OWN PUBLISHER_OWN grant on their own published content,
// the modal swaps to a destructive-confirmation step (typed-email match)
// mirroring D12.9's role-mutation pattern. Other grant kinds (PURCHASE /
// SEED / MANUAL / SUBSCRIPTION / non-self PUBLISHER_OWN) keep the existing
// single-step low-friction flow.
//
// The server route at /api/admin/grants/[id]/revoke enforces the same
// predicate as a hard 409 SELF_PROTECTION gate, so this modal is UX-only —
// a fast-click bypass still gets blocked at the API.

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
  currentUserId,
  currentUserEmail,
  onClose,
}: {
  grant: AdminGrantRow;
  // Stream V (D19.x) — required so the modal can detect self-PUBLISHER_OWN
  // and gate the typed-email confirmation. Non-optional by design so a
  // missing wire-up at the parent table fails at compile time, not silently
  // at runtime (which would skip the soft rail entirely — only the server
  // hard rail would catch it).
  currentUserId: string;
  currentUserEmail: string;
  onClose: () => void;
}) {
  // Stream V (D19.x) — self-protection trigger. Predicate intentionally
  // duplicated against the server-side check (route.ts: grant.source ===
  // "PUBLISHER_OWN" && grant.subscriber.userId === session.user.id). One
  // truth, two surfaces; refactor into a shared helper if a third call site
  // appears.
  const isSelfPublisherOwn =
    grant.source === GrantSource.PUBLISHER_OWN &&
    grant.subscriberUserId !== null &&
    grant.subscriberUserId === currentUserId;

  const [typedEmail, setTypedEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Trim + case-insensitive email match (dispatch §4 catch: operators paste
  // with trailing space; RFC email comparison is case-insensitive on the
  // local part by convention).
  const emailMatches =
    typedEmail.trim().toLowerCase() === currentUserEmail.toLowerCase();
  const submitDisabled =
    submitting || isPending || (isSelfPublisherOwn && !emailMatches);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/grants/${grant.id}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const body = (await res
          .json()
          .catch(() => ({}))) as { error?: string; code?: string };
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
        {isSelfPublisherOwn ? (
          // Stream V destructive-confirmation header. Red-bordered warning
          // + typed-email input + disabled-until-match submit. Mirrors the
          // shape of role-mutation-modal.tsx's destructive branch.
          <>
            <h2 className="text-lg font-bold mb-2 text-red-800">
              Revoking your own publisher grant
            </h2>
            <p className="text-xs text-gray-500 font-mono mb-4">
              grant_id: {grant.id}
            </p>

            <div className="bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 rounded-lg mb-4">
              <strong>This will remove your access</strong> to{" "}
              <strong>
                &ldquo;{grant.bookTitle ?? grant.skillName ?? "—"}&rdquo;
              </strong>{" "}
              that <strong>you published</strong>. You will no longer be able
              to fetch this content via API. Type your email below to confirm.
            </div>

            <input
              type="text"
              value={typedEmail}
              onChange={(e) => setTypedEmail(e.target.value)}
              placeholder={currentUserEmail}
              className="w-full px-3 py-2 border border-[#E5DCC8] rounded-lg bg-white text-sm font-mono mb-4"
              disabled={submitting || isPending}
              autoComplete="off"
            />

            <p className="text-xs text-gray-600">
              The server enforces this check too — revoking your own
              PUBLISHER_OWN grant returns 409 from the API. To bypass for a
              genuine publisher hand-off, use psql per{" "}
              <code>docs/operations.md</code>.
            </p>
          </>
        ) : (
          // Standard low-friction confirmation — every non-self path.
          <>
            <h2 className="text-lg font-bold mb-2">
              Revoke {grant.source} grant on &ldquo;
              {grant.bookTitle ?? grant.skillName ?? "—"}&rdquo; for{" "}
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
              must run{" "}
              <code>
                UPDATE access_grants SET revoked_at = NULL WHERE id = &apos;
                {grant.id}&apos;
              </code>{" "}
              via psql (Q-F5; not a UI action).
            </p>
          </>
        )}

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
            disabled={submitDisabled}
            className={
              isSelfPublisherOwn
                ? "bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-red-800 shadow-sm disabled:opacity-50"
                : "bg-black text-[#FAF6EC] px-4 py-2 rounded-lg text-sm font-bold hover:bg-black shadow-sm disabled:opacity-50"
            }
          >
            {submitting || isPending
              ? "Revoking…"
              : isSelfPublisherOwn
                ? "Confirm revoke"
                : "Revoke"}
          </button>
        </div>
      </div>
    </div>
  );
}
