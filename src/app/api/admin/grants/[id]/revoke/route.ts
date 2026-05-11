import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { writeAuditEntry } from "@/lib/admin/audit";
import { Prisma, Role } from "@/generated/prisma/client";

// Phase 4.5 Stream F — access_grants revoke.
//
// Soft-revoke per D12.6: sets revoked_at = NOW() via UPDATE. Never DELETE
// from this surface. Hard-delete is a psql-only break-glass path.
//
// Source-agnostic — works for any of the 5 GrantSource values. The
// per-source side effects are surfaced in the revoke modal's warning copy
// (SEED unblocks Checkout per D10.2; PUBLISHER_OWN removes the publisher's
// own read access; etc.). The handler itself is symmetric across sources.
//
// Already-revoked grants return 400 (per the assignment) — the UI hides
// the Revoke button on revoked rows so this branch only fires on a direct
// API call / stale-tab race.

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

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: grantId } = await params;

  const session = await auth();
  if (!session?.user?.id || session.user.role !== Role.ADMIN) {
    return NextResponse.json({ error: "ADMIN only" }, { status: 403 });
  }

  if (!UUID_REGEX.test(grantId)) {
    return NextResponse.json({ error: "grant id must be a UUID" }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Read inside the TX so the existence + revoked-at check is
      // consistent with the UPDATE below. A concurrent revoke would race
      // with this check; serializing inside one TX makes the
      // already-revoked branch deterministic.
      const grant = await tx.accessGrant.findUnique({
        where: { id: grantId },
        select: {
          id: true,
          source: true,
          revokedAt: true,
          subscriberId: true,
          bookId: true,
        },
      });
      if (!grant) throw new HandlerError("Grant not found", 404);
      if (grant.revokedAt !== null) {
        throw new HandlerError("Grant already revoked", 400);
      }

      const revokedAt = new Date();
      await tx.accessGrant.update({
        where: { id: grantId },
        data: { revokedAt },
      });

      // Audit row. before_state captures revoked_at=null; after_state the
      // ISO timestamp. The decode query at docs/operations.md:918-925
      // reads after_state->>'revoked_at' so the JSONB key naming is
      // snake_case to match.
      await writeAuditEntry(tx, {
        actorUserId: session.user.id,
        actionType: "grant.revoke",
        targetType: "grant",
        targetId: grantId,
        beforeState: { revoked_at: null },
        afterState: { revoked_at: revokedAt.toISOString() },
      });

      return {
        id: grantId,
        revokedAt: revokedAt.toISOString(),
        source: grant.source,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof HandlerError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2025"
    ) {
      return NextResponse.json({ error: "Grant not found" }, { status: 404 });
    }
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[admin/grants/revoke] Failed: ${msg}`);
    return NextResponse.json({ error: `Revoke failed: ${msg}` }, { status: 500 });
  }
}
