# bkstr.tmrwgroup.ai — Phase 4 Decision Log

Decisions made during Phase 4 marketplace work (D11.x slot). Phase 3 history lives in [`phase-3-decisions.md`](./phase-3-decisions.md); Phase 2 in [`phase-2-decisions.md`](./phase-2-decisions.md). Both are left intact — Phase 4 entries are additive, never overwriting.

Phase 4 ships across four parallel streams (D → A → {B, C} per CC-1 in the Phase 4 design doc). This log opens with Stream D's load-bearing decisions; Streams A, B, C add their own D11.x entries in their own commits.

---

## D11 — Phase 4 cross-cutting decisions (Stream D — open signup)

### D11.5 — Pre-stage `/etc/bkstr/roles.env` BEFORE Stream D deploys

**Choice:** the operator stages `/etc/bkstr/roles.env` on EC2 (mode 600 root, per the D9.4 per-service env-file convention) populated with `ADMIN_EMAILS=animesh@2tmorrow.com` and `PUBLISHER_EMAILS=edward@tmrwgroup.ai,zach@tmrwgroup.ai` **before** the CodePipeline that deploys Stream D's auth-callback changes fires. The file is read by `scripts/start.sh` at process start and propagated to the running app via `pm2 reload --update-env`. Stream D's code-side responsibility is the matching `[ -f /etc/bkstr/roles.env ] && source …` block plus the WARN-on-missing line; the operator's responsibility is the file itself. (Operator confirmed pre-dispatch: file already exists on EC2 with the addresses above.)

The deploy sequence is therefore: (1) operator stages roles.env; (2) Stream D's PR lands on `main` and CodePipeline builds; (3) `start.sh` sources roles.env into the running shell; (4) `pm2 reload --update-env` propagates the env vars to the Next.js process; (5) on the next signin event the role-sync hook reads ADMIN_EMAILS / PUBLISHER_EMAILS and applies promotions per D11.11's monotonic-upward semantics.

**Reasoning:** the single most dangerous deploy-ordering bug in Phase 4 is the ADMIN auto-demotion regression. If Stream D's code ships before `roles.env` is staged, every signin sees empty `ADMIN_EMAILS`. D11.11's monotonic-upward semantics protect against this — env absence is a no-op, not a demotion — but staging the file ahead of time gives a second layer of defence (the env var is *also* populated, not just safely-empty). Alternatives rejected: (a) "stage roles.env on the first Stream D deploy itself" — race conditions between rsync, env-source, and pm2 reload mean a signin during the deploy window could land on a state where the env file exists on disk but hasn't been sourced into the running process yet; (b) "demotion-permitting env semantics" (treat unset env as 'demote everyone') — makes a stalled deploy or a missing-file mistake catastrophic instead of cosmetic. D11.11 takes care of (b); D11.5 takes care of (a) by removing the race entirely.

**Supersedes:** D8.1–D8.4 (Phase 2 OAuth allowlist; closed by open signup). Phase 2's `/etc/bkstr/oauth.env` retains `GOOGLE_CLIENT_*` and `NEXTAUTH_SECRET`; the `ALLOWED_EMAIL_DOMAINS` / `ALLOWED_EMAILS` keys it used to hold are deleted from the file as part of operator cleanup (no code reads them anymore as of this patch).

---

### D11.6 — Role-grant env lives in its own file: `/etc/bkstr/roles.env` (not folded into `oauth.env`)

**Choice:** `ADMIN_EMAILS` and `PUBLISHER_EMAILS` ship in a new `/etc/bkstr/roles.env` file rather than being added to the existing `/etc/bkstr/oauth.env`. `scripts/start.sh` gains a new `[ -f /etc/bkstr/roles.env ] && source …` block placed above the `# Phase 3 D9.4: per-service env files; add new ones above this comment` marker per D10.3 (preserves the chronological "newest service closest to the marker" ordering). The WARN-on-missing line mirrors the existing aws.env / oauth.env / stripe.env shape: `[start.sh] WARN: /etc/bkstr/roles.env not present — role auto-promotion disabled; existing roles preserved.` `.env.example` carries the matching section under its own header referencing D9.4 / D10.3 / D11.5 / D11.11.

