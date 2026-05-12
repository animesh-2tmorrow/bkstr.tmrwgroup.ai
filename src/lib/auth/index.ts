import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { getServerSession, type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { cookies } from "next/headers";
import { Role } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditEntry } from "@/lib/admin/audit";
import {
  hashToken,
  markInvitationAccepted,
  PENDING_INVITATION_COOKIE,
} from "@/lib/admin/invitations";

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.warn("[auth] GOOGLE_CLIENT_ID/SECRET missing — Google sign-in will fail until /etc/bkstr/oauth.env is sourced.");
}
if (!process.env.NEXTAUTH_SECRET) {
  console.warn("[auth] NEXTAUTH_SECRET missing — sessions will not encrypt correctly.");
}

// Phase 4 Stream D (D11.5 / D11.6 / D11.11) — role-grant env vars replace the
// Phase 2 fail-closed allowlist (D8.1–D8.4). The signin gate is gone (open
// signup); roles are sourced from /etc/bkstr/roles.env via env-WARN-on-missing
// (the same shape as oauth.env / stripe.env / aws.env per D9.4 / D10.3).
//
// Operator semantics: env presence promotes; env absence is a no-op. See the
// monotonic-upward invariant block at syncRoleFromEnv below for why we never
// demote from env state.
if (!process.env.ADMIN_EMAILS) {
  console.warn("[auth] ADMIN_EMAILS missing — no auto-promotion to ADMIN. Existing ADMINs unaffected.");
}
if (!process.env.PUBLISHER_EMAILS) {
  console.warn("[auth] PUBLISHER_EMAILS missing — no auto-promotion to PUBLISHER. Existing PUBLISHERs unaffected.");
}

// parseList — comma-separated, trimmed, lowercased, empties dropped. Inherited
// shape from the retired Phase 2 allowlist helper; now consumed only by
// syncRoleFromEnv for ADMIN_EMAILS / PUBLISHER_EMAILS parsing.
function parseList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Role ordering for the monotonic-upward max. Higher index = higher privilege.
// Used only inside syncRoleFromEnv; not exported.
const ROLE_RANK: Record<Role, number> = {
  [Role.SUBSCRIBER]: 0,
  [Role.PUBLISHER]: 1,
  [Role.ADMIN]: 2,
};

/**
 * syncRoleFromEnv — Phase 4 Stream D role-promotion hook (D11.11).
 *
 * HARD SAFETY INVARIANT — MONOTONIC-UPWARD PROMOTION:
 *
 *   1. Env presence PROMOTES: an email in ADMIN_EMAILS gets role=ADMIN;
 *      an email in PUBLISHER_EMAILS (and NOT in ADMIN_EMAILS) gets PUBLISHER.
 *   2. Env absence is a NO-OP: an unset or empty ADMIN_EMAILS does NOT demote
 *      existing ADMINs; an unset or empty PUBLISHER_EMAILS does NOT demote
 *      existing PUBLISHERs. The user keeps whatever role the DB row carries.
 *   3. Email-not-in-env-but-env-set is a NO-OP: removing edward@… from
 *      PUBLISHER_EMAILS does NOT demote Edward. Demotion is operator-explicit
 *      only — `UPDATE users SET role='SUBSCRIBER' WHERE email='…'` via psql.
 *   4. The check runs on EVERY signin (not just first signin). Operators who
 *      add an email to PUBLISHER_EMAILS after the user has already signed in
 *      get the promotion applied on the user's next visit.
 *   5. Precedence: ADMIN_EMAILS wins over PUBLISHER_EMAILS if a single email
 *      appears in both. ADMIN is strictly higher than PUBLISHER.
 *   6. The effective new role is max(currentRole, envDerivedRole) by ROLE_RANK.
 *      Never lowers.
 *
 * This is a LOAD-BEARING safety property protecting against operator-error
 * regressions (e.g. typo in roles.env, file deleted during a deploy, env var
 * unset on a fresh box). Future contributors MUST NOT weaken it without a
 * matching D-numbered decision entry. See docs/phase-4-decisions.md D11.11
 * and docs/operations.md "Roles env file" runbook.
 */
