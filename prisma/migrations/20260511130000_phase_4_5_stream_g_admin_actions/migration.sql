-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 4.5 Stream G — admin_actions table (audit log foundation)
--
-- Per docs/phase-4.5-decisions.md D12.7 — durable record of every ADMIN
-- mutation surface (user role changes — Stream E; book ownership
-- reassignment + access_grants revoke — Stream F). Write surface lands in
-- Phase 4.5 Streams E + F via the writeAuditEntry(tx, …) helper at
-- src/lib/admin/audit.ts. Read surface (/dashboard/admin/audit) deferred
-- per D12.12; operators query this table via psql until then (runbook in
-- docs/operations.md "Querying admin_actions via psql").
--
-- Per D12.5 — actionType is dot-delimited free-form VARCHAR(64) of shape
-- `<scope>.<verb>[_<qualifier>]`: 'user.role_promote_admin',
-- 'user.role_promote_publisher', 'user.role_demote_subscriber',
-- 'user.role_demote_publisher', 'book.reassign_publisher', 'grant.revoke'.
-- No Postgres enum — future Streams add values without schema migrations
-- per the webhook_events.source precedent (D9.3) and fetch_logs.source
-- (D11.13).
--
-- Per D12.14 — before_state / after_state JSONB payloads capture CHANGING
-- FIELDS ONLY, not full row snapshots. Examples: {"role":"SUBSCRIBER"} →
-- {"role":"PUBLISHER"}; {"publisher_user_id":"<old>"} →
-- {"publisher_user_id":"<new>"}; {"revoked_at":null} →
-- {"revoked_at":"2026-05-11T…"}. Forensically adequate; storage-efficient.
--
-- Per D12.4 — the helper writes this INSERT inside the same TX as the
-- mutation it describes (interactive prisma.$transaction(async (tx) => …)).
-- If the mutation rolls back, the audit row rolls back too — no "audit-
-- attempt without mutation success" half-state. Inverted from
-- withIdempotency (which runs OUTSIDE TX for side-effect-bearing webhook
-- handlers per D10.1).
--
-- No backfill — admin_actions starts empty by definition. Pre-Phase-4.5
-- mutations did not run through the helper and are not captured
-- retroactively.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK SQL (R1 mitigation per phase-4.5-design.md §9 — operator-applied
-- if needed. The migration is fully transactional (Prisma's migrate deploy
-- wraps each file in one TX per the rationale at
-- prisma/migrations/20260511120000_phase_4_schema_part_1/migration.sql:16-19),
-- so a mid-statement failure reverts everything atomically. This block
-- exists for the case where the migration commits cleanly but a downstream
-- issue forces a manual roll-back. Bring app DOWN first so no writer races
-- a half-rolled-back schema.
--
--   DROP INDEX IF EXISTS "admin_actions_action_type_created_at_idx";
--   DROP INDEX IF EXISTS "admin_actions_target_type_target_id_created_at_idx";
--   DROP INDEX IF EXISTS "admin_actions_actor_user_id_created_at_idx";
--   ALTER TABLE "admin_actions" DROP CONSTRAINT IF EXISTS "admin_actions_actor_user_id_fkey";
--   DROP TABLE IF EXISTS "admin_actions";
--
-- Re-application after rollback is clean — no enum value adds (so no
-- ALTER TYPE … ADD VALUE residue persists in the schema the way
-- PUBLISHER_OWN persists per D11.3's mechanics note), no backfill, no
-- dependencies on existing data. Standard path is operator-applied
-- rollback (the five DROPs above) before re-running prisma migrate deploy.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "admin_actions" (
    "id"             UUID           NOT NULL DEFAULT gen_random_uuid(),
    "actor_user_id"  UUID           NOT NULL,
    "action_type"    VARCHAR(64)    NOT NULL,
    "target_type"    VARCHAR(32)    NOT NULL,
    "target_id"      UUID           NOT NULL,
    "before_state"   JSONB,
    "after_state"    JSONB,
    "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_actions_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
-- ON DELETE RESTRICT preserves audit history: a User with admin_actions
-- rows cannot be hard-deleted without an explicit operator migration.
-- SET NULL would lose forensic value ("which ADMIN did this?"); CASCADE
-- would defeat the audit table's purpose entirely. Mirrors the RESTRICT
-- precedent on FetchLog.bookVersionId (schema.prisma:311).
-- ON UPDATE CASCADE mirrors the other FKs in the schema.
ALTER TABLE "admin_actions"
    ADD CONSTRAINT "admin_actions_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex — three composite indexes pre-aligned with the eventual
-- read surface's filter dimensions (D12.12). When the read surface ships,
-- no additional indexes are needed.

-- 1. "who has done what recently" — supports the actor filter.
CREATE INDEX "admin_actions_actor_user_id_created_at_idx"
    ON "admin_actions"("actor_user_id", "created_at" DESC);

-- 2. "history for this user/book/grant" — supports the target filter.
--    Composite-on-discriminator-plus-id matches the polymorphic-target
--    shape (no FK on target_id; target_type tells you which table).
CREATE INDEX "admin_actions_target_type_target_id_created_at_idx"
    ON "admin_actions"("target_type", "target_id", "created_at" DESC);

-- 3. "every promotion in the last week" — supports the action-type filter.
CREATE INDEX "admin_actions_action_type_created_at_idx"
    ON "admin_actions"("action_type", "created_at" DESC);
