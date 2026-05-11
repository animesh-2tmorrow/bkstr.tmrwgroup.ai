-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 4 Stream A — Part 1: schema-only patch
--
-- Carries (per docs/phase-4-decisions.md D11.1–D11.4, D11.10, D11.12, D11.13):
--   • GrantSource enum: ADD VALUE 'PUBLISHER_OWN' (D11.3 / CC-3)
--   • books.description           TEXT NULL                 (D11.10 / CC-10)
--   • books.publisher_user_id     UUID NULL + FK + index    (D11.10 / D11.2)
--   • fetch_logs.source           VARCHAR(32) NOT NULL DEFAULT 'agent_fetch'
--                                                            (D11.13)
--   • fetch_logs.api_key_id       drop NOT NULL              (D11.12)
--
-- Part 2 (20260511120100_phase_4_schema_part_2_backfill) carries the
-- conditional backfill INSERTs that reference the new 'PUBLISHER_OWN' enum
-- value. The split is REQUIRED because Postgres ≥12 allows ALTER TYPE … ADD
-- VALUE inside a transaction, but the new value cannot be referenced in the
-- SAME transaction. Prisma's `migrate deploy` wraps each migration file in
-- a transaction (single migration = single TX), so the ADD VALUE in this
-- file MUST commit before any INSERT referencing 'PUBLISHER_OWN' runs. By
-- the time Part 2 begins its own transaction, Part 1 is fully committed.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK SQL (R1 mitigation per phase-4-design.md §9 — operator-applied if
-- the deploy fails and Prisma marks this migration as failed in
-- _prisma_migrations. The transactional wrapper means a mid-statement failure
-- reverts everything atomically; this comment block exists for the case where
-- the migration commits cleanly but a downstream issue (Stream B/C surprise,
-- production data shape mismatch) forces a manual roll-back of Phase 4 schema.
-- Run via psql; bring app DOWN first so no writer races a half-rolled-back
-- schema.
--
--   -- Part 1 reverse:
--   DROP INDEX IF EXISTS "books_publisher_user_id_idx";
--   ALTER TABLE "books"     DROP CONSTRAINT IF EXISTS "books_publisher_user_id_fkey";
--   ALTER TABLE "books"     DROP COLUMN IF EXISTS "publisher_user_id";
--   ALTER TABLE "books"     DROP COLUMN IF EXISTS "description";
--   ALTER TABLE "fetch_logs" DROP COLUMN IF EXISTS "source";
--   ALTER TABLE "fetch_logs" ALTER COLUMN "api_key_id" SET NOT NULL;
--
--   -- Note: Postgres does NOT support DROP VALUE on enum types. The
--   -- 'PUBLISHER_OWN' value persists harmlessly in the GrantSource enum if
--   -- no access_grants rows reference it (Part 2's backfill is also being
--   -- rolled back per its own reverse block). Future re-application of
--   -- Part 1 is idempotent — ALTER TYPE … ADD VALUE IF NOT EXISTS via PG
--   -- semantics means the value stays and re-add is a no-op.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. AlterEnum: add PUBLISHER_OWN to GrantSource (D11.3 / CC-3).
-- Postgres ≥12 allows this inside a transaction; the value is not yet
-- referenced anywhere in this file. Part 2 references it from its own TX.
ALTER TYPE "GrantSource" ADD VALUE 'PUBLISHER_OWN';

-- 2. AlterTable: books.description (D11.10 / CC-10).
-- Nullable per blocking-Q amendment: existing 5 books backfill as NULL
-- (no prose written yet); Stream B's new-book form will write values for
-- new rows. #68 tracks tightening to NOT NULL once every book has prose.
ALTER TABLE "books" ADD COLUMN "description" TEXT;

-- 3. AlterTable: books.publisher_user_id (D11.10 / D11.2).
-- Nullable for staged authoring: Edward + Zach may not have signed in yet
-- at deploy time (verified 2026-05-11: only animesh@2tmorrow.com,
-- animeshk604@gmail.com, clawbot@tmrwgroup.ai exist in users). Part 2's
-- conditional backfill assigns publisher_user_id IF Edward exists, ELSE
-- defers. #68 tracks tightening to NOT NULL post-backfill.
ALTER TABLE "books" ADD COLUMN "publisher_user_id" UUID;

-- 4. AddForeignKey: books.publisher_user_id → users.id.
-- ON DELETE SET NULL: if a publisher User is ever deleted, their books
-- survive with publisher_user_id = NULL (matches the soft-attribution
-- intent and pairs with the column's nullable shape). ON UPDATE CASCADE
-- mirrors other FKs in the schema.
ALTER TABLE "books"
  ADD CONSTRAINT "books_publisher_user_id_fkey"
  FOREIGN KEY ("publisher_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. CreateIndex: lookup-by-publisher (Stream B's /dashboard/pricing
-- PUBLISHER-scoped findMany filter; Stream B's new-book POST writes
-- publisher_user_id = session.user.id and downstream queries scope by it).
CREATE INDEX "books_publisher_user_id_idx" ON "books"("publisher_user_id");

-- 6. AlterTable: fetch_logs.source (D11.13).
-- VARCHAR(32) + app-side discipline per webhook_events.source precedent
-- (D9.3, prisma/migrations/20260510140000_phase_3_webhook_events). Values
-- read by app code: 'agent_fetch' (existing, default), 'dashboard_view'
-- and 'dashboard_download' (Stream C will write these). No Postgres
-- enum / no CHECK constraint — Stream C may add more source values
-- without a schema change. DEFAULT 'agent_fetch' backfills every
-- existing row in one statement.
ALTER TABLE "fetch_logs"
  ADD COLUMN "source" VARCHAR(32) NOT NULL DEFAULT 'agent_fetch';

-- 7. AlterTable: fetch_logs.api_key_id drop NOT NULL (D11.12).
-- Stream C's dashboard surfaces (View, Download) run with a session cookie,
-- not an API key — they must write fetch_logs rows with apiKeyId = NULL.
-- The existing /api/agent/fetch handler continues to write a non-null
-- apiKeyId for its rows; this change is purely permissive.
ALTER TABLE "fetch_logs" ALTER COLUMN "api_key_id" DROP NOT NULL;

-- Part 2 (immediately following) runs the conditional backfill that
-- references the new PUBLISHER_OWN enum value. By the time Part 2 begins
-- its own transaction, this Part 1's ALTER TYPE has fully committed.
