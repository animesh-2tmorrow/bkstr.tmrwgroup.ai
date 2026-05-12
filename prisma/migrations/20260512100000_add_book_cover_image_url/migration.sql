-- Migration: add_book_cover_image_url
-- Phase 5 Stream H (D15.6) — adds nullable cover_image_url column to books table.
-- Existing rows remain NULL until a publisher uploads a cover via the new
-- /api/books/[id]/cover endpoint. Storefront renders a domain-initial
-- placeholder tile when cover_image_url IS NULL.
--
-- Additive nullable column; no backfill, no downtime concern; existing
-- buyers' Active Books surface and the agent fetch path are untouched.

ALTER TABLE "books" ADD COLUMN "cover_image_url" TEXT;

-- Rollback:
--   ALTER TABLE "books" DROP COLUMN "cover_image_url";
