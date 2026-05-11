-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 5 Stream B — assistant_conversations + assistant_messages tables
--
-- Per docs/decisions.md D14.3 — persisted history for the read-only admin
-- AI assistant at /dashboard/admin/assistant. Stream B writes ONLY into
-- these two tables; the assistant is read-only against the rest of the
-- schema (D14.1 — no mutations, no admin_actions writes, no fetch_logs
-- writes). The assistant ITSELF is not an admin mutation, so the audit-log
-- contract documented at src/lib/admin/audit.ts:16-30 does not apply.
--
-- Schema choices (D14.3):
--   - One row per content BLOCK, not per Anthropic message. Translation to
--     Anthropic's messages-array shape happens app-side in
--     src/lib/admin/assistant/agent.ts. Specifically: one row per text
--     content block (role='assistant'), one row per tool_use block
--     (role='tool_use', content={toolUseId, name, input}), one row per
--     tool_result block (role='tool_result', content={toolUseId, output}),
--     and one row per user message (role='user', content={text}). The
--     load translation reassembles consecutive same-role rows into a
--     single Anthropic message.
--   - role is VARCHAR(32) (NOT a Postgres enum) per the webhook_events.source
--     (D9.3) / admin_actions.target_type (D12.7) precedent — future Streams
--     (C: propose-mode, D: execute-mode) may add additional row types
--     without a schema migration.
--   - content is JSONB so each row type carries its own structured payload
--     without per-role columns. Trade-off: no per-field index possible, but
--     queries against this column are always by conversation_id + createdAt
--     (composite index below).
--   - model_id, input_tokens, output_tokens are nullable — only populated
--     on assistant rows that consumed a Bedrock call. user / tool_use /
--     tool_result rows carry NULLs honestly rather than sentinel zeros.
--   - owner_user_id FK with ON DELETE RESTRICT — preserves history; deleting
--     a User that still has assistant conversations is blocked at the DB
--     layer (matches AdminAction precedent at admin_actions D12.7). Hard-
--     delete of a user requires an explicit operator migration to first
--     archive or transfer their assistant conversations.
--   - conversation_id FK with ON DELETE CASCADE — when a conversation is
--     hard-deleted, its messages go with it. Soft-archive (archived_at) is
--     the normal path; CASCADE only fires for explicit psql DELETEs.
--
-- No backfill — both tables start empty by definition. Pre-Phase-5 surfaces
-- did not run through the assistant.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK SQL (operator-applied if needed. The migration is fully
-- transactional (Prisma's migrate deploy wraps each file in one TX per the
-- rationale at prisma/migrations/20260511120000_phase_4_schema_part_1
-- /migration.sql:16-19), so a mid-statement failure reverts everything
-- atomically. This block exists for the case where the migration commits
-- cleanly but a downstream issue forces a manual roll-back. Bring app DOWN
-- first so no writer races a half-rolled-back schema.
--
--   DROP INDEX IF EXISTS "assistant_messages_conversation_id_created_at_idx";
--   ALTER TABLE "assistant_messages" DROP CONSTRAINT IF EXISTS "assistant_messages_conversation_id_fkey";
--   DROP TABLE IF EXISTS "assistant_messages";
--   DROP INDEX IF EXISTS "assistant_conversations_owner_user_id_archived_at_updated_at_idx";
--   ALTER TABLE "assistant_conversations" DROP CONSTRAINT IF EXISTS "assistant_conversations_owner_user_id_fkey";
--   DROP TABLE IF EXISTS "assistant_conversations";
--
-- Re-application after rollback is clean — no enum value adds, no backfill,
-- no dependencies on existing data. Standard path is operator-applied
-- rollback (the six statements above) before re-running prisma migrate
-- deploy.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "assistant_conversations" (
    "id"             UUID           NOT NULL DEFAULT gen_random_uuid(),
    "owner_user_id"  UUID           NOT NULL,
    "title"          VARCHAR(255),
    "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMPTZ(6) NOT NULL,
    "archived_at"    TIMESTAMPTZ(6),

    CONSTRAINT "assistant_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_messages" (
    "id"               UUID           NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id"  UUID           NOT NULL,
    "role"             VARCHAR(32)    NOT NULL,
    "content"          JSONB          NOT NULL,
    "model_id"         VARCHAR(128),
    "input_tokens"     INTEGER,
    "output_tokens"    INTEGER,
    "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_messages_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
-- ON DELETE RESTRICT preserves conversation history: a User with
-- assistant_conversations rows cannot be hard-deleted without an explicit
-- operator migration. Matches AdminAction precedent at admin_actions D12.7.
ALTER TABLE "assistant_conversations"
    ADD CONSTRAINT "assistant_conversations_owner_user_id_fkey"
    FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- ON DELETE CASCADE — messages follow their parent conversation. Soft-
-- archive (archived_at) is the normal path; CASCADE only fires on explicit
-- psql DELETEs of the conversation row.
ALTER TABLE "assistant_messages"
    ADD CONSTRAINT "assistant_messages_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "assistant_conversations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex — supports the list-conversations query at
-- /api/admin/assistant/conversations GET, which filters on owner_user_id +
-- archived_at IS NULL and orders by updated_at DESC.
CREATE INDEX "assistant_conversations_owner_user_id_archived_at_updated_at_idx"
    ON "assistant_conversations"("owner_user_id", "archived_at", "updated_at" DESC);

-- CreateIndex — supports the list-messages query at
-- /api/admin/assistant/conversations/[id]/messages GET, plus the agent
-- loop's in-conversation prior-messages load. Composite on
-- (conversation_id, created_at) orders chronologically within a single
-- conversation in one index scan.
CREATE INDEX "assistant_messages_conversation_id_created_at_idx"
    ON "assistant_messages"("conversation_id", "created_at");