async function syncRoleFromEnv(userId: string, email: string, currentRole: Role): Promise<void> {
  const normalized = email.toLowerCase().trim();
  if (!normalized) return;

  const adminEmails = parseList(process.env.ADMIN_EMAILS);
  const publisherEmails = parseList(process.env.PUBLISHER_EMAILS);

  // Env-derived role. ADMIN takes precedence over PUBLISHER (rule 5).
  // Email-not-in-any-env-list resolves to null (rule 3 — no-op, NOT demote).
  let envDerived: Role | null = null;
  if (adminEmails.includes(normalized)) {
    envDerived = Role.ADMIN;
  } else if (publisherEmails.includes(normalized)) {
    envDerived = Role.PUBLISHER;
  }

  // No env match → no-op. Existing role preserved (rule 3).
  if (envDerived === null) return;

  // Monotonic-upward (rule 6): only UPDATE if env-derived role is strictly higher.
  if (ROLE_RANK[envDerived] <= ROLE_RANK[currentRole]) return;

  await prisma.user.update({
    where: { id: userId },
    data: { role: envDerived },
  });
  console.info(`[auth] role promoted: ${normalized} ${currentRole} → ${envDerived}`);
}

/**
 * applyPendingInvitation — Phase 5 Stream E (D15.1–D15.4).
 *
 * Reads the bkstr_pending_invitation cookie set by
 * /api/invitations/accept-init, re-hashes the plaintext token, validates
 * the invitation row (not expired, not accepted), compares the OAuth
 * email to the invitation email case-insensitively, and either:
 *
 *   - applies the pre-assigned role monotonic-upward + marks the
 *     invitation accepted + writes an `invitation.accept` audit row
 *     (actor is the recipient themselves per Q5 — see comment below),
 *     OR
 *   - documents the mismatch on emailMismatchNote and leaves the
 *     invitation pending (Q4).
 *
 * The cookie is always cleared after this function runs, regardless of
 * outcome — invitation is single-use even on email-mismatch (the admin
 * must reissue if they want a second chance).
 *
 * Fail-safe: any throw inside this function is caught and logged. The
 * caller's signIn flow continues normally. We never want an invitation-
 * processing error to block the user from signing in.
 */
