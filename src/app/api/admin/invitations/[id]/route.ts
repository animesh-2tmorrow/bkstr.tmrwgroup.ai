import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { writeAuditEntry } from "@/lib/admin/audit";
import { Role } from "@/generated/prisma/client";

// Phase 5 Stream E (D15.1 / D15.2) — invitation cancel handler. ADMIN-only.
// Only cancellable when acceptedAt IS NULL. Writes an `invitation.cancel`
// audit row + sets emailSendStatus='cancelled' so the pending-invitations
// table can distinguish cancelled-by-admin from never-sent / failed-to-send.
// Hard-delete is NOT supported via the API — keeps the row as audit history
// (operator can DELETE via psql if a genuine purge is needed, mirroring the
// soft-revoke precedent at D12.6).

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== Role.ADMIN) {
    return NextResponse.json({ error: "ADMIN only" }, { status: 403 });
  }

  const { id } = await params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: "Invitation id must be a UUID" }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const row = await tx.userInvitation.findUnique({
        where: { id },
        select: { id: true, email: true, role: true, acceptedAt: true, emailSendStatus: true },
      });
      if (!row) {
        return { status: "not_found" as const };
      }
      if (row.acceptedAt) {
        return { status: "already_accepted" as const };
      }

      await tx.userInvitation.update({
        where: { id },
        data: { emailSendStatus: "cancelled" },
      });

      await writeAuditEntry(tx, {
        actorUserId: session.user.id,
        actionType: "invitation.cancel",
        targetType: "invitation",
        targetId: id,
        beforeState: { emailSendStatus: row.emailSendStatus },
        afterState: { emailSendStatus: "cancelled" },
      });

      return { status: "ok" as const };
    });

    if (result.status === "not_found") {
      return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
    }
    if (result.status === "already_accepted") {
      return NextResponse.json(
        { error: "Cannot cancel an invitation that has already been accepted" },
        { status: 409 },
      );
    }
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[admin/invitations/${id}] DELETE failed: ${msg}`);
    return NextResponse.json({ error: `Cancel failed: ${msg}` }, { status: 500 });
  }
}
