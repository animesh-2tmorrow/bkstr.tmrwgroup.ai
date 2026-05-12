import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 5 Stream H — regression tests for the cover upload route. Covers
// the four auth/validation branches that the route must enforce before
// any S3 call fires:
//   H-1 — unauthenticated → 401
//   H-2 — wrong role (SUBSCRIBER) → 403 role-required
//   H-3 — PUBLISHER targeting someone else's book → 403 not-your-book
//   H-4 — unsupported MIME type → 400 (validates the allowlist runs
//          before S3 is touched)

const authMock = vi.fn<() => Promise<unknown>>();
vi.mock("@/lib/auth", () => ({
  auth: () => authMock(),
}));

const prismaFindUniqueMock = vi.fn<(arg: unknown) => Promise<unknown>>();
const prismaUpdateMock = vi.fn<(arg: unknown) => Promise<unknown>>();
vi.mock("@/lib/db", () => ({
  prisma: {
    book: {
      findUnique: (arg: unknown) => prismaFindUniqueMock(arg),
      update: (arg: unknown) => prismaUpdateMock(arg),
    },
  },
}));

const s3SendMock = vi.fn<(cmd: unknown) => Promise<unknown>>();
vi.mock("@/lib/storage/book-content", () => ({
  s3Client: { send: (cmd: unknown) => s3SendMock(cmd) },
}));

import { POST } from "./route";

const BOOK_ID = "11111111-1111-1111-1111-111111111111";
const PUBLISHER_USER_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_PUBLISHER_ID = "33333333-3333-3333-3333-333333333333";

beforeEach(() => {
  authMock.mockReset();
  prismaFindUniqueMock.mockReset();
  prismaUpdateMock.mockReset();
  s3SendMock.mockReset();
});

function buildFormReq(file: File): Request {
  const fd = new FormData();
  fd.append("cover", file);
  return new Request(`http://localhost/api/books/${BOOK_ID}/cover`, {
    method: "POST",
    body: fd,
  });
}

describe("cover upload — auth + validation", () => {
  it("(H-1) unauthenticated → 401", async () => {
    authMock.mockResolvedValue(null);
    const req = buildFormReq(
      new File([Buffer.from("x")], "c.jpg", { type: "image/jpeg" }),
    );
    const res = await POST(req, { params: Promise.resolve({ id: BOOK_ID }) });
    expect(res.status).toBe(401);
    expect(prismaFindUniqueMock).not.toHaveBeenCalled();
    expect(s3SendMock).not.toHaveBeenCalled();
  });

  it("(H-2) SUBSCRIBER role → 403 role-required", async () => {
    authMock.mockResolvedValue({
      user: { id: "sub-1", email: "s@example.com", role: "SUBSCRIBER" },
    });
    const req = buildFormReq(
      new File([Buffer.from("x")], "c.jpg", { type: "image/jpeg" }),
    );
    const res = await POST(req, { params: Promise.resolve({ id: BOOK_ID }) });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/PUBLISHER or ADMIN/i);
    expect(prismaFindUniqueMock).not.toHaveBeenCalled();
    expect(s3SendMock).not.toHaveBeenCalled();
  });

  it("(H-3) PUBLISHER targeting another publisher's book → 403", async () => {
    authMock.mockResolvedValue({
      user: { id: PUBLISHER_USER_ID, email: "p@example.com", role: "PUBLISHER" },
    });
    prismaFindUniqueMock.mockResolvedValue({
      id: BOOK_ID,
      title: "Other Publisher's Book",
      publisherUserId: OTHER_PUBLISHER_ID,
    });
    const req = buildFormReq(
      new File([Buffer.from("x")], "c.jpg", { type: "image/jpeg" }),
    );
    const res = await POST(req, { params: Promise.resolve({ id: BOOK_ID }) });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/not your book/i);
    expect(s3SendMock).not.toHaveBeenCalled();
    expect(prismaUpdateMock).not.toHaveBeenCalled();
  });

  it("(H-4) unsupported MIME type → 400 (S3 never touched)", async () => {
    authMock.mockResolvedValue({
      user: { id: PUBLISHER_USER_ID, email: "p@example.com", role: "PUBLISHER" },
    });
    prismaFindUniqueMock.mockResolvedValue({
      id: BOOK_ID,
      title: "Owned Book",
      publisherUserId: PUBLISHER_USER_ID,
    });
    const req = buildFormReq(
      new File([Buffer.from("not-an-image")], "evil.exe", {
        type: "application/x-msdownload",
      }),
    );
    const res = await POST(req, { params: Promise.resolve({ id: BOOK_ID }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/unsupported file type/i);
    expect(s3SendMock).not.toHaveBeenCalled();
    expect(prismaUpdateMock).not.toHaveBeenCalled();
  });
});
