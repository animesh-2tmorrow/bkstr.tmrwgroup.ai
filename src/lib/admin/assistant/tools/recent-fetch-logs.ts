import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

// Phase 5 Stream B (D14.5) — recent_fetch_logs tool. Read-only against
// fetch_logs. NOTE: fetch_logs keys on book_version_id (not book_id) — the
// bookId filter traverses the bookVersion relation: `{ bookVersion: { bookId } }`.

export const recentFetchLogsTool = {
  name: "recent_fetch_logs",
  description:
    "Recent /api/agent/fetch log entries (and dashboard view/download events that share the table). Returns rows with id, subscriberId, subscriberEmail (joined), bookVersionId, bookId (resolved via bookVersion relation), source (agent_fetch/dashboard_view/etc.), status, createdAt. Filter by bookId (resolves via book_versions), apiKeyId, or `since` ISO timestamp.",
  input_schema: {
    type: "object",
    properties: {
      bookId: {
        type: "string",
        description:
          "Filter to fetch logs whose bookVersion belongs to this book (UUID). Traverses the bookVersion relation.",
      },
      apiKeyId: {
        type: "string",
        description: "Filter to fetch logs made with this API key (UUID).",
      },
      since: {
        type: "string",
        description:
          "ISO 8601 timestamp; only return rows with createdAt >= since. Example: '2026-05-10T00:00:00Z'.",
      },
      limit: {
        type: "number",
        minimum: 1,
        maximum: 200,
        default: 50,
        description: "Max rows to return. Hard-capped server-side at 200.",
      },
    },
    required: [],
  },
} as const;

export type RecentFetchLogsInput = {
  bookId?: string;
  apiKeyId?: string;
  since?: string;
  limit?: number;
};

export async function executeRecentFetchLogs(input: RecentFetchLogsInput) {
  const rawLimit = typeof input.limit === "number" ? input.limit : 50;
  const limit = Math.min(Math.max(Math.floor(rawLimit), 1), 200);

  const where: Prisma.FetchLogWhereInput = {};
  // bookId filter — fetch_logs has no book_id column; we go through the
  // bookVersion relation: `{ bookVersion: { bookId } }`. See schema
  // prisma/schema.prisma:311 (FetchLog.bookVersionId).
  if (typeof input.bookId === "string" && input.bookId.length > 0) {
    where.bookVersion = { bookId: input.bookId };
  }
  if (typeof input.apiKeyId === "string" && input.apiKeyId.length > 0) {
    where.apiKeyId = input.apiKeyId;
  }
  if (typeof input.since === "string" && input.since.length > 0) {
    const parsed = new Date(input.since);
    if (!Number.isNaN(parsed.getTime())) {
      where.createdAt = { gte: parsed };
    }
  }

  const rows = await prisma.fetchLog.findMany({
    where,
    take: limit,
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      subscriberId: true,
      bookVersionId: true,
      source: true,
      status: true,
      createdAt: true,
      subscriber: { select: { user: { select: { email: true } } } },
      bookVersion: { select: { bookId: true } },
    },
  });

  const flattened = rows.map((r) => ({
    id: r.id,
    subscriberId: r.subscriberId,
    subscriberEmail: r.subscriber?.user?.email ?? null,
    bookVersionId: r.bookVersionId,
    bookId: r.bookVersion?.bookId ?? null,
    source: r.source,
    status: r.status,
    createdAt: r.createdAt,
  }));

  return { rows: flattened, count: flattened.length, capped: flattened.length === limit };
}
