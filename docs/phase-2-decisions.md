# bkstr.tmrwgroup.ai — Phase 2 Decision Log

Decisions made during Phase 2 product work. Every flagged decision in `bkstr-phase-2-kickoff-prompt.md` and each step's prompt gets a paragraph here with reasoning, even when the answer is "took the recommended option." Future work will reference this when revisiting trade-offs.

---

## Step 1 — Real auth foundation (NextAuth)

### D1.1 — Auth provider mix: Google OAuth only (deferred Email magic-link)

**Choice:** Google OAuth as the sole sign-in provider for Phase 2. Email magic-link deferred to a Phase 2 follow-up.

**Reasoning:** The internal-alpha audience is `@2tmorrow.com` Google Workspace accounts (Animesh, Zach, Edward, James). Magic-link via SES requires (a) sender verification on `tmrwgroup.ai`, (b) SPF/DKIM/DMARC DNS records on the Route 53 zone, (c) IAM policy on `bkstr-ec2-role`, (d) deliverability testing to avoid spam-folder routing — all of which exceed the 30-minute scope guard in the kickoff prompt. The kickoff explicitly authorized this deferral. We keep the `VerificationToken` model in the schema so a future PR enabling magic-link doesn't need a migration, only an env var (`EMAIL_SERVER`) + the `EmailProvider` registration.

**Why not Credentials (email + password):** the kickoff explicitly excluded it. Adds bcrypt + reset-token flow + UI surface for zero current users.

### D1.2 — Session strategy: Database sessions

**Choice:** Database-backed sessions via NextAuth's `Session` table.

**Reasoning:** Took the recommended option. Internal-alpha needs revocable, listable, auditable sessions — JWT sessions are unrecoverable once issued. The Prisma adapter handles session storage with no custom code, and the cost is one DB read per authenticated request (acceptable at Phase 2 scale).

### D1.3 — User ↔ Subscriber relationship: separate entities, FK on Subscriber, 1:1 in Phase 2

**Choice:** `subscribers.user_id` (nullable, unique) → `users.id` with `onDelete: SetNull`. Auto-create matching Subscriber on first sign-in via NextAuth's `signIn` callback.

**Reasoning:** Took the recommended option. `User = identity` and `Subscriber = billing/quota entity` are conceptually distinct even though they map 1:1 today. The unique constraint enforces 1:1 in Phase 2; future phases relax it for "consultant working with two companies" or "team members sharing a Subscriber" by removing the unique. Nullable `user_id` lets pre-existing Subscriber rows (Phase 1 has none, but seed-script Subscribers in Phase 2 might) survive the migration without backfill. `SetNull` on User delete preserves Subscriber audit history rather than cascading away usage data when a User leaves.

**Auto-create at signIn (no "set up your workspace" interstitial):** chose frictionless signup. `companyName` defaults to `User.name?.trim() || "Personal"` — placeholder until a Phase 3 settings page lets users edit it. Trade-off: less accurate `companyName` data day-one, more accurate user funnel.

**Idempotency:** the `signIn` callback uses `prisma.subscriber.upsert({ where: { userId } })`, so re-firing on every subsequent sign-in is a no-op `update: {}`. Avoids the failure mode #5 in the kickoff (callback firing twice creating duplicate Subscriber rows).

### D1.4 — NextAuth version: v4.24.14 (stable), not v5 (still in beta)

**Choice:** `next-auth@4.24.14` + `@next-auth/prisma-adapter@1.0.7`.

**Reasoning:** Auth.js v5 has been published as `5.0.0-beta.31` for years; npm `latest` is still v4. Phase 1's "structural surface bugs compound" lesson argues against stacking `next-auth@beta` on top of Prisma 7's new `prisma-client` generator. v4 supports App Router via the `app/api/auth/[...nextauth]/route.ts` pattern, supports the database session strategy, and the adapter peer-deps allow `@prisma/client >= 2.26.0` (Prisma 7.8 satisfies). The prompt's `auth()` API surface is preserved by exporting `export const auth = () => getServerSession(authOptions)` from `src/lib/auth.ts` — the call sites read identically to v5's `auth()` but the internals are stable v4.

**Trade-off accepted:** will revisit v5 once it ships GA. Migration will be straightforward: swap the adapter package, replace `getServerSession` with v5's `auth()`, drop the wrapper.

### D1.5 — Login/signup pages: form removed, Google button only

**Choice:** Removed the email/password form fields entirely on `/login` and `/signup`. Card structure preserved (cream background, wordmark, headline, subhead, link to the other page) but the form + "Or continue with" divider replaced by a single Google button + a one-line "Email + password sign-up is coming soon." caption.

**Reasoning:** The kickoff offered two options — keep the form visible (visual continuity) or remove it. Keeping a non-functional form on a credential entry page is a UX trap: typing into it and clicking Submit either does nothing (confusing) or silently submits to a stale `/dashboard` action (a regression bug waiting to happen). The "coming soon" caption preserves the *signal* that more sign-in options will land, without keeping the trap. Visual contract delta from the Manus locked design is small — the cream card + wordmark + tagline + button hierarchy all match.

### D1.6 — Prisma 7 driver-adapter requirement (not flagged in kickoff but surfaced)

**Discovery:** Phase 1's schema picked the new Prisma 7 generator (`provider = "prisma-client"`) which requires an explicit driver adapter at `new PrismaClient()` time — no implicit `DATABASE_URL` pickup. Phase 1 never instantiated the client (no app code used it), so this surfaced on Step 1's first `import { prisma }`.

**Choice:** Installed `@prisma/adapter-pg` + `pg` + `@types/pg`; created `src/lib/db.ts` with `new PrismaPg({ connectionString: process.env.DATABASE_URL })` passed as the adapter. Standard idiom from Prisma 7 docs.

