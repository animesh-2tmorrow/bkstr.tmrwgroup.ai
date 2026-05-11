-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 4 Stream A — Part 2: conditional backfill for Edward's publisher claim
--
-- Why a second migration file (not folded into Part 1):
--   Postgres ≥12 allows `ALTER TYPE … ADD VALUE` inside a transaction, but
--   the new value CANNOT be referenced in the SAME transaction. Prisma's
--   `migrate deploy` wraps each migration file in one transaction. Part 1
--   added 'PUBLISHER_OWN' to GrantSource; this Part 2 INSERTs access_grants
--   rows with source = 'PUBLISHER_OWN'. The two-file split makes the commit
--   between them explicit. (Verified shape — see D11.3 rationale.)
--
-- What this migration does:
--   IF edward@tmrwgroup.ai exists in users:
--     • UPDATE books.publisher_user_id = edward.id for every row where
--       publisher_user_id IS NULL (today: all 5 seed books).
--     • IF edward also has a subscribers row (events.createUser creates one
--       auto per Phase 2 contract — verified at src/lib/auth/index.ts:154):
--         INSERT one access_grants row per Edward-owned book with
--         source = 'PUBLISHER_OWN'. Idempotent via the unique constraint
--         (subscriber_id, book_id, source) — re-running is safe.
--   ELSE:
--     • RAISE NOTICE and return. The migration commits cleanly (transaction
--       success) but books and access_grants are untouched. Operator
--       re-runs the same DO block manually via psql once Edward signs in
--       (see docs/operations.md "Phase 4.5 — Edward / Zach publisher
--       backfill").
--
-- Today (2026-05-11) Edward has NOT signed in. The DO block will hit the
-- ELSE branch on this deploy. The backfill SQL is preserved here verbatim;
-- the runbook in docs/operations.md is the operator path for re-running.
--
-- Zach is intentionally NOT covered in this automated DO block. Per
-- design Q1 + D11.10, Edward owns all 5 existing books in the backfill.
-- When Zach's email lands, his books are first-class new-book creations
-- via Stream B's /dashboard/books/new — no migration needed.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK SQL (R1 mitigation — operator-applied if needed):
--
--   DELETE FROM "access_grants" WHERE source = 'PUBLISHER_OWN';
--   UPDATE "books" SET "publisher_user_id" = NULL;
--
-- The DELETE is safe at this phase — no app code reads PUBLISHER_OWN yet
-- (Streams B and C are the consumers; both PRs will arrive after this
-- migration). The UPDATE sets every book back to nullable-publisher state,
-- recoverable by re-running the DO block below once Edward exists.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  edward_id     UUID;
  edward_sub_id UUID;
  books_updated INT := 0;
  grants_made   INT := 0;
BEGIN
  SELECT "id" INTO edward_id FROM "users" WHERE "email" = 'edward@tmrwgroup.ai';

  IF edward_id IS NULL THEN
    RAISE NOTICE 'Phase 4 Stream A: edward@tmrwgroup.ai not yet in users; publisher backfill deferred. Re-run this DO block manually via psql after Edward signs in. See docs/operations.md "Phase 4.5 — Edward / Zach publisher backfill".';
    RETURN;
  END IF;

  -- events.createUser (src/lib/auth/index.ts:154) creates a subscribers row
  -- on first signin for every new User. Defensive check anyway: if the
  -- invariant ever fails, we still set publisher_user_id (the cheap half)
  -- and skip the PUBLISHER_OWN grants (the half that depends on it).
  SELECT "id" INTO edward_sub_id FROM "subscribers" WHERE "user_id" = edward_id;

  IF edward_sub_id IS NULL THEN
    RAISE NOTICE 'Phase 4 Stream A: edward user row exists but no subscribers row — auto-creation may have failed. Setting publisher_user_id on books; PUBLISHER_OWN access_grants deferred until subscriber row exists.';
  END IF;

  -- Assign every currently-unattributed book to Edward.
  UPDATE "books"
     SET "publisher_user_id" = edward_id
   WHERE "publisher_user_id" IS NULL;
  GET DIAGNOSTICS books_updated = ROW_COUNT;
  RAISE NOTICE 'Phase 4 Stream A: assigned % book(s) to edward@tmrwgroup.ai', books_updated;

  IF edward_sub_id IS NOT NULL THEN
    -- One PUBLISHER_OWN access_grant per Edward-owned book. Idempotent
    -- via the (subscriber_id, book_id, source) unique constraint (the
    -- same one used by the SEED backfill in Phase 3's access_grants
    -- migration). Re-running this DO block after Edward already has
    -- grants is a no-op.
    INSERT INTO "access_grants" ("id", "subscriber_id", "book_id", "source", "granted_at")
    SELECT gen_random_uuid(), edward_sub_id, b."id", 'PUBLISHER_OWN'::"GrantSource", CURRENT_TIMESTAMP
      FROM "books" b
     WHERE b."publisher_user_id" = edward_id
        ON CONFLICT ("subscriber_id", "book_id", "source") DO NOTHING;
    GET DIAGNOSTICS grants_made = ROW_COUNT;
    RAISE NOTICE 'Phase 4 Stream A: created % PUBLISHER_OWN grant(s) for edward@tmrwgroup.ai', grants_made;
  END IF;
END $$;
