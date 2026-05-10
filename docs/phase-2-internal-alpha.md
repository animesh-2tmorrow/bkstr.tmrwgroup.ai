# bkstr.tmrwgroup.ai — Phase 2 Internal-Alpha Report

*Closed 2026-05-10. Engineering complete; deployed thin slice provides Google OAuth, API key issuance, Bearer-authenticated agent fetch against Bedrock Sonnet 4.5 with SSE streaming + sanitized error path + LRU cache, books dashboard with real metrics, fetch logs view, and a CLI book import primitive. Internal-alpha walkthrough with Zach + Edward pending as a separate follow-on.*

---

## What Phase 2 built

A working content-delivery system where a publisher can expose markdown documents and a subscriber can query them via an authenticated agent endpoint backed by Bedrock Sonnet 4.5.

Concretely, the deployed system at `bkstr.tmrwgroup.ai` provides:

- **NextAuth + Google OAuth** at `/login`, `/signup`, `/api/auth/[...nextauth]`.
- **API key issuance** at `/dashboard/api-keys` and `POST/GET/DELETE /api/keys[/id]` with show-once plaintext modal.
- **Agent fetch endpoint** at `POST /api/agent/fetch` — Bearer-auth, SSE streaming, sanitized error path, in-memory LRU cache, 30-second first-token timeout, 8000-char query cap, 150k token content guard.
- **Books dashboard** at `/dashboard` showing per-book metrics (latest version, total fetches, last 30d fetches, active agents 30d, last fetched).
- **Fetch logs view** at `/dashboard/fetch-logs` with subscriber-scoped read and optional `?book=` filter.
- **CLI book import** via `npm run import-book -- --publisher ... --title ... --domain ... --file ...`, deployed as part of the application bundle on EC2.

The seed corpus at close-out: 5 books under publisher `tmrwgroup`, sourced from skillsmp.com (gif-grep, node-connect, hermes-dogfood, ci-diagnostics, docker-patterns). Size range 2,611 to 20,478 bytes. All v1.

## What works, with evidence

| Capability | Evidence |
|---|---|
| Google OAuth login | 3 distinct subscriber identities authenticated cleanly during Phase 2 |
| API key issuance | `bks_9XhbyfLT...` issued via dashboard, used successfully in production curl |
| Book import | 5 SKILL.md files imported, idempotency verified via gif-grep re-import (no-op on identical content) |
| Agent fetch — success path | First production Bedrock call: 902 input tokens, 116 output tokens, 2999ms latency, content-from-DB confirmed in agent response |
| Agent fetch — error path | Test 11 deliberately broke `MODEL_ID`; route returned sanitized "j (ValidationException): Unknown error", no AWS internals leaked |
| fetch_logs write on success | Row written from `finally` block: `status=success`, all token/latency fields populated |
| fetch_logs write on error | Row written: `status=error`, `error_message` sanitized, `model` column preserved attempted bogus value for audit |
| Dashboard rendering | All 3 pages (Books, Fetch Logs, API Keys) verified visually with populated data; subscriber-scoping honored |
| Recovery from deliberate break | Post-revert curl returned clean SSE stream (latency 6856ms, 899 input / 385 output tokens); confirmed by fresh-query cache miss |

## How it was built

A step-gated approach with explicit decision logs and follow-up tracking, executed across 8 steps:

- **Step 1**: NextAuth + Google OAuth.
- **Step 2**: Bedrock SDK + IAM scoping to EC2 instance role.
- **Step 3**: Schema additions for inline content + fetch_logs (4 migrations through Step 4).
- **Step 4**: API key issuance, auth helper, dashboard UI for keys.
- **Step 5**: Agent fetch endpoint with sanitization layer; Test 11 deferred to post-Step-7.
- **Step 6**: Dashboard metrics + fetch logs view (server-component-only, no API routes).
- **Step 7**: Book import CLI script with idempotency + slugify + auto-publisher-create.
- **Step 8**: End-to-end verification (5 sub-tasks: seed import, first Bedrock call, EXPLAIN ANALYZE, dashboard walkthrough, Test 11).

