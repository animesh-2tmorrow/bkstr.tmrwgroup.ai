import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

// Stream U — GET /api/books/[id]/files tests. 6 cases:
//   U-1  happy path multi-chapter (manifest declares paths)
//   U-2  404 BOOK_NOT_FOUND on unknown slug
//   U-3  401 UNAUTHENTICATED on no auth
//   U-4  403 ACCESS_DENIED on authenticated but no AccessGrant
//   U-5  404 NO_ACTIVE_VERSION on ARCHIVED book → surfaces as BOOK_NOT_FOUND
//         per Stream U dispatch §3 (non-ACTIVE → BOOK_NOT_FOUND, not
//         NO_ACTIVE_VERSION; we don't disclose ARCHIVED existence at the
//         slug). The NO_ACTIVE_VERSION code IS reachable — when the book is
//         ACTIVE but has zero chapters AND no inline content — but that's an
//         edge case; the ARCHIVED-only test maps to BOOK_NOT_FOUND.
//   U-6  legacy inline-content book (no manifest chapters) → returns single
//         { path: "content.md", content, sha256 } file.
//
// Mocks shape mirrors src/app/api/skills/[slug]/files/route.test.ts — full
// prisma + auth mocking, no real DB. Helper is exercised end-to-end through
// the route by mocking its three Prisma collaborators (subscriber, book,
// accessGrant — the latter through the existing requireBookAccess primitive).

const authMock = vi.fn<() => Promise<unknown>>();
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));

// API-key path is mocked as fail-fast: no test here exercises Bearer-token
// auth (the skills-side parity tests don't either; the path is shared code
// already covered by the skills tests).
vi.mock("@/lib/auth/api-key", async () => {
  const real = await vi.importActual<typeof import("@/lib/auth/api-key")>("@/lib/auth/api-key");
  return {
    ...real,
    requireApiKey: vi.fn(async () => {
      throw new Error("requireApiKey unexpectedly invoked in session-only test");
    }),
  };
});

const subscriberFindFirstMock = vi.fn<(arg: unknown) => Promise<unknown>>();
const bookFindFirstMock = vi.fn<(arg: unknown) => Promise<unknown>>();
const accessGrantFindFirstMock = vi.fn<(arg: unknown) => Promise<unknown>>();

vi.mock("@/lib/db", () => ({
  prisma: {
    subscriber: { findFirst: (a: unknown) => subscriberFindFirstMock(a) },
    book: { findFirst: (a: unknown) => bookFindFirstMock(a) },
    accessGrant: { findFirst: (a: unknown) => accessGrantFindFirstMock(a) },
  },
}));

import { GET } from "./route";

const SUBSCRIBER_ID = "11111111-1111-1111-1111-111111111111";
const BOOK_ID = "22222222-2222-2222-2222-222222222222";
const VERSION_ID = "33333333-3333-3333-3333-333333333333";
const GRANT_ID = "44444444-4444-4444-4444-444444444444";

const SESSION = { user: { email: "buyer@example.com" } };

function makeRequest(): Request {
  return new Request("http://localhost/api/books/my-book/files");
}

function makeContext(slug = "my-book") {
  // The Next.js route directory is [id]; the param name in code is "id"
  // even though the value is a slug (see route file's header comment).
  return { params: Promise.resolve({ id: slug }) };
}

type ChapterFixture = { id: string; order: number; slug: string; content: string };

function makeMultiChapterBookRecord(opts: {
  status?: "ACTIVE" | "ARCHIVED" | "DRAFT";
  chapters?: ChapterFixture[];
  manifestChapters?: Array<{ slug?: string; file?: string }>;
} = {}) {
  const chapters: ChapterFixture[] = opts.chapters ?? [
    { id: "c1", order: 0, slug: "foundations", content: "# Foundations\nfirst body" },
    { id: "c2", order: 1, slug: "patterns", content: "# Patterns\nsecond body" },
  ];
  const manifestChapters =
    opts.manifestChapters ?? [
      { slug: "foundations", file: "chapters/01-foundations.md" },
      { slug: "patterns", file: "chapters/02-patterns.md" },
    ];
  return {
    id: BOOK_ID,
    slug: "my-book",
    title: "My Book",
    status: opts.status ?? "ACTIVE",
    versions: [
      {
        id: VERSION_ID,
        version: 2,
        content: null,
        manifest: { chapters: manifestChapters },
        chapters,
      },
    ],
  };
}

function makeLegacyBookRecord(content: string) {
  return {
    id: BOOK_ID,
    slug: "legacy-book",
    title: "Legacy Single-Blob Book",
    status: "ACTIVE",
    versions: [
      {
        id: VERSION_ID,
        version: 1,
        content,
        manifest: {},
        chapters: [],
      },
    ],
  };
}

beforeEach(() => {
  authMock.mockReset();
  subscriberFindFirstMock.mockReset();
  bookFindFirstMock.mockReset();
  accessGrantFindFirstMock.mockReset();
});

