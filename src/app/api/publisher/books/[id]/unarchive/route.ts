import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { writeAuditEntry } from "@/lib/admin/audit";
import { BookStatus, Role } from "@/generated/prisma/client";

// Phase 5 Stream E (D15.5) — publisher book unarchive. ARCHIVED → ACTIVE.
// Mirrors the archive handler shape; the inverse transition.
//
// Status flow:
//   - ARCHIVED → ACTIVE  : canonical
//   - ACTIVE / DRAFT     : 409 (only ARCHIVED is unarchive-able; unarchive
//     of an already-ACTIVE book is meaningless, unarchive of a DRAFT
//     would semantically mean "publish" which is a separate flow).

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== Role.PUBLISHER && session.user.role !== Role.ADMIN) {
    return NextResponse.json(
      { error: "PUBLISHER or ADMIN role required" },
      { status: 403 },
    );
  }

  const { id: bookId } = await params;
  if (!UUID_REGEX.test(bookId)) {
    return NextResponse.json({ error: "Book id must be a UUID" }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const book = await tx.book.findUnique({
        where: { id: bookId },
        select: { id: true, status: true, publisherUserId: true },
      });
      if (!book) {
        return { status: "not_found" as const };
      }
      if (
        session.user.role === Role.PUBLISHER &&
        book.publisherUserId !== session.user.id
      ) {
        return { status: "forbidden" as const };
      }
      if (book.status !== BookStatus.ARCHIVED) {
        return { status: "not_archived" as const };
      }

      await tx.book.update({
        where: { id: bookId },
        data: { status: BookStatus.ACTIVE },
      });

      await writeAuditEntry(tx, {
        actorUserId: session.user.id,
        actionType: "book.unarchive",
        targetType: "book",
        targetId: bookId,
        beforeState: { status: BookStatus.ARCHIVED },
        afterState: { status: BookStatus.ACTIVE },
      });

      return { status: "ok" as const };
    });

    if (result.status === "not_found") {
      return NextResponse.json({ error: "Book not found" }, { status: 404 });
    }
    if (result.status === "forbidden") {
      return NextResponse.json(
        { error: "You do not own this book" },
        { status: 403 },
      );
    }
    if (result.status === "not_archived") {
      return NextResponse.json(
        { error: "Book is not archived; only ARCHIVED books can be unarchived" },
        { status: 409 },
      );
    }
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[publisher/books/${bookId}/unarchive] failed: ${msg}`);
    return NextResponse.json({ error: `Unarchive failed: ${msg}` }, { status: 500 });
  }
}
