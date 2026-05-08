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
