"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminBookRow, AdminUserRow } from "@/lib/dashboard/queries";

// Phase 4.5 Stream F — reassign-publisher modal.
//
// Confirmation pattern (D12.10): simple OK/Cancel. Reassign is a benign
// mutation — attribution moves between two non-destructive states; nothing
// is hard-deleted (the prior PUBLISHER_OWN grant is soft-revoked per
// D12.6 and preserved in access_grants). The asymmetric "type-the-email"
// gate is reserved for destructive role-demotions (Stream E); this modal
// uses the lower-friction shape.
//
// The dropdown options are pre-fetched server-side (passed in via props
// from /dashboard/admin/books/page.tsx). No client-side query — the page
// reload after success refreshes the option set if a new PUBLISHER/ADMIN
// has signed in since the last render. Options with hasSubscriber=false
// are kept but disabled with a "no subscribers row" hint — the handler
// would 422 these anyway, but disabling preempts the round-trip.

export function ReassignPublisherModal({
  book,
  reassignableUsers,
  onClose,
}: {
  book: AdminBookRow;
  reassignableUsers: AdminUserRow[];
  onClose: () => void;
}) {
  // Default the dropdown to the first user that's NOT the current owner
  // (the no-op case is short-circuited server-side, but the dropdown
  // pre-selecting "no change" would be confusing). Fall back to the first
  // user when every user IS the current owner (impossible in practice but
  // handles the empty-list edge case cleanly).
  const firstDifferent =
    reassignableUsers.find((u) => u.id !== book.publisherUserId) ??
    reassignableUsers[0] ??
    null;
  const [targetId, setTargetId] = useState<string>(firstDifferent?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Current owner display — matches the table's publisher rendering.
  // "Unassigned" if NULL; the user's email + name otherwise.
  const currentChip = book.publisherUserId
    ? `${book.publisherUserName ?? "(no name)"} · ${book.publisherUserEmail ?? "(no email)"}`
    : "Unassigned";

  async function handleSubmit() {
    setError(null);
    if (!targetId) {
      setError("Pick a target publisher.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/books/${book.id}/reassign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_user_id: targetId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      // Success — close the modal and refresh the table SSR. The
      // router.refresh() re-runs getAdminBooks() server-side so the new
      // publisher attribution + revoked grant counts appear.
      startTransition(() => {
        router.refresh();
        onClose();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reassign");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // Fixed-position overlay; click-outside-to-cancel uses the backdrop.
    // The inner card stops propagation so clicks inside don't dismiss.
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#FAF6EC] border border-[#E5DCC8] rounded-xl shadow-xl max-w-lg w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-2">
          Reassign &ldquo;{book.title}&rdquo; to a new publisher
        </h2>
        <p className="text-xs text-gray-500 mb-4 font-mono">
          {book.slug} · {book.domain}
        </p>

        <div className="space-y-4">
          <div>
            <div className="text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wider">
              Current publisher
            </div>
            <div className="bg-white border border-[#E5DCC8] rounded-lg px-3 py-2 text-sm">
              {currentChip}
            </div>
          </div>

          <div>
            <label
              htmlFor="target-user"
              className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wider"
            >
              Target publisher
            </label>
            <select
              id="target-user"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="w-full px-3 py-2 border border-[#E5DCC8] rounded-lg bg-white text-sm"
              disabled={submitting || reassignableUsers.length === 0}
            >
              {reassignableUsers.length === 0 ? (
                <option value="">No PUBLISHER or ADMIN users available</option>
              ) : (
                reassignableUsers.map((u) => {
                  const label = `${u.name ?? "(no name)"} · ${u.email} · ${u.role}`;
                  const disabledLabel = u.hasSubscriber
                    ? label
                    : `${label} — no subscribers row (ask them to sign in)`;
                  return (
                    <option
                      key={u.id}
                      value={u.id}
                      disabled={!u.hasSubscriber}
                    >
                      {disabledLabel}
                    </option>
                  );
                })
              )}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Only PUBLISHER + ADMIN roles are listed. The handler revokes the
              current owner&apos;s <code>PUBLISHER_OWN</code> grant
              (soft-revoke per D12.6) and issues a fresh grant on the
              target&apos;s subscribers row. Other grant sources (MANUAL /
              SEED / PURCHASE / SUBSCRIPTION) are not touched (D12.13).
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 rounded-lg">
              {error}
            </div>
          )}
        </div>

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
            disabled={submitting || isPending || !targetId || reassignableUsers.length === 0}
            className="bg-black text-[#FAF6EC] px-4 py-2 rounded-lg text-sm font-bold hover:bg-black shadow-sm disabled:opacity-50"
          >
            {submitting || isPending ? "Reassigning…" : "Reassign"}
          </button>
        </div>
      </div>
    </div>
  );
}
