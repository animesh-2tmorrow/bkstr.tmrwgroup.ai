import { describe, it, expect, vi, beforeEach } from "vitest";
import AdmZip from "adm-zip";

// Phase 6 Stream K (D17.1) — /api/books/new route tests. Three zip-multipart
// cases (new slug create, existing slug new-version, skill-rejected) and one
// legacy JSON-body regression test confirming the Stream B/I single-blob path
// still takes its branch unchanged.

const authMock = vi.fn<() => Promise<unknown>>();
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));

// Pre-tx (global prisma client) mocks
const publisherFindFirstMock = vi.fn<(arg: unknown) => Promise<unknown>>();
const subscriberFindFirstMock = vi.fn<(arg: unknown) => Promise<unknown>>();
const bookFindUniqueMock = vi.fn<(arg: unknown) => Promise<unknown>>();
// Inside-tx mocks
const txBookFindUniqueMock = vi.fn<(arg: unknown) => Promise<unknown>>();
const txBookCreateMock = vi.fn<(arg: unknown) => Promise<unknown>>();
const txBookPriceCreateMock = vi.fn<(arg: unknown) => Promise<unknown>>();
const txAccessGrantCreateManyMock = vi.fn<(arg: unknown) => Promise<unknown>>();
const txBookVersionCreateMock = vi.fn<(arg: unknown) => Promise<unknown>>();
const txBookChapterCreateManyMock = vi.fn<(arg: unknown) => Promise<unknown>>();
const txAdminActionCreateMock = vi.fn<(arg: unknown) => Promise<unknown>>();
// Legacy array-form prisma method mocks
const legacyBookCreateMock = vi.fn<(arg: unknown) => Promise<unknown>>();
const legacyBookVersionCreateMock = vi.fn<(arg: unknown) => Promise<unknown>>();
const legacyBookPriceCreateMock = vi.fn<(arg: unknown) => Promise<unknown>>();
const legacyAccessGrantCreateManyMock = vi.fn<(arg: unknown) => Promise<unknown>>();

const transactionMock = vi.fn<(arg: unknown) => Promise<unknown>>(async (arg: unknown) => {
  if (typeof arg === "function") {
    const tx = {
      book: {
        findUnique: (a: unknown) => txBookFindUniqueMock(a),
        create: (a: unknown) => txBookCreateMock(a),
      },
      bookPrice: { create: (a: unknown) => txBookPriceCreateMock(a) },
      accessGrant: { createMany: (a: unknown) => txAccessGrantCreateManyMock(a) },
      bookVersion: { create: (a: unknown) => txBookVersionCreateMock(a) },
      bookChapter: { createMany: (a: unknown) => txBookChapterCreateManyMock(a) },
      adminAction: { create: (a: unknown) => txAdminActionCreateMock(a) },
    };
    return (arg as (tx: unknown) => Promise<unknown>)(tx);
  }
  if (Array.isArray(arg)) {
    // Legacy array-form transaction (Stream B path) — just resolve all.
    return Promise.all(arg);
  }
  throw new Error("Unexpected $transaction shape in test");
});

vi.mock("@/lib/db", () => ({
  prisma: {
    publisher: { findFirst: (a: unknown) => publisherFindFirstMock(a) },
    subscriber: { findFirst: (a: unknown) => subscriberFindFirstMock(a) },
    book: {
      findUnique: (a: unknown) => bookFindUniqueMock(a),
      create: (a: unknown) => legacyBookCreateMock(a),
    },
    bookVersion: { create: (a: unknown) => legacyBookVersionCreateMock(a) },
    bookPrice: { create: (a: unknown) => legacyBookPriceCreateMock(a) },
    accessGrant: { createMany: (a: unknown) => legacyAccessGrantCreateManyMock(a) },
    $transaction: (a: unknown) => transactionMock(a),
  },
}));

const stripeProductsCreateMock = vi.fn<(a: unknown) => Promise<unknown>>();
const stripePricesCreateMock = vi.fn<(a: unknown) => Promise<unknown>>();
const stripeProductsUpdateMock = vi.fn<(id: string, a: unknown) => Promise<unknown>>();
vi.mock("@/lib/stripe", () => ({
  stripe: {
    products: {
      create: (a: unknown) => stripeProductsCreateMock(a),
      update: (id: string, a: unknown) => stripeProductsUpdateMock(id, a),
    },
    prices: { create: (a: unknown) => stripePricesCreateMock(a) },
  },
}));

// getVersionContent is awaited inside the route's idempotency check on the
// existing-book branch. Mock it; the route only cares about the returned text.
const getVersionContentMock = vi.fn<(arg: unknown) => Promise<string>>();
vi.mock("@/lib/books/content", () => ({
  getVersionContent: (a: unknown) => getVersionContentMock(a),
}));

import { POST } from "./route";

const PUBLISHER_ID = "11111111-1111-1111-1111-111111111111";
const SUBSCRIBER_ID = "22222222-2222-2222-2222-222222222222";
const EXISTING_BOOK_ID = "33333333-3333-3333-3333-333333333333";
const SESSION = {
  user: { id: "user-99", email: "p@example.com", role: "PUBLISHER" },
};

