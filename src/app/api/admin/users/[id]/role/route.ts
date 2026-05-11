import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { writeAuditEntry } from "@/lib/admin/audit";
import { Role } from "@/generated/prisma/client";

/**
 * Phase 4.5 Stream E — role mutation handler (D12.2 / D12.4 / D12.5 / D12.9).
 *
 * Promotes / demotes a target user's role. ADMIN-only. The mutation + the
 * audit-log row are written inside a single interactive `prisma.$transaction`
 * so the two writes commit / roll back atomically (D12.4).
 *
 * REQUEST SHAPE (JSON body):
 *   { role: "SUBSCRIBER" | "PUBLISHER" | "ADMIN" }
 *
 * RESPONSE SHAPES:
 *   200 { status: "ok" }          — mutation written, audit row written.
 *   200 { status: "unchanged" }   — no-op (current role == target role). NO
 *                                    audit row written (Scenario H in the
 *                                    implementation prompt — keep the audit
 *                                    log free of spurious entries).
 *   400 { error: "Invalid role" }                  — body.role not in the enum.
 *   400 { error: "Cannot demote yourself..." }     — Gate 1 (self-demote).
 *   400 { error: "Cannot demote the last..." }     — Gate 2 (last ADMIN).
 *   403 { error: "ADMIN role required" }           — caller is not ADMIN.
 *   403 { error: "Cannot promote above..." }       — Gate 5 (defense-in-depth).
 *   404 { error: "User not found" }                — Gate 3 (target missing).
 *
 * D12.2 — Four-rule extension of D11.11's monotonic-upward invariant:
 *
 *   1. Env presence PROMOTES (D11.11 rule 1) — UNCHANGED. syncRoleFromEnv at
 *      src/lib/auth/index.ts:74-101 still applies on every signin.
 *   2. Env absence is a NO-OP (D11.11 rule 2) — UNCHANGED.
 *   3. Demotion via env removal is forbidden (D11.11 rule 3) — UNCHANGED.
 *      The env-driven path never lowers a role.
 *   4. Demotion via explicit ADMIN UI action is PERMITTED — NEW (this handler).
 *      An ADMIN clicking "Change role" + confirming via the asymmetric modal
 *      (D12.10) may lower a target user's role. The audit row in admin_actions
 *      captures the actor + before/after state.
 *
 * Operator consequence (R1): UI demotion alone is "until next signin." If the
 * demoted user's email remains in PUBLISHER_EMAILS or ADMIN_EMAILS, their next
 * signin will re-promote them via syncRoleFromEnv. The runbook in
 * docs/operations.md "Stream E — role mutation operator guide" documents this
 * — operators must also pull the email from /etc/bkstr/roles.env for the
 * demotion to stick across signins.
 *
 * D12.9 — Five self-protection gates. Implemented as throws of
 * HandlerError(status, message) inside the transaction so the count check
 * (Gate 2) sees a consistent view of the users table.
 *
 * D12.5 — actionType naming: dot-delimited `user.role_<direction>_<targetRole>`.
 * Values written by this handler:
 *   - user.role_promote_publisher  (SUBSCRIBER → PUBLISHER)
 *   - user.role_promote_admin       (any → ADMIN)
 *   - user.role_demote_publisher    (ADMIN → PUBLISHER — rare but enumerated)
 *   - user.role_demote_subscriber   (PUBLISHER → SUBSCRIBER or ADMIN → SUBSCRIBER)
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_ROLES: ReadonlyArray<Role> = [Role.SUBSCRIBER, Role.PUBLISHER, Role.ADMIN];

// Local ROLE_RANK — kept consistent with src/lib/auth/index.ts:41-45 by
// convention (small enough that exporting + importing through a shared module
// adds more ceremony than the duplication). Higher number = higher privilege.
const ROLE_RANK: Record<Role, number> = {
  [Role.SUBSCRIBER]: 0,
  [Role.PUBLISHER]: 1,
  [Role.ADMIN]: 2,
};

// Sentinel error class — carries an HTTP status alongside the message so
// gates inside the $transaction can short-circuit with the right shape on
// the way out. The catch block at the bottom of the handler maps this to a
// JSON response; anything else re-throws to the framework (500 default).
class HandlerError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function isRole(value: unknown): value is Role {
  return typeof value === "string" && VALID_ROLES.includes(value as Role);
}

// Direction-and-target → D12.5 actionType. The "demote" branch picks based on
// the TARGET role (the rank-lower side); the "promote" branch picks based on
// the TARGET role too. ADMIN-to-PUBLISHER and ADMIN-to-SUBSCRIBER are both
// demotes; PUBLISHER-to-ADMIN is a promote-to-admin. The enumeration matches
// D12.5 verbatim.
function actionTypeFor(beforeRole: Role, afterRole: Role): string {
  const direction = ROLE_RANK[afterRole] > ROLE_RANK[beforeRole] ? "promote" : "demote";
  return `user.role_${direction}_${afterRole.toLowerCase()}`;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Gate 5 (defense-in-depth) — only ADMIN can call. The /dashboard/admin/
  // layout already redirects non-ADMIN browsers; this guard catches any
  // hand-crafted curl request.
  if (session.user.role !== Role.ADMIN) {
    return NextResponse.json({ error: "ADMIN role required" }, { status: 403 });
  }

  const { id: targetUserId } = await ctx.params;
  if (!UUID_REGEX.test(targetUserId)) {
    return NextResponse.json({ error: "User id must be a UUID" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const targetRole = (body as { role?: unknown })?.role;
  // Gate 4 — role must be a valid Role enum value.
  if (!isRole(targetRole)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  // Gate 5 (forward-compat) — cannot promote above own role. Today this is
  // moot (only ADMIN reaches this handler, ADMIN is the highest rank); the
  // check is defense-in-depth for a future 4-tier enum.
  if (ROLE_RANK[targetRole] > ROLE_RANK[session.user.role]) {
    return NextResponse.json(
      { error: "Cannot promote above your own role" },
      { status: 403 },
    );
  }

  // Single interactive transaction per D12.4 — read pre-mutation row, run the
  // mutation, write the audit entry, all under the same TX. The HandlerError
  // throws inside the callback abort the TX and bubble out to the catch
  // block below, which maps them to JSON error responses.
  try {
    const result = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, email: true, role: true },
      });
      // Gate 3 — target must exist.
      if (!target) {
        throw new HandlerError("User not found", 404);
      }

      // Gate 1 — ADMIN cannot demote themselves. Fires BEFORE Gate 2 (so
      // self-demote on the only ADMIN reports the "self" reason, not the
      // "last ADMIN" reason). Both apply in Scenario E in the implementation
      // prompt; the order is deliberate.
      if (target.id === session.user.id && targetRole !== Role.ADMIN) {
        throw new HandlerError(
          "Cannot demote yourself. If absolutely necessary, use the SQL fallback documented in docs/operations.md.",
          400,
        );
      }

      // No-op short-circuit (Scenario H) — current role already matches the
      // target. Return a sentinel that the outer code maps to a 200
      // "unchanged" without writing an audit row.
      if (target.role === targetRole) {
        return { status: "unchanged" as const };
      }

      // Gate 2 — cannot demote the last remaining ADMIN. Runs INSIDE the TX
      // so the count is consistent with the read above. Race window with two
      // concurrent demotes accepted per D12.9 R3 (multi-ADMIN coordination
      // is a rare scenario; revisit with SELECT … FOR UPDATE if we ever ship
      // >2 ADMIN environments).
      if (target.role === Role.ADMIN && targetRole !== Role.ADMIN) {
        const adminCount = await tx.user.count({ where: { role: Role.ADMIN } });
        if (adminCount <= 1) {
          throw new HandlerError(
            "Cannot demote the last remaining ADMIN. Promote a successor first, then demote.",
            400,
          );
        }
      }

      // Mutate the role. Prisma + Postgres handles the underlying UPDATE; the
      // @updatedAt column bumps automatically.
      await tx.user.update({
        where: { id: targetUserId },
        data: { role: targetRole },
      });

      // Audit row — D12.5 actionType, D12.14 changing-fields-only state
      // capture. The actor is the logged-in ADMIN; the target is the user
      // whose role just changed.
      await writeAuditEntry(tx, {
        actorUserId: session.user.id,
        actionType: actionTypeFor(target.role, targetRole),
        targetType: "user",
        targetId: targetUserId,
        beforeState: { role: target.role },
        afterState: { role: targetRole },
      });

      return { status: "ok" as const };
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof HandlerError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    // Anything else — let it propagate to the framework (500). The audit row
    // would have rolled back with the mutation (D12.4 atomicity guarantee).
    throw err;
  }
}
