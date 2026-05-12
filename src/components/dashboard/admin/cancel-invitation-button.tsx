"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Phase 5 Stream E (D15.1) — cancel-invitation client island. Confirms
// via window.confirm (lightweight friction; cancelling an unsent
// invitation is low-consequence, no typed-confirmation needed). On
// success, refreshes the parent server-component.

export function CancelInvitationButton({
  invitationId,
  email,
}: {
  invitationId: string;
  email: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCancel() {
    if (!window.confirm(`Cancel invitation for ${email}?`)) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/invitations/${invitationId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
      setSubmitting(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleCancel}
        disabled={submitting}
        className="px-3 py-1 rounded-md text-xs font-bold bg-white border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {submitting ? "Cancelling…" : "Cancel"}
      </button>
      {error && (
        <div className="text-xs text-red-700 mt-1">{error}</div>
      )}
    </div>
  );
}