async function applyPendingInvitation(userId: string, userEmail: string): Promise<void> {
  let cookieStore: Awaited<ReturnType<typeof cookies>> | null = null;
  try {
    cookieStore = await cookies();
  } catch {
    // cookies() throws outside a request context; this function only
    // ever runs inside the events.signIn hook which is request-bound, so
    // this catch is purely defensive (e.g. test harness with no cookie
    // jar).
    return;
  }

  const tokenCookie = cookieStore.get(PENDING_INVITATION_COOKIE);
  if (!tokenCookie?.value) return;
  const plaintext = tokenCookie.value;

  // Clear the cookie regardless of outcome (single-use). The cookie set
  // happens in the accept-init POST handler; we clear here by overwriting
  // with maxAge=0. Next's cookies() in a server-action context allows
  // mutating cookies; events.signIn runs in that context.
  try {
    cookieStore.set({
      name: PENDING_INVITATION_COOKIE,
      value: "",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  } catch {
    // Some NextAuth event hooks run in a context where cookies() can be
    // read but not written. Non-fatal — the cookie's own 15-min TTL is
    // the worst-case fallback.
  }

  try {
    const tokenHash = hashToken(plaintext);
    const invitation = await prisma.userInvitation.findFirst({
      where: {
        tokenHash,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!invitation) {
      // Stale / expired / already-accepted cookie. Nothing to do.
      return;
    }

    const oauthEmail = userEmail.toLowerCase().trim();
    const invitationEmail = invitation.email.toLowerCase().trim();

    if (oauthEmail !== invitationEmail) {
      // Q4 — email mismatch. Document on the row + leave pending.
      await prisma.userInvitation.update({
        where: { id: invitation.id },
        data: {
          emailMismatchNote: `Recipient signed in with ${oauthEmail} (invitation was for ${invitationEmail}) at ${new Date().toISOString()}`,
        },
      });
      console.warn(
        `[auth] invitation email mismatch — invitation ${invitation.id} stays pending (OAuth: ${oauthEmail}, invitation: ${invitationEmail})`,
      );
      return;
    }

    // Email match. Apply role monotonic-upward + mark accepted + write
    // audit row, all inside one TX.
    const ROLE_RANK_LOCAL: Record<Role, number> = {
      [Role.SUBSCRIBER]: 0,
      [Role.PUBLISHER]: 1,
      [Role.ADMIN]: 2,
    };
    const invitationRole = invitation.role;

    await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (!current) return;
      const beforeRole = current.role;
      // Monotonic-upward (D11.11) — only UPDATE if invitation-derived
      // role is strictly higher than current. Otherwise the invitation
      // is a no-op (still marked accepted to consume the row).
      if (ROLE_RANK_LOCAL[invitationRole] > ROLE_RANK_LOCAL[beforeRole]) {
        await tx.user.update({
          where: { id: userId },
          data: { role: invitationRole },
        });
      }
      await markInvitationAccepted(tx, invitation.id, userId);
      // Actor is the recipient per Q5 — state transitions, not click
      // attempts; recipient caused the transition by accepting. NO new
      // D-slot — this rationale lives here inline.
      await writeAuditEntry(tx, {
        actorUserId: userId,
        actionType: "invitation.accept",
        targetType: "invitation",
        targetId: invitation.id,
        beforeState: { role: beforeRole, acceptedAt: null },
        afterState: {
          role:
            ROLE_RANK_LOCAL[invitationRole] > ROLE_RANK_LOCAL[beforeRole]
              ? invitationRole
              : beforeRole,
          acceptedAt: new Date().toISOString(),
        },
      });
    });

    console.info(`[auth] invitation ${invitation.id} accepted by ${userId} (${oauthEmail})`);
  } catch (err) {
    // Never block signin on an invitation-processing error. Surface to
    // logs so the operator can investigate; the user's session still
    // commits and they can use the app with their default role.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[auth] applyPendingInvitation failed: ${msg}`);
  }
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  session: { strategy: "database" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    // Phase 4 Stream D (D11.5 / D11.11) — open signup. The Phase 2 OAuth
    // domain/email allowlist gate (D8.1–D8.4) is removed. Any Google
    // identity that completes OAuth is allowed in; role assignment is handled
    // separately by syncRoleFromEnv via events.signIn / events.createUser.
    //
    // The email-presence sanity check is retained: NextAuth's contract is
    // that a falsy email here indicates a malformed provider response, NOT a
    // policy decision. Returning false aborts the flow before any DB write.
    async signIn({ user }) {
      const email = (user?.email ?? "").toLowerCase().trim();
      if (!email) {
        console.warn("[auth] signIn rejected: no email on user");
        return false;
      }
      return true;
    },
    async session({ session, user }) {
      if (session.user && user) {
        (session.user as { id?: string }).id = user.id;
        // Phase 3 Stream 3 — hydrate role from the User row so ADMIN-gated
        // surfaces (pricing UI, future moderation) can read session.user.role.
        // The next-auth.d.ts augmentation pre-declared the type at Stream 1
        // patch time; this is the runtime fill-in. Database-strategy sessions
        // call this callback every request so a role bump propagates without
        // requiring sign-out.
        const userWithRole = user as { role?: string };
        if (userWithRole.role) {
          (session.user as { role?: string }).role = userWithRole.role;
        }
      }
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (!user.id || !user.email) {
        throw new Error(`createUser event fired without id/email: ${JSON.stringify(user)}`);
      }
      await prisma.subscriber.create({
        data: {
          userId: user.id,
          companyName: user.name?.trim() || "Personal",
          email: user.email,
        },
      });
      // Phase 4.5 Stream H (D12.3) — stamp last_signin_at on first-signin.
      // events.createUser fires BEFORE events.signIn for new users; this
      // ensures the column is populated by the time the session callback
      // hits. events.signIn will refresh it microseconds later (idempotent
      // — last write wins with the slightly-later signIn timestamp). No
      // audit-log write: signin is implicit-self-action, not an admin
      // mutation per Stream G's writeAuditEntry contract (D12.4 / D12.7).
      // Maps to scenarios B + C in this hook (any new user; env match
      // promotes their role separately below).
      await prisma.user.update({
        where: { id: user.id },
        data: { lastSigninAt: new Date() },
      });
      // Phase 4 Stream D (D11.11) — apply env-driven role promotion on first
      // signin. NextAuth's adapter just inserted the user row with the schema
      // default (SUBSCRIBER per prisma/schema.prisma:131). If the email
      // matches ADMIN_EMAILS / PUBLISHER_EMAILS, promote now so the very
      // first session callback hydrates the correct role.
      // Scenario B (Edward, first signin): default SUBSCRIBER → env match → PUBLISHER.
      // Scenario C (fresh stranger): default SUBSCRIBER → no match → no-op.
      await syncRoleFromEnv(user.id, user.email, Role.SUBSCRIBER);
    },
    async signIn({ user, isNewUser }) {
      // Phase 4.5 Stream H (D12.3) — stamp last_signin_at on every signin.
      // Runs for BOTH new and returning users (the isNewUser guard below
      // gates only the role re-sync, not the lastSigninAt write — for new
      // users this UPDATE refreshes the timestamp createUser just wrote, to
      // the slightly-later signIn moment; for returning users this is the
      // sole write of the field for the session). The if (user.id) guard
      // covers the Scenario D NextAuth-quirk where user.id is falsy (skip
      // the UPDATE rather than crash; no harm — column stays at its
      // previous value). No audit-log write per the createUser comment
      // above (D12.4 / D12.7 contract: writeAuditEntry is for ADMIN
      // mutations with a distinct actor; signin is implicit-self-action,
      // not an admin action).
      if (user.id) {
        await prisma.user.update({
          where: { id: user.id },
          data: { lastSigninAt: new Date() },
        });
      }

      // Phase 5 Stream E (D15.1) — invitation acceptance hook. Runs for
      // BOTH new and returning users (Q3 — handles both paths uniformly,
      // not just createUser). Reads the bkstr_pending_invitation cookie,
      // validates the token, applies the role monotonic-upward, and
      // marks the invitation accepted. Errors are caught inside the
      // helper — they NEVER block the signin flow.
      if (user.id && user.email) {
        await applyPendingInvitation(user.id, user.email);
      }

      // First-signin promotion is handled by createUser above (which fires
      // BEFORE signIn for new users). Skip the role re-sync here to avoid a
      // redundant DB read; the lastSigninAt UPDATE above still ran.
      if (isNewUser) return;
      if (!user.id || !user.email) return;
      // Phase 4 Stream D (D11.11) — re-sync role on every returning signin.
      // Handles the "operator adds Edward to PUBLISHER_EMAILS AFTER Edward
      // already has a SUBSCRIBER row" case — Edward gets PUBLISHER on his
      // next visit without requiring manual SQL.
      // The DB read here is the source of truth for currentRole; we do NOT
      // trust the NextAuth user object's role field (it may be stale across
      // adapter implementations). Scenarios mapped here:
      //   Scenario A (animesh, returning): DB ADMIN → env ADMIN → max=ADMIN → no UPDATE.
      //   Scenario D (edward post-removal): DB PUBLISHER → no env match → no-op (rule 3).
      //   Scenario E (roles.env missing entirely): both env vars unset → envDerived=null → no-op.
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { role: true },
      });
      if (!dbUser) return;
      await syncRoleFromEnv(user.id, user.email, dbUser.role);
    },
  },
};

export const auth = () => getServerSession(authOptions);
