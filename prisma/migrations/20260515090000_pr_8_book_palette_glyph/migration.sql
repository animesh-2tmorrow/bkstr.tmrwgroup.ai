-- ─────────────────────────────────────────────────────────────────────────────
-- bkstr redesign PR 8 — book palette + glyph columns + backfill.
--
-- Adds the two columns that drive the typographic <BookCover> SVG. Until
-- this migration ships, palette + glyph were derived client-side via
-- src/lib/books/cover-derive.ts (FNV-1a-ish hash on domain → 6-palette
-- bucket; first uppercase ASCII letter of title → glyph; '?' fallback).
-- That helper is deleted in this PR — every callsite reads the columns
-- instead.
--
-- ─── Co-deploy safety (operator invariant: single ff-merge, no half-deployed
--     state) ────────────────────────────────────────────────────────────────
--
-- This migration runs in scripts/start.sh's ApplicationStart hook BEFORE
-- pm2 reload. There is a brief window where:
--   1. Old code (PR 7) is still serving — does NOT read palette/glyph.
--   2. This migration adds the columns NOT NULL WITH DEFAULTS.
--   3. pm2 reload swaps to PR 8 code — reads palette/glyph from rows.
--
-- The DEFAULT values on the columns are LOAD-BEARING for that window: if
-- old PR 7 code happens to INSERT a books row during deploy (e.g. a
-- publisher hits /dashboard/books/new mid-deploy), the Prisma client emits
-- INSERT without palette/glyph fields. Postgres applies the defaults so the
-- INSERT succeeds. Without defaults, old-code inserts would 500 with
-- "null value in column ... violates not-null constraint."
--
-- We therefore keep the DEFAULTs on the columns indefinitely (no DROP
-- DEFAULT statement at the bottom). Future PR can tighten if/when we
-- decide every insert path explicitly supplies the values.
--
-- ─── Backfill heuristic ─────────────────────────────────────────────────────
--
-- PALETTE — derived from domain. Two-tier strategy:
--
--   1. Explicit category mapping for the canonical taxonomies that ship
--      with the v0 catalog. Pairs each editorial category with a palette
--      that reads sensibly against the cover layout. Today's known domain
--      strings (per src/app/page.tsx SAMPLE_HERO_BOOKS + the ~10 production
--      books) are case-mapped:
--
--        marketing*, growth*, sales*       → saffron (warm, attention-call)
--        agent*, qa*, testing*             → forest  (calm, validate)
--        devops, ci, cd, infra*, platform* → indigo  (cool, infrastructure)
--        ops*, runbook*, sre*              → slate   (neutral, operational)
--        ai, ml, data*, analytics*         → plum    (lab/research)
--        security*, compliance*, legal*    → oxblood (caution, gravity)
--        design*, ux*, product*            → forest  (mirrors agent palette,
--                                                     reads as creative)
--
--   2. Deterministic hash fallback for everything else. Postgres's
--      built-in HASHTEXT function returns a 32-bit signed integer that's
--      stable for a given input string across versions. ABS(HASHTEXT(d))
--      MOD 6 gives a stable palette index for unknown domains; mapped
--      via array indexing to the same 6-palette set.
--
-- GLYPH — first uppercase ASCII letter of title, '?' fallback for
-- non-alpha titles (e.g. "12-factor"). Uses regexp_replace + UPPER + LEFT.
--
-- The component (src/components/design/book-cover.tsx) renders the glyph
-- as a single large italic letter; multi-character or non-ASCII glyphs
-- would visually overflow the canvas, so we hard-clamp to a single
-- uppercase ASCII letter via LEFT(..., 1).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. AddColumns. NOT NULL with DEFAULTs so existing rows immediately have
-- safe values; old-code inserts during the deploy window also succeed.
ALTER TABLE "books" ADD COLUMN "palette" VARCHAR(16) NOT NULL DEFAULT 'indigo';
ALTER TABLE "books" ADD COLUMN "glyph"   CHAR(1)     NOT NULL DEFAULT '?';