**Alternative considered:** switch the schema generator back to legacy `provider = "prisma-client-js"`. Rejected — works but rolls back from Prisma 7's recommended path. The adapter approach is one extra dependency for a forward-looking pattern.

### D1.7 — `start.sh` env sourcing pattern

**Choice:** `set -a; source /var/www/bkstr/.env; [ -f /etc/bkstr/oauth.env ] && source /etc/bkstr/oauth.env; set +a` near the top of `start.sh`, plus `--update-env` on `pm2 reload`.

**Reasoning:** PM2 reload reuses the env from the original `pm2 start` invocation unless `--update-env` is passed. Phase 1 worked because only `DATABASE_URL` was needed and it was in `/var/www/bkstr/.env` at first start. Phase 2 adds OAuth keys via a separate file (`/etc/bkstr/oauth.env`) staged operator-side, so the env set has *changed* — without `--update-env` the new keys land in `.env` files but never reach the running process. The startup log line prints which keys were sourced (key names only, no values) so the failure mode "OAuth env file got renamed and nobody noticed" is visible in `pm2 logs bkstr-web` immediately.

**Tolerated absence:** the `[ -f ... ] && source` pattern means a missing OAuth file is a logged WARN, not a fatal. Rationale: protects the deploy from a chicken-and-egg failure where the file hasn't been staged yet on first deploy. The `console.warn` in `src/lib/auth.ts` provides a second layer of visibility at runtime.

### D1.8 — Coming-soon caption wording

**Choice:** "Email and password sign-in coming soon—use Google for now" (em-dash, not hyphen). Applied verbatim under the Google button on both `/login` and `/signup`.

**Reasoning:** Honest about the deferred surface (D1.1) and explicit about the recovery path. The earlier placeholder ("Email + password sign-up is coming soon.") stated the absence but didn't tell the user what to do instead — Zach showing up to sign up could conclude bkstr isn't ready yet rather than reaching for the Google button right above. Identical string on both pages keeps the surface symmetric and reads slightly oddly on `/signup` ("sign-in" vs the page heading "sign-up") but matches the kickoff-prompt instruction to apply the exact string.

### D1.9 — Google OAuth scopes: default only (`openid profile email`)

**Choice:** Don't customize. `src/lib/auth.ts` GoogleProvider config passes only `clientId` and `clientSecret`; no `authorization.params.scope` override. Default `openid profile email` applies.

**Reasoning:** Phase 2 only needs identity. Broader Workspace scopes (Calendar, Drive, Gmail) would trigger Google's OAuth verification review process — domain ownership challenge, security questionnaire, video walkthrough — which adds friction without product benefit when the product surface is "API key + Bedrock fetch." Revisit if Phase 3 features need expanded scopes (e.g., Drive content ingestion, Calendar context for agents); at that point a Google verification submission becomes part of the work and should be planned with at least a week of lead time.

### D1.10 — Session expiry: NextAuth default (30-day rolling)

**Choice:** Don't customize. `authOptions.session = { strategy: "database" }` without `maxAge`. Default 30-day rolling expiry applies.

**Reasoning:** Internal alpha audience; re-login friction is not worth tightening for. 30-day rolling matches what users expect from any modern Google-OAuth app — the session refreshes on each request, only expiring after 30 days of inactivity. Phase 3+ may revisit if security review or compliance (SOC 2, etc.) requires shorter sessions; database-session strategy means we can also force-logout individual users without a global config change.

---

## Open questions for Step 1 STOP-gate review

