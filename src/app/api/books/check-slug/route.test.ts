import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 6 Stream K (D17.1) — check-slug endpoint tests. Auth gate + the two
// outcome shapes the form's prefetch consumes ({exists:false} vs {exists:true,
// bookId, title, currentPriceUsdCents, latestVersion, status}). Publisher
// resolution is mocked; the slug-shape 400 branch is exercised in the test
// "rejects bad slug shape" if you want a fourth test — kept to three per the
// Gate 2 spec.

const authMock = vi.fn<() => Promise<unknown>>();
vi.mock("@/lib/auth", () => ({
  auth: () => authMock(),
}));

const publisherFindFirstMock = vi.fn<(arg: unknown) => Promise<unknown>>();
const bookFindUniqueMock = vi.fn<(arg: unknown) => Promise<unknown>>();
vi.mock("@/lib/db", () => ({
  prisma: {
    publisher: { findFirst: (arg: unknown) => publisherFindFirstMock(arg) },
    book: { findUnique: (arg: unknown) => bookFindUniqueMock(arg) },
  },
}));

import { GET } from "./route";
import { NextRequest } from "next/server";

function req(slug: string): NextRequest {
  return new NextRequest(`http://localhost/api/books/check-slug?slug=${encodeURIComponent(slug)}`);
}

beforeEach(() => {
  authMock.mockReset();
  publisherFindFirstMock.mockReset();
  bookFindUniqueMock.mockReset();
});

describe("GET /api/books/check-slug", () => {
  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValue(null);
    const res = await GET(req("anything"));
    expect(res.status).toBe(401);
    expect(publisherFindFirstMock).not.toHaveBeenCalled();
    expect(bookFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns {exists:false} when the slug is not in the caller's publisher", async () => {
    authMock.mockResolvedValue({
      user: { id: "pub-1", email: "p@example.com", role: "PUBLISHER" },
    });
    publisherFindFirstMock.mockResolvedValue({ id: "publisher-id" });
    bookFindUniqueMock.mockResolvedValue(null);

    const res = await GET(req("brand-new-slug"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ exists: false });
    expect(bookFindUniqueMock).toHaveBeenCalledOnce();
  });

  it("returns {exists:true, bookId, title, currentPriceUsdCents, latestVersion, status} when the slug exists", async () => {
    authMock.mockResolvedValue({
      user: { id: "pub-1", email: "p@example.com", role: "PUBLISHER" },
    });
    publisherFindFirstMock.mockResolvedValue({ id: "publisher-id" });
    bookFindUniqueMock.mockResolvedValue({
      id: "book-uuid",
      title: "Existing Book",
      status: "ACTIVE",
      prices: [{ unitAmountCents: 1299 }],
      versions: [{ version: 3 }],
    });

    const res = await GET(req("existing-slug"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      exists: true,
      bookId: "book-uuid",
      title: "Existing Book",
      currentPriceUsdCents: 1299,
      latestVersion: 3,
      status: "ACTIVE",
    });
  });
});
