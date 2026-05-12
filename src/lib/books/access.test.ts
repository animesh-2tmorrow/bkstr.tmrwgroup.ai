import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 5 Stream E (D15.5) — invariant: a PURCHASE grant on an ARCHIVED
// book still resolves to access=true. Buyers who own an ARCHIVED book
// retain their access; the archive flag is a Library-visibility toggle,
// NOT an access revocation. This pairs with the Q6 verification that
// getBooksWithMetrics has no status filter — together they form the
// "ARCHIVED book stays accessible to grant-holders" load-bearing UX
// invariant.
//
// Single test (h) per the dispatch spec.

const prismaFindFirstMock = vi.fn<(arg: unknown) => Promise<unknown>>();

vi.mock("@/lib/db", () => ({
  prisma: {
    accessGrant: {
      findFirst: (arg: unknown) => prismaFindFirstMock(arg),
    },
  },
}));

import { requireBookAccess } from "./access";

beforeEach(() => {
  prismaFindFirstMock.mockReset();
});

describe("requireBookAccess on ARCHIVED books", () => {
  it("(h) PURCHASE grant on ARCHIVED book still resolves access=true", async () => {
    // The helper does not query book.status — its predicate is purely
    // grant-side (active, non-revoked, non-expired). An ARCHIVED book
    // with an active PURCHASE grant resolves to the grant row,
    // confirming buyers retain access.
    const fakeGrant = {
      id: "g-1",
      subscriberId: "sub-1",
      bookId: "book-archived",
      source: "PURCHASE",
      revokedAt: null,
      expiresAt: null,
      grantedAt: new Date(),
    };
    prismaFindFirstMock.mockResolvedValue(fakeGrant);

    const result = await requireBookAccess("sub-1", "book-archived");
    expect(result).toEqual(fakeGrant);

    // Confirm the predicate had no book.status filter — only
    // grant-side filters.
    const callArgs = prismaFindFirstMock.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(callArgs.where).toMatchObject({
      subscriberId: "sub-1",
      bookId: "book-archived",
      revokedAt: null,
    });
    // The where clause must NOT have a book.status filter — that would
    // break the "buyer keeps access on archived book" invariant.
    expect("book" in callArgs.where).toBe(false);
  });
});
