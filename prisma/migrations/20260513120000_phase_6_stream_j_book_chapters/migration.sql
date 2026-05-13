-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 6 Stream J — multi-chapter book structure (ADDITIVE ONLY)
--
-- Per docs/decisions.md D16.1 and docs/phase-6-roadmap.md AD1 (revised):
-- chapters are a property of a book_versions row, not a books row. A version
-- has zero chapters (legacy single-blob — content lives in book_versions.content
-- / .content_uri via the D9.2 dual-storage seam) or N chapters (multi-chapter —
-- content assembled from book_chapters ordered by "order", read via the
-- getVersionContent(version) helper at src/lib/books/content.ts).
--
-- NO BACKFILL: the 6 existing book_versions rows stay chapterless and continue
-- to be served via loadBookContent unchanged. NO column is deprecated —
-- book_versions.content / .content_uri remain authoritative for legacy versions.
-- NO admin_actions write — a schema migration is a deployment artifact, not an
-- ADMIN mutation (D12.7); the audit trail for this change is this file + D16.1
-- + git history.
--
-- Net effect on production data: zero rows touched in books or book_versions.
-- Two schema objects added: the book_chapters table; the book_versions.manifest
-- column (JSONB, default '{}').
-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK SQL (operator-applied if needed; bring the app DOWN first so no
-- writer races a half-rolled-back schema):
--
--   DROP TABLE IF EXISTS "book_chapters";
--   ALTER TABLE "book_versions" DROP COLUMN IF EXISTS "manifest";
--
-- Re-application after rollback is clean — additive only, no backfill, no
-- dependencies on existing data.
-- ─────────────────────────────────────────────────────────────────────────────

-- AlterTable — per-version manifest metadata; '{}' for legacy single-blob versions.
ALTER TABLE "book_versions" ADD COLUMN "manifest" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "book_chapters" (
    "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
    "book_version_id" UUID         NOT NULL,
    "order"           INTEGER      NOT NULL,
    "slug"            VARCHAR(128) NOT NULL,
    "title"           VARCHAR(255),
    "content"         TEXT         NOT NULL,
    "token_estimate"  INTEGER,
    "metadata"        JSONB        NOT NULL DEFAULT '{}',
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "book_chapters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "book_chapters_book_version_id_slug_key"  ON "book_chapters"("book_version_id", "slug");
CREATE UNIQUE INDEX "book_chapters_book_version_id_order_key" ON "book_chapters"("book_version_id", "order");
CREATE INDEX        "book_chapters_book_version_id_idx"       ON "book_chapters"("book_version_id");

-- AddForeignKey
-- ON DELETE CASCADE: chapters are owned wholly by their version; deleting a
-- book_versions row (only ever a CASCADE from a books delete today) takes its
-- chapters with it. ON UPDATE CASCADE mirrors every other FK in the schema.
ALTER TABLE "book_chapters"
    ADD CONSTRAINT "book_chapters_book_version_id_fkey"
    FOREIGN KEY ("book_version_id") REFERENCES "book_versions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
