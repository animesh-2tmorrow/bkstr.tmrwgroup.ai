// Phase 4.5 Stream G (D12.4 / D12.5 / D12.7 / D12.8 / D12.14) — durable
// audit trail for ADMIN mutations. Mirrors the lib/<domain>/<concern>
// layout established by src/lib/books/access.ts (D11.4) and
// src/lib/webhooks/idempotency.ts (D10.1).
//
// Read surface (/dashboard/admin/audit) is deferred per D12.12; until it
// ships, operators query admin_actions via psql per the runbook in
// docs/operations.md "Querying admin_actions via psql".

// We import `Prisma` as a value (not type-only) because the helper
// references `Prisma.DbNull` to write a SQL NULL into the nullable JSONB
// columns. The `Prisma.TransactionClient` type is reachable through the
// same import.
import { Prisma } from "@/generated/prisma/client";

/**
 * Phase 4.5 Stream G (D12.4 / D12.7 / D12.14) — durable audit trail for
 * ADMIN mutations. ONE INSERT per mutation, INSIDE the mutation
 * transaction so the audit row commits/rolls-back atomically with the
 * mutation it describes. There is no "audit-attempt without mutation
 * success" half-state.
 *
 * CONTRAST WITH `withIdempotency` (src/lib/webhooks/idempotency.ts):
 * `withIdempotency` runs the handler OUTSIDE a DB transaction because the
 * handler does Stripe/S3 side-effects that can't be cleanly rolled back
 * (rationale at src/lib/webhooks/idempotency.ts:8-11). This helper runs
 * INSIDE because both the mutation and the audit row are local-DB writes
 * — there is nothing to leak outside the transaction. The two helpers
 * intentionally have inverted TX shapes.
 *
 * CALLER CONTRACT — the `tx` parameter is load-bearing. This helper
 * requires a `Prisma.TransactionClient`, not the global `prisma` client.
 * Callers MUST use the interactive transaction form:
 *
 *   await prisma.$transaction(async (tx) => {
 *     const before = await tx.user.findUniqueOrThrow({
 *       where: { id: targetUserId },
 *       select: { role: true },
 *     });
 *     await tx.user.update({
 *       where: { id: targetUserId },
 *       data: { role: targetRole },
 *     });
 *     await writeAuditEntry(tx, {
 *       actorUserId: session.user.id,
 *       actionType: "user.role_promote_publisher",
 *       targetType: "user",
 *       targetId: targetUserId,
 *       beforeState: { role: before.role },
 *       afterState: { role: targetRole },
 *     });
 *   });
 *
 * The array form `prisma.$transaction([...])` (used by Stream B at
 * src/app/api/books/new/route.ts:273-320 for its compose-with-Stripe
 * flow) does NOT work here — the array form runs every statement
 * independently and can't read pre-mutation `before` state under the
 * same TX, and the helper can't be threaded into the array. Streams E +
 * F use the interactive form for exactly this reason.
 *
 * The TX-bound contract is enforced by the TypeScript type signature:
 * any caller passing `prisma` directly (rather than `tx` obtained from
 * `prisma.$transaction(async (tx) => …)`) gets a compile-time error
 * because `Prisma.TransactionClient` is a narrower type than
 * `PrismaClient` — it lacks `$connect`, `$disconnect`, `$transaction`,
 * `$on`, and `$use`.
 *
 * actionType convention (D12.5): dot-delimited `<scope>.<verb>[_<qualifier>]`.
 *   user.role_promote_admin, user.role_promote_publisher,
 *   user.role_demote_subscriber, user.role_demote_publisher,
 *   book.reassign_publisher, grant.revoke.
 * The discriminator column is VARCHAR(64) per D12.7; app-side discipline
 * enforces the value set (no Postgres enum, no CHECK constraint, per the
 * webhook_events.source precedent at D9.3 / fetch_logs.source at D11.13).
 *
 * before/after state convention (D12.14): CHANGING FIELDS ONLY. E.g.
 * `{ role: 'SUBSCRIBER' }` before, `{ role: 'PUBLISHER' }` after — NOT
 * the full User row snapshot. Full row snapshots are ~10x the payload
 * and rarely needed for the kinds of admin mutations Phase 4.5 covers;
 * individual handlers can opt into full snapshots later without changing
 * this helper's signature.
 *
 * Trade-off — audit-write-fails-blocks-mutation (R2): if this INSERT
 * itself fails (Postgres infra issue: out-of-disk, lock timeout) the
 * parent mutation rolls back too. Mitigations: schema-level NOT NULL on
 * every required column; no FK on target_id (polymorphic — no
 * target-row-deletion-mid-TX FK errors); the actor FK has a valid target
 * by construction (caller is the logged-in ADMIN session.user.id).
 * Remaining failure mode (PG infrastructure) takes down the parent
 * mutation, which is the acceptable behavior — operator gets a 500 + the
 * mutation didn't happen, rather than silently losing the audit trail.
 */

// D12.7 — `target_type` discriminator. VARCHAR(32) column; app-side
// discipline restricts the value set to three known target tables.
export type AuditTargetType = "user" | "book" | "grant";

export type WriteAuditEntryArgs = {
  /** The logged-in ADMIN's `session.user.id`. NOT NULL at the DB layer. */
  actorUserId: string;
  /**
   * Dot-delimited per D12.5. App-side discipline; the DB column is
   * VARCHAR(64) with no CHECK constraint so future Streams add values
   * without a schema migration.
   */
  actionType: string;
  targetType: AuditTargetType;
  /** UUID of the target row (users.id, books.id, or access_grants.id). */
  targetId: string;
  /**
   * D12.14 — changing fields only, not a full row snapshot. Nullable
   * (some mutations have no meaningful "before" — though every Phase 4.5
   * mutation captures one).
   */
  beforeState?: Record<string, unknown> | null;
  /** D12.14 — changing fields only, not a full row snapshot. Nullable. */
  afterState?: Record<string, unknown> | null;
};

/**
 * Inserts one row into `admin_actions` inside the caller's transaction.
 * Returns void — callers don't need the audit row's id today; trivial to
 * surface later if a use case appears.
 *
 * @param tx interactive transaction client from
 *           `prisma.$transaction(async (tx) => { ... })`. Passing the
 *           global `prisma` client is a TYPE ERROR by design (D12.4) —
 *           the TX-bound contract is the load-bearing atomicity property.
 * @param args see WriteAuditEntryArgs.
 */
export async function writeAuditEntry(
  tx: Prisma.TransactionClient,
  args: WriteAuditEntryArgs,
): Promise<void> {
  await tx.adminAction.create({
    data: {
      actorUserId: args.actorUserId,
      actionType: args.actionType,
      targetType: args.targetType,
      targetId: args.targetId,
      // Prisma's nullable JSONB columns use a tagged-null distinction on
      // CREATE input: `Prisma.DbNull` writes SQL NULL (the column is
      // empty), `Prisma.JsonNull` writes the JSON value `null` into the
      // column. Phase 4.5 picks SQL NULL — matches the column's NULL-able
      // Prisma shape (`Json?`) and gives the cleanest `IS NULL` query
      // semantics for the deferred read surface (D12.12).
      beforeState:
        args.beforeState == null
          ? Prisma.DbNull
          : (args.beforeState as Prisma.InputJsonValue),
      afterState:
        args.afterState == null
          ? Prisma.DbNull
          : (args.afterState as Prisma.InputJsonValue),
    },
  });
}
