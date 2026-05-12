import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { writeAuditEntry } from "@/lib/admin/audit";
import {
  generateInvitationToken,
  hashToken,
  PENDING_INVITATION_TTL_SECONDS,
} from "@/lib/admin/invitations";
import { sendInvitationEmail } from "@/lib/email/client";
import { renderInvitationEmail } from "@/lib/email/templates/invitation";
import { Role } from "@/generated/prisma/client";

// Phase 5 Stream E (D15.1–D15.4) — invitation create + list surface.
//
// POST: ADMIN-only. Creates a UserInvitation row, sends the email (best-
// effort), writes an `invitation.send` audit entry. Returns the magic link
// in the response so the admin UI can copy-paste as a fallback when SMTP
// fails or isn't yet staged. Per Q8, if the recipient email matches an
// existing user, returns the row plus a `warning` field describing the
// promote-on-accept (or no-op-on-accept) outcome — never rejects.
//
// GET: ADMIN-only. Returns recent invitations (both pending + recently-
// accepted). Used by the pending-invitations table on /dashboard/admin/users.

// 15-minute TTL on the magic link → matches the cookie TTL. Operators who
// need a longer-lived invitation re-issue (#90 follow-up tracks "invite
// expiry policy revisit" if this becomes painful).
const INVITATION_TTL_MS = PENDING_INVITATION_TTL_SECONDS * 1000;

// RFC 5322-flavored email validation. Not a full RFC implementation —
// intentionally restrictive (no quoted-strings, no IP-literal domains,
// no comments) because the invitations flow is single-purpose: typing
// a normal corporate email and getting it in front of Google OAuth. The
// regex matches the same shape NextAuth uses internally.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class HandlerError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function originFromRequest(request: Request): string {
  // Honor X-Forwarded-Proto/Host from the load balancer when present
  // (production); fall back to the URL's own origin for dev / curl.
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return new URL(request.url).origin;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== Role.ADMIN) {
    return NextResponse.json({ error: "ADMIN only" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const emailRaw = (body as { email?: unknown })?.email;
  const roleRaw = (body as { role?: unknown })?.role;

  if (typeof emailRaw !== "string" || !EMAIL_REGEX.test(emailRaw)) {
    return NextResponse.json(
      { error: "email must be a valid email address" },
      { status: 400 },
    );
  }
  // D15.1 — invitations are restricted to PUBLISHER + SUBSCRIBER. ADMIN
  // promotion stays gated behind the existing role-mutation modal (D12.10)
  // so the asymmetric-friction confirmation is enforced.
  if (roleRaw !== Role.PUBLISHER && roleRaw !== Role.SUBSCRIBER) {
    return NextResponse.json(
      { error: "role must be PUBLISHER or SUBSCRIBER" },
      { status: 400 },
    );
  }

  const email = emailRaw.toLowerCase().trim();
  const role = roleRaw as typeof Role.PUBLISHER | typeof Role.SUBSCRIBER;

  // Q8 — invite to existing user. NOT a rejection; we return a `warning`
  // string in the response so the admin UI can render it prominently. The
  // monotonic-upward promotion semantics from D11.11 mean the invitation
  // either promotes the existing user (if their current role is lower than
  // the invited role) OR is a no-op-on-accept (current role >= invited
  // role). The audit row writes either way.
  const existingUser = await prisma.user.findFirst({
    where: { email },
    select: { id: true, role: true },
  });
  let warning: string | null = null;
  if (existingUser) {
    const ROLE_RANK: Record<Role, number> = {
      [Role.SUBSCRIBER]: 0,
      [Role.PUBLISHER]: 1,
      [Role.ADMIN]: 2,
    };
    if (ROLE_RANK[existingUser.role] >= ROLE_RANK[role]) {
      warning = `User with this email already exists with role ${existingUser.role}. Invitation will be a no-op since they're already ${existingUser.role} (which is at-or-above ${role}).`;
    } else {
      warning = `User with this email already exists with role ${existingUser.role}. Invitation will promote them to ${role} on accept.`;
    }
  }

  // Generate the plaintext token + hash. Plaintext goes in the email +
  // the magicLink in the response; hash goes in the DB. See
  // src/lib/admin/invitations.ts for the lifecycle commentary.
  const plaintextToken = generateInvitationToken();
  const tokenHash = hashToken(plaintextToken);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  const magicLink = `${originFromRequest(request)}/invitations/accept?token=${encodeURIComponent(plaintextToken)}`;

  try {
    // Single TX so the row + audit entry commit atomically (D12.4).
    const invitation = await prisma.$transaction(async (tx) => {
      const created = await tx.userInvitation.create({
        data: {
          email,
          role,
          tokenHash,
          invitedByUserId: session.user.id,
          expiresAt,
          // 'pending' until the post-TX send call settles. The audit row
          // captures the send-attempt as audit, not the final delivery
          // status — final status is updated outside the TX.
          emailSendStatus: "pending",
        },
      });

      await writeAuditEntry(tx, {
        actorUserId: session.user.id,
        actionType: "invitation.send",
        targetType: "invitation",
        targetId: created.id,
        beforeState: null,
        afterState: { email, role, expiresAt: expiresAt.toISOString() },
      });

      return created;
    });

    // Send the email OUTSIDE the TX so a slow / failing SMTP relay doesn't
    // hold a Postgres transaction open. Failures here update the row to
    // emailSendStatus='failed' so the admin UI shows the right pill; the
    // magic link is still returned to the caller for copy-paste fallback.
    const { subject, text } = renderInvitationEmail({
      inviterName: session.user.name ?? session.user.email ?? "An admin",
      role,
      magicLink,
      recipientEmail: email,
    });
    const result = await sendInvitationEmail({ to: email, subject, text });

    if (result.status === "sent") {
      await prisma.userInvitation.update({
        where: { id: invitation.id },
        data: { emailSendStatus: "sent" },
      });
    } else {
      await prisma.userInvitation.update({
        where: { id: invitation.id },
        data: {
          emailSendStatus: "failed",
          emailSendError: result.error.slice(0, 1000),
        },
      });
    }

    return NextResponse.json({
      id: invitation.id,
      email,
      role,
      magicLink,
      emailSendStatus: result.status === "sent" ? "sent" : "failed",
      emailSendError: result.status === "failed" ? result.error : null,
      warning,
    });
  } catch (err) {
    if (err instanceof HandlerError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[admin/invitations] POST failed: ${msg}`);
    return NextResponse.json({ error: `Invitation create failed: ${msg}` }, { status: 500 });
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== Role.ADMIN) {
    return NextResponse.json({ error: "ADMIN only" }, { status: 403 });
  }

  // Pull the 100 most-recent rows (pending + accepted). Pagination is a
  // future follow-up — at v1 we expect <50 rows over the platform's first
  // year of life.
  const rows = await prisma.userInvitation.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      email: true,
      role: true,
      invitedByUserId: true,
      invitedBy: { select: { email: true, name: true } },
      expiresAt: true,
      acceptedAt: true,
      acceptedByUserId: true,
      emailSendStatus: true,
      emailSendError: true,
      emailMismatchNote: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ invitations: rows });
}