function buildZipBuffer(entries: Array<{ name: string; content: string }>): Buffer {
  const z = new AdmZip();
  for (const e of entries) z.addFile(e.name, Buffer.from(e.content, "utf8"));
  return z.toBuffer();
}

function buildMultipartRequest(zipBuf: Buffer, extra: Record<string, string> = {}): Request {
  const fd = new FormData();
  // Convert Buffer → Uint8Array for the BlobPart shape TS expects.
  fd.append(
    "zip",
    new File([new Uint8Array(zipBuf)], "upload.zip", { type: "application/zip" }),
  );
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return new Request("http://localhost/api/books/new", { method: "POST", body: fd });
}

beforeEach(() => {
  for (const m of [
    authMock,
    publisherFindFirstMock,
    subscriberFindFirstMock,
    bookFindUniqueMock,
    txBookFindUniqueMock,
    txBookCreateMock,
    txBookPriceCreateMock,
    txAccessGrantCreateManyMock,
    txBookVersionCreateMock,
    txBookChapterCreateManyMock,
    txAdminActionCreateMock,
    legacyBookCreateMock,
    legacyBookVersionCreateMock,
    legacyBookPriceCreateMock,
    legacyAccessGrantCreateManyMock,
    transactionMock,
    stripeProductsCreateMock,
    stripePricesCreateMock,
    stripeProductsUpdateMock,
    getVersionContentMock,
  ]) m.mockReset();
});