describe("GET /api/books/[id]/files — Stream U (slug-only despite [id] dir name)", () => {
  it("(U-1) happy path multi-chapter — 200; files ordered by chapter.order; paths from manifest.file; sha256 computed at response time", async () => {
    authMock.mockResolvedValue(SESSION);
    subscriberFindFirstMock.mockResolvedValue({ id: SUBSCRIBER_ID });
    bookFindFirstMock.mockResolvedValue(makeMultiChapterBookRecord());
    accessGrantFindFirstMock.mockResolvedValue({ id: GRANT_ID, source: "PURCHASE" });

    const res = await GET(makeRequest() as Parameters<typeof GET>[0], makeContext());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const body = await res.json();

    expect(body.book).toEqual({
      slug: "my-book",
      title: "My Book",
      version: "2", // string per dispatch (parity with skills-side)
    });
    expect(body.files).toHaveLength(2);
    expect(body.files[0].path).toBe("chapters/01-foundations.md");
    expect(body.files[1].path).toBe("chapters/02-patterns.md");
    expect(body.files[0].content).toBe("# Foundations\nfirst body");
    expect(body.files[1].content).toBe("# Patterns\nsecond body");

    // sha256 computed from the per-chapter content. Verify byte-for-byte
    // against Node's createHash('sha256') of the UTF-8 string.
    const expected0 = createHash("sha256").update("# Foundations\nfirst body", "utf8").digest("hex");
    const expected1 = createHash("sha256").update("# Patterns\nsecond body", "utf8").digest("hex");
    expect(body.files[0].sha256).toBe(expected0);
    expect(body.files[1].sha256).toBe(expected1);
    expect(body.files[0].sha256).toMatch(/^[0-9a-f]{64}$/); // lowercase hex shape
  });

  it("(U-2) 404 BOOK_NOT_FOUND on unknown slug", async () => {
    authMock.mockResolvedValue(SESSION);
    subscriberFindFirstMock.mockResolvedValue({ id: SUBSCRIBER_ID });
    bookFindFirstMock.mockResolvedValue(null);

    const res = await GET(makeRequest() as Parameters<typeof GET>[0], makeContext("unknown-book"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("BOOK_NOT_FOUND");
    // AccessGrant must NOT be queried — we short-circuit before grant lookup.
    expect(accessGrantFindFirstMock).not.toHaveBeenCalled();
  });

  it("(U-3) 401 UNAUTHENTICATED on no session and no API-key header", async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(makeRequest() as Parameters<typeof GET>[0], makeContext());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("UNAUTHENTICATED");
    // Book lookup must NOT happen if auth fails first.
    expect(bookFindFirstMock).not.toHaveBeenCalled();
  });

  it("(U-4) 403 ACCESS_DENIED — authenticated, book exists, but no AccessGrant (composed via requireBookAccess primitive)", async () => {
    authMock.mockResolvedValue(SESSION);
    subscriberFindFirstMock.mockResolvedValue({ id: SUBSCRIBER_ID });
    bookFindFirstMock.mockResolvedValue(makeMultiChapterBookRecord());
    // requireBookAccess uses accessGrant.findFirst; returning null triggers
    // the leaf primitive's BookAccessError(403), which agent-access wraps
    // into BookFetchAccessError(403, "ACCESS_DENIED").
    accessGrantFindFirstMock.mockResolvedValue(null);

    const res = await GET(makeRequest() as Parameters<typeof GET>[0], makeContext());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("ACCESS_DENIED");
  });

  it("(U-5) 404 BOOK_NOT_FOUND when book is ARCHIVED (non-ACTIVE status → don't disclose existence)", async () => {
    authMock.mockResolvedValue(SESSION);
    subscriberFindFirstMock.mockResolvedValue({ id: SUBSCRIBER_ID });
    bookFindFirstMock.mockResolvedValue(makeMultiChapterBookRecord({ status: "ARCHIVED" }));

    const res = await GET(makeRequest() as Parameters<typeof GET>[0], makeContext());
    expect(res.status).toBe(404);
    const body = await res.json();
    // Dispatch §3 catches — ARCHIVED maps to BOOK_NOT_FOUND, not
    // NO_ACTIVE_VERSION (we don't disclose archived existence).
    expect(body.code).toBe("BOOK_NOT_FOUND");
    expect(accessGrantFindFirstMock).not.toHaveBeenCalled();
  });

  it("(U-6) legacy inline-content book (no manifest chapters) — single file path=content.md, content matches BookVersion.content, sha256 computed", async () => {
    const legacyContent = "# Old Book\n\nAll one blob, no chapters.\n";
    authMock.mockResolvedValue(SESSION);
    subscriberFindFirstMock.mockResolvedValue({ id: SUBSCRIBER_ID });
    bookFindFirstMock.mockResolvedValue(makeLegacyBookRecord(legacyContent));
    accessGrantFindFirstMock.mockResolvedValue({ id: GRANT_ID, source: "PUBLISHER_OWN" });

    const res = await GET(makeRequest() as Parameters<typeof GET>[0], makeContext("legacy-book"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.book.slug).toBe("legacy-book");
    expect(body.book.version).toBe("1");
    expect(body.files).toHaveLength(1);
    expect(body.files[0].path).toBe("content.md");
    expect(body.files[0].content).toBe(legacyContent);
    const expected = createHash("sha256").update(legacyContent, "utf8").digest("hex");
    expect(body.files[0].sha256).toBe(expected);
  });
});