Through Step 7 the work was Codex-driven: prompt-pre-gather, implementation, STOP-gate, push-on-approval. Step 8 shifted to direct-by-Animesh execution via SSH-on-EC2 + WSL-curl-from-laptop. Both patterns produced verified outcomes.

## Decision log summary (D1.1 — D7.20)

The full log lives in `docs/phase-2-decisions.md`. Highlights worth carrying into Phase 3 thinking:

- **D5.11 / #32**: Per-book authorization deliberately deferred. Currently any authenticated subscriber can fetch any book. Acceptable at one-publisher-one-subscriber Phase 2 scale; **must resolve before external onboarding**.
- **D6.8 / #39**: Dashboard chose option (c) — single-tenant simplified view. Books table unscoped (all books in the system); fetch logs scoped to current user's subscriber. Punt on multi-tenant role model; revisit in Phase 3.
- **D3.3 + D5.8 + D7.19**: Sanitization layer at `lib/agent/sanitize.ts` exports `sanitizeError()`. Verified end-to-end via Test 11. Static evidence (grep), helper-only runtime evidence (synthetic Bedrock errors), and route-integration evidence (real bogus-model-id) all clean.
- **D7.x series**: Step 7 import-book script auto-creates publishers (D7.9), idempotency enforced via runtime SHA-256 against latest stored version content (D7.10, no hash column stored), `inline://<uuid>` content_uri sentinel honored across all 5 imports.
- **D7.20**: Test 11 surfaced two non-blocking observations (#53 minified class names in sanitized errors; #54 categorizable errors collapsing to generic "Unknown error") — Phase 3 polish.

## Follow-ups status (#1 — #55)

Resolved during Phase 2: #9, #10, #11, #33.

Open and worth attention before external onboarding (Phase 3 scope items):

- **#32** — per-book subscriber authorization model.
- **#39** — split publisher vs subscriber dashboards.
- **#40** — verify Google OAuth client consent screen Internal vs External; allowlist if External. Escalated by 3rd subscriber row appearing during Step 8 (`animesh@2tmorrow.com`); confirms auto-create-on-OAuth flow is open to any Google identity.
- **#45** — `book_versions.content_uri` (S3 design) vs `content` (inline) transitional schema state. Inline is source of truth; S3 migration deferred.
- **#46** — `import-book.ts` should auto-load `.env` via dotenv or `node --env-file`; currently requires `set -a; source .env` workaround.
- **#47** — `docs/operations.md` should document env-source prerequisite and Prisma `DATABASE_URL` vs psql URL-format mismatch.
- **#48** — `import-book.ts` reports `id=<uuid>` ambiguously; the value is `book_version.id`, not `book.id`. Operators using this for API calls hit "Book not found".
- **#49** — Add `ANALYZE books; ANALYZE book_versions; ANALYZE fetch_logs;` to import-book as `--analyze` flag or document as recommended post-bulk-import step.
- **#50** — 3rd subscriber row (`animesh@2tmorrow.com`) appeared during Step 8. Behavior is correct (OAuth auto-creates); reconcile with #40.
- **#51** — Dashboard left-nav contains "Usage Metrics", "Team Access", "Billing" not described in Phase 2 scope. Verify placeholder vs broken UI; hide or remove if not Phase 3 imminent.
- **#52** — `MODEL_ID` is hardcoded in `route.ts` line 17. Promote to env var. Phase 3 cleanup.
- **#53** — Sanitized errors retain minified class identifier (`j` from production bundle). Cosmetic.
- **#54** — Sanitizer collapses categorizable errors (ValidationException) to generic "Unknown error". Design trade-off — review.
- **#55** — Agent fetch route's HTTP status doesn't match its apparent intent (route returned 200 in Test 11 despite source saying 502). Investigate the source-vs-runtime mismatch before deciding whether to keep 200-everywhere or fix to non-2xx.

## Operational baselines captured

- **Schema**: 4 migrations, 10 tables. `book_versions.content` populated (inline). `fetch_logs` exercised across success/error paths.
- **Query plans**: `getBooksWithMetrics` baseline at 5 books / 5 versions / 1 fetch_log: triple Seq Scan + Hash Right Joins + Sort + GroupAggregate, 0.281ms execution post-ANALYZE. `getRecentFetchLogs` baseline: Seq Scan + Filter (composite index `fetch_logs_subscriber_id_created_at_idx` dormant at this row count; will activate at scale). Re-capture at 100+ fetch_logs to verify index path.
- **Statistics discipline**: Run `ANALYZE` after bulk imports; autovacuum handles incremental. (#49 formalizes this.)
- **Deploy budgets at close**: Step 5 at 3/3 (Test 11 exhausted). Step 6 at 0–1/3. Step 7 at 2/3 (tsx prune fix-up commit). Subsequent Phase 2 work was within budget.

## What was deferred to Phase 3

These came up mid-Phase-2 and were explicitly punted; carrying them forward verbatim:

1. Marketplace UI — book/skill cards with prices, browse before purchase.
2. Stripe sandbox — payment intent flow, customer/subscription model.
3. Admin upload dashboard — replaces CLI import script for non-engineering publishers.
4. Per-book auth — promotes #32 from follow-up to Phase 3 scope item.
5. Pricing model — per-book? per-subscription? per-fetch? **OPEN.**
6. Admin role design — separate users column vs `admin_users` table vs auth provider integration. **OPEN.**

These compound badly if started without answering the open questions. Phase 3 should start with a scope doc that enumerates dependencies and answers role/pricing/Stripe-tenant questions before any code.

## Operational patterns established

- **Pre-gather pass before every patch.** Each step started with a read-only gather prompt confirming schema state and surfacing unexpected findings. Caught real issues every step (pgcrypto extension; existing columns; missing join tables; subscriber row anomalies; schema mismatches between prompt and reality).
- **STOP gates before push.** Codex implements + verifies + reports, then waits for approval. Catches issues before prod.
- **Deploy budgets per step.** 3-deploy budget per step (initial + 2 reserves). Forces deliberate spending.
- **Decision log + follow-up discipline.** Every step appends explicit decisions and surfaces follow-ups. Prevents "why did we do it this way" compounding later.
- **Prompt-style for Codex**: frontload context-gathering, lock decisions explicitly, forbid scope creep, verification matrix, STOP gate, code-review-grep targets where invariants matter.

## Sign-off criteria

Phase 2 closes with:
- ✅ Application deployed and serving traffic at `bkstr.tmrwgroup.ai`.
- ✅ All 8 steps closed with evidence in decision log.
- ✅ Test 11 sanitization verified end-to-end.
- ✅ Recovery verified post-deliberate-break.
- ✅ Seed corpus loaded and queryable.
- ✅ Dashboard rendering correctly with populated data.
- ⚠️ External-subscriber walkthrough (Zach + Edward) NOT yet executed; deferred to follow-on internal-alpha session.

---

## Recommended next actions (in order)

1. **Internal-alpha walkthrough with Zach + Edward.** They each issue keys, run curls from their own machines, walk dashboard pages. Their first impression should be a working system, not the test branch. Capture friction points as new follow-ups.
2. **Address #40 + #50 (OAuth scope verification).** Before any external invitation, confirm Internal vs External and gate accordingly.
3. **Phase 3 scope doc.** Don't start Phase 3 code until role/pricing/Stripe-tenant questions are answered. The doc should also fold in #32, #39, #45, and #52 as scope items rather than follow-ups.
4. **Re-capture EXPLAIN ANALYZE at scale.** When fetch_logs grows past ~100 rows from real use, re-run the two dashboard query plans to verify index activation.