describe("POST /api/books/new — Stream K zip-multipart paths", () => {
  it("(K-1) zip with new slug — creates Book + v1 + N chapters + BookPrice + PUBLISHER_OWN grant + admin_action; Stripe Product+Price called", async () => {
    authMock.mockResolvedValue(SESSION);
    publisherFindFirstMock.mockResolvedValue({ id: PUBLISHER_ID });
    subscriberFindFirstMock.mockResolvedValue({ id: SUBSCRIBER_ID });
    bookFindUniqueMock.mockResolvedValue(null); // pre-tx peek: slug unused
    txBookFindUniqueMock.mockResolvedValue(null); // inside-tx authoritative: still unused
    stripeProductsCreateMock.mockResolvedValue({ id: "prod_test_K1" });
    stripePricesCreateMock.mockResolvedValue({ id: "price_test_K1" });

    const zipBuf = buildZipBuffer([
      { name: "ch00-intro.md", content: "# Intro\nbody A" },
      { name: "ch01-body.md", content: "# Body\nbody B" },
    ]);
    const req = buildMultipartRequest(zipBuf, {
      title: "New Book",
      slug: "new-book",
      domain: "skill",
      description: "desc",
      price_usd_cents: "999",
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(stripeProductsCreateMock).toHaveBeenCalledOnce();
    expect(stripePricesCreateMock).toHaveBeenCalledOnce();
    expect(txBookCreateMock).toHaveBeenCalledOnce();
    expect(txBookPriceCreateMock).toHaveBeenCalledOnce();
    expect(txAccessGrantCreateManyMock).toHaveBeenCalledOnce();
    expect(txBookVersionCreateMock).toHaveBeenCalledOnce();
    expect(txBookChapterCreateManyMock).toHaveBeenCalledOnce();
    expect(txAdminActionCreateMock).toHaveBeenCalledOnce();

    // Audit row shape — D-K7 / D12.5 / D12.14
    const auditCall = txAdminActionCreateMock.mock.calls[0][0] as {
      data: {
        actionType: string;
        targetType: string;
        beforeState: { existing_version: number | null };
        afterState: { new_version: number; chapter_count: number; manifest_present: boolean };
      };
    };
    expect(auditCall.data.actionType).toBe("book.zip_upload");
    expect(auditCall.data.targetType).toBe("book");
    expect(auditCall.data.beforeState.existing_version).toBeNull();
    expect(auditCall.data.afterState.new_version).toBe(1);
    expect(auditCall.data.afterState.chapter_count).toBe(2);
    expect(auditCall.data.afterState.manifest_present).toBe(false);

    // BookChapter rows: two of them, with the right slugs
    const chapterCall = txBookChapterCreateManyMock.mock.calls[0][0] as {
      data: Array<{ order: number; slug: string }>;
    };
    expect(chapterCall.data.map((c) => c.slug)).toEqual(["intro", "body"]);
  });

  it("(K-2) zip with existing slug — creates BookVersion v2 + chapters; no new Stripe, no new BookPrice, no new Book/grant; audit before→after captures the transition", async () => {
    authMock.mockResolvedValue(SESSION);
    publisherFindFirstMock.mockResolvedValue({ id: PUBLISHER_ID });
    subscriberFindFirstMock.mockResolvedValue({ id: SUBSCRIBER_ID });
    // pre-tx peek: existing book with one prior version v1 whose content
    // differs from our draft (so idempotency does NOT short-circuit)
    bookFindUniqueMock.mockResolvedValue({
      id: EXISTING_BOOK_ID,
      versions: [
        { id: "v1-id", version: 1, content: "v1 inline blob", contentUri: "inline://v1", chapters: [] },
      ],
    });
    getVersionContentMock.mockResolvedValue("PREVIOUS-V1-CONTENT-DIFFERENT");
    txBookFindUniqueMock.mockResolvedValue({
      id: EXISTING_BOOK_ID,
      versions: [{ version: 1 }],
    });

    const zipBuf = buildZipBuffer([
      { name: "ch00-intro.md", content: "# New intro" },
      { name: "ch01-body.md", content: "# New body" },
    ]);
    const req = buildMultipartRequest(zipBuf, {
      title: "Whatever",
      slug: "existing-slug",
      domain: "skill",
      // No price field: it's ignored on the existing-book branch (T2)
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    // No Stripe writes on the existing-book branch
    expect(stripeProductsCreateMock).not.toHaveBeenCalled();
    expect(stripePricesCreateMock).not.toHaveBeenCalled();
    // No new Book/BookPrice/grant rows
    expect(txBookCreateMock).not.toHaveBeenCalled();
    expect(txBookPriceCreateMock).not.toHaveBeenCalled();
    expect(txAccessGrantCreateManyMock).not.toHaveBeenCalled();
    // But a new BookVersion + chapters + audit row
    expect(txBookVersionCreateMock).toHaveBeenCalledOnce();
    expect(txBookChapterCreateManyMock).toHaveBeenCalledOnce();
    expect(txAdminActionCreateMock).toHaveBeenCalledOnce();

    const versionCall = txBookVersionCreateMock.mock.calls[0][0] as {
      data: { version: number; bookId: string };
    };
    expect(versionCall.data.version).toBe(2);
    expect(versionCall.data.bookId).toBe(EXISTING_BOOK_ID);

    const auditCall = txAdminActionCreateMock.mock.calls[0][0] as {
      data: {
        beforeState: { existing_version: number | null };
        afterState: { new_version: number };
      };
    };
    expect(auditCall.data.beforeState.existing_version).toBe(1);
    expect(auditCall.data.afterState.new_version).toBe(2);
  });

  it("(K-3) zip containing SKILL.md → 400 SKILL_DETECTED; no Stripe calls; no DB writes", async () => {
    authMock.mockResolvedValue(SESSION);
    publisherFindFirstMock.mockResolvedValue({ id: PUBLISHER_ID });
    subscriberFindFirstMock.mockResolvedValue({ id: SUBSCRIBER_ID });

    const zipBuf = buildZipBuffer([
      {
        name: "SKILL.md",
        content: `---\nname: my-skill\ndescription: skill not book\n---\n\n# Body\n`,
      },
      { name: "helper.py", content: "print('hi')" },
    ]);
    const req = buildMultipartRequest(zipBuf, {
      title: "Whatever",
      slug: "would-be-slug",
      domain: "skill",
      price_usd_cents: "999",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("SKILL_DETECTED");
    expect(body.error).toMatch(/Stream L/);

    expect(stripeProductsCreateMock).not.toHaveBeenCalled();
    expect(stripePricesCreateMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("(K-4) legacy JSON body — single-blob path still takes its branch (regression for Stream B/I)", async () => {
    authMock.mockResolvedValue(SESSION);
    publisherFindFirstMock.mockResolvedValue({ id: PUBLISHER_ID });
    subscriberFindFirstMock.mockResolvedValue({ id: SUBSCRIBER_ID });
    bookFindUniqueMock.mockResolvedValue(null); // legacy precheck: slug free
    stripeProductsCreateMock.mockResolvedValue({ id: "prod_legacy" });
    stripePricesCreateMock.mockResolvedValue({ id: "price_legacy" });
    legacyBookCreateMock.mockResolvedValue({ id: "book-id" });
    legacyBookVersionCreateMock.mockResolvedValue({ id: "version-id" });
    legacyBookPriceCreateMock.mockResolvedValue({ id: "price-row-id" });
    legacyAccessGrantCreateManyMock.mockResolvedValue({ count: 1 });

    const req = new Request("http://localhost/api/books/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Legacy Book",
        slug: "legacy-book",
        domain: "skill",
        description: "from JSON path",
        content: "# Legacy\nbody",
        price_usd_cents: 999,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    // Legacy path goes through ARRAY-form $transaction with the four creates
    expect(transactionMock).toHaveBeenCalledOnce();
    const txArg = transactionMock.mock.calls[0][0];
    expect(Array.isArray(txArg)).toBe(true);
    expect(stripeProductsCreateMock).toHaveBeenCalledOnce();
    expect(stripePricesCreateMock).toHaveBeenCalledOnce();
    // The interactive-form tx mocks should NOT have fired
    expect(txBookCreateMock).not.toHaveBeenCalled();
    expect(txBookChapterCreateManyMock).not.toHaveBeenCalled();
    expect(txAdminActionCreateMock).not.toHaveBeenCalled();
  });
});
