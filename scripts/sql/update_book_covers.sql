-- Phase 5 Stream H.1 — wire the seed book covers to the S3 URLs.
-- The 6 PNGs are uploaded to s3://bkstr-tmrw-prod/book-covers/ out-of-band.
-- This script writes the matching public HTTPS URL into the books table.
--
-- Idempotent: UPDATE keys on `slug` (unique-per-publisher; all 6 seed
-- books are from one publisher so slug is effectively globally unique).
-- Re-running rewrites the same column to the same value.
--
-- Operator action — run once after Stream H.1 deploys + after the
-- PublicReadBookCovers bucket policy is applied (otherwise next/image
-- will silently fall through to the domain-initial placeholder tile).
--
-- Note: node-connect is currently ARCHIVED. The UPDATE writes the row
-- regardless. The storefront's status=ACTIVE filter excludes it from
-- /storefront; the dashboard's Active Books surface (which keeps
-- ARCHIVED-with-grant rows per D15.5) would display the cover there.

UPDATE books SET cover_image_url = 'https://bkstr-tmrw-prod.s3.us-east-1.amazonaws.com/book-covers/ci-diagnostics.png'  WHERE slug = 'ci-diagnostics';
UPDATE books SET cover_image_url = 'https://bkstr-tmrw-prod.s3.us-east-1.amazonaws.com/book-covers/developer-churn.png' WHERE slug = 'developer-churn';
UPDATE books SET cover_image_url = 'https://bkstr-tmrw-prod.s3.us-east-1.amazonaws.com/book-covers/docker-patterns.png' WHERE slug = 'docker-patterns';
UPDATE books SET cover_image_url = 'https://bkstr-tmrw-prod.s3.us-east-1.amazonaws.com/book-covers/gif-grep.png'        WHERE slug = 'gif-grep';
UPDATE books SET cover_image_url = 'https://bkstr-tmrw-prod.s3.us-east-1.amazonaws.com/book-covers/hermes-dogfood.png'  WHERE slug = 'hermes-dogfood';
UPDATE books SET cover_image_url = 'https://bkstr-tmrw-prod.s3.us-east-1.amazonaws.com/book-covers/node-connect.png'    WHERE slug = 'node-connect';

-- Verify
SELECT slug, cover_image_url FROM books ORDER BY slug;
