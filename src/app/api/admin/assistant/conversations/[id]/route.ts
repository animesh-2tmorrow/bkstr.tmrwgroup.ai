import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Role } from "@/generated/prisma/client";

// Phase 5 Stream B — DELETE: soft-archive a conversation (sets
// archived_at = NOW()). ADMIN-only + ownership-checked. Returns 204 on
// success, 403 if not owner, 404 if not found.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== Role.ADMIN) {
    return NextResponse.json({ error: "ADMIN role required" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: "Conversation id must be a UUID" }, { status: 400 });
  }

  const existing = await prisma.assistantConversation.findUnique({
    where: { id },
    select: { ownerUserId: true, archivedAt: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
  if (existing.ownerUserId !== session.user.id) {
    // Ownership check is the load-bearing isolation between admins. ADMIN
    // role gates entry to /dashboard/admin/assistant; ownerUserId gates
    // access to a SPECIFIC conversation.
    return NextResponse.json(
      { error: "You do not own this conversation" },
      { status: 403 },
    );
  }

  await prisma.assistantConversation.update({
    where: { id },
    data: { archivedAt: existing.archivedAt ?? new Date() },
  });

  return new Response(null, { status: 204 });
}