**Reasoning:** D9.4 locked the per-service env-file convention ("one file per concern, so independent rotations don't cross-contaminate"). Role-grant rotation is operationally distinct from OAuth-secret rotation — adding a new publisher email is a routine permission-management edit; rotating the Google OAuth client secret is a credentials-leak response. Mixing them in `oauth.env` means every permission edit re-touches a file that holds secrets, broadening the blast radius of a fat-finger. Mixing them also obscures the operator-mental-model: `oauth.env` is for talking to Google; `roles.env` is for who can do what inside bkstr. Alternatives rejected: (a) reuse `oauth.env` — the old allowlist (D8.x) lived there, so the new role-grant lists are a natural inheritor; rejected on consistency, because D9.4's whole point is to break up monolithic env files and reusing `oauth.env` re-monolithizes a growing surface; (b) put the keys in `.env.local` (Next.js convention) — rejected because production env management is per-service-file per D9.4, not `.env.local`.

The naming wart — "roles" is a code-concept (the `Role` enum) not a service-concept (Stripe, AWS, OAuth) — is acknowledged. D10.3 is general enough to cover it; the convention is "one file per concern" and role-grant management qualifies as a distinct concern.

**Supersedes:** the unused `ALLOWED_*` keys in `oauth.env` (D8.3). Operator should remove them from `/etc/bkstr/oauth.env` as a cleanup-step alongside this deploy; nothing reads them anymore.

---

### D11.11 — Monotonic-upward role promotion; env absence is a no-op; demotion only via explicit ADMIN SQL

**Choice:** the role-sync hook in `src/lib/auth/index.ts` (`syncRoleFromEnv`, called from `events.signIn` and `events.createUser`) enforces a hard safety invariant:

1. **Env presence promotes.** A user whose email appears in `ADMIN_EMAILS` gets `users.role = ADMIN` on signin; an email in `PUBLISHER_EMAILS` (and not in `ADMIN_EMAILS`) gets `PUBLISHER`.
2. **Env absence is a no-op.** An unset or empty `ADMIN_EMAILS` does **not** demote existing ADMINs; an unset or empty `PUBLISHER_EMAILS` does **not** demote existing PUBLISHERs. The user keeps whatever `role` the DB row carries.
3. **Email-not-in-env-but-env-set is also a no-op.** Removing `edward@…` from `PUBLISHER_EMAILS` does not demote Edward. Demotion is operator-explicit only — `UPDATE users SET role='SUBSCRIBER' WHERE email='…'` via psql.
4. **The check runs on every signin** (NextAuth `events.signIn` for returning users, `events.createUser` for first signin), not just first signin. Operators who add an email to `PUBLISHER_EMAILS` after the target user has already signed in get the promotion applied on the user's next visit, no manual SQL required.
5. **Precedence: ADMIN beats PUBLISHER.** If a single email appears in both lists, ADMIN wins. ADMIN is strictly higher than PUBLISHER in privilege.
6. **The effective new role is `max(currentRole, envDerivedRole)` by privilege rank.** The hook never lowers a role.

The invariant is documented inline in `src/lib/auth/index.ts` as a multi-line comment block above `syncRoleFromEnv`. The comment explicitly tells future contributors not to weaken the property without a matching D-numbered decision entry.

**Reasoning:** the failure modes this prevents are operator-error class regressions, ranked by severity:

