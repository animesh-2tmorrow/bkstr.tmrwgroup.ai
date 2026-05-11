import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

// Phase 5 Stream B (D14.5) — read_audit_log tool. Read-only against
// admin_actions (the Phase 4.5 Stream G durable audit trail). Useful for
// questions like "show me admin actions from the last 24 hours" or "what
// did Edward change recently."

export const readAuditLogTool = {
  name: "read_audit_log",
  description:
    "Read entries from the admin_actions audit log. Returns rows with id, actorUserId, actorEmail (joined), actionType (e.g. user.role_promote_publisher), targetType (user/book/grant), targetId, beforeState, afterState, createdAt. Filter by actor (the admin who performed the action), action type, or a `since` ISO timestamp for time-windowed queries.",
  input_schema: {
    type: "object",
    properties: {
      actorUserId: {
        type: "string",
        description: "Filter to actions performed by this admin (User UUID).",
      },
      action: {
        type: "string",
        description:
          "Filter to actions of this dot-delimited type (e.g. 'user.role_promote_publisher', 'grant.revoke', 'book.reassign_publisher'). Exact match.",
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

export type ReadAuditLogInput = {
  actorUserId?: string;
  action?: string;
  since?: string;
  limit?: number;
};

export async function executeReadAuditLog(input: ReadAuditLogInput) {
  const rawLimit = typeof input.limit === "number" ? input.limit : 50;
  const limit = Math.min(Math.max(Math.floor(rawLimit), 1), 200);

  const where: Prisma.AdminActionWhereInput = {};
  if (typeof input.actorUserId === "string" && input.actorUserId.length > 0) {
    where.actorUserId = input.actorUserId;
  }
  if (typeof input.action === "string" && input.action.length > 0) {
    where.actionType = input.action;
  }
  if (typeof input.since === "string" && input.since.length > 0) {
    const parsed = new Date(input.since);
    if (!Number.isNaN(parsed.getTime())) {
      where.createdAt = { gte: parsed };
    }
    // Silent drop on unparseable timestamps — better to return the
    // unfiltered tail than 500 mid-LLM-turn on a malformed model output.
  }

  const rows = await prisma.adminAction.findMany({
    where,
    take: limit,
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      actorUserId: true,
      actionType: true,
      targetType: true,
      targetId: true,
      beforeState: true,
      afterState: true,
      createdAt: true,
      actor: { select: { email: true } },
    },
  });

  const flattened = rows.map((r) => ({
    id: r.id,
    actorUserId: r.actorUserId,
    actorEmail: r.actor?.email ?? null,
    actionType: r.actionType,
    targetType: r.targetType,
    targetId: r.targetId,
    beforeState: r.beforeState,
    afterState: r.afterState,
    createdAt: r.createdAt,
  }));

  return { rows: flattened, count: flattened.length, capped: flattened.length === limit };
}
