import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { writeAuditEntry } from "@/lib/admin/audit";
import { GrantSource, Prisma, Role } from "@/generated/prisma/client";

// Phase 4.5 Stream F — book ownership reassignment.
//
// Productizes the SQL block at docs/operations.md:453-478 (the
// "ADMIN-as-seed-owner → Reassign seed books later" runbook). Same three
// writes plus the audit row, atomically in an interactive
// $transaction(async (tx) => { … }) per D12.4. No Stripe touch — publisher
// attribution is not mirrored to Stripe (locked decision #7 in the design
// doc).
//
// D12.13 — ONLY PUBLISHER_OWN grants are affected. MANUAL / SEED / PURCHASE
// / SUBSCRIPTION grants on the same book stay untouched. This matches the
// SQL template's `WHERE source = 'PUBLISHER_OWN'` clause.
//
// D12.6 — soft-revoke. The prior owner's PUBLISHER_OWN grant is updated
// (revoked_at = NOW()), never DELETEd. Hard-delete is a psql-only path
// per docs/operations.md:288.
//
// Idempotency: re-running the same call with the same target results in
// the same end state. The book is already at the target publisher; the
// updateMany matches zero rows (no active prior grant); the createMany
// skipDuplicates no-ops on the unique constraint (subscriber_id, book_id,
// source). The audit row writes every time so the operator has a record
// of each click — desirable, not a defect (Q-F5 reissue-from-revoked is
// OOS so the "click again to no-op" path is the closest thing to a
// reissue and that path remains auditable).
//
// Error shape: HandlerError-based control flow, like Stream B's
// /api/checkout. The TX throws on the validation branches and we map to
// the appropriate status outside.

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
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: bookId } = await params;

  // 1. Role gate. ADMIN only. SUBSCRIBER + PUBLISHER are kicked at the
  //    layout level (UI flow) and re-checked here (defense-in-depth for
  //    direct curl / API misuse).
  const session = await auth();
  if (!session?.user?.id || session.user.role !== Role.ADMIN) {
    return NextResponse.json({ error: "ADMIN only" }, { status: 403 });
  }

  // 2. Input validation. UUID format + non-empty body. Stream B's pricing
  //    handler establishes the same UUID_REGEX shape.
  if (!UUID_REGEX.test(bookId)) {
    return NextResponse.json({ error: "book id must be a UUID" }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const targetUserId = (body as { target_user_id?: unknown })?.target_user_id;
  if (typeof targetUserId !== "string" || !UUID_REGEX.test(targetUserId)) {
    return NextResponse.json(
      { error: "target_user_id must be a UUID string" },
      { status: 400 },
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 3. Load the book + target user inside the TX so all reads see a
      //    consistent snapshot with the writes below.
      const book = await tx.book.findUnique({
        where: { id: bookId },
        select: { id: true, slug: true, title: true, publisherUserId: true },
      });
      if (!book) throw new HandlerError("Book not found", 404);

      const targetUser = await tx.user.findUnique({
        where: { id: targetUserId },
        select: {
          id: true,
          role: true,
          subscriber: { select: { id: true } },
        },
      });
      if (!targetUser) throw new HandlerError("Target user not found", 404);

      // 4. Role guard — defense-in-depth on top of the dropdown filter.
      //    ADMIN-target is intentionally allowed; matches the current
      //    ADMIN-as-seed-owner state and lets ADMIN re-attribute books
      //    back to itself if needed.
      if (
        targetUser.role !== Role.PUBLISHER &&
        targetUser.role !== Role.ADMIN
      ) {
        throw new HandlerError("Target user must be PUBLISHER or ADMIN", 400);
      }

      // 5. Subscriber row required — PUBLISHER_OWN grants live on the
      //    publisher's subscribers row. Auto-created via events.createUser
      //    at signin; absent means the user hasn't signed in yet. Mirrors
      //    the migration's `IF edward_sub_id IS NULL` defer branch.
      if (!targetUser.subscriber) {
        throw new HandlerError(
          "Target user has no subscribers row; ask them to sign in first",
          422,
        );
      }

      // 6. No-op short-circuit. Reassign-to-self is a click that does
      //    nothing — return early without writing the audit row (no state
      //    change, no audit need). The early return inside the TX is fine;
      //    Prisma commits an empty TX (or rolls back to a no-op) without
      //    error.
      if (book.publisherUserId === targetUserId) {
        return {
          bookId,
          status: "unchanged" as const,
          previousPublisherUserId: book.publisherUserId,
          newPublisherUserId: targetUserId,
          revokedGrantCount: 0,
          newGrantCreated: false,
        };
      }

      // 7. Three writes mirroring docs/operations.md:453-478.
      //    a) Move book.publisher_user_id to the target.
      await tx.book.update({
        where: { id: bookId },
        data: { publisherUserId: targetUserId },
      });

      //    b) Soft-revoke every active PUBLISHER_OWN grant for this book.
      //       updateMany on (source, bookId, revokedAt: null) is the
      //       D12.13-narrow scope — MANUAL / SEED / PURCHASE / SUBSCRIPTION
      //       grants are not in the WHERE and are untouched.
      const revoked = await tx.accessGrant.updateMany({
        where: {
          bookId,
          source: GrantSource.PUBLISHER_OWN,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });

      //    c) Issue a fresh PUBLISHER_OWN grant for the target. The unique
      //       constraint (subscriber_id, book_id, source) means a stale
      //       revoked row for THIS target on THIS book would collide. We
      //       use createMany skipDuplicates (the ON CONFLICT DO NOTHING
      //       equivalent — Stream B's new-book handler uses the same shape
      //       at src/app/api/books/new/route.ts:310-319). The trade-off:
      //       if the target previously held PUBLISHER_OWN, was revoked,
      //       and is now re-owning, the create silently no-ops and the
      //       grant stays revoked. Per Q-F5, reissue-from-revoked is OOS
      //       — operator un-revokes via psql.
      const created = await tx.accessGrant.createMany({
        data: [
          {
            subscriberId: targetUser.subscriber.id,
            bookId,
            source: GrantSource.PUBLISHER_OWN,
          },
        ],
        skipDuplicates: true,
      });

      // 8. Audit row. before/after state captures changing fields only
      //    (D12.14). Keeping the publisher_user_id snake_case in the JSONB
      //    matches the SQL column name and the operations.md JSONB-decode
      //    queries at docs/operations.md:903-914.
      await writeAuditEntry(tx, {
        actorUserId: session.user.id,
        actionType: "book.reassign_publisher",
        targetType: "book",
        targetId: bookId,
        beforeState: { publisher_user_id: book.publisherUserId },
        afterState: { publisher_user_id: targetUserId },
      });

      return {
        bookId,
        status: "ok" as const,
        previousPublisherUserId: book.publisherUserId,
        newPublisherUserId: targetUserId,
        revokedGrantCount: revoked.count,
        newGrantCreated: created.count > 0,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof HandlerError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    // Prisma "record not found" inside an update would surface as P2025;
    // we already pre-checked book existence so it should not fire, but
    // map it to 404 defensively for forward-compat.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2025"
    ) {
      return NextResponse.json({ error: "Book not found" }, { status: 404 });
    }
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[admin/books/reassign] Failed: ${msg}`);
    return NextResponse.json({ error: `Reassign failed: ${msg}` }, { status: 500 });
  }
}