- **The catastrophic one — ADMIN auto-demotion.** If `ADMIN_EMAILS` is unset (fresh box, deleted file, typo in `start.sh`'s source line) and the hook treats "unset = demote everyone," then the next signin demotes the operator to SUBSCRIBER and locks them out of pricing / moderation surfaces. Recovery requires DB-direct SQL, which the demoted operator may no longer have credentials for. D11.5's pre-staging is one safeguard; D11.11's no-op-on-empty is the second, independent safeguard.
- **The silent-revert one.** An operator removes `edward@tmrwgroup.ai` from `PUBLISHER_EMAILS` intending to revoke Edward's publishing rights. Under demote-on-removal semantics, Edward's role flips to SUBSCRIBER on his next signin and his books no longer surface in his Active Books — *but his existing books and grants remain*. The PUBLISHER attribution gap (Edward's books are still attributed to him in `book.publisher_user_id` but he can no longer manage them) is a worse end state than "you have to also run the SQL UPDATE." Forcing the demotion to be explicit ensures the operator considers the publisher-attribution implications.
- **The race condition one.** Under "every signin re-syncs from env" semantics with demotion-on-removal, a brief window during a `pm2 reload` where env vars are unset (between the old process exiting and the new process reading the env) could trigger a wave of demotions if any signin lands in that window. The no-op-on-empty rule means even a partially-loaded env state can't cause harm.

Alternatives rejected:

- **(a) Demotion via env removal (the obvious symmetric design).** Rejected for the three failure modes above. The asymmetry (env-as-promotion-source, SQL-as-demotion-path) is the load-bearing safety property; symmetry was the rejected design.
- **(b) First-signin-only via `events.createUser`.** Rejected because env-list changes don't retroactively apply; promotion would require manual SQL whenever a new publisher is added. Defeats the operator-workflow ergonomics of "edit `/etc/bkstr/roles.env` → `pm2 reload` → user gets promoted on next signin."
- **(c) Periodic full-table re-sync on a cron.** Rejected as out-of-scope and a new failure surface (cron drift, what happens during a deploy mid-sync, etc.). Per-signin re-sync is the minimum surface that meets the operator-workflow requirement.

**Supersedes:** D8.1–D8.4 (Phase 2 OAuth allowlist) and the migration-SQL ADMIN promotion in `20260510130000_phase_3_role_enum/migration.sql:9` (which now becomes a one-shot historical UPDATE; future ADMIN identities go through `/etc/bkstr/roles.env` rather than hand-written SQL).

---

## D11 — Phase 4 cross-cutting decisions (Stream A — schema + roles)

### D11.1 — Stream ordering: D → A → {B, C}

**Choice:** Stream D (open signup) ships first, A (schema + role-attribution backfill) second, B (publisher UI) and C (book library + content access) parallel after A. The bkstr operator dispatches streams in this order; the design doc's CC-1 sets the rationale; A's PR description must call out Edward's signin-required precondition for the backfill.

**Reasoning:** Stream A's migration backfills `book.publisher_user_id` with Edward's `users.id`. That ID only exists if Edward has signed in. Pre-D, the fail-closed OAuth allowlist would have rejected him at sign-in even if the row could otherwise be created; D removes the allowlist, so Edward can sign in, which then creates the row A's backfill needs to reference. Streams B and C both depend on A's `publisher_user_id` column + the unified migration; they have no mutual dependency, so they run concurrently. Alternatives rejected: (a) A first with raw-SQL placeholder `users` rows for Edward + Zach + NextAuth adapter dedup on email — adds a placeholder-row pattern with no test coverage and the dedupe-on-email behavior is documented but unverified here; (b) A first with `publisher_user_id` nullable + a later flip-to-NOT-NULL migration — two close-together migrations on the same table without operational benefit at 5-row corpus scale. D11.2's unified migration shape is cleaner.

**Cross-references:** [D11.5](#d115--pre-stage-etcbkstrrolesenv-before-stream-d-deploys) (deploy-ordering for Stream D), [#68](./follow-ups.md#68-tighten-bookpublisher_user_id-to-not-null-after-phase-4-backfill-completes) (post-backfill NOT NULL tightening — Phase 4.5 work).

---

### D11.2 — One unified Stream A migration; two files only because Postgres enum + DML constraint forces it

**Choice:** Stream A ships ALL Phase 4 schema changes (B's `book.description` column, A's `book.publisher_user_id` FK, C's `fetch_logs.source` + `fetch_logs.api_key_id` nullable reshape, and the `GrantSource.PUBLISHER_OWN` enum value) under ONE Stream A migration logically. The on-disk layout is TWO migration files (`20260511120000_phase_4_schema_part_1` + `20260511120100_phase_4_schema_part_2_backfill`) because Postgres ≥12 allows `ALTER TYPE … ADD VALUE` inside a transaction but the new value CANNOT be referenced in the same transaction. Prisma's `migrate deploy` wraps each migration file in one transaction. Part 1 adds the enum value + columns + FK + index + nullability change; Part 2 runs the conditional `DO $$ … $$` backfill that INSERTs access_grants rows with `source = 'PUBLISHER_OWN'`. Streams B and C do NOT open their own migrations.

**Reasoning:** Two close-together migrations on `books` (A's FK + B's description) and on `fetch_logs` (C's source + nullability) create unnecessary deploy-sequencing complexity. A single Stream A patch lets the operator run `prisma migrate deploy` once during the Stream A deploy window; Streams B + C inherit a clean schema precondition. The two-file split on the enum-value side is a Postgres mechanics fact, not an architectural choice — both files belong to Stream A's PR. Alternatives rejected: (a) three separate migrations (A's FK, B's description, C's fetch_logs) — triples deploy-window complexity and each migration would need its own rollback story; (b) keep one file and rely on Prisma's autocommit-per-statement on this stack — Prisma 7's `migrate deploy` is explicit-transaction by default and there is no flag to disable it per-statement; verified by the two-file Phase 3 migration precedent (`20260510130000_phase_3_role_enum` + `20260510150000_phase_3_access_grants`).

**Cross-references:** [D11.3](#d113--publisher_own-grant-source-+-auto-grant-at-fk-assignment-time) (the enum value), Phase 4 design doc §3 (full unified-migration SQL preview), [R1 in §9](#) (rollback notes — inline as SQL comments at top of each migration file).

---

### D11.3 — PUBLISHER_OWN grant source + auto-grant at FK assignment time

**Choice:** Add `GrantSource.PUBLISHER_OWN` as a new enum value. When `book.publisher_user_id` is set (Part 2 backfill of existing books, or Stream B's new-book POST), automatically insert a row into `access_grants` with `source = 'PUBLISHER_OWN'` linking the publisher's Subscriber → Book. Authorization stays uniform: every read path (Stream C's View + Download, future `agent/fetch` under `ENFORCE_BOOK_ACCESS`) goes through the same `access_grants` lookup, no role-bypass branch.

**Reasoning:** The project's stated authorization direction (D9.6 / D10.2) is "any active `access_grants` row → allow read." A route-level role-bypass (`if role === 'PUBLISHER' && book.publisherUserId === user.id`) forks the model, makes the future `ENFORCE_BOOK_ACCESS` flag harder to reason about, and creates three diverging branches in `view`, `download`, and `agent/fetch`. A grant row keeps every read uniform and audit-trace clean. A new enum value (PUBLISHER_OWN) is cleaner than overloading SEED (which is grandfathered-subscriber semantics per D9.6 and [#65](./follow-ups.md#65-d96-seed-backfill-operates-on-subscribers-table-not-usersrolesubscriber)'s ambiguity flag). Closing #65 in this phase by reserving SEED for the subscribers-table grandfathering and using PUBLISHER_OWN for publishers' own books is a clean boundary.

**Mechanics note:** Postgres ≥12 allows `ALTER TYPE … ADD VALUE` inside a transaction BUT the new value cannot be referenced in the same transaction (the value isn't visible to other statements until commit). Prisma's `migrate deploy` wraps each migration file in a transaction. If both the `ADD VALUE` and a backfill `INSERT … source = 'PUBLISHER_OWN'` lived in one file, the INSERT would fail with `invalid input value for enum "GrantSource": "PUBLISHER_OWN"`. The defensive shape: split the migration into TWO files (`part_1` schema + ADD VALUE, `part_2` backfill referencing the now-committed value). Pick (a) two files over (b) one-file-trust-autocommit because Prisma 7 has no autocommit-per-statement flag and the two-file shape is independently verifiable. Documented in Part 1's SQL header comment.

**Alternatives rejected:** (a) route-level role bypass, no grant row — forks authorization model, three places to touch, complicates future ENFORCE_BOOK_ACCESS rollout; (b) reuse `GrantSource.SEED` for publisher rows — overloads SEED's grandfathered-subscriber meaning and aggravates [#65](./follow-ups.md#65-d96-seed-backfill-operates-on-subscribers-table-not-usersrolesubscriber)'s analysis cost; (c) no automatic access (publisher buys their own book to read it) — friction-y and operationally absurd.

**Cross-references:** [D11.2](#d112--one-unified-stream-a-migration-two-files-only-because-postgres-enum--dml-constraint-forces-it) (why two files); [#65](./follow-ups.md#65-d96-seed-backfill-operates-on-subscribers-table-not-usersrolesubscriber) (SEED ambiguity, now eased by PUBLISHER_OWN providing a clean cousin); Phase 4 design doc CC-3.

---

### D11.4 — Shared `requireBookAccess` helper at `src/lib/books/access.ts` (Stream C implements; logged here for visibility)

**Choice:** Stream C creates a new helper module `src/lib/books/access.ts` exporting `requireBookAccess(subscriberId, bookId)` + `BookAccessDeniedError`. Three consumers will share it: Stream C's `view/route.ts`, Stream C's `download/route.ts`, and the deferred Stream 1 patch 2 (`/api/agent/fetch` under `ENFORCE_BOOK_ACCESS` flag per D9.6).

**Reasoning:** Stream C is already writing three near-identical access checks (View, Download, plus the `accessGrants` filter in `getBookAccessStates`). Extracting a single helper removes a known duplication target and gives Stream 1 patch 2 a near-zero implementation cost when it finally ships. The helper's "active grant" predicate (`revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > NOW())`) mirrors `getBookAccessStates` and `checkout/route.ts:72-80`, keeping every authorization read consistent. PUBLISHER_OWN (D11.3) is just another active grant — the helper does NOT switch on `source`; the role + publisher_user_id question is moot inside the helper. Stream A logs this decision so reviewers of Streams B/C/the eventual Stream 1 patch see the seam was intended from Phase 4 design time.

**Cross-references:** Phase 4 design doc CC-4; [D11.3](#d113--publisher_own-grant-source-+-auto-grant-at-fk-assignment-time) (PUBLISHER_OWN is consumed transparently by the helper); Phase 4 design doc §10 step 11 (Stream 1 patch 2 — `ENFORCE_BOOK_ACCESS` rollout — Phase 5+ work).

---

### D11.7 — Stream B's new-book POST: Stripe-first + manual reconcile (logged here for visibility)

**Choice:** Stream B's `/api/books` POST executes Stripe Product+Price creation BEFORE the local `prisma.$transaction([Book, BookVersion, BookPrice, AccessGrant])`. The `book_id` UUID is generated client-side via `randomUUID()` so `metadata.book_id` in the Stripe Product can match the Book row PK without a chicken-and-egg. Failure modes: Stripe Product+Price succeed → local TX fails → orphan Stripe Product+Price referencing a book_id that doesn't exist locally; operator retry's metadata search finds the Product and adds another Price (D9.7 idempotency pattern).

**Reasoning:** Stripe-first ordering preserves the invariant "local Book row always has a working stripePriceId." The inverse ordering (DB-first) would leave Book rows in the for-sale-but-broken state at `src/app/api/checkout/route.ts:61-66` (returns 503 to buyers). An orphan Stripe Product with no local Book is invisible to buyers (nothing references it). An orphan local Book with no Stripe Price is buyer-facing failure. Alternatives rejected: saga pattern (compensating `Stripe.products.delete`) — Stripe Prices are not deletable; Products only when no active Prices; compensation is fragile. Outbox table + async worker — net-new infrastructure for Phase 4; manual reconcile at expected publisher-write volume (Edward + Zach, ~10 books/month) is fine. Stream A logs this for cross-stream review visibility; Stream B owns the implementation.

**Cross-references:** Phase 4 design doc CC-9 (the same shape, longer rationale); D9.7 (Stripe Prices are immutable; old prices stay as audit trail); R3 in the design doc §9 (orphan reconciliation).

---

### D11.8 — Stream B's content storage target: inline only (logged here for visibility)

**Choice:** Stream B's `/api/books` POST writes `BookVersion.content` inline (TEXT column), `contentUri = "inline://<versionId>"`. No direct-to-S3 write path. Mirrors `scripts/import-book.ts` exactly.

**Reasoning:** Inline writes preserve the dual-storage seam at `src/lib/storage/book-content.ts` — reads resolve correctly regardless of inline vs s3-prefix. The eventual inline → S3 sweep job (follow-up [#63](./follow-ups.md#63-scale-stream-2-sweep-2-spot-check-sample-size-with-corpus-growth)'s neighbour, the actual sweep) picks up Phase 4 publisher writes identically to the existing 5 books. Alternative rejected: direct-to-S3 write on new-book creation — introduces the first S3 *write* path in the codebase (current code only reads); couples publisher UI to S3 availability and `BKSTR_CONTENT_BUCKET` env staging. Reconsider if Edward/Zach upload books > ~500KB (current corpus is ~10KB markdown).

**Cross-references:** Phase 4 design doc CC-8; D9.2 (dual-storage seam); D9.4 (per-service env files — would need `aws.env` for direct-S3-writes).

---

### D11.9 — Stream C's download rate-limit window: fixed UTC day (logged here for visibility)

**Choice:** Stream C's download rate limit (5/day/book/subscriber per [#66](./follow-ups.md#66-buyer-facing-content-access-in-dashboard-view--download-surfaces)) counts downloads since 00:00 UTC of the current day. On 429, the `Retry-After` header carries seconds until 00:00 UTC tomorrow. Stream A's migration ships the `fetch_logs.source` column that the count query filters on (`source = 'dashboard_download'`); the existing `(subscriber_id, created_at DESC)` index covers the read path adequately at 5-rows-per-subscriber-per-day scale.

**Reasoning:** Matches #66's revised cap (10 → 5) and fixed-UTC-day boundary explicitly. The `Retry-After` value is cheap to compute and stable to communicate. A rolling-24h-sliding window is strictly more accurate but the Retry-After becomes a per-second-decreasing timestamp that's harder for a buyer to reason about. Alternative rejected: rolling 24h window — minor accuracy gain at 5/day cap, with worse communication cost. Worth revisiting only if buyers complain about edge-of-window edge cases. Stream A logs this for visibility; Stream C owns the implementation.

**Cross-references:** Phase 4 design doc CC-7; [#66](./follow-ups.md#66-buyer-facing-content-access-in-dashboard-view--download-surfaces); D11.13 (the column that makes the count query indexable).

---

### D11.10 — `book.description` AND `book.publisher_user_id` BOTH ship NULLABLE; pair-tighten later per #68

**Choice:** Both new columns on `books` land NULL-able:
- `description TEXT NULL` — existing 5 books backfill as NULL; Stream B's new-book form writes a value for new rows.
- `publisher_user_id UUID NULL` — FK to `users.id`, ON DELETE SET NULL, indexed. Part 2's conditional backfill UPDATEs to Edward's id if Edward exists today; otherwise the column stays NULL until operator re-runs the DO block per `docs/operations.md`.

NOT the Phase 4 design doc's CC-10 original proposal of `TEXT NOT NULL DEFAULT ''`. The user overrode that during stakeholder review.

**Reasoning:** Pair-rationale — both columns ship nullable for staged authoring. At deploy time the data is incomplete (Edward + Zach have not signed in yet — verified 2026-05-11; no operator has written prose descriptions yet either). A NOT NULL + sentinel-default ('' for text, "no publisher" placeholder UUID for FK) buys nothing in the read path: every consumer either filters on the field or `?? ""`s it. Nullable + explicit-NULL is honest about the staged state. Tighten in lockstep with [#68](./follow-ups.md#68-tighten-bookpublisher_user_id-to-not-null-after-phase-4-backfill-completes) once Edward + Zach have signed in, the DO block has been re-run, and the invariant becomes "every book has both a description and a publisher_user_id". The tightening is a one-line follow-up migration on each column. Alternatives rejected: `TEXT NOT NULL DEFAULT ''` — adds noise to the read paths (`description !== ""` becomes a presence check that empty-string-as-absent muddles); `UUID NOT NULL DEFAULT '<sentinel>'` — requires inventing a sentinel publisher User, which would be operator-visible noise in `users`.

**Cross-references:** Phase 4 design doc CC-10 (the original NOT NULL DEFAULT '' proposal — overridden by stakeholder); [#68](./follow-ups.md#68-tighten-bookpublisher_user_id-to-not-null-after-phase-4-backfill-completes) (publisher_user_id NOT NULL tightening); Phase 4.5 runbook entry in `docs/operations.md` (manual re-run of the DO block once Edward signs in).

---

### D11.12 — `fetch_logs.api_key_id` becomes NULL-able for Stream C dashboard surfaces

**Choice:** Drop the NOT NULL constraint on `fetch_logs.api_key_id`. Stream C's View and Download routes run with a session cookie, no API key in play; they write fetch_logs rows with `apiKeyId = NULL`. Existing `/api/agent/fetch` rows continue to carry a non-null `apiKeyId` because the route is API-key-authenticated.

**Reasoning:** Stream C's content-egress paths are session-authenticated, not API-key-authenticated — the buyer is logged in via NextAuth, not presenting a `Bearer bks_…` header. Forcing a sentinel "dashboard" API key per subscriber was rejected as polluting `subscriber_api_keys`. Making the column nullable is the cheap honest move. The fetch-logs dashboard view at `src/lib/dashboard/queries.ts:101-137` does not currently filter on `api_key_id` so the nullability change is invisible to existing readers. Prisma schema marks the relation `SubscriberApiKey?`; the `onDelete: Restrict` survives unchanged (a null FK can't be the target of a delete restriction).

**Cross-references:** Phase 4 design doc CC-2; Stream C's `requireBookAccess` flow (D11.4); D9.5 (API-key auth shape — unchanged).

---

### D11.13 — `fetch_logs.source` as VARCHAR(32) NOT NULL DEFAULT 'agent_fetch'; not a Postgres enum

**Choice:** Add `source VARCHAR(32) NOT NULL DEFAULT 'agent_fetch'` to `fetch_logs`. The DEFAULT backfills every existing row in one statement. Values the app writes: `'agent_fetch'` (existing — the /api/agent/fetch handler; relies on the column default for now, optionally one-line edit to write explicitly), `'dashboard_view'` and `'dashboard_download'` (Stream C will write these from the new View and Download routes). No CHECK constraint; no Postgres enum. App-side discipline (Stream C's route handlers carry the literal strings) is the validation.

**Reasoning:** Mirrors the `webhook_events.source` precedent established at D9.3 (`prisma/migrations/20260510140000_phase_3_webhook_events`): free-text VARCHAR(32), not a Postgres enum, because the value-set is expected to grow (Stream C may add more dashboard sources later; future MCP server consumers may add others). VARCHAR allows additive value adds without a migration — the same friction-cost trade D9.3 took. Stream C's rate-limit count query (`source = 'dashboard_download'`) filters on this column; the existing `(subscriber_id, created_at DESC)` index is adequate at 5-rows-per-subscriber-per-day scale. A dedicated `(subscriber_id, source, created_at DESC)` composite index was considered (would tighten Stream C's rate-limit count) but rejected for Phase 4 — the rate cap is low enough that seq-scan-on-filter fallback is cheap. Stream C may add the composite index in its own migration if hot-path scans appear.

**Alternative rejected:** Postgres enum `FetchLogSource AS ENUM('agent_fetch','dashboard_view','dashboard_download')` — same friction as D9.3 rejected for `webhook_events.source`, and Postgres enums require a migration to add values (the very thing this column is shaped to avoid).

**Cross-references:** Phase 4 design doc CC-2 (the column is part of the unified Stream A migration); D9.3 (the precedent shape); [#20](./follow-ups.md) (eventual enum-ization of `fetch_logs.status` — `source` follows the same posture).

---

*Last updated: 2026-05-11. Stream A — schema + roles. Streams B and C will add their own D11.x entries (D11.7+, D11.9+ may grow with stream-specific implementation decisions beyond the Stream A pre-log) in their own commits.*
