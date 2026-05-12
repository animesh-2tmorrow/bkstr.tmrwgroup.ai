"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Phase 5 Stream E (D15.1) — invite-user modal.
//
// Email input (validated as RFC-shape email; the server re-validates with
// the same regex). Role select (PUBLISHER / SUBSCRIBER only — ADMIN
// promotion stays gated behind the existing role-mutation modal at
// /dashboard/admin/users per D15.1).
//
// On submit, POSTs to /api/admin/invitations. Success state shows the
// magic link (copy button) + the emailSendStatus pill + the Q8 warning if
// present. The magic link is the canonical fallback when SMTP isn't yet
// staged — operator copies the link from the modal and shares it out-of-
// band (Slack, manual email, etc).

// Local string-literal alias for Role to avoid pulling the Prisma client
// into the client bundle. Same shape as role-mutation-modal.tsx:21.
type InvitableRole = "PUBLISHER" | "SUBSCRIBER";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type CreateInviteResponse = {
  id: string;
  email: string;
  role: InvitableRole;
  magicLink: string;
  emailSendStatus: "sent" | "failed";
  emailSendError: string | null;
  warning: string | null;
};

export function InviteUserButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-black text-[#FAF6EC] px-4 py-2 rounded-lg text-sm font-bold hover:bg-black shadow-sm"
      >
        Invite user
      </button>
      {open && <InviteUserModal onClose={() => setOpen(false)} />}
    </>
  );
}

function InviteUserModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>("SUBSCRIBER");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<CreateInviteResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const emailValid = EMAIL_REGEX.test(email.trim());

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!emailValid) {
      setError("Enter a valid email address.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), role }),
      });
      const body = (await res.json().catch(() => ({}))) as
        | CreateInviteResponse
        | { error?: string };
      if (!res.ok) {
        setError(("error" in body && body.error) || `HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }
      setSuccess(body as CreateInviteResponse);
      setSubmitting(false);
      // Refresh the parent server-component so the pending-invitations
      // table picks up the new row when the operator closes the modal.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send invitation");
      setSubmitting(false);
    }
  }

  async function copyLink() {
    if (!success) return;
    try {
      await navigator.clipboard.writeText(success.magicLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write fails on insecure contexts / browser policy;
      // user can still triple-click the link text.
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
        {success ? (
          <div className="space-y-4">
            <header>
              <h2 className="text-xl font-bold">Invitation created</h2>
              <p className="text-xs text-gray-500 mt-1">
                <span className="font-mono">{success.email}</span> →{" "}
                <span className="font-mono font-bold">{success.role}</span>
              </p>
            </header>

            <div
              className={
                success.emailSendStatus === "sent"
                  ? "bg-green-50 border border-green-200 text-green-800 text-sm px-4 py-3 rounded-lg"
                  : "bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3 rounded-lg"
              }
            >
              {success.emailSendStatus === "sent" ? (
                <>Email sent successfully.</>
              ) : (
                <>
                  <strong>Email send failed.</strong>{" "}
                  {success.emailSendError ?? "Unknown error"} — copy the
                  magic link below and share it out-of-band.
                </>
              )}
            </div>

            {success.warning && (
              <div className="bg-blue-50 border border-blue-200 text-blue-900 text-sm px-4 py-3 rounded-lg">
                <strong>Note:</strong> {success.warning}
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-700">
                Magic link (15-min TTL)
              </label>
              <div className="flex items-stretch gap-2">
                <input
                  type="text"
                  readOnly
                  value={success.magicLink}
                  className="flex-grow px-3 py-2 border border-[#E5DCC8] rounded-lg bg-white text-xs font-mono"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  type="button"
                  onClick={copyLink}
                  className="bg-black text-[#FAF6EC] px-3 py-2 rounded-lg text-xs font-bold hover:bg-black shadow-sm"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm font-bold text-gray-700 bg-white border border-[#E5DCC8] hover:bg-[#EAE2D0]"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <>
            <header>
              <h2 className="text-xl font-bold">Invite user</h2>
              <p className="text-xs text-gray-500 mt-1">
                Send a magic-link invitation. The recipient accepts by
                signing in with the email below; their account is
                promoted to the chosen role automatically.
              </p>
            </header>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="invite-email"
                  className="block text-sm font-semibold text-gray-700 mb-1"
                >
                  Email
                </label>
                <input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError(null);
                  }}
                  placeholder="user@example.com"
                  className="w-full px-3 py-2 border border-[#E5DCC8] rounded-lg bg-white text-sm"
                  disabled={submitting}
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="invite-role"
                  className="block text-sm font-semibold text-gray-700 mb-1"
                >
                  Role
                </label>
                <select
                  id="invite-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as InvitableRole)}
                  className="w-full px-3 py-2 border border-[#E5DCC8] rounded-lg bg-white text-sm"
                  disabled={submitting}
                >
                  <option value="SUBSCRIBER">SUBSCRIBER</option>
                  <option value="PUBLISHER">PUBLISHER</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  ADMIN promotion stays gated behind the role-mutation
                  modal — invitations are restricted to PUBLISHER and
                  SUBSCRIBER.
                </p>
              </div>

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
                  disabled={submitting || !emailValid}
                  className="bg-black text-[#FAF6EC] px-4 py-2 rounded-lg text-sm font-bold hover:bg-black shadow-sm disabled:opacity-50"
                >
                  {submitting ? "Sending…" : "Send invitation"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
