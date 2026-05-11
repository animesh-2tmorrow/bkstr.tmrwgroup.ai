import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 5 Stream B (D14.5) — unit coverage for the 5 assistant tools.
//
// Strategy: mock the Prisma client. We assert each tool's input-validation
// + 200-cap behavior by inspecting the arguments passed to prisma.*.findMany.
// The Prisma client itself is the load-bearing query engine; testing its
// correctness is outside Stream B's scope.
//
// Six cases (a)–(f) per the dispatch spec.

// Mock the prisma module BEFORE importing the tools (vi.mock is hoisted).
vi.mock("@/lib/db", () => {
  return {
    prisma: {
      user: { findMany: vi.fn() },
      book: { findMany: vi.fn() },
      accessGrant: { findMany: vi.fn() },
      adminAction: { findMany: vi.fn() },
      fetchLog: { findMany: vi.fn() },
    },
  };
});

import { prisma } from "@/lib/db";
import { executeListUsers } from "./tools/list-users";
import { executeListBooks } from "./tools/list-books";
import { executeListGrants } from "./tools/list-grants";
import { executeReadAuditLog } from "./tools/read-audit-log";
import { executeRecentFetchLogs } from "./tools/recent-fetch-logs";

type Mock = ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Reset all mocks between tests so call-arg assertions are isolated.
  (prisma.user.findMany as unknown as Mock).mockReset();
  (prisma.book.findMany as unknown as Mock).mockReset();
  (prisma.accessGrant.findMany as unknown as Mock).mockReset();
  (prisma.adminAction.findMany as unknown as Mock).mockReset();
  (prisma.fetchLog.findMany as unknown as Mock).mockReset();
});

describe("list_users", () => {
  // (a) — returns rows with expected shape.
  it("returns count + capped from findMany result", async () => {
    (prisma.user.findMany as unknown as Mock).mockResolvedValue([
      { id: "u1", email: "a@b.c", role: "ADMIN", lastSigninAt: null, createdAt: new Date() },
      { id: "u2", email: "x@y.z", role: "SUBSCRIBER", lastSigninAt: null, createdAt: new Date() },
    ]);
    const out = await executeListUsers({});
    expect(out.count).toBe(2);
    expect(out.capped).toBe(false);
    expect(out.rows).toHaveLength(2);
  });

  // (b) — role filter is applied to the WHERE clause.
  it("filters by role when role=ADMIN", async () => {
    (prisma.user.findMany as unknown as Mock).mockResolvedValue([]);
    await executeListUsers({ role: "ADMIN" });
    const callArgs = (prisma.user.findMany as unknown as Mock).mock.calls[0][0];
    expect(callArgs.where).toEqual({ role: "ADMIN" });
  });

  it("ignores invalid role values", async () => {
    (prisma.user.findMany as unknown as Mock).mockResolvedValue([]);
    await executeListUsers({ role: "SUPERADMIN" });
    const callArgs = (prisma.user.findMany as unknown as Mock).mock.calls[0][0];
    expect(callArgs.where).toEqual({});
  });
});

describe("list_books", () => {
  // (c) — status filter excludes other statuses.
  it("filters by status=ACTIVE", async () => {
    (prisma.book.findMany as unknown as Mock).mockResolvedValue([]);
    await executeListBooks({ status: "ACTIVE" });
    const callArgs = (prisma.book.findMany as unknown as Mock).mock.calls[0][0];
    expect(callArgs.where).toEqual({ status: "ACTIVE" });
  });
});

describe("list_grants", () => {
  // (d) — default excludes revoked; includeRevoked=true includes them.
  it("default WHERE includes revokedAt: null", async () => {
    (prisma.accessGrant.findMany as unknown as Mock).mockResolvedValue([]);
    await executeListGrants({});
    const callArgs = (prisma.accessGrant.findMany as unknown as Mock).mock.calls[0][0];
    expect(callArgs.where).toEqual({ revokedAt: null });
  });

  it("includeRevoked=true drops the revokedAt filter", async () => {
    (prisma.accessGrant.findMany as unknown as Mock).mockResolvedValue([]);
    await executeListGrants({ includeRevoked: true });
    const callArgs = (prisma.accessGrant.findMany as unknown as Mock).mock.calls[0][0];
    expect(callArgs.where).toEqual({});
  });
});

describe("read_audit_log", () => {
  // (e) — since filter is parsed and applied as gte.
  it("since filter resolves to createdAt.gte", async () => {
    (prisma.adminAction.findMany as unknown as Mock).mockResolvedValue([]);
    const since = "2026-05-10T00:00:00Z";
    await executeReadAuditLog({ since });
    const callArgs = (prisma.adminAction.findMany as unknown as Mock).mock.calls[0][0];
    expect(callArgs.where.createdAt).toBeDefined();
    expect(callArgs.where.createdAt.gte).toEqual(new Date(since));
  });

  it("malformed since timestamp is silently dropped", async () => {
    (prisma.adminAction.findMany as unknown as Mock).mockResolvedValue([]);
    await executeReadAuditLog({ since: "not a date" });
    const callArgs = (prisma.adminAction.findMany as unknown as Mock).mock.calls[0][0];
    expect(callArgs.where).toEqual({});
  });
});

describe("recent_fetch_logs", () => {
  // (f) — 200-row hard cap: request limit=1000, expect 200 reached.
  it("clamps limit to 200 even when caller asks for 1000", async () => {
    // Build a 200-row mock result to match the cap; the tool's `capped`
    // flag should fire (rows.length === limit).
    const fakeRows = Array.from({ length: 200 }).map((_, i) => ({
      id: `f${i}`,
      subscriberId: "s1",
      bookVersionId: "v1",
      source: "agent_fetch",
      status: "success",
      createdAt: new Date(),
      subscriber: { user: { email: "x@y.z" } },
      bookVersion: { bookId: "b1" },
    }));
    (prisma.fetchLog.findMany as unknown as Mock).mockResolvedValue(fakeRows);

    const out = await executeRecentFetchLogs({ limit: 1000 });
    const callArgs = (prisma.fetchLog.findMany as unknown as Mock).mock.calls[0][0];
    expect(callArgs.take).toBe(200);
    expect(out.count).toBe(200);
    expect(out.capped).toBe(true);
  });

  it("bookId filter traverses the bookVersion relation", async () => {
    (prisma.fetchLog.findMany as unknown as Mock).mockResolvedValue([]);
    await executeRecentFetchLogs({ bookId: "b1" });
    const callArgs = (prisma.fetchLog.findMany as unknown as Mock).mock.calls[0][0];
    // fetch_logs has no book_id column — the filter MUST go through the
    // bookVersion relation, not directly via { bookId }.
    expect(callArgs.where).toEqual({ bookVersion: { bookId: "b1" } });
  });
});
