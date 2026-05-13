import { describe, it, expect, vi, beforeEach } from "vitest";
import AdmZip from "adm-zip";

// Phase 6 Stream L (D18.1) — /api/skills/new route tests. Three mock-based
// cases mirror the books route.test.ts pattern:
//   (L-1) new skill from Zach-shaped files.zip → 201, Skill + SkillPrice +
//         PUBLISHER_OWN grant + SkillVersion + 7 SkillFile rows + audit row
//   (L-2) same zip re-uploaded unchanged → 200 {unchanged:true}, no new
//         version, no audit row
//   (L-3) modified copy, same slug → 201, v2 minted, prev=1
//
// Hash computation: the idempotency comparison uses skill_versions.normalized_hash
// which the skill upload pipeline computes via SHA-256 of getVersionFilesConcat
// (path + content joined by "\n\n"). For test (L-2) the mock peek's
// normalizedHash must equal what processZipUpload would produce for the
// upload's buffer. We pre-compute it by importing the canonicalizer + the
// pipeline directly — no mocking of internal lib code.

const authMock = vi.fn<() => Promise<unknown>>();
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));

// Pre-tx (global prisma client) mocks
const publisherFindFirstMock = vi.fn<(arg: unknown) => Promise<unknown>>();
const subscriberFindFirstMock = vi.fn<(arg: unknown) => Promise<unknown>>();
const skillFindUniqueMock = vi.fn<(arg: unknown) => Promise<unknown>>();
// Inside-tx mocks
const txSkillFindUniqueMock = vi.fn<(arg: unknown) => Promise<unknown>>();
const txSkillCreateMock = vi.fn<(arg: unknown) => Promise<unknown>>();
const txSkillPriceCreateMock = vi.fn<(arg: unknown) => Promise<unknown>>();
const txAccessGrantCreateManyMock = vi.fn<(arg: unknown) => Promise<unknown>>();
const txSkillVersionCreateMock = vi.fn<(arg: unknown) => Promise<unknown>>();
const txSkillFileCreateManyMock = vi.fn<(arg: unknown) => Promise<unknown>>();
const txAdminActionCreateMock = vi.fn<(arg: unknown) => Promise<unknown>>();

const transactionMock = vi.fn<(arg: unknown) => Promise<unknown>>(async (arg: unknown) => {
  if (typeof arg === "function") {
    const tx = {
      skill: {
        findUnique: (a: unknown) => txSkillFindUniqueMock(a),
        create: (a: unknown) => txSkillCreateMock(a),
      },
      skillPrice: { create: (a: unknown) => txSkillPriceCreateMock(a) },
      accessGrant: { createMany: (a: unknown) => txAccessGrantCreateManyMock(a) },
      skillVersion: { create: (a: unknown) => txSkillVersionCreateMock(a) },
      skillFile: { createMany: (a: unknown) => txSkillFileCreateManyMock(a) },
      adminAction: { create: (a: unknown) => txAdminActionCreateMock(a) },
    };
    return (arg as (tx: unknown) => Promise<unknown>)(tx);
  }
  throw new Error("Skill handler should only use interactive $transaction; got " + typeof arg);
});

