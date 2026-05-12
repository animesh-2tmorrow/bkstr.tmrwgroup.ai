import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { writeAuditEntry } from "@/lib/admin/audit";
import { BookStatus, Role } from "@/generated/prisma/client";

// Phase 5 Stream E (D15.5) — publisher book archive.
//
// POST. Role check (PUBLISHER or ADMIN), ownership check (if PUBLISHER,
// book.publisherUserId === session.user.id). Atomic prisma.$transaction
// → tx.book.update + writeAuditEntry. Per D15.5 the BookStatus.ARCHIVED
// enum value already exists since Phase 1 — this handler only flips
// the status column.
//
// Status flow:
//   - DRAFT → ARCHIVED   : allowed (publisher gives up on a draft)
//   - ACTIVE → ARCHIVED  : allowed (canonical case)
//   - ARCHIVED → ARCHIVED: 409 (already archived; surface as no-op)
//
// Grants on the archived book are NOT touched (D15.5 invariant). Buyers
// who own the book continue to access it via requireBookAccess (which
// does not filter on status). The Active Books table includes ARCHIVED
// rows for grant-holders too — verified during Stream E implementation
// (Q6) that getBooksWithMetrics has no status filter.

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
        select: { id: true, status: true, publisherUserId: true, title: true },
      });
      if (!book) {
        return { status: "not_found" as const };
      }

      // Defense-in-depth ownership check. PUBLISHER must own the book;
      // ADMIN bypasses (handled by the role check above, no per-row
      // ownership requirement).
      if (
        session.user.role === Role.PUBLISHER &&
        book.publisherUserId !== session.user.id
      ) {
        return { status: "forbidden" as const };
      }

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
    if (result.status === "forbidden") {
      return NextResponse.json(
        { error: "You do not own this book" },
        { status: 403 },
      );
    }
    if (result.status === "already_archived") {
      return NextResponse.json(
        { error: "Book is already archived" },
        { status: 409 },
      );
    }
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[publisher/books/${bookId}/archive] failed: ${msg}`);
    return NextResponse.json({ error: `Archive failed: ${msg}` }, { status: 500 });
  }
}
