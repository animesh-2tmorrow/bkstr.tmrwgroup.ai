import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 6 Stream L follow-up #122 — GET /api/skills/[slug]/files tests.
// Six cases per the dispatch §tests:
//   F-1  happy path (authenticated subscriber with AccessGrant)
//   F-2  404 SKILL_NOT_FOUND on unknown slug
//   F-3  401 UNAUTHENTICATED on no auth
//   F-4  403 ACCESS_DENIED on authenticated but no AccessGrant
//   F-5  404 NO_ACTIVE_VERSION on ARCHIVED-only skill
//   F-6  UTF-8 round-trip — non-ASCII `.py` content preserved byte-for-byte
//
// Mocks: auth() and prisma fully mocked. The route delegates to
// requireSkillAccess in @/lib/skills/auth; the mocks exercise that helper
// end-to-end (it's a pure function over its prisma + auth deps).

const authMock = vi.fn<() => Promise<unknown>>();
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));

// requireApiKey is the API-key-auth path; tests here exercise session auth
// only (no Authorization header on the test Request), so the API-key path
// shouldn't fire. Mock it as a fail-fast guard.
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
const skillFindFirstMock = vi.fn<(arg: unknown) => Promise<unknown>>();
const accessGrantFindFirstMock = vi.fn<(arg: unknown) => Promise<unknown>>();

vi.mock("@/lib/db", () => ({
  prisma: {
    subscriber: { findFirst: (a: unknown) => subscriberFindFirstMock(a) },
    skill: { findFirst: (a: unknown) => skillFindFirstMock(a) },
    accessGrant: { findFirst: (a: unknown) => accessGrantFindFirstMock(a) },
  },
}));

import { GET } from "./route";

const SUBSCRIBER_ID = "11111111-1111-1111-1111-111111111111";
const SKILL_ID = "22222222-2222-2222-2222-222222222222";
const VERSION_ID = "33333333-3333-3333-3333-333333333333";
const GRANT_ID = "44444444-4444-4444-4444-444444444444";

const SESSION = { user: { email: "buyer@example.com" } };

function makeRequest(): Request {
  return new Request("http://localhost/api/skills/my-skill/files");
}

function makeContext(slug = "my-skill") {
  return { params: Promise.resolve({ slug }) };
}

function makeSkillRecord(opts: {
  status?: "ACTIVE" | "ARCHIVED";
  files?: Array<{ id: string; path: string; content: string; extension: string; byteSize: number; contentHash: string }>;
} = {}) {
  const files = opts.files ?? [
    {
      id: "f1",
      path: "SKILL.md",
      content: "---\nname: my-skill\ndescription: t\n---\n# body\n",
      extension: ".md",
      byteSize: 40,
      contentHash: "a".repeat(64),
    },
    {
      id: "f2",
      path: "scripts/setup.py",
      content: "import os\n",
      extension: ".py",
      byteSize: 10,
      contentHash: "b".repeat(64),
    },
  ];
  return {
    id: SKILL_ID,
    slug: "my-skill",
    name: "my-skill",
    description: "A test skill",
    status: opts.status ?? "ACTIVE",
    versions: [
      {
        id: VERSION_ID,
        version: 1,
        manifest: {},
        normalizedHash: "c".repeat(64),
        files,
      },
    ],
  };
}

beforeEach(() => {
  authMock.mockReset();
  subscriberFindFirstMock.mockReset();
  skillFindFirstMock.mockReset();
  accessGrantFindFirstMock.mockReset();
});

