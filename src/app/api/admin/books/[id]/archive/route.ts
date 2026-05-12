import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { writeAuditEntry } from "@/lib/admin/audit";
import { BookStatus, Role } from "@/generated/prisma/client";

// Phase 5 Stream E (D15.5) — admin book archive. ADMIN-only (no ownership
// check). Same audit shape as the publisher route; the actor is the
// admin, not the publisher. Lets ADMIN archive a book without first
// reassigning publisher ownership.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== Role.ADMIN) {
    return NextResponse.json({ error: "ADMIN only" }, { status: 403 });
  }

  const { id: bookId } = await params;
  if (!UUID_REGEX.test(bookId)) {
    return NextResponse.json({ error: "Book id must be a UUID" }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const book = await tx.book.findUnique({
        where: { id: bookId },
        select: { id: true, status: true },
      });
      if (!book) return { status: "not_found" as const };
      if (book.status === BookStatus.ARCHIVED) {
        return { status: "already_archived" as const };
      }

      await tx.book.update({
        where: { id: bookId },
        data: { status: BookStatus.ARCHIVED },
      });

      await writeAuditEntry(tx, {
        actorUserId: session.user.id,
        actionType: "book.archive",
        targetType: "book",
        targetId: bookId,
        beforeState: { status: book.status },
        afterState: { status: BookStatus.ARCHIVED },
      });

      return { status: "ok" as const };
    });

    if (result.status === "not_found") {
      return NextResponse.json({ error: "Book not found" }, { status: 404 });
    }
    if (result.status === "already_archived") {
      return NextResponse.json({ error: "Book is already archived" }, { status: 409 });
    }
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[admin/books/${bookId}/archive] failed: ${msg}`);
    return NextResponse.json({ error: `Archive failed: ${msg}` }, { status: 500 });
  }
}
