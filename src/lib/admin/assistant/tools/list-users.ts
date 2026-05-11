import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

// Phase 5 Stream B (D14.5) — list_users tool. Read-only Prisma query.
// 200-row hard cap; no free-form SQL escape hatch (follow-up #80).
//
// JSON Schema (NOT zod) — Anthropic's tools API takes JSON Schema directly.
// zod is not in package.json (D14.4 — no new deps for Stream B beyond
// @anthropic-ai/bedrock-sdk); validation is manual inside executeListUsers.

const VALID_ROLES = ["ADMIN", "PUBLISHER", "SUBSCRIBER"] as const;

export const listUsersTool = {
  name: "list_users",
  description:
    "List users on the bkstr platform. Optionally filter by role. Returns user rows with id, email, role, lastSigninAt, createdAt. Use this to answer questions about who's on the platform, who's a publisher, who just signed in, etc.",
  input_schema: {
    type: "object",
    properties: {
      role: {
        type: "string",
        enum: ["ADMIN", "PUBLISHER", "SUBSCRIBER"],
        description: "Filter to users of this role. Omit for all roles.",
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

export type ListUsersInput = {
  role?: string;
  limit?: number;
};

export async function executeListUsers(input: ListUsersInput) {
  // Server-side cap — even if the model emits limit=10000, we return at most
  // 200 rows. This is the load-bearing safety floor against runaway result
  // sets pulled into the LLM context (D14.5).
  const rawLimit = typeof input.limit === "number" ? input.limit : 50;
  const limit = Math.min(Math.max(Math.floor(rawLimit), 1), 200);

  const where: Prisma.UserWhereInput = {};
  if (typeof input.role === "string" && (VALID_ROLES as readonly string[]).includes(input.role)) {
    where.role = input.role as Prisma.UserWhereInput["role"];
  }

  const rows = await prisma.user.findMany({
    where,
    take: limit,
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      email: true,
      role: true,
      lastSigninAt: true,
      createdAt: true,
    },
  });
  return { rows, count: rows.length, capped: rows.length === limit };
}
