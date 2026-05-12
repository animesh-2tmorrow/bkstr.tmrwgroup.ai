import { findValidInvitationByToken } from "@/lib/admin/invitations";

// Phase 5 Stream E (D15.1) — invitation magic-link landing page.
//
// Server component. Reads ?token=… from the URL, validates server-side
// (token exists, not expired, not accepted). Renders a single CTA button
// that POSTs to /api/invitations/accept-init — that handler sets the
// bkstr_pending_invitation cookie + redirects to NextAuth signin.
//
// The flow:
//   1. Recipient clicks magic link in email.
//   2. This page loads, validates the token. Bad token → "this link is
//      invalid or expired" message. Good token → render the CTA + the
//      target email + the target role.
//   3. Recipient clicks "Sign in with Google to accept" → POST to
//      /api/invitations/accept-init → 303 redirect to /api/auth/signin
//      with the bkstr_pending_invitation cookie set.
//   4. Recipient completes OAuth.
//   5. events.signIn reads the cookie, re-hashes the token, applies the
//      pre-assigned role monotonic-upward, marks the invitation accepted.

export const metadata = {
  title: "Accept invitation | bkstr",
};

export const dynamic = "force-dynamic";

export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const tokenParam = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = typeof tokenParam === "string" ? tokenParam : "";

  const invitation = token ? await findValidInvitationByToken(token) : null;

  if (!invitation) {
    return (
      <main className="min-h-screen bg-[#FAF6EC] flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-white border border-[#E5DCC8] rounded-xl shadow-sm p-8 space-y-4">
          <h1 className="text-2xl font-bold text-gray-900">Invalid invitation</h1>
          <p className="text-sm text-gray-600">
            This invitation link is invalid, expired, or has already been
            accepted. Ask the admin who sent it to reissue the invitation.
          </p>
          <a
            href="/"
            className="inline-block bg-black text-[#FAF6EC] px-4 py-2 rounded-lg text-sm font-bold hover:bg-black shadow-sm"
          >
            Go to bkstr home
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#FAF6EC] flex items-center justify-center p-6">
      <div className="max-w-lg w-full bg-white border border-[#E5DCC8] rounded-xl shadow-sm p-8 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold text-gray-900">You&apos;ve been invited to bkstr</h1>
          <p className="text-sm text-gray-600">
            Sign in with your Google account at{" "}
            <span className="font-mono font-bold text-gray-900">{invitation.email}</span>{" "}
            to accept your invitation. Your account will be promoted to{" "}
            <span className="font-mono font-bold text-gray-900">{invitation.role}</span>{" "}
            automatically.
          </p>
        </header>

        <form action="/api/invitations/accept-init" method="POST" className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <button
            type="submit"
            className="w-full bg-black text-[#FAF6EC] px-4 py-3 rounded-lg text-sm font-bold hover:bg-black shadow-sm"
          >
            Sign in with Google to accept
          </button>
        </form>

        <div className="text-xs text-gray-500 space-y-2 border-t border-[#E5DCC8] pt-4">
          <p>
            <strong>Note:</strong> If you sign in with a different email
            address than{" "}
            <span className="font-mono">{invitation.email}</span>, the
            invitation will remain pending and your account will keep its
            default role. The admin who sent this invitation can reissue
            it to the email you intend to sign in with.
          </p>
          <p>
            This invitation expires in 15 minutes from when it was sent. If
            you see this page after that window, request a fresh invitation.
          </p>
        </div>
      </div>
    </main>
  );
}