vi.mock("@/lib/db", () => ({
  prisma: {
    publisher: { findFirst: (a: unknown) => publisherFindFirstMock(a) },
    subscriber: { findFirst: (a: unknown) => subscriberFindFirstMock(a) },
    skill: { findUnique: (a: unknown) => skillFindUniqueMock(a) },
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

import { POST } from "./route";
import { processZipUpload } from "@/lib/skills/zip-upload";

const PUBLISHER_ID = "11111111-1111-1111-1111-111111111111";
const SUBSCRIBER_ID = "22222222-2222-2222-2222-222222222222";
const EXISTING_SKILL_ID = "33333333-3333-3333-3333-333333333333";
const SESSION = {
  user: { id: "user-99", email: "p@example.com", role: "PUBLISHER" },
};

// Zach-shape: SKILL.md (with required frontmatter) + 4 .md references +
// validate_book.py + token_count.py = 7 files flat.
const ZACH_SKILL_MD = `---
name: agent-book-author
description: A skill that helps an agent author bkstr books from raw notes.
---

# Agent Book Author

Use this skill to draft chapter outlines, expand notes into prose, and validate manifests.
`;

const ZACH_VALIDATE_PY = `# validate_book.py — placeholder for the test fixture
def validate(manifest: dict) -> bool:
    return "title" in manifest and "chapters" in manifest
`;

const ZACH_TOKEN_COUNT_PY = `# token_count.py — placeholder for the test fixture
def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)
`;

const ZACH_REFERENCE_MDS: Record<string, string> = {
  "reference-tone.md": "# Voice & tone\n\nProfessional, terse, evidence-led.",
  "reference-structure.md": "# Chapter structure\n\nIntro → details → recap.",
  "reference-glossary.md": "# Glossary\n\nKey terms used across books.",
  "reference-examples.md": "# Examples\n\nGood opening paragraphs from the corpus.",
};

function buildZachZipBuffer(skillMdContent: string = ZACH_SKILL_MD): Buffer {
  const z = new AdmZip();
  z.addFile("SKILL.md", Buffer.from(skillMdContent, "utf8"));
  for (const [name, content] of Object.entries(ZACH_REFERENCE_MDS)) {
    z.addFile(name, Buffer.from(content, "utf8"));
  }
  z.addFile("validate_book.py", Buffer.from(ZACH_VALIDATE_PY, "utf8"));
  z.addFile("token_count.py", Buffer.from(ZACH_TOKEN_COUNT_PY, "utf8"));
  return z.toBuffer();
}

function buildMultipartRequest(zipBuf: Buffer, extra: Record<string, string> = {}): Request {
  const fd = new FormData();
  fd.append(
    "zip",
    new File([new Uint8Array(zipBuf)], "upload.zip", { type: "application/zip" }),
  );
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return new Request("http://localhost/api/skills/new", { method: "POST", body: fd });
}

/** Compute the normalizedHash the route's processZipUpload would compute for
 *  a given buffer. The test reuses the actual pipeline (no lib mocking) so
 *  the hash matches what the route's idempotency comparison expects. */
async function computeHash(zipBuf: Buffer): Promise<string> {
  const result = await processZipUpload(zipBuf, { slug: "agent-book-author" });
  if (result.kind !== "success") throw new Error(`fixture build failed: ${result.kind}`);
  return result.normalizedHash;
}

beforeEach(() => {
  for (const m of [
    authMock,
    publisherFindFirstMock,
    subscriberFindFirstMock,
    skillFindUniqueMock,
    txSkillFindUniqueMock,
    txSkillCreateMock,
    txSkillPriceCreateMock,
    txAccessGrantCreateManyMock,
    txSkillVersionCreateMock,
    txSkillFileCreateManyMock,
    txAdminActionCreateMock,
    transactionMock,
    stripeProductsCreateMock,
    stripePricesCreateMock,
    stripeProductsUpdateMock,
  ]) m.mockReset();
});

describe("POST /api/skills/new — Stream L mock-based smoke", () => {
  it("(L-1) new skill from Zach-shaped files.zip — 201; Skill + SkillPrice + PUBLISHER_OWN grant + SkillVersion + 7 SkillFile + audit row; Stripe Product+Price created", async () => {
    authMock.mockResolvedValue(SESSION);
    publisherFindFirstMock.mockResolvedValue({ id: PUBLISHER_ID });
    subscriberFindFirstMock.mockResolvedValue({ id: SUBSCRIBER_ID });
    skillFindUniqueMock.mockResolvedValue(null); // pre-tx peek: slug unused
    txSkillFindUniqueMock.mockResolvedValue(null); // inside-tx: still unused
    stripeProductsCreateMock.mockResolvedValue({ id: "prod_test_L1" });
    stripePricesCreateMock.mockResolvedValue({ id: "price_test_L1" });

    const zipBuf = buildZachZipBuffer();
    const req = buildMultipartRequest(zipBuf, {
      slug: "agent-book-author",
      price_usd_cents: "999",
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(stripeProductsCreateMock).toHaveBeenCalledOnce();
    expect(stripePricesCreateMock).toHaveBeenCalledOnce();
    expect(txSkillCreateMock).toHaveBeenCalledOnce();
    expect(txSkillPriceCreateMock).toHaveBeenCalledOnce();
    expect(txAccessGrantCreateManyMock).toHaveBeenCalledOnce();
    expect(txSkillVersionCreateMock).toHaveBeenCalledOnce();
    expect(txSkillFileCreateManyMock).toHaveBeenCalledOnce();
    expect(txAdminActionCreateMock).toHaveBeenCalledOnce();

    // 7 SkillFile rows (SKILL.md order=0 + 4 .md + 2 .py)
    const fileCall = txSkillFileCreateManyMock.mock.calls[0][0] as {
      data: Array<{ order: number; path: string; extension: string }>;
    };
    expect(fileCall.data).toHaveLength(7);
    expect(fileCall.data[0]).toMatchObject({ order: 0, path: "SKILL.md", extension: ".md" });
    // Remaining 6 are alphabetical by path
    const restPaths = fileCall.data.slice(1).map((f) => f.path);
    expect(restPaths).toEqual([...restPaths].sort());

    // PUBLISHER_OWN grant carries skillId, not bookId (XOR-checked at DB layer)
    const grantCall = txAccessGrantCreateManyMock.mock.calls[0][0] as {
      data: Array<{ subscriberId: string; skillId: string; source: string }>;
    };
    expect(grantCall.data[0]).toMatchObject({
      subscriberId: SUBSCRIBER_ID,
      source: "PUBLISHER_OWN",
    });
    expect(grantCall.data[0].skillId).toBeDefined();

    // Audit row shape — D18.1 §3e
    const auditCall = txAdminActionCreateMock.mock.calls[0][0] as {
      data: {
        actionType: string;
        targetType: string;
        beforeState: { existing_version: number | null };
        afterState: {
          new_version: number;
          file_count: number;
          manifest_present: boolean;
          slug_source: string;
          virtual_root: string | null;
        };
      };
    };
    expect(auditCall.data.actionType).toBe("skill.zip_upload");
    expect(auditCall.data.targetType).toBe("skill");
    expect(auditCall.data.beforeState.existing_version).toBeNull();
    expect(auditCall.data.afterState.new_version).toBe(1);
    expect(auditCall.data.afterState.file_count).toBe(7);
    expect(auditCall.data.afterState.manifest_present).toBe(true);
    expect(auditCall.data.afterState.slug_source).toBe("form"); // form slug provided
    expect(auditCall.data.afterState.virtual_root).toBeNull(); // flat zip
  });

  it("(L-2) same zip re-uploaded unchanged — 200 {unchanged:true}, no new version, no audit row, no Stripe write", async () => {
    authMock.mockResolvedValue(SESSION);
    publisherFindFirstMock.mockResolvedValue({ id: PUBLISHER_ID });
    subscriberFindFirstMock.mockResolvedValue({ id: SUBSCRIBER_ID });

    const zipBuf = buildZachZipBuffer();
    const expectedHash = await computeHash(zipBuf);

    skillFindUniqueMock.mockResolvedValue({
      id: EXISTING_SKILL_ID,
      versions: [{ id: "v1-id", version: 1, normalizedHash: expectedHash }],
    });

    const req = buildMultipartRequest(zipBuf, { slug: "agent-book-author" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.unchanged).toBe(true);
    expect(body.id).toBe(EXISTING_SKILL_ID);
    expect(body.version).toBe(1);

    // No writes, no Stripe
    expect(stripeProductsCreateMock).not.toHaveBeenCalled();
    expect(stripePricesCreateMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
    expect(txSkillCreateMock).not.toHaveBeenCalled();
    expect(txSkillVersionCreateMock).not.toHaveBeenCalled();
    expect(txSkillFileCreateManyMock).not.toHaveBeenCalled();
    expect(txAdminActionCreateMock).not.toHaveBeenCalled();
  });

  it("(L-3) modified copy, same slug — 201 v2 minted; no new Stripe Product/Price; audit row before_state.existing_version=1 → after_state.new_version=2", async () => {
    authMock.mockResolvedValue(SESSION);
    publisherFindFirstMock.mockResolvedValue({ id: PUBLISHER_ID });
    subscriberFindFirstMock.mockResolvedValue({ id: SUBSCRIBER_ID });

    // Modified SKILL.md content → different hash; mock peek with v1's old hash.
    const modifiedSkillMd = `---
name: agent-book-author
description: Now with an improved description that actually changes content.
---

# Agent Book Author v2

This skill body has been substantively edited.
`;
    const zipBuf = buildZachZipBuffer(modifiedSkillMd);

    // The hash of the ORIGINAL zip — what's persisted on v1.
    const v1Hash = await computeHash(buildZachZipBuffer());

    skillFindUniqueMock.mockResolvedValue({
      id: EXISTING_SKILL_ID,
      versions: [{ id: "v1-id", version: 1, normalizedHash: v1Hash }],
    });
    txSkillFindUniqueMock.mockResolvedValue({
      id: EXISTING_SKILL_ID,
      versions: [{ version: 1 }],
    });

    const req = buildMultipartRequest(zipBuf, { slug: "agent-book-author" });
    const res = await POST(req);
    expect(res.status).toBe(201);

    // No new Stripe Product/Price for an existing skill
    expect(stripeProductsCreateMock).not.toHaveBeenCalled();
    expect(stripePricesCreateMock).not.toHaveBeenCalled();
    // No new Skill/SkillPrice/grant rows
    expect(txSkillCreateMock).not.toHaveBeenCalled();
    expect(txSkillPriceCreateMock).not.toHaveBeenCalled();
    expect(txAccessGrantCreateManyMock).not.toHaveBeenCalled();
    // But a new SkillVersion + SkillFile rows + audit row
    expect(txSkillVersionCreateMock).toHaveBeenCalledOnce();
    expect(txSkillFileCreateManyMock).toHaveBeenCalledOnce();
    expect(txAdminActionCreateMock).toHaveBeenCalledOnce();

    const versionCall = txSkillVersionCreateMock.mock.calls[0][0] as {
      data: { version: number; skillId: string; normalizedHash: string };
    };
    expect(versionCall.data.version).toBe(2);
    expect(versionCall.data.skillId).toBe(EXISTING_SKILL_ID);
    // The new version's normalizedHash differs from v1's.
    expect(versionCall.data.normalizedHash).not.toBe(v1Hash);

    const auditCall = txAdminActionCreateMock.mock.calls[0][0] as {
      data: { beforeState: { existing_version: number | null }; afterState: { new_version: number } };
    };
    expect(auditCall.data.beforeState.existing_version).toBe(1);
    expect(auditCall.data.afterState.new_version).toBe(2);
  });
});