-- 2. Backfill palette via the two-tier strategy described above. The
-- LOWER(domain) match is intentional — production domains today are
-- inconsistent in case ('Marketing Ops', 'devops', 'AGENT QA' all coexist
-- without normalization). Operator-facing domain casing is preserved on
-- read; the backfill normalizes only for the matching step.
--
-- The CASE branches use LIKE patterns rather than exact matches because
-- production domains carry suffix words ('Marketing Ops', 'Marketing
-- Operations Playbook'). Branch order matters where prefixes overlap
-- (e.g. 'agent' before 'ai' so 'agent qa' doesn't fall through to plum).
UPDATE "books"
SET "palette" = CASE
  -- Explicit category mappings (case-insensitive prefix/contains).
  WHEN LOWER("domain") LIKE 'marketing%'    THEN 'saffron'
  WHEN LOWER("domain") LIKE 'growth%'       THEN 'saffron'
  WHEN LOWER("domain") LIKE 'sales%'        THEN 'saffron'
  WHEN LOWER("domain") LIKE 'agent%'        THEN 'forest'
  WHEN LOWER("domain") LIKE 'qa%'           THEN 'forest'
  WHEN LOWER("domain") LIKE '%testing%'     THEN 'forest'
  WHEN LOWER("domain") LIKE 'design%'       THEN 'forest'
  WHEN LOWER("domain") LIKE 'ux%'           THEN 'forest'
  WHEN LOWER("domain") LIKE 'product%'      THEN 'forest'
  WHEN LOWER("domain") LIKE 'devops%'       THEN 'indigo'
  WHEN LOWER("domain") IN ('ci', 'cd', 'ci/cd') THEN 'indigo'
  WHEN LOWER("domain") LIKE 'infra%'        THEN 'indigo'
  WHEN LOWER("domain") LIKE 'platform%'     THEN 'indigo'
  WHEN LOWER("domain") LIKE 'ops%'          THEN 'slate'
  WHEN LOWER("domain") LIKE 'runbook%'      THEN 'slate'
  WHEN LOWER("domain") LIKE 'sre%'          THEN 'slate'
  WHEN LOWER("domain") IN ('ai', 'ml')      THEN 'plum'
  WHEN LOWER("domain") LIKE 'data%'         THEN 'plum'
  WHEN LOWER("domain") LIKE 'analytics%'    THEN 'plum'
  WHEN LOWER("domain") LIKE 'security%'     THEN 'oxblood'
  WHEN LOWER("domain") LIKE 'compliance%'   THEN 'oxblood'
  WHEN LOWER("domain") LIKE 'legal%'        THEN 'oxblood'
  -- Deterministic hash fallback for unknown domains. The 6-element array
  -- order matches BookCoverPalette in src/components/design/book-cover.tsx.
  -- HASHTEXT can return INT_MIN, on which ABS overflows; the (... + 6) % 6
  -- shape is the standard "always-positive modulo" idiom.
  ELSE (ARRAY['saffron','forest','oxblood','indigo','plum','slate'])
    [(ABS(HASHTEXT(LOWER("domain"))) % 6) + 1]
END;

-- 3. Backfill glyph. UPPER(LEFT(regexp_replace(...), 1)) extracts the first
-- character after stripping non-letters; falls back to '?' when the title
-- has no ASCII letters at all (e.g. '12-factor' → '?'). LEFT(..., 1)
-- guarantees single-character output even if regexp_replace returns more.
UPDATE "books"
SET "glyph" = COALESCE(
  NULLIF(UPPER(LEFT(REGEXP_REPLACE("title", '[^A-Za-z]', '', 'g'), 1)), ''),
  '?'
);

-- 4. Rollback (operator-applied via psql if a downstream issue forces a
-- retreat). The migration is purely additive — the rollback drops both
-- columns, which has no side-effects on the rest of the schema. App-code
-- rollback (revert the PR 8 commit on git, restart) lands the old code
-- which doesn't read either column, so the column drop is safe to do
-- after the code rollback completes.
--
--   Rollback SQL:
--     ALTER TABLE "books" DROP COLUMN "glyph";
--     ALTER TABLE "books" DROP COLUMN "palette";
--
-- The cover_image_url column from 20260512100000_add_book_cover_image_url
-- is intentionally LEFT IN PLACE for one cycle per PR 8's plan — the UI
-- stops referencing it (PR 8) but the column survives until a follow-up
-- cycle confirms no migration paths still need it.
