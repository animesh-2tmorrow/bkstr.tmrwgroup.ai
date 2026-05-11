import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

// Phase 5 Stream B (D14.5) — list_books tool. Read-only.

const VALID_STATUSES = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;

export const listBooksTool = {
  name: "list_books",
  description:
    "List books on the bkstr platform. Optionally filter by publisher (user-id of the publisher) or status (DRAFT/ACTIVE/ARCHIVED). Returns rows with id, slug, title, status, publisherUserId, createdAt. Use this for questions like 'how many active books are there?' or 'what books has Edward published?'.",
  input_schema: {
    type: "object",
    properties: {
      publisherUserId: {
        type: "string",
        description: "Filter to books authored by this publisher (User UUID).",
      },
      status: {
        type: "string",
        enum: ["DRAFT", "ACTIVE", "ARCHIVED"],
        description: "Filter to books with this status. Omit for all statuses.",
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

export type ListBooksInput = {
  publisherUserId?: string;
  status?: string;
  limit?: number;
};

export async function executeListBooks(input: ListBooksInput) {
  const rawLimit = typeof input.limit === "number" ? input.limit : 50;
  const limit = Math.min(Math.max(Math.floor(rawLimit), 1), 200);

  const where: Prisma.BookWhereInput = {};
  if (typeof input.publisherUserId === "string" && input.publisherUserId.length > 0) {
    where.publisherUserId = input.publisherUserId;
  }
  if (
    typeof input.status === "string" &&
    (VALID_STATUSES as readonly string[]).includes(input.status)
  ) {
    where.status = input.status as Prisma.BookWhereInput["status"];
  }

  const rows = await prisma.book.findMany({
    where,
    take: limit,
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      publisherUserId: true,
      createdAt: true,
    },
  });
  return { rows, count: rows.length, capped: rows.length === limit };
}