(All resolved per D1.8–D1.10 above. Animesh's local validation walk is the remaining gate before push.)

---

## Step 2 — Bedrock IAM + SDK setup

### D2.1 — Model selection: `us.anthropic.claude-sonnet-4-5-20250929-v1:0` (US inference profile)

**Choice:** the US cross-region inference profile, ARN `arn:aws:bedrock:us-east-1:049405321468:inference-profile/us.anthropic.claude-sonnet-4-5-20250929-v1:0`. Not the foundation-model ARN.

**Forced choice (not preference):** the Sonnet 4.5 foundation model (`anthropic.claude-sonnet-4-5-20250929-v1:0`) reports `inferenceTypesSupported: ["INFERENCE_PROFILE"]` in our region. Direct `InvokeModel` against the foundation-model ARN is not supported — Bedrock requires invocation through an inference profile. Two profiles are available in our account (us-east-1):
- `us.anthropic...` — routes within US regions only (us-east-1, us-east-2, us-west-2)
- `global.anthropic...` — routes globally

We picked **US** because EC2 is in us-east-1, the US-only region pool gives more predictable latency and lower egress, and US-internal failover already provides resilience without global routing. Phase 3+ may revisit if cross-region disaster-recovery requirements expand.

**Why Sonnet 4.5 over Haiku 4.5:** matches Lab's choice (same operator, same patterns), handles 50k+ token system prompts comfortably (full marketing-ops markdown will fit), and Zach's iteration loop benefits more from Sonnet's reasoning quality than from Haiku's lower latency. Cost per fetch is reasonable for an internal alpha. Phase 3 may revisit if usage scales or if a fast-path tier emerges.

### D2.2 — Policy scope: `bkstr-bedrock-access` inline, model+profile resources only

**Choice:** inline policy on `bkstr-ec2-role` named `bkstr-bedrock-access`, allowing only `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream` against four ARNs (the US inference profile + the three foundation-model ARNs the profile internally routes to).

**Stream permission included for Phase 3 readiness.** Phase 2 is non-streaming per the locked decision; the `InvokeModelWithResponseStream` permission is unused today, but pre-granting avoids a policy update when streaming lands. Tradeoff accepted: a slightly broader IAM surface today for one less migration step later. Both actions are still scoped to the same model — there's no `bedrock:*`, no list/describe, no embedding/rerank actions.

**The four-ARN gotcha.** When using inference profiles, Bedrock internally invokes the underlying foundation model in whichever region wins routing. That internal invocation needs IAM permission too — granting only the profile ARN is insufficient. The policy lists all three foundation-model ARNs (us-east-1, us-east-2, us-west-2) so any internal routing is permitted. Filed follow-up #16 to re-audit when AWS expands the US profile's region pool.

### D2.3 — Region: `us-east-1`

**Choice:** us-east-1, matching the EC2 region and Phase 1's locked decision.

**Reasoning:** Sonnet 4.5 is available in us-east-1 (verified via `aws bedrock get-foundation-model-availability` returning `AUTHORIZED`/`AVAILABLE`). Cross-region calls would add latency without benefit. The chosen US inference profile still gives intra-US routing flexibility (us-east-2, us-west-2 as failover) without the EC2 having to issue cross-region API calls itself.

### Smoke test verification (2026-05-08)

Inline node `--input-type=module` test invoked via SSM, hitting the US inference profile from the EC2's instance-profile credentials (no AWS CLI keys involved). No file artifact left on EC2.

```json
{
  "ok": true,
  "latency_ms": 1696,
  "response_text": "bkstr Phase 2 Bedrock smoke test OK",
  "usage": {
    "input_tokens": 28,
    "output_tokens": 16,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0
  },
  "stop_reason": "end_turn",
  "model": "claude-sonnet-4-5-20250929"
}
```

Confirms: IAM path works, model actually responds (exact phrase echoed), `usage` object populated with `input_tokens`/`output_tokens` (Step 5's `fetch_logs` will pull these), latency is in the expected 1–3s range for short responses.

**Side observation worth noting:** AWS SDK v3 will deprecate Node 20 support after first week of January 2027 (we're on Node 20). 8+ months runway from today; consider folding a Node 22 bump into a Phase 3 ops sweep before the deprecation window closes.

### D2.4 — Bedrock SDK version pin

**Choice:** `@aws-sdk/client-bedrock-runtime` pinned to exact `3.1045.0` (no caret), matching Phase 1's installed version. Dropped `^` so future `npm install` runs don't silently bump the SDK and introduce surprises.

---

## Step 3 — Schema additions for content + fetch_logs

### D3.1 — Markdown stored as a single TEXT column on `book_versions`

**Choice:** add `content` (nullable `TEXT`) directly on `book_versions`. No separate `book_content` table.

**Reasoning:** versioning is already handled by `book_versions` being its own append-only table — each version is a row with its own `content_uri` (S3 placeholder from Phase 1) and now its own inline content. A separate `book_content` table would force a join on every fetch with no benefit at internal-alpha scale (one book, one version active at a time). When Step 5's LRU cache reads a version's content, it's a single row read keyed by `book_version_id` — the cleanest shape Postgres can give us.

**Nullable on purpose.** Existing rows have no content; Step 7's import script populates. Never want a publisher row blocked from existing because content hasn't been uploaded yet. Phase 3 may revisit if the column starts hurting query plans (TOAST overhead on large rows is a known Postgres edge case but irrelevant at our row-size and row-count scale).

### D3.2 — `fetch_logs` column set + nullability

**Choice:** columns are `id, subscriber_id, book_version_id, api_key_id, model, query, input_tokens, output_tokens, latency_ms, status, error_message, created_at`. All three FKs are `NOT NULL`. `model`, `query`, `status` are `NOT NULL`. `input_tokens`, `output_tokens`, `latency_ms`, `error_message` are nullable.

**FK NOT NULL rationale:** every fetch comes through the agent endpoint with a Bearer key for an authenticated subscriber against a specific book_version. There is no shape of valid log row that lacks any of the three.

**Token-count + latency nullable:** error rows (Bedrock 4xx, timeout, network failure) won't have these populated. Forcing `NOT NULL` would push us toward sentinel zero values, which would silently corrupt Step 6's "avg tokens", "p95 latency" metrics. Honest NULLs let analytics queries `WHERE input_tokens IS NOT NULL` cleanly.

**`error_message` nullable:** populated only on non-success rows. Filed forward-pointer to Step 5: implementation must include a sanitization layer ensuring this never carries Bedrock response content (see follow-up #21).

**FK delete behaviors:**
- `subscriber_id ON DELETE CASCADE` — subscriber teardown takes the fetch history with them.
- `book_version_id ON DELETE RESTRICT` — never want a book_version deleted while logs reference it; restrict forces an explicit cleanup path if a publisher pulls a version.
- `api_key_id ON DELETE RESTRICT` — key revocation must NOT cascade-delete logs (revocation should preserve audit trail; only full subscriber teardown should sweep logs).

### D3.3 — Query string IS logged. Response body is NOT.

**Choice:** asymmetric on purpose.

**Reasoning:** the query is the user's input — useful for debugging ("why did Zach see this output?"), useful for future eval work (replaying queries against new model versions), and not particularly sensitive. The response body is the publisher's compressed knowledge interpolated through the model — logging it creates a leak surface (a DBA dump exposes content the publisher pays to gate behind API keys), inflates row size unpredictably, and adds nothing we can't get by re-running the query against the same `book_version_id` later.

**Forward-pointer to Step 5:** `error_message` field needs a sanitization layer. Bedrock's error responses occasionally echo prompt content; we must strip that before persisting. Filed as follow-up #21.

### D3.4 — No retention policy on `fetch_logs` at internal-alpha

**Choice:** unbounded growth for now. Filed follow-up #19 for revisit.

**Reasoning:** internal alpha will produce on the order of 10s–100s of fetches per day. Even at 1k/day, the table reaches 365k rows in a year — well within Postgres single-table comfort zone for the index shape we have. Adding retention policy now (pg_cron sweeps, partitioning, app-side sweepers) is premature optimization that creates moving parts before the moving parts pay for themselves. Revisit when the table hits ~100k rows or when Edward asks about cost.

---

## Step 4 — API key issuance, auth middleware, dashboard UI

### D4.1 — Key format: `bks_<32 base64url>` (192 bits of entropy)

**Choice:** `bks_` prefix + 32 base64url characters (encoded from 24 random bytes via `crypto.randomBytes(24)`).

**Reasoning:** the `bks_` tag makes keys self-identifying in logs and grep — operators and security tooling can scan for `bks_` to find leaked credentials in error reports, JIRA tickets, screenshots. 192 bits of entropy is well past any brute-force threshold; a 32-char base64url tail is short enough to fit on one terminal line. No `bks_test_` / `bks_live_` distinction in Phase 2 — single environment, no need yet. Phase 3 may introduce `bks_live_` and `bks_test_` if a sandbox tier emerges.

### D4.2 — `key_prefix` is first 12 chars (`bks_` + 8 chars), btree-indexed

**Choice:** store `plaintext.slice(0, 12)` as the `key_prefix` column. Lookup pattern: `WHERE key_prefix = $1 AND revoked_at IS NULL`, then constant-time hash compare across the (typically one, occasionally zero, theoretically many) candidates.

**Reasoning:** 8 characters of base64url is 48 bits — enough to keep collision probability negligible at our key counts (you'd need millions of keys before any prefix collision was likely), but **insufficient as a credential alone** (48 bits is brute-forceable). The hash compare on the full 192-bit plaintext is the actual auth check; the prefix is purely a fast-path lookup index. Revealing the prefix in dashboard UI and logs is intentional — it lets operators identify which key was used without ever seeing the secret.

The btree index on `key_prefix` (added in this Step's migration) means auth lookup is O(log n) on table size, not seq scan. Without the index, every authenticated API call would scan the entire table — pre-emptively a hot-path scan we don't want to discover under load.

### D4.3 — SHA-256 hex hash. No bcrypt/argon2.

**Choice:** `crypto.createHash('sha256').update(plaintext).digest('hex')` — 64-char hex string, fits in `varchar(128)`.

**Reasoning:** bcrypt/argon2 are slow-by-design (compute-bound) precisely to make brute-forcing low-entropy human passwords impractical. API keys generated from `crypto.randomBytes(24)` carry 192 bits of entropy — brute-forcing them is computationally infeasible regardless of hash algorithm. Slow hashes would cost ~100ms per request on the auth hot path for zero security benefit. SHA-256 is fast, deterministic, and indexed cleanly. The unique index on `key_hash` enforces global uniqueness as a sanity belt-and-suspenders.

### D4.4 — Show-once strict, gated behind explicit confirmation

**Choice:** `POST /api/keys` returns the plaintext exactly once. No re-fetch path. The dashboard generate-flow modal:
1. Displays plaintext + a copy button
2. Requires a checkbox ("I have copied this key and stored it securely") before the "Done" button enables
3. Holds the plaintext only in React component state during the modal lifecycle — never `localStorage`, never `sessionStorage`, no `console.log`
4. State is dropped when the modal unmounts

**Reasoning:** users who lose a key revoke and regenerate. Better UX would be reckless — every persisted-plaintext convenience is a new leak surface. The checkbox-gate forces the user to acknowledge the irreversibility before dismissing the modal, preventing the "tab closed before copy" footgun.

### D4.5 — Revoke is soft delete (`revoked_at` set)

**Choice:** `UPDATE subscriber_api_keys SET revoked_at = NOW() WHERE id = $1`. No row deletion.

**Reasoning:** half is forced — `fetch_logs.api_key_id ON DELETE RESTRICT` (Step 3) blocks hard delete when any fetch logs reference the key. Half is choice — even without the FK, soft delete preserves audit trail ("which key was used to fetch this book on this date"), supports unrevoke if the operator changes their mind, and matches how every other auth system represents revocation. Hard delete only happens if a Subscriber teardown cascades through (and even then the logs cascade with the subscriber).

### D4.6 — Per-route auth helper, not Next.js root middleware.ts

**Choice:** `requireApiKey(request)` lives at `src/lib/auth/api-key.ts` and is called at the top of `/api/agent/fetch` (Step 5). No `middleware.ts` at the project root.

**Reasoning:** Next.js root middleware runs on the **edge runtime**, where Prisma 7's driver-adapter (`@prisma/adapter-pg` + `pg`) does not run — `pg` is Node-only. Putting auth in middleware would require a separate edge-compatible code path for the auth DB lookup (e.g., Prisma's HTTP-based driver, or a separate verifier service). Per-route helpers run on the Node runtime where Prisma already works. The trade-off accepted: a one-line `await requireApiKey(req)` at the top of each protected route, instead of one `middleware.ts` config. For the single agent endpoint Phase 2 ships, the trade-off is trivial.

### D4.7 — `name` column added with `DEFAULT ''` for backfill safety

**Choice:** `ALTER TABLE subscriber_api_keys ADD COLUMN name TEXT NOT NULL DEFAULT ''`. Empty string is allowed; the dashboard UI italicizes "(no name)" on rows where `name.trim() === ''`.

**Reasoning:** any pre-existing rows (Phase 1 had zero, but the migration must be safe regardless) get `name = ''` rather than failing on NOT NULL. Empty allowed but the UI nudges toward naming. A future Phase 3 may add a backfill script if the empty-name population becomes annoying; for internal alpha at one user with new keys, irrelevant.

### D4.8 — `key_prefix` btree index added in this Step (not deferred)

**Choice:** add `CREATE INDEX subscriber_api_keys_key_prefix_idx ON subscriber_api_keys(key_prefix)` in this same migration as the `name` column, not deferred to a Phase 3 perf pass.

**Reasoning:** correctness-adjacent. The auth helper's lookup pattern is `WHERE key_prefix = $1 AND revoked_at IS NULL`; without the index, every authenticated API call to the agent endpoint does a sequential scan. At Phase 2 scale (one user, a handful of keys) the scan is fine; at any meaningful scale it's a hot-path bottleneck that's invisible in dev and painful in prod. Adding the index now costs nothing and forecloses a future "why is the agent endpoint slow" debugging session.

---

## Step 5 — Agent fetch endpoint

### D5.1 — Endpoint shape: `POST /api/agent/fetch`, SSE response, Bearer auth

**Choice:** the agent endpoint is `POST /api/agent/fetch`. Authentication is Bearer-key via `requireApiKey()` (Step 4's helper). Successful responses are server-sent-events (SSE) streams; pre-stream failures use HTTP 4xx/5xx, mid-stream failures send `event: error` and close.

**Reasoning:** SSE is the natural shape for an LLM-backed endpoint — Bedrock responses arrive token-by-token, and downstream agent loops want to start consuming as soon as the model starts producing. The "200 if stream opened" rule means the HTTP status decision is committed before we know whether the model will actually finish cleanly; mid-stream errors get represented as a final `event: error` message instead of being smuggled into the HTTP status (which the client may have already started rendering against). REST conventions of "errors are 5xx" don't fit streaming responses.

### D5.2 — Request body: `{ book_id, version_id?, query }`. version_id optional, defaults to latest.

**Choice:** required `book_id` (UUID), optional `version_id` (UUID; latest if omitted), required `query` (string, non-empty). Latest version resolves via `bookVersion.findFirst({ where: { bookId }, orderBy: { version: 'desc' } })`.

**Reasoning:** subscribers care about "the book" most of the time, not specific versions. Defaulting to latest keeps the common case ergonomic; opting into a specific `version_id` lets eval/comparison tooling pin to a known snapshot. UUIDs validated by regex before the DB lookup so a malformed input is a 400, not a Postgres error.

### D5.3 — Query length capped at 8000 chars

**Choice:** reject queries over 8000 characters with HTTP 400. Pre-checked before any Bedrock call.

**Reasoning:** Bedrock charges per input token. An 8000-char query is roughly 2000 tokens — generous for any reasonable question, well below abuse territory. Without the cap, a misbehaving client could ship a 1MB "query" through the system prompt path before we hit the size guard, racking up Bedrock charges. The cap is a cheap pre-gate.

### D5.4 — System prompt: hardcoded preamble + book markdown; user query as user message

**Choice:** the system prompt is a fixed preamble (`"You are an assistant answering questions about the following book. Only answer based on the content of the book provided below. If the answer is not in the book, say so clearly. Do not invent or speculate."` plus separator and markdown). The user query becomes the `user` role message, not interpolated into the system prompt.

**Reasoning:** keeping the query out of the system prompt limits prompt-injection surface — anything in the user message can be ignored by the model per the system prompt's "only answer based on this content." This is not hardened defense (a determined attacker can phrase prompt-injection attempts in ways the preamble doesn't anticipate), but it's the floor that makes opportunistic injections unproductive. Filed follow-up #30 for hardening if behavior degrades or a security review flags it.

### D5.5 — Content size guard: 150k tokens estimated via 4-char/token rule

**Choice:** `estimateTokens(content) > 150_000` rejects with 413 + `status='content_too_large'`. Estimate is `Math.ceil(content.length / 4)`.

**Reasoning:** Sonnet 4.5's context window is 200k tokens; reserving ~50k for the user query, the system prompt scaffolding, and the response leaves ~150k for the book. The 4-chars/token approximation is a published Anthropic rule of thumb — accurate enough for a hard-reject gate, not for billing (filed follow-up #28). RAG/chunking for books that exceed this is filed as #27 and deferred to Phase 3; today's behavior is hard-reject so a too-large book fails loudly rather than silently truncates.

### D5.6 — In-memory LRU cache, 100 entries, 15-min TTL

**Choice:** `lru-cache@11.3.6` exact-pinned. Key = `${book_version_id}:${sha256(query.trim().toLowerCase())}`. Value = `{ text, input_tokens, output_tokens }`. Max 100 entries, TTL 15 minutes. Cache hits replay as 50-char SSE chunks (so clients don't have to special-case "everything at once") with cached token counts and a real `latency_ms`. Errors NOT cached.

**Reasoning:** the expected workload is the same query asked many times within minutes (Zach iterating, agent loops re-asking). Caching produces order-of-magnitude latency improvement for repeated queries at zero quality cost. In-memory is the right scope at Phase 2 (single PM2 process); follow-up #29 tracks moving to Redis when multi-instance deploys land. The 15-minute TTL is a guess at "how long is a 'session' worth of repeated queries" — Phase 3 with real telemetry can tune.

### D5.7 — Error taxonomy

**Choice:** logged-vs-not and HTTP-status mapping per kickoff prompt's table. Specifically:

| Failure | HTTP | Logged? | `status` |
|---|---|---|---|
| Bad body / missing fields / query too long / bad UUIDs | 400 | NO | — |
| Auth failed (`requireApiKey` throws) | 401 | NO | — |
| Book / version not found, no content | 404 | NO | — |
| Content exceeds size estimate | 413 | YES | `content_too_large` |
| Bedrock errors before first token | 502 | YES | `error` |
| Bedrock no-first-token within 30s (pre-stream) | 504 | YES | `timeout` |
| Mid-stream Bedrock error | 200 + `event: error` | YES | `error` |
| Mid-stream first-token-timeout (post-stream-open) | 200 + `event: error` | YES | `timeout` |
| Happy path | 200 + full stream + `event: done` | YES | `success` |
| Cache hit | 200 + replayed stream + `event: done` | YES | `cache_hit` |

**Reasoning:** 400/401/404 are caller bugs (or unauthenticated probes) — logging them creates dashboard noise without operational signal. Anything that consumed real resources (Bedrock invocation attempted, content guard tripped, cache hit served) gets logged so the dashboard's metrics are honest. Confirmed with operator that 400-not-logged is the right call for Phase 2; revisit if it turns out we need to surface caller-bug volume.

### D5.8 — Sanitization helper at `lib/agent/sanitize.ts`, single-export shape

**Choice:** `sanitize.ts` exports exactly one function: `sanitizeError(err: unknown): string`. App-generated short messages (`"No first token within 30s"`, `` `content_estimate exceeds ${MAX_CONTENT_TOKENS} tokens` ``, `"Bedrock returned no body"`) are assigned directly as string literals at the call site in `route.ts`, not routed through a helper.

**Reasoning:** an earlier draft included a companion `sanitizeMessage(message: string): string` for static strings. That was wrong — its `string` parameter would also accept user input or Bedrock body content, creating a sanitization-bypass surface. A future caller writing `sanitizeMessage(err.message)` or `sanitizeMessage(query)` would pass type-check despite violating the rule.

Three paths considered: (a) inline literals at call sites, (b) TypeScript template-literal-types to constrain to compile-time string literals, (c) doc comment + grep enforcement. Picked (a) because the actual messages are short literals (or template literals with one numeric module constant), so the 500-char cap is moot for them, and grep makes the literal-only pattern visible at every call site. The grep rule is now: every assignment to `errorMessage` is the initial `null`, a string literal, a template literal whose only interpolations are compile-time module-level constants (today: `MAX_CONTENT_TOKENS`), or `sanitizeError(err)`. Anything else is a sanitization-bypass risk and must be flagged in review.

The `sanitizeError` whitelist deliberately drops `err.message`. Bedrock's error responses occasionally echo prompt or response content in `.message`; the only safe thing to log is the class name + code, mapped to a hardcoded human description. Anything outside that allowlist is dropped. The 500-char cap is enforced inside `sanitizeError`; #21's "schema TEXT, app-layer cap" pattern closes via this implementation choice.

### D5.9 — Single fetch_logs write at end of request, in `finally` block

**Choice:** every code path that gets past auth + body parse + book lookup produces exactly one `fetch_logs` insert via a closure (`writeLog`) called in `finally` of the relevant try block. No two-write pattern, no pending-then-update. The closure swallows insert errors (writes a `console.error` but doesn't throw), so a DB hiccup at log-write time doesn't crash the user-facing response.

**Reasoning:** the prompt's "process crashes mid-request leave no row — acceptable at internal-alpha" makes this trivially correct. Single-write in `finally` is the simplest pattern that guarantees coverage across happy path, pre-stream errors, mid-stream errors, content-too-large, and cache hits. The closure pattern keeps the four call-sites (each `try` block's `finally`) syntactically simple. The Prisma insert error swallow means a log-write outage doesn't compound a user-facing failure.

### D5.10 — First-token timeout 30s; AbortController on Bedrock; caller-disconnect propagates

**Choice:** A single `AbortController` is created right before `bedrockClient.send()`. A `setTimeout(30s)` aborts it if no first chunk arrives. `request.signal.addEventListener("abort", ...)` plumbs caller-disconnect through to the same abort. If timeout fires before `send()` returns (pre-stream), result is HTTP 504. If timeout fires during body iteration before any chunk (post-stream-open), result is `event: error` over the already-open SSE stream with `status='timeout'`. Caller-disconnect during the stream cancels the upstream Bedrock call so we don't burn tokens for a client that's left.

**Reasoning:** 30s is generous for Sonnet's typical first-token latency (~1-2s) but accommodates a cold-start Bedrock region or transient network slowness. Tighter would create false-positive timeouts; looser would let real failures hang the dashboard. AbortController is the standard SDK v3 pattern for cancellation. The branching on `request.signal.aborted` in the timeout handler avoids logging a "timeout" for what was actually a caller-disconnect — those are distinct failure modes.

### D5.11 — Subscriber-to-book authorization: open access in Phase 2; per-book deferred

**Choice:** Phase 2 has no subscriber-to-book authorization model. Any authenticated subscriber (any valid API key) can fetch any book. Key validity is the only gate. Per-book authorization deferred to a separate step before external subscribers land. See follow-up #32.

**Reasoning:** Phase 2's locked scope is "one publisher, one book, one subscriber." Adding a `subscriber_books` join table now would introduce machinery for a multi-tenant scenario the locked scope doesn't include, and the design choices (per-book? per-publisher? per-tier?) are best made when the actual access pattern is known. Option (c) from the pre-gather report — open access today, follow-up filed, decision deferred to a step before external onboarding — keeps the Step 5 scope minimal and the Phase 3 design space open.

The route still verifies (1) the book exists and (2) the targeted version has content, so a malformed `book_id` or content-less version fails 404 cleanly. The missing piece is "is THIS subscriber allowed THIS book," and the answer in Phase 2 is "yes, always."

### D5.12 — Step 5 verification: helper validated standalone; tests 1–11 deferred to Step 7's walkthrough

**Choice:** the sanitization helper (`sanitizeError`) was validated standalone via an SSM Node script that imported the helper logic and ran 11 synthetic Bedrock-shaped errors through it (every known class in the whitelist + unknowns + non-Error inputs + a 600-char-className truncation case). All cases passed every leak/format/cap check; zero leak payloads appeared in any output. The route's call sites for `sanitizeError` are grep-confirmed at `route.ts:219` (pre-stream) and `route.ts:294` (mid-stream). The end-to-end "Test 11" (temporarily set MODEL_ID to a bogus value, send a real request, inspect persisted `fetch_logs.error_message`) is deferred to Step 7's walkthrough where real seeded book content makes the round-trip natural.

**Reasoning:** running Test 11 in isolation now would cost two production deploys (bogus push + revert) plus a fixture insert + cleanup, against a Step-5 deploy budget already at 1/3. The helper-alone validation closes the security-sensitive bit (helper output never carries leak content) at zero deploy cost. Route integration is grep-static evidence — every value flowing into `errorMessage` is either a string literal, a template literal interpolating compile-time module constants, or `sanitizeError(err)`. Tests 1–10 (happy path, cache hit, 400/401/404 boundaries, 413 oversized content, query-length cap, mid-stream error) are also blocked on real seeded content and roll into Step 7's walkthrough naturally. Filed forward-pointer #33 so we don't lose track.

---

## Step 6 — Dashboard metrics + fetch logs view

### D6.1 — Books table columns: title, latest version, total fetches, last 30d, active agents 30d, last fetched

**Choice:** six metrics columns plus a "View fetches" action. Skipped the 7-day window (filed #36 if useful during walkthrough).

**Reasoning:** the kickoff specified these six. Each answers a publisher-shaped question: "what's live", "what version", "is this getting used at all", "is it growing", "how many distinct callers", "is it still alive." 7-day adds noise without distinct decision value at internal-alpha; defer until somebody actually wants it.

### D6.2 — Fetch logs view at `/dashboard/fetch-logs`, cross-book, optional `?book=` filter

**Choice:** standalone page, not a sub-section of `/dashboard`. Defaults to all books for the current subscriber; `?book=<uuid>` narrows to one book. The Books table's "View fetches" action links into the filter.

**Reasoning:** the natural shape — most of the time you want chronological cross-book ("what just happened?"); occasionally you want one book ("why is this book's metric weird?"). Two pages would be redundant; a filter on one page handles both.

### D6.3 — Last 100 rows, no pagination

**Choice:** hard cap at 100. Filed #35 for cursor pagination when row count makes 100 annoying.

**Reasoning:** Phase 2's expected fetch volume is ~10s–100s of fetches per day. 100 rows covers a few days of activity. Pagination machinery (cursor encoding, "load more" UI, scroll position preservation) is real engineering for a use case we don't have yet.

### D6.4 — Manual `router.refresh()`. No polling, no SSE, no websockets.

**Choice:** a Refresh button that calls `router.refresh()` (Next.js App Router server-component re-render). No automatic refresh.

**Reasoning:** the user is a publisher reviewing their fetch log dashboard, not a live-monitoring agent. Manual refresh matches the intent. Filed #38 for live updates if Phase 3 dashboards want them.

### D6.5 — Server components + direct Prisma. No new API routes.

**Choice:** the dashboard pages are server components reading directly from Prisma. No `/api/dashboard/*` routes.

**Reasoning:** the dashboard is auth-gated, the data lives in the same DB, and the pages render server-side anyway. An API route adds: (a) a serialization step, (b) a network hop, (c) a separate auth surface. None has a consumer at Phase 2 — every reader is the dashboard itself. Phase 3 may revisit if external consumers (e.g. mobile app) need a JSON surface.

### D6.6 — Status badges color-coded. `error_message` NOT shown in UI.

**Choice:** badge colors map status → tone:
- `success` / `cache_hit` → green
- `timeout` / `content_too_large` → yellow
- `error` → red
- anything else → neutral

`fetch_logs.error_message` is NEVER displayed in the dashboard. Filed #37 for a debug-mode toggle.

**Reasoning:** the UI shows the user's own data (queries) but not implementation details (sanitized error class names that look noisy without context). When a fetch errored, the publisher cares "did this book fail?" — yes/no via the badge — not the Bedrock class name. The full error text remains queryable from the DB for actual debugging.

### D6.7 — Query strings shown in the UI (truncated 80 chars, full on hover)

**Choice:** `fetch_logs.query` is displayed in the table, truncated at 80 chars with a `title=` tooltip showing the full query.

**Reasoning:** the query is the publisher's own data about how their book is being used — core value of the dashboard. Truncation keeps the table readable; tooltip preserves the full content for debugging. D3.3's "query is logged, response is not" rule is what makes this safe to display: queries are user-provided text, not publisher content or model output.

### D6.8 — Single-tenant simplified dashboard scope

**Choice:** Books table scopes to all books in the system (no publisher/subscriber filter). Fetch logs view scopes to the current user's subscriber via the user→subscriber relation. The publisher-vs-subscriber view distinction is deliberately deferred per follow-up #39.

**Reasoning:** Phase 2's locked scope is one publisher + one book + one subscriber. Adding a User→Publisher schema linkage now (option a in the pre-gather report) would commit to a multi-tenant role model not yet stakeholder-validated (per-publisher? per-tier? admin vs viewer?). Going subscriber-only (option b) requires per-book auth (#32) which is also deferred. Single-tenant simplified view (option c) is honest framing: the scope question is unresolved, and at single-tenant scale all three options collapse to the same render.

**Test data note:** `subscribers` and `users` each contain 2 rows from 2 distinct Google identities (`animeshk604@gmail.com` personal + `clawbot@tmrwgroup.ai` workspace) — both are valid test users that signed in via Step 1's OAuth flow. The dashboard's user→subscriber resolution rule handles both correctly: each session sees its own subscriber's fetch logs. The OAuth client's consent-screen status (Internal vs External) couldn't be verified from EC2 alone — filed #40 for out-of-band check before any external pilot.

### D6.9 — Sidebar extracted into `DashboardShell` component

**Choice:** added `src/components/dashboard/dashboard-shell.tsx` that takes `active: "books" | "api-keys" | "fetch-logs"` plus session-derived props (companyName, userEmail, initial) and renders the sidebar + main slot. The three pages (`/dashboard`, `/dashboard/api-keys`, `/dashboard/fetch-logs`) all use it.

**Reasoning:** Step 4 left the sidebar duplicated between `/dashboard` and `/dashboard/api-keys`. Step 6 adds a third page that would have been the third copy. Three near-identical sidebars with one different "active" item each is the canonical signal for extraction. The extraction is small (~70-line component, replaces ~70 lines per page) and produces grep-clean nav-item ownership.

---

## Step 7 — Book import script + seed corpus

### D7.1 — Import is a CLI script, not a UI

**Choice:** `npm run import-book -- --publisher ... --title ... --domain ... --file ...`. No admin UI for book upload in Phase 2.

**Reasoning:** the only operator at Phase 2 is engineering. A CLI is faster to write, easier to reason about for idempotency (re-runnable without UI state), and trivially scriptable for bulk imports later. Admin UI work is filed as #41 (Phase 3) and depends on the admin role-model resolution that #39 will trigger.

### D7.2 — Publisher upsert by slug, not name

**Choice:** the script auto-slugifies `--publisher <name>` and upserts on `Publisher.slug`. The schema's unique constraint is `slug @unique`; `name` is not unique.

**Reasoning:** the prompt's example assumed `name @unique` but the actual schema has `slug @unique`. Slug is the URL-safe identifier and the natural key for upsert. The operator-facing risk: the same publisher entered as `"tmrwgroup"` vs `"TMRW Group"` produces two different slugs (and thus two different rows). Documented in `docs/operations.md` so the operator knows to keep the publisher name consistent across imports.

### D7.3 — Idempotent import via SHA-256 content hash diff

**Choice:** before inserting a new `book_version`, the script reads the latest version's `content` column, hashes both (file content + existing content) with SHA-256, compares. Equal → no-op exit 0 with `unchanged:` log line. Different → insert new version with `version = max + 1`.

**Reasoning:** content equality is the right test. If the operator re-runs the same `--file` against the same book without changing the markdown, we don't want a v2/v3/v4 churn of identical content. SHA-256 is overkill for collision avoidance but cheap and unambiguous. The hash is computed on the fly — no `content_hash` column on the schema (D7.4).

### D7.4 — No `content_hash` column added; hash on the fly

**Choice:** SHA-256 is computed at import time on both the new file and the latest version's stored content. Single comparison cost is trivial (~10ms for a typical SKILL.md sub-100KB).

**Reasoning:** persisting the hash would add a column with no query consumer. Re-hashing the latest row on each import is cheaper than maintaining a separate column, and there's no plausible Phase 3 use case where we'd want to query "find books whose content matches this hash" (the existing inline-storage model means the content itself is queryable directly). YAGNI.

### D7.5 — Seed content lives in gitignored `/seed-content/`

**Choice:** the directory is tracked (via `.gitkeep`) but `*.md` files inside are gitignored. Seed files live per-environment, committed to operator's local workspace, not to the repo.

**Reasoning:** seed content is operational test data, not source code. Possible licensing/attribution concerns we haven't audited (the SKILL.md files Animesh sources from agent-skill marketplaces have their own licenses). Bundling them with the application would conflate operational data with code in a way that complicates clean-room rebuilds. The local-only convention also means the prod EC2 doesn't ship with empty seed files cluttering its filesystem; imports are run by the operator against the prod DB via SSH-tunneled DATABASE_URL when seeding.

### D7.6 — Source format is local file path; no S3/URL/GitHub ingest

**Choice:** `--file <path>` only. No `--url`, no `--s3-bucket`, no `gh:owner/repo/path`.

**Reasoning:** every external-source ingest path multiplies failure modes (auth, rate limits, content negotiation, encoding). At Phase 2 with the operator running imports manually from their laptop, the file-path interface is the lowest-friction option that handles every existing source via a one-line `curl` or `gh` step before invoking the script. Filed #43 to revisit alongside admin UI in Phase 3.

### D7.7 — Schema reality differs from the Phase 2 plan summary

**Discovery:** the Phase 2 kickoff plan summarized the book storage shape simply, but the actual schema (Phase 1 design) has:
- `Book.slug` (varchar 128, required) and `Book.domain` (varchar 64, required) in addition to `title`
- `BookVersion.contentUri` (Text, required, was the Phase 1 S3 placeholder) and `BookVersion.byteSize` (Int, required) in addition to the Step-3-added `content` (Text, nullable)
- `BookVersion.version` field, not `versionNumber`

**Choice:** Step 7's import populates all of these. `Book.slug` auto-slugifies from `--title` (override with `--slug`); `Book.domain` is required CLI arg `--domain`. `BookVersion.contentUri` is set to `inline://<book_version_id>` to communicate inline storage; the UUID is generated client-side via `crypto.randomUUID()` so id and contentUri can be set in a single insert with no two-phase create-then-update. `BookVersion.byteSize` is `Buffer.byteLength(content, 'utf8')`.

**Schema-debt note:** as of Step 7, **inline `content` is the source of truth.** `content_uri` is a forward-looking placeholder pointing nowhere real. Cleanup deferred to follow-up #45 — either drop `content_uri` (commit to inline storage) or design a clean inline-vs-S3 dual-storage model with a clear precedence rule. Either resolution is Phase 3 work.