describe("GET /api/skills/[slug]/files — follow-up #122", () => {
  it("(F-1) happy path — 200 with skill+files JSON; sha256 from content_hash; path ASC ordering preserved", async () => {
    authMock.mockResolvedValue(SESSION);
    subscriberFindFirstMock.mockResolvedValue({ id: SUBSCRIBER_ID });
    skillFindFirstMock.mockResolvedValue(makeSkillRecord());
    accessGrantFindFirstMock.mockResolvedValue({ id: GRANT_ID, source: "PURCHASE" });

    const res = await GET(makeRequest() as Parameters<typeof GET>[0], makeContext());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const body = await res.json();

    expect(body.skill).toEqual({
      slug: "my-skill",
      name: "my-skill",
      version: "1", // string per dispatch
      description: "A test skill",
    });
    expect(body.files).toHaveLength(2);
    // Path ASC ordering — "SKILL.md" < "scripts/setup.py"
    expect(body.files[0].path).toBe("SKILL.md");
    expect(body.files[1].path).toBe("scripts/setup.py");
    // sha256 sourced from skill_files.content_hash
    expect(body.files[0].sha256).toBe("a".repeat(64));
    expect(body.files[1].sha256).toBe("b".repeat(64));
    // Inline content (no base64)
    expect(body.files[1].content).toBe("import os\n");
  });

  it("(F-2) 404 SKILL_NOT_FOUND on unknown slug", async () => {
    authMock.mockResolvedValue(SESSION);
    subscriberFindFirstMock.mockResolvedValue({ id: SUBSCRIBER_ID });
    skillFindFirstMock.mockResolvedValue(null);

    const res = await GET(makeRequest() as Parameters<typeof GET>[0], makeContext("unknown-skill"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("SKILL_NOT_FOUND");
    // AccessGrant must NOT have been queried — we short-circuit before it.
    expect(accessGrantFindFirstMock).not.toHaveBeenCalled();
  });

  it("(F-3) 401 UNAUTHENTICATED on no session and no API-key header", async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(makeRequest() as Parameters<typeof GET>[0], makeContext());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("UNAUTHENTICATED");
    // Skill lookup must NOT happen if auth fails first.
    expect(skillFindFirstMock).not.toHaveBeenCalled();
  });

  it("(F-4) 403 ACCESS_DENIED — authenticated, skill exists, but no AccessGrant", async () => {
    authMock.mockResolvedValue(SESSION);
    subscriberFindFirstMock.mockResolvedValue({ id: SUBSCRIBER_ID });
    skillFindFirstMock.mockResolvedValue(makeSkillRecord());
    accessGrantFindFirstMock.mockResolvedValue(null);

    const res = await GET(makeRequest() as Parameters<typeof GET>[0], makeContext());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("ACCESS_DENIED");
  });

  it("(F-5) 404 NO_ACTIVE_VERSION when skill is ARCHIVED", async () => {
    authMock.mockResolvedValue(SESSION);
    subscriberFindFirstMock.mockResolvedValue({ id: SUBSCRIBER_ID });
    skillFindFirstMock.mockResolvedValue(makeSkillRecord({ status: "ARCHIVED" }));

    const res = await GET(makeRequest() as Parameters<typeof GET>[0], makeContext());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("NO_ACTIVE_VERSION");
    // AccessGrant must NOT have been queried — we short-circuit on the
    // version status check before reaching grant lookup.
    expect(accessGrantFindFirstMock).not.toHaveBeenCalled();
  });

  it("(F-6) UTF-8 round-trip — non-ASCII .py content preserved byte-for-byte", async () => {
    const utf8Content = "# café ☕\nprint('héllo wörld 中文 🚀')\n";
    authMock.mockResolvedValue(SESSION);
    subscriberFindFirstMock.mockResolvedValue({ id: SUBSCRIBER_ID });
    skillFindFirstMock.mockResolvedValue(
      makeSkillRecord({
        files: [
          {
            id: "f1",
            path: "SKILL.md",
            content: "---\nname: i18n\n---\n",
            extension: ".md",
            byteSize: 18,
            contentHash: "a".repeat(64),
          },
          {
            id: "f2",
            path: "scripts/utf8.py",
            content: utf8Content,
            extension: ".py",
            byteSize: Buffer.byteLength(utf8Content, "utf8"),
            contentHash: "b".repeat(64),
          },
        ],
      }),
    );
    accessGrantFindFirstMock.mockResolvedValue({ id: GRANT_ID, source: "PURCHASE" });

    const res = await GET(makeRequest() as Parameters<typeof GET>[0], makeContext());
    expect(res.status).toBe(200);
    const body = await res.json();
    const pyFile = body.files.find((f: { path: string }) => f.path === "scripts/utf8.py");
    expect(pyFile).toBeDefined();
    // Exact string match — JSON encoding round-trip must preserve every
    // code point, including the emoji and CJK characters.
    expect(pyFile.content).toBe(utf8Content);
  });
});
