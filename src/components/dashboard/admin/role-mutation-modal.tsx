"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Phase 4.5 Stream E — local string-literal alias for the Role enum.
//
// Why not `import { Role } from "@/generated/prisma/client"`: that import is a
// VALUE import (the runtime enum object), not a type-only import. Webpack
// pulls the whole `@/generated/prisma/client` module into the client bundle
// when it sees that, which trips `UnhandledSchemeError: node:crypto / node:fs
// / node:events` (the Prisma client transitively imports Node built-ins).
//
// Solution: use the string-literal union below and avoid the Prisma client at
// the client-component boundary. The server-component caller
// (users-table.tsx) does the type-narrowing on the way in via Role enum
// (which is fine in a Server Component because it doesn't ship to the client
// bundle). Server handler `app/api/admin/users/[id]/role/route.ts` is the
// validation authority — it re-validates the body.role string against
// `Object.values(Role)` server-side per D12.9 Gate 4.
type Role = "SUBSCRIBER" | "PUBLISHER" | "ADMIN";

// Phase 4.5 Stream E (D12.10) — asymmetric-friction role mutation modal.
//
// FRICTION RULES (D12.10):
//   - "Type the target email" (GitHub-style) for DESTRUCTIVE actions:
//       - any demote (target rank < current rank), AND
//       - promote to ADMIN (regardless of current rank).
//   - Simple OK / Cancel for BENIGN actions:
//       - SUBSCRIBER → PUBLISHER (one rank up, non-ADMIN).
//
// The component is split into the user-facing button (server-renderable from
// the parent table — it's `"use client"` so it can hold useState, but the
// table embeds it as a child node; no separate Suspense boundary required)
// and the modal body which appears once `open` flips true.
//
// SERVER GATES ARE THE FLOOR (D12.9). This modal's typing-confirmation is
// UX-only; the server handler at /api/admin/users/[id]/role re-enforces every
// gate (self-demote refuse, last-ADMIN refuse, invalid-role refuse, no-op
// refuse). A tampered client that skips the modal still gets 400'd.

// Local copy of the rank map — kept in sync with src/lib/auth/index.ts's
// ROLE_RANK (D11.11) by convention; tiny enough that duplication is cheaper
// than threading an export through a shared module.
const RANK: Record<Role, number> = {
  SUBSCRIBER: 0,
  PUBLISHER: 1,
  ADMIN: 2,
};

function isDestructive(currentRole: Role, targetRole: Role): boolean {
  if (RANK[targetRole] < RANK[currentRole]) return true; // any demote
  if (targetRole === "ADMIN") return true; // ADMIN promotion is a security event
  return false; // SUBSCRIBER → PUBLISHER only
}

export function RoleMutationButton({
  userId,
  email,
  currentRole,
  isSelf,
}: {
  userId: string;
  email: string;
  currentRole: Role;
  isSelf: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 font-mono text-[11px] tracking-eyebrow uppercase bg-paper border border-rule text-ink-2 hover:bg-paper-2 hover:text-ink transition-colors"
      >
        Change role
      </button>
      {open && (
        <RoleMutationModal
          userId={userId}
          email={email}
          currentRole={currentRole}
          isSelf={isSelf}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function RoleMutationModal({
  userId,
  email,
  currentRole,
  isSelf,
  onClose,
}: {
  userId: string;
  email: string;
  currentRole: Role;
  isSelf: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  // Default the target role to the first valid alternative — anything other
  // than currentRole. Picking the next-higher rank gives the most-common
  // promotion path; if there is no higher rank (ADMIN current), default to
  // PUBLISHER (the canonical demote-step).
  const defaultTarget: Role =
    currentRole === "SUBSCRIBER"
      ? "PUBLISHER"
      : currentRole === "PUBLISHER"
        ? "ADMIN"
        : "PUBLISHER";
  const [targetRole, setTargetRole] = useState<Role>(defaultTarget);
  const [typedEmail, setTypedEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const destructive = isDestructive(currentRole, targetRole);
  const sameRole = currentRole === targetRole;
  const emailMatches = typedEmail.trim().toLowerCase() === email.toLowerCase();
  // Submit is disabled until the typed-email gate passes (destructive only)
  // OR for any in-flight request OR for the no-op same-role case.
  const submitDisabled = submitting || sameRole || (destructive && !emailMatches);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (submitDisabled) return;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: targetRole }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        status?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }
      // Success — refresh the page so the server-rendered table reflects the
      // new role. router.refresh() re-fetches server-component data without
      // a full reload (cheaper than window.location.reload()).
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update role");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-[#FAF6EC] border border-[#E5DCC8] rounded-xl shadow-xl p-6 w-full max-w-lg space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2 className="text-xl font-bold">Change role for {email}</h2>
          <p className="text-xs text-gray-500 mt-1">
            Current role:{" "}
            <span className="font-mono font-bold">{currentRole}</span>
            {isSelf && (
              <span className="ml-2 text-amber-700">(this is your own account)</span>
            )}
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="target-role" className="block text-sm font-semibold text-gray-700 mb-1">
              New role
            </label>
            <select
              id="target-role"
              value={targetRole}
              onChange={(e) => {
                setTargetRole(e.target.value as Role);
                setTypedEmail(""); // reset the typed-email gate when the target changes
                setError(null);
              }}
              className="w-full px-3 py-2 border border-[#E5DCC8] rounded-lg bg-white text-sm"
              disabled={submitting}
            >
              <option value="SUBSCRIBER">SUBSCRIBER</option>
              <option value="PUBLISHER">PUBLISHER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </div>

          {sameRole && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs px-4 py-3 rounded-lg">
              The target role is the same as the current role. Pick a different role.
            </div>
          )}

          {destructive && !sameRole && (
            <div className="space-y-2">
              <div className="bg-red-50 border border-red-200 text-red-800 text-xs px-4 py-3 rounded-lg">
                <strong>This is a high-consequence change.</strong>{" "}
                {RANK[targetRole] < RANK[currentRole]
                  ? "Demoting a user revokes their access to higher-privileged surfaces."
                  : "Promoting to ADMIN grants full mutation power across the system."}{" "}
                Type the user&apos;s email below to confirm.
              </div>
              <input
                type="text"
                value={typedEmail}
                onChange={(e) => setTypedEmail(e.target.value)}
                placeholder={email}
                className="w-full px-3 py-2 border border-[#E5DCC8] rounded-lg bg-white text-sm font-mono"
                disabled={submitting}
                autoComplete="off"
              />
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-lg text-sm font-bold text-gray-700 bg-white border border-[#E5DCC8] hover:bg-[#EAE2D0] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitDisabled}
              className="bg-black text-[#FAF6EC] px-4 py-2 rounded-lg text-sm font-bold hover:bg-black shadow-sm disabled:opacity-50"
            >
              {submitting ? "Saving…" : destructive ? "Confirm change" : "Change role"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
