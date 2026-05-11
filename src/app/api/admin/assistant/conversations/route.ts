import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Role } from "@/generated/prisma/client";

// Phase 5 Stream B — POST: create a new assistant conversation. GET: list
// the current admin's non-archived conversations. ADMIN-only on both.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAdmin(
  session: Awaited<ReturnType<typeof auth>>,
): session is NonNullable<typeof session> & {
  user: { id: string; email: string; role: typeof Role.ADMIN };
} {
  return Boolean(session?.user?.id && session.user.email && session.user.role === Role.ADMIN);
}

export async function POST(request: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "ADMIN role required" }, { status: 403 });
  }

  let body: unknown = {};
  try {
    if (request.headers.get("content-length") !== "0") {
      body = await request.json();
    }
  } catch {
    // Empty / malformed body is fine — title is optional.
    body = {};
  }
  const titleRaw = (body as { title?: unknown }).title;
  const title =
    typeof titleRaw === "string" && titleRaw.trim().length > 0
      ? titleRaw.trim().slice(0, 255)
      : null;

  const created = await prisma.assistantConversation.create({
    data: {
      ownerUserId: session.user.id,
      title,
    },
    select: { id: true, title: true, createdAt: true },
  });

  return NextResponse.json(created, { status: 201 });
}

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "ADMIN role required" }, { status: 403 });
  }

  const conversations = await prisma.assistantConversation.findMany({
    where: { ownerUserId: session.user.id, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  });

  return NextResponse.json(
    conversations.map((c) => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt,
      messageCount: c._count.messages,
    })),
    { status: 200 },
  );
}
