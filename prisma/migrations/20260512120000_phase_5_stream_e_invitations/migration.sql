-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 5 Stream E — user_invitations table (admin email invitations)
--
-- Per docs/decisions.md D15.1–D15.4 — magic-link email invitations issued by
-- ADMIN to recipients destined for PUBLISHER or SUBSCRIBER role. The
-- plaintext token lives ONLY in the email link; the DB stores a SHA-256 hex
-- hash (VARCHAR(64)). On accept, the events.signIn hook at
-- src/lib/auth/index.ts reads the bkstr_pending_invitation cookie, hashes
-- the token, looks up the invitation row, validates (not expired, not
-- accepted, email match case-insensitive), and applies the pre-assigned
-- role monotonic-upward per D11.11.
--
-- Schema choices (D15.1):
--   - Role enum reused: app-side enforcement restricts to PUBLISHER /
--     SUBSCRIBER at the POST /api/admin/invitations handler. ADMIN
--     invitations are forbidden through this flow (D15.1) — promote to
--     ADMIN via the existing role-mutation surface after the user accepts.
--   - tokenHash VARCHAR(64) — SHA-256 hex digest length. Plaintext is 32
--     bytes (256 bits) base64url-encoded; never persisted.
--   - emailSendStatus VARCHAR(32) free-form discriminator per the
--     webhook_events.source (D9.3) / admin_actions.target_type (D12.7)
--     precedent — pending / sent / failed / accepted. New states ship
--     without a migration.
--   - emailSendError nullable — populated only on failed sends. The
--     admin UI surfaces these so the operator can copy the magic-link
--     fallback from the create-invite response.
--   - emailMismatchNote nullable + semantically distinct from
--     emailSendError per Q4 — populated by events.signIn when the OAuth
--     email does not match the invitation email (case-insensitive). The
--     invitation stays pending; admin UI surfaces the note so the
--     operator can decide whether to cancel + reissue.
--   - invitedByUserId FK with ON DELETE RESTRICT — preserves audit chain;
--     deleting the ADMIN that issued the invitation is blocked.
--   - acceptedByUserId FK with ON DELETE SET NULL — recipient row delete
--     does NOT block the invitation row (the email string is preserved
--     as audit context regardless).
--
-- Two indexes:
--   - (email, acceptedAt) — supports the admin pending-invitations table
--     query (filter by accepted-or-pending status) and the
--     "is-there-already-an-open-invite-for-this-email" lookup on POST.
--   - (tokenHash) — supports the accept-init lookup. The SHA-256 hash is
--     already unique-ish in practice (256-bit collision space) but no
--     UNIQUE constraint — collision recovery would be operator-driven.
--
-- No data backfill — user_invitations starts empty by definition.
-- Pre-Phase-5 invitation flow did not exist.
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
--   DROP INDEX IF EXISTS "user_invitations_token_hash_idx";
--   DROP INDEX IF EXISTS "user_invitations_email_accepted_at_idx";
--   ALTER TABLE "user_invitations" DROP CONSTRAINT IF EXISTS "user_invitations_accepted_by_user_id_fkey";
--   ALTER TABLE "user_invitations" DROP CONSTRAINT IF EXISTS "user_invitations_invited_by_user_id_fkey";
--   DROP TABLE IF EXISTS "user_invitations";
--
-- Re-application after rollback is clean — no enum value adds, no backfill,
-- no dependencies on existing data. Standard path is operator-applied
-- rollback (the five statements above) before re-running prisma migrate
-- deploy.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "user_invitations" (
    "id"                     UUID           NOT NULL DEFAULT gen_random_uuid(),
    "email"                  TEXT           NOT NULL,
    "role"                   "Role"         NOT NULL,
    "token_hash"             VARCHAR(64)    NOT NULL,
    "invited_by_user_id"     UUID           NOT NULL,
    "expires_at"             TIMESTAMPTZ(6) NOT NULL,
    "accepted_at"            TIMESTAMPTZ(6),
    "accepted_by_user_id"    UUID,
    "email_send_status"      VARCHAR(32)    NOT NULL DEFAULT 'pending',
    "email_send_error"       TEXT,
    "email_mismatch_note"    TEXT,
    "created_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_invitations_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
-- ON DELETE RESTRICT preserves audit chain: a User that issued an
-- invitation cannot be hard-deleted without an explicit operator
-- migration. Mirrors AdminAction.actor precedent at D12.7.
ALTER TABLE "user_invitations"
    ADD CONSTRAINT "user_invitations_invited_by_user_id_fkey"
    FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- ON DELETE SET NULL — recipient delete doesn't block the invitation
-- row. The email string is preserved on the row as audit context.
ALTER TABLE "user_invitations"
    ADD CONSTRAINT "user_invitations_accepted_by_user_id_fkey"
    FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex — (email, accepted_at) supports the pending-invitations
-- table query (WHERE accepted_at IS NULL / ORDER BY created_at) and the
-- "is there an open invite for this email" pre-check on POST.
CREATE INDEX "user_invitations_email_accepted_at_idx"
    ON "user_invitations"("email", "accepted_at");

-- CreateIndex — (token_hash) supports the accept-init lookup. No
-- UNIQUE constraint; SHA-256 collisions are operator-recoverable.
CREATE INDEX "user_invitations_token_hash_idx"
    ON "user_invitations"("token_hash");
