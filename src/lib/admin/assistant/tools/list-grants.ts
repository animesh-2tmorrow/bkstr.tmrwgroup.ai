import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

// Phase 5 Stream B (D14.5) — list_grants tool. Read-only.
//
// Returns access_grants rows joined with subscriber.user.email (for human
// readability) and book.title. Defaults to includeRevoked=false so the
// common-case "show me active grants" question doesn't need a parameter.

const VALID_SOURCES = ["MANUAL", "SUBSCRIPTION", "PURCHASE", "SEED", "PUBLISHER_OWN"] as const;

export const listGrantsTool = {
  name: "list_grants",
  description:
    "List access grants on the bkstr platform. Returns rows with id, subscriberId, subscriberEmail (joined), bookId, bookTitle (joined), source (MANUAL/SUBSCRIPTION/PURCHASE/SEED/PUBLISHER_OWN), grantedAt, revokedAt. By default excludes revoked grants — pass includeRevoked=true to include them. Use this for questions like 'who has access to book X?' or 'how many active SUBSCRIPTION grants are there?'.",
  input_schema: {
    type: "object",
    properties: {
      subscriberId: {
        type: "string",
        description: "Filter to grants for this subscriber (UUID).",
      },
      bookId: {
        type: "string",
        description: "Filter to grants for this book (UUID).",
      },
      source: {
        type: "string",
        enum: ["MANUAL", "SUBSCRIPTION", "PURCHASE", "SEED", "PUBLISHER_OWN"],
        description: "Filter to grants of this provenance.",
      },
      includeRevoked: {
        type: "boolean",
        default: false,
        description:
          "If false (default), only active grants (revokedAt IS NULL) are returned. If true, includes soft-revoked rows.",
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

export type ListGrantsInput = {
  subscriberId?: string;
  bookId?: string;
  source?: string;
  includeRevoked?: boolean;
  limit?: number;
};

export async function executeListGrants(input: ListGrantsInput) {
  const rawLimit = typeof input.limit === "number" ? input.limit : 50;
  const limit = Math.min(Math.max(Math.floor(rawLimit), 1), 200);

  const where: Prisma.AccessGrantWhereInput = {};
  if (typeof input.subscriberId === "string" && input.subscriberId.length > 0) {
    where.subscriberId = input.subscriberId;
  }
  if (typeof input.bookId === "string" && input.bookId.length > 0) {
    where.bookId = input.bookId;
  }
  if (
    typeof input.source === "string" &&
    (VALID_SOURCES as readonly string[]).includes(input.source)
  ) {
    where.source = input.source as Prisma.AccessGrantWhereInput["source"];
  }
  // Default: exclude revoked grants. Opt-in via includeRevoked=true.
  if (input.includeRevoked !== true) {
    where.revokedAt = null;
  }

  const rows = await prisma.accessGrant.findMany({
    where,
    take: limit,
    orderBy: [{ grantedAt: "desc" }],
    select: {
      id: true,
      subscriberId: true,
      bookId: true,
      source: true,
      grantedAt: true,
      revokedAt: true,
      subscriber: { select: { user: { select: { email: true } } } },
      book: { select: { title: true } },
    },
  });

  // Flatten the joins for cleaner LLM tool-result output.
  const flattened = rows.map((r) => ({
    id: r.id,
    subscriberId: r.subscriberId,
    subscriberEmail: r.subscriber?.user?.email ?? null,
    bookId: r.bookId,
    bookTitle: r.book?.title ?? null,
    source: r.source,
    grantedAt: r.grantedAt,
    revokedAt: r.revokedAt,
  }));

  return { rows: flattened, count: flattened.length, capped: flattened.length === limit };
}
