// Phase 4 Stream C (D11.4 / CC-4) — shared authorization primitive for the
// content-egress routes (View, Download) and the future
// `/api/agent/fetch` enforcement (Stream 1 patch 2, `ENFORCE_BOOK_ACCESS`).
//
// The "active grant" predicate mirrors the one used in
// `src/lib/dashboard/queries.ts:getBookAccessStates` and
// `src/app/api/checkout/route.ts` so every authorization read stays
// consistent. PUBLISHER_OWN (D11.3) is just another active grant — the helper
// does NOT switch on `source`; the role + publisher_user_id question is moot
// inside the helper. Callers are responsible for the user → subscriber
// lookup; this helper is the authorization primitive only.

import { prisma } from "@/lib/db";
import type { AccessGrant } from "@/generated/prisma/client";

export class BookAccessError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "BookAccessError";
    this.status = status;
  }
}

/**
 * Returns the most recent active AccessGrant for (subscriberId, bookId), or
 * throws BookAccessError(403). "Active" means revokedAt IS NULL AND
 * (expiresAt IS NULL OR expiresAt > NOW()).
 *
 * Consumers:
 *   - src/app/api/books/[id]/view/route.ts (Stream C)
 *   - src/app/api/books/[id]/download/route.ts (Stream C)
 *   - src/app/api/agent/fetch/route.ts (Stream 1 patch 2 — `ENFORCE_BOOK_ACCESS`,
 *     deferred; the route currently skips the check per D5.11 / #32).
 */
export async function requireBookAccess(
  subscriberId: string,
  bookId: string,
): Promise<AccessGrant> {
  const grant = await prisma.accessGrant.findFirst({
    where: {
      subscriberId,
      bookId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { grantedAt: "desc" },
  });
  if (!grant) {
    throw new BookAccessError("No active grant for this book", 403);
  }
  return grant;
}
