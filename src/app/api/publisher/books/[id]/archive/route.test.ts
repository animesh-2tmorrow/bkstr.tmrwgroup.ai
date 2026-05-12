import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 5 Stream E (D15.5) — defense-in-depth coverage for the
// publisher archive route. Verifies that a non-owner PUBLISHER who
// reaches the handler with a foreign book id gets 403 even though the
// role check passed.
//
// Single test (g) per the dispatch spec.

const authMock = vi.fn<() => Promise<unknown>>();
vi.mock("@/lib/auth", () => ({
  auth: () => authMock(),
}));

// Mock prisma. The $transaction call short-circuits to forbidden BEFORE
// any update fires because the book.publisherUserId mismatch is detected
// in the read step. We return a row with a different publisherUserId.
const prismaFindUniqueMock = vi.fn<(arg: unknown) => Promise<unknown>>();
const prismaTransactionMock = vi.fn<(cb: (tx: unknown) => Promise<unknown>) => Promise<unknown>>();

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: (cb: (tx: unknown) => Promise<unknown>) => prismaTransactionMock(cb),
  },
}));

vi.mock("@/lib/admin/audit", () => ({
  writeAuditEntry: vi.fn(),
}));

import { POST } from "./route";

beforeEach(() => {
  authMock.mockReset();
  prismaFindUniqueMock.mockReset();
  prismaTransactionMock.mockReset();
  // Default $transaction behavior: call the callback with a tx that
  // exposes findUnique-on-book + update-on-book.
  prismaTransactionMock.mockImplementation(async (cb) =>
    cb({
      book: {
        findUnique: (arg: unknown) => prismaFindUniqueMock(arg),
        update: vi.fn(),
      },
    }),
  );
});

describe("publisher archive — defense-in-depth", () => {
  it("(g) non-owner PUBLISHER gets 403 even when reaching the handler", async () => {
    // Authenticated as a PUBLISHER user 'pub-A'.
    authMock.mockResolvedValue({
      user: { id: "pub-A", email: "a@example.com", role: "PUBLISHER" },
    });
    // The targeted book belongs to a DIFFERENT publisher 'pub-B'.
    prismaFindUniqueMock.mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000001",
      status: "ACTIVE",
      publisherUserId: "pub-B",
      title: "Other Publisher's Book",
    });

    const req = new Request("http://localhost/api/publisher/books/00000000-0000-0000-0000-000000000001/archive", {
      method: "POST",
    });
    const res = await POST(req, {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/do not own/i);
  });
});
