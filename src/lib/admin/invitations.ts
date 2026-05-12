// Phase 5 Stream E (D15.1–D15.4) — invitation token helpers.
//
// Token lifecycle:
//   1. POST /api/admin/invitations generates a 32-byte (256-bit) random
//      token via crypto.randomBytes + base64url encoding. The PLAINTEXT
//      is returned in the API response (for the email body + admin UI
//      copy-paste fallback) and ALSO emailed via Nodemailer. The
//      SHA-256 hash is persisted in user_invitations.token_hash.
//   2. Recipient clicks the magic link → POST /api/invitations/accept-init
//      hashes the supplied plaintext, looks up the row by hash,
//      validates expiry + non-accepted state, sets the
//      bkstr_pending_invitation cookie (15-min TTL, HttpOnly + Secure +
//      SameSite=Lax), and redirects to /api/auth/signin.
//   3. OAuth callback → events.signIn reads the cookie, re-hashes,
//      re-validates, and (a) if OAuth email matches invitation email
//      case-insensitively, applies the pre-assigned role monotonic-
//      upward + marks the row accepted, (b) otherwise documents the
//      mismatch on emailMismatchNote and leaves the row pending.
//
// Persistence shape:
//   - tokenHash = SHA-256 hex (64 hex chars) of the plaintext.
//   - plaintext is NEVER persisted. Compromise of the DB cannot replay
//     accepts; an attacker would need both DB read AND an ability to
//     reset every invitation's hash from a known plaintext, which they
//     can't do without write access.

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import type { UserInvitation } from "@/generated/prisma/client";

// Token byte count → base64url length:
//   32 bytes (256 bits) → 43 base64url chars (no padding) →
//   well above the 128-bit floor for unguessable single-use tokens.
const TOKEN_BYTES = 32;

/**
 * Returns a 32-byte (256-bit) cryptographically-random token, base64url-
 * encoded. The returned string is ≥43 chars (43 with no padding; Node's
 * base64url encoder strips padding by default). This is the PLAINTEXT
 * portion of the invitation token — emailed to the recipient and used as
 * the `?token=` querystring value on the magic link.
 */
export function generateInvitationToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * Returns the SHA-256 hex digest of the supplied plaintext. Used both for
 * persistence (writes user_invitations.token_hash) and for lookups
 * (validates an incoming `?token=` against the DB row). Deterministic for
 * a given input.
 */
export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Looks up an invitation row by plaintext token. Returns the row only if
 * it is BOTH not-expired (expiresAt > now) AND not-accepted (acceptedAt
 * IS NULL). Returns null otherwise — including when no row matches the
 * hash.
 *
 * Caller-side notes: this helper does NOT validate the email-match. That
 * check happens later inside events.signIn where the OAuth-returned email
 * is available. The accept-init route uses this helper to gate cookie-set
 * (don't set cookie for invalid tokens); the signIn hook re-runs the
 * lookup-by-hash for defense-in-depth.
 */
export async function findValidInvitationByToken(
  plaintext: string,
): Promise<UserInvitation | null> {
  if (!plaintext || typeof plaintext !== "string") return null;
  const tokenHash = hashToken(plaintext);
  const row = await prisma.userInvitation.findFirst({
    where: {
      tokenHash,
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  return row ?? null;
}

/**
 * Marks an invitation row as accepted by the given user. Designed to be
 * called from inside an interactive `prisma.$transaction(async (tx) => …)`
 * so the accept + the role-promote + the audit row commit atomically.
 *
 * Idempotent at the row level: if a concurrent call already set
 * acceptedAt, this update writes the same fields again. The
 * caller-supplied `tx` keeps the read-modify-write under one transaction
 * so the second concurrent attempt sees the updated row at commit time.
 */
export async function markInvitationAccepted(
  tx: {
    userInvitation: {
      update: (args: {
        where: { id: string };
        data: { acceptedAt: Date; acceptedByUserId: string; emailSendStatus: string };
      }) => Promise<UserInvitation>;
    };
  },
  invitationId: string,
  acceptedByUserId: string,
): Promise<UserInvitation> {
  return tx.userInvitation.update({
    where: { id: invitationId },
    data: {
      acceptedAt: new Date(),
      acceptedByUserId,
      emailSendStatus: "accepted",
    },
  });
}

/**
 * The cookie name + max-age used by the accept-init → events.signIn
 * handshake. Exported as a constant so all three call sites (cookie set,
 * cookie read, runbook docs) stay in sync.
 *
 * Per Q7 (Gate 1 lock):
 *   - HttpOnly, Secure, SameSite=Lax, Path=/, 15-minute TTL.
 *   - Value is the PLAINTEXT token. The signIn hook re-hashes + re-looks-
 *     up. Plaintext-on-cookie is acceptable because the cookie is
 *     HttpOnly (JS can't read it) + SameSite=Lax (third-party-site
 *     iframes can't read it) + Secure (HTTPS-only transmission). The
 *     attack model that would matter — an attacker who can read the
 *     cookie — already controls the browser session.
 */
export const PENDING_INVITATION_COOKIE = "bkstr_pending_invitation";
export const PENDING_INVITATION_TTL_SECONDS = 15 * 60;
