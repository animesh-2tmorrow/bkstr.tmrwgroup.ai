# bkstr.tmrwgroup.ai — Follow-ups

Tracked items deferred from Phase 1 scaffolding. Numbered globally; mark resolved entries with strikethrough + a one-line resolution note rather than renumbering.

---

## From Phase 1 first-deploy debug (2026-05-08)

### 1. `scripts/before-install.sh` invokes Prisma CLI via literal package path

`scripts/before-install.sh:22` currently runs `node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma` instead of `node_modules/.bin/prisma migrate deploy ...`.

**Why:** CodeBuild's zip artifact dereferences `node_modules/.bin/` symlinks, copying `prisma`'s `index.js` into `.bin/` as a regular file. At runtime `__dirname` resolves to `.bin/`, where Prisma's bundled CLI expects to find a sibling `prisma_schema_build_bg.wasm` — which does not exist there (only at `prisma/build/`). Result: `ENOENT: no such file or directory, open '.../node_modules/.bin/prisma_schema_build_bg.wasm'`. Invoking `prisma/build/index.js` directly puts `__dirname` at `prisma/build/`, where the wasm sibling lives.

The literal path is brittle to Prisma reorganizing its `build/` layout in a future minor version. Replace with a more resilient form during the hardening pass:

- `npm exec --prefix . -- prisma migrate deploy --schema prisma/schema.prisma`, or
- `node "$(node -p "require.resolve('prisma/package.json')")/../build/index.js" migrate deploy --schema prisma/schema.prisma`

The `npm exec` form is preferred (delegates path resolution to npm/Node's package resolver).

**Severity:** low (working today, only matters when Prisma reorganizes internals — likely never on a Phase 1 timescale). **Suggested resolution:** swap during the hardening pass that also reviews the `EnvironmentFile` path, the systemd unit user (`ubuntu` is fine for Phase 1), and the nginx config hardening (HSTS, security headers).

### 2. Local hook-chain validation precedes every hook-touching change

New discipline emerging from the four-failure deploy chain (commits `3ad853a` → `e006b5b` → `59b923a` → `8f5c111` → next). Each failure was a single-layer bug — cwd, missing-file, missing-file, version-syntax — that local validation against the actual EC2 environment would have caught in seconds. The cost of skipping local validation: four pipeline cycles plus a degraded production state.

**Rule:** any change to `scripts/*.sh`, `scripts/*.service`, `scripts/nginx-*.conf`, or `appspec.yml` must pass three pre-push checks:

- **Check A:** the proposed nginx config validates via `nginx -t` against the EC2's actual nginx version, dry-symlinked then unlinked
- **Check B:** every hook script runs end-to-end against the deployment archive in `/tmp/bkstr-local-repro/` with destructive operations replaced by echo+test
- **Check C:** any systemd unit changes pass `systemd-analyze verify`

Validation output goes into the commit message or PR description before push. **Severity:** process. **Resolution:** documented now; enforcement is per-commit discipline.

### 3. Migration/deploy decoupling for Phase 2

`scripts/before-install.sh` runs `prisma migrate deploy` during the BeforeInstall hook. Acceptable for Phase 1 (single instance, no users, only the idempotent init migration), problematic before Phase 2 because:

- A forward-incompatible schema migration (column drop, type change, NOT NULL addition) gets applied to the DB before the new app code rolls to instances. During the brief window between schema-apply and app-start, any reader running on the old code hits a query against a schema it doesn't understand.
- A failed migration leaves the DB schema partially applied while app code rolls back. Prisma's `_prisma_migrations` table marks failed migrations as failed — but the DDL changes already committed are not rolled back.

**Severity:** medium for Phase 2. **Suggested resolution before Phase 2:** decouple via either (a) explicit pre-deploy migration step run as a separate SSM command with manual gating, or (b) blue/green schema migration patterns (additive-only forward, drops only after the old code is fully retired). Decision needed before any non-additive migration ships.

### 4. `prisma.config.ts` runtime requirement — document in README

Prisma 7's `migrate deploy` reads `datasource.url` exclusively from `prisma.config.ts` at the project root. The schema-vs-config split means the file isn't optional — it's a hard runtime dependency. Easy to omit from a build artifact (we did, in commit `3ad853a`'s buildspec) because it's at the repo root, not under `prisma/`.

**Severity:** low (now fixed in `8f5c111`). **Suggested resolution:** add a one-paragraph note to `README.md` calling out: "`prisma.config.ts` is required at runtime; if you adjust the build artifact allow-list, ensure it stays included." Ten minutes of README work that could prevent a Phase 2 contributor from re-introducing this exact failure.

### 5. nginx version pinning question

Ubuntu 24.04 ships nginx 1.24.0 in its package repo. nginx 1.25+ adds HTTP/3 (QUIC), the standalone `http2 on;` directive form, and other features we don't need for Phase 1 but might want later. PPA-based 1.25+ installs add maintenance risk (PPA staleness, security update lag, dist-upgrade conflicts).

**Severity:** none today (1.24 works, HTTPS + HTTP/2 enabled via listen-line parameter). **Suggested resolution:** decision deferred until Phase 2 has a concrete need (e.g., HTTP/3 for mobile clients, or a feature only in 1.26+). Default until then: stay on Ubuntu's repo nginx, accept the 1.24 syntax constraints. If pinning is needed: nginx's official repo (`nginx.org/packages/ubuntu`) is preferred over random PPAs.

### 6. `start.sh` rsync excludes need expansion when user-upload directories land

`scripts/start.sh` currently rsyncs the deployment release dir into `/var/www/bkstr/` with `--delete --exclude .env`. This is correct for Phase 1 (only `.env` needs preservation across deploys). When Phase 2 introduces persistent on-instance state — book content uploads, profile images, generated artifacts, or anything else not intended to be wiped on each deploy — `start.sh`'s `--exclude` list needs to grow.

The reference selfandmatchnew chain excludes `public/images/products`, `public/images/blog`, `storage` for this reason. Whatever bkstr's equivalents are, they go in the rsync exclude list at the same time as the feature itself lands.

**Severity:** none today (no user uploads in Phase 1). **Suggested resolution:** every PR adding persistent on-instance directories must update `start.sh` rsync excludes in the same diff. Add a checklist item to whatever PR template/conventions land for Phase 2.

### 7. EBADENGINE warning on `@prisma/streams-local@0.1.2` declaring `node >=22`

Surfaced during Phase C local-repro `npm ci` on the EC2:

```
npm warn EBADENGINE Unsupported engine {
  package: '@prisma/streams-local@0.1.2',
  required: { bun: '>=1.3.6', node: '>=22.0.0' },
  current: { node: 'v20.20.2', npm: '10.8.2' }
}
```

A transitive dep of `prisma@^7.8.0` declares Node 22+ in its `engines` field. We're on Node 20 (matching the EC2's repo nginx-era stack) and `npm ci` treats this as `warn`, not error — install + build + runtime all proceed.

**Severity:** none today (warn, doesn't block). Becomes a hard requirement if a future Prisma version converts the warn to error, OR if `@prisma/streams-local` adds Node 22-only API usage. **Suggested resolution:** monitor Prisma upgrade notes; either upgrade EC2 Node to 22+ when Phase 2 lands, or pin Prisma at the highest 7.x that doesn't bump this requirement.

### 8. Phase C local validation must capture the spawned PID and kill that specific PID at end

The Phase C validation script started `npm start` in the background to verify the unpacked artifact serves `:3000` correctly. At the end of the script, cleanup tried `pkill -f 'next start'` and `pkill -f 'npm start'`. **Both patterns missed the actual runtime process**, which renames itself to `next-server (v15.5.18)` after the npm/next exec chain completes. Result: an orphaned `next-server` process kept listening on `:3000` for ~8 minutes until the actual deploy ran — at which point PM2's `pm2 start npm --name bkstr-web -- run start` hit `EADDRINUSE: :::3000` and retried 16 times until PM2 marked the entry errored. Production was briefly served by the orphan, not the deploy's PM2-managed process.

The deploy itself was correct; the bug is in the validation script's cleanup discipline.

**Fix shape for next time:** capture the PID into a file at spawn-time, kill that specific PID at end. Don't rely on `pkill -f` against a name that the runtime may rename.

```bash
# Right way:
sudo -u ubuntu nohup npm start > /tmp/.../validate-npm-start.log 2>&1 &
NPM_PID=$!
echo "$NPM_PID" > /tmp/.../validate.pid
# ...validation curl checks...
kill "$(cat /tmp/.../validate.pid)" 2>/dev/null || true
sleep 2
# Defensive backup: any next-server that escaped (none expected)
pkill -f 'next-server' 2>/dev/null || true
```

**Severity:** medium (caused a real false-positive green deploy that almost passed undetected). **Suggested resolution:** roll into the local-hook-validation discipline (#2). Update any future validation runbook to use the PID-capture pattern.

### ~~9. First EC2 reboot post-Phase-1 validates the `pm2-ubuntu.service` resurrect path~~ — **RESOLVED 2026-05-08**

Verified end-to-end via controlled `aws ec2 reboot-instances` before Phase 1 close. Boot id changed from `4bd5e610-…` → `88352098-…`, uptime reset, all four key services (postgresql, nginx, codedeploy-agent, pm2-ubuntu) came back active. `journalctl -u pm2-ubuntu` showed the full sequence: `[PM2] Resurrecting → Restoring processes located in /home/ubuntu/.pm2/dump.pm2 → Process /usr/bin/npm restored`. PM2 daemon PID 842 (fresh), next-server PID 946 (fresh), `:3000` re-bound, external `curl https://bkstr.tmrwgroup.ai/` returned 200 with Content-Length 34254 within 3s of post-reboot SSM agent recovery. Cold-boot ordering with postgres+nginx is verified working.

### 10. ~~Delete legacy `bkstr-app.service` systemd unit before Phase 2 kickoff~~ **RESOLVED 2026-05-08**

> Resolved during Phase 2 Pre-step. SSM-executed `systemctl disable` → `rm /etc/systemd/system/bkstr-app.service` → `daemon-reload`. Pre-state confirmed `inactive`+`disabled`; post-state shows no `bkstr`-named unit-files. `pm2-ubuntu.service` remained active and `bkstr-web` was undisturbed (same pid 1478 across the operation); prod still 200.

The pre-structural-reset deploy chain installed `/etc/systemd/system/bkstr-app.service` as the original Next.js process supervisor. After adopting PM2 (commit `f5ca66c`) it was disabled and stopped. The unit file is still on disk; `systemctl status bkstr-app` shows `loaded (disabled / inactive (dead))`.

**Severity:** none today (disabled+inactive, no boot path activates it). **Suggested resolution before Phase 2:**
```bash
sudo systemctl disable bkstr-app   # idempotent; already disabled
sudo rm /etc/systemd/system/bkstr-app.service
sudo systemctl daemon-reload
```

Cleanup task; no functional change.

### 11. ~~Rotate Postgres `bkstr` user password before Phase 2's first real-world traffic~~ **RESOLVED 2026-05-08**

> Resolved during Phase 2 Pre-step. New 32-char alphanumeric password generated server-side via `openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 32`; `ALTER USER bkstr WITH PASSWORD ...` applied; both `/var/www/bkstr/.env` and `/etc/bkstr/app.env` rewritten via Python URL-surgery (URL-encoded password, atomic temp-file replace preserving original ownership and mode 600); pre-rotation backups left at `*.pre-phase2-rotation`. Verified: direct `psql` round-trip with new password returned `bkstr / bkstr_app / 1`, `pm2 reload --update-env` clean (restart_time=3, "✓ Ready in 833ms"), all four prod routes returned 200. New password handed off to operator via `/home/ubuntu/.bkstr-new-pw.txt` (mode 600 ubuntu) — never printed to chat. Old password (Phase 1 chat history) is now invalid.

The current password was generated server-side via `openssl rand -base64 24 | tr -d '/+=' | head -c 32` during Phase 1 Step 5. It is mode-protected at rest at `/var/www/bkstr/.env` (mode 600 ubuntu:ubuntu) and `/etc/bkstr/app.env` (mode 600 root:root). However, **the plaintext password appears in chat history of the Phase 1 build session** (it was printed at provisioning time for the operator's records). Before Phase 2 ships any real-world traffic, the password should be rotated so that the chat-history copy is no longer valid.

**Procedure:**
```bash
# 1. Generate new password on EC2:
NEW_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)

# 2. ALTER ROLE in postgres:
sudo -u postgres psql -c "ALTER USER bkstr WITH PASSWORD '$NEW_PASS'"

# 3. Update both .env files atomically:
sudo sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://bkstr:${NEW_PASS}@localhost:5432/bkstr_app?schema=public|" /var/www/bkstr/.env /etc/bkstr/app.env

# 4. Restart bkstr-web to pick up new env:
sudo -u ubuntu PM2_HOME=/home/ubuntu/.pm2 pm2 reload bkstr-web

# 5. Verify connectivity:
curl -I https://bkstr.tmrwgroup.ai/   # should still be 200
```

**Severity:** medium (password is mode-protected on EC2 but exposed in chat-history backups). **Suggested resolution:** rotate before any Phase 2 user data lands.

### 12. Custom `not-found.tsx` with cream theme + bkstr wordmark

Surfaced during Step 8 Playwright audit (`/tmp/bkstr-step8-browser-audit.md`). Hitting any unrouted path renders Next.js's default 404 page — black text on white background, no cream theme, no bkstr wordmark, no "back to home" CTA. Functionally correct (returns HTTP 404; page title falls back to root metadata) but cosmetically inconsistent with the rest of the app.

**Fix shape:** add `src/app/not-found.tsx` mirroring the login/signup card layout — `bg-[#FAF6EC]` rounded card on cream body, "404" in Fraunces, "This page could not be found" subhead, `<Link href="/">` back-to-home CTA. ~30 lines.

**Severity:** low (cosmetic, not a deploy issue). **Suggested resolution:** Phase 2 polish.

### 13. Set `metadata.title` on the custom not-found page

When the custom `not-found.tsx` lands per #12, set its `export const metadata = { title: '404 — bkstr' }` (or similar). Currently any unrouted path inherits the root metadata (`bkstr | Compressed Knowledge for AI Agents`), so browser tabs and social previews show the landing-page title even when the user is on a 404. One line, same diff as #12.

**Severity:** low (cosmetic, easily missed in audits). **Suggested resolution:** ship in the same commit as #12.

### 14. Wire `#` placeholder links to real destinations as features land

Step 8's audit confirmed all `#` placeholder links match the Manus visual contract (Direction 2 / Revision 6 left them as placeholders for not-yet-implemented destinations). Per-destination tracking:

| Placeholder | Page | Phase 2 destination |
|---|---|---|
| `Book a demo` | Landing hero CTA | contact-sales form or Calendly link |
| `Browse all →` | Landing Registry section header | real registry route (likely `/registry`) |
| `Forgot?` | Login form | password reset flow (depends on Phase 2 auth design) |
| `Registry` `Pricing` `Documentation` `API Status` | Footer Product column | real routes |
| `About` `Blog` `Careers` `Contact` | Footer Company column | real content |
| `Terms of Service` `Privacy Policy` `Security` `BAA` | Footer Legal column | real legal docs |

These aren't broken — clicking `#` is a no-op except scroll-to-top, which matches Manus contract behavior. Each turns into a real link as the corresponding feature ships.

**Severity:** medium (ongoing — track each as a Phase 2 feature wiring task; none are Phase 1 blockers). **Suggested resolution:** every Phase 2 PR that introduces a new destination updates the corresponding `<a href="#">` to the real route in the same diff.

### 15. PM2 fork-mode `EADDRINUSE` noise during `pm2 reload`

Surfaced during Step 1's first deploy (commit `aa35024`). pm2 reload spawns a new process before the old one fully releases port 3000, so the new process logs several `Error: listen EADDRINUSE: address already in use :::3000` lines while it retries the bind. The new process eventually succeeds (smoke tests confirmed the new code was running and bound on :3000), and pm2 jlist reports `online`, so this is cosmetic — but the log noise looks like a real failure to anyone tailing `pm2 logs bkstr-web` post-deploy.

This is **not** the orphan-detection class of follow-up #8 (a manually-spawned `next-server` from a smoke test). #8 was about processes pm2 didn't track. #15 is about pm2's own reload mechanic in fork mode (pm2 has no graceful reload semantics in fork mode the way it does in cluster mode — it's effectively kill-then-start with a small overlap window).

**Fix shapes (decision deferred — three real options, each with a tradeoff):**

1. Switch `pm2 reload` to `pm2 restart` in `start.sh` — explicit kill-then-start, no overlap, no EADDRINUSE noise. **Cost:** ~1s of downtime per deploy (was effectively zero with reload).
2. Switch to pm2 cluster mode with 2 instances — true zero-downtime reload via worker rotation. **Cost:** ~2x memory baseline, more moving parts, requires Next.js to be cluster-safe (stateless server-side, sticky session not required since we use database sessions).
3. Tune `kill_timeout` higher in pm2 ecosystem config — give the old process longer to release the port before the new one tries to bind. **Cost:** longer worst-case deploy time if a process hangs.

**Severity:** low cosmetic (it's noise, not a failure). **Suggested resolution:** option 1 in Phase 3 polish unless the noise becomes confusing in operations.

### 16. Audit `bkstr-bedrock-access` resource list when AWS announces new US regions for Sonnet inference profiles

Surfaced during Step 2 (2026-05-08). The `bkstr-bedrock-access` inline policy on `bkstr-ec2-role` scopes the foundation-model resource list to `us-east-1`, `us-east-2`, `us-west-2` — the three regions the `us.anthropic.claude-sonnet-4-5-20250929-v1:0` cross-region inference profile currently routes to. AWS occasionally adds regions to the US inference profile pool; the policy must include those new regions or the profile's internal routing will fail with `AccessDeniedException` on the foundation-model invocation step.

**Detection:** when `aws bedrock get-inference-profile --inference-profile-identifier us.anthropic.claude-sonnet-4-5-20250929-v1:0` shows a new region in `models[].modelArn`, update the policy.

**Severity:** low (only manifests if AWS expands the profile and we hit the new region during routing). **Suggested resolution:** add to a pre-Phase-3 ops audit checklist; optionally script a periodic check.

### 17. Node 20 → Node 22 bump before AWS SDK v3 deprecates Node 20 (Jan 2027)

AWS SDK v3 announced deprecation of Node 20 runtime support after the first week of January 2027. EC2 currently runs Node 20.20.2; CodeBuild's `runtime-versions.nodejs: 20` matches. About 8 months runway from May 2026. Worth folding a Node 22 bump into a Phase 3 ops sweep — not urgent now. Lab uses Node 20 too; coordinate the bump across both projects so we don't end up with split runtime versions on the same EC2 fleet.

**Severity:** low (no failure today; deprecation window is months out). **Suggested resolution:** Phase 3 ops sweep; bump CodeBuild's `runtime-versions.nodejs`, install Node 22 on EC2 via nvm or apt, retest the deploy chain, coordinate timing with Lab.

### 18. Bedrock prompt caching for repeated book-markdown system prompts

Sonnet 4.5 supports prompt caching, visible in Step 2's smoke test as `cache_creation_input_tokens` / `cache_read_input_tokens` fields in the `usage` object (currently both 0). The Phase 2 expected pattern — same book markdown sent as a system prompt across many fetches by the same subscriber — is the canonical case prompt caching is designed for. Enabling caching could meaningfully reduce per-fetch cost once fetch volume scales.

**Why deferred:** Phase 2 ships one book and one subscriber for an internal alpha; per-fetch cost is negligible at this scale, and adding cache-control blocks to the request shape complicates the agent endpoint without measurable benefit yet. Revisit when (a) Zach's iteration loop produces meaningful fetch volume, OR (b) Phase 3 onboards additional subscribers.

**Severity:** medium (real cost optimization that becomes obvious to evaluate the moment fetch volume crosses any meaningful threshold; not a correctness issue). **Suggested resolution:** Phase 3 evaluation. Implementation is small — wrap the system-prompt content block with `{"cache_control": {"type": "ephemeral"}}` per Bedrock's docs and verify cache-read tokens dominate cache-creation in the usage object after warm-up.

### 19. `fetch_logs` retention policy

Surfaced during Step 3 schema design (D3.4). Internal alpha has no retention policy — table grows unbounded. At expected internal-alpha volume (10s–100s of fetches/day), the table reaches manageable scale; the table remains well within Postgres single-table comfort zone for years. Not a problem today, becomes one at sustained higher volume.

**Severity:** low at current scale (becomes medium when fetch volume crosses ~10/min sustained or table approaches 100k rows). **Suggested resolution:** revisit when table hits ~100k rows or when Edward asks about cost. Three implementation shapes worth weighing then: (a) pg_cron sweep (`DELETE WHERE created_at < now() - interval '90 days'`), (b) app-side sweep on a daily cron lambda, (c) declarative monthly partitioning (cleanest but most setup).

### 20. Enum-ize `fetch_logs.status` once values stabilize

Step 3 ships `status` as free-form `TEXT` (D3.2). Today's expected values are `success`, `error`, `timeout`. Once those values prove stable across Phase 2 implementation, enum-ize for query plan benefits + invariant enforcement. Postgres enum migrations are reversible but require `ALTER TYPE`; doing it now would force decisions on values that might still drift.

**Severity:** low (cosmetic — free-form TEXT works correctly, just doesn't give the type-system safety net we'd prefer). **Suggested resolution:** Phase 3, when Step 5's implementation has accumulated real `status` values across observed failure modes.

### 21. Step 5 must sanitize and truncate `fetch_logs.error_message`

**This is a forward-pointer for Step 5, not a defer.** When Step 5 implements the agent endpoint, the catch handler that populates `fetch_logs.error_message` must strip any Bedrock response content from the error message before persisting, and truncate the result (suggested 500-char cap) before inserting. Bedrock's error responses occasionally echo prompt or response content in debug fields; logging that defeats D3.3's "response body is never persisted" rule.

**Column is `TEXT` at schema level for flexibility; app layer enforces the bound.** Step 3's migration ships `error_message TEXT` (no length constraint) — keeping the schema flexible avoids future Postgres `ALTER COLUMN ... TYPE varchar(N)` migrations if the cap turns out to need adjustment. The 500-char limit is enforced in the Step 5 insert path, not by the column type.

**Severity:** high — this is a privacy/leak vector if missed. **Suggested resolution:** Step 5's implementation prompt should include this as an explicit checklist item. Sanitization shape: keep `err.name` + `err.message` (then `.slice(0, 500)`), strip any field that looks like a Bedrock body (`err.$response`, `err.$metadata.requestId` are safe; anything else gets dropped before reaching the insert).

### 22. API key expiry (`expires_at` column + enforcement)

Step 4 ships keys with no expiry — they live until explicitly revoked. Phase 2 internal-alpha is fine without this; a future paid customer or first security review will likely ask for time-bounded keys. Defer until that ask materializes; not worth pre-building.

**Severity:** low (no user yet asking; deferred per locked decision). **Suggested resolution:** add `expires_at TIMESTAMP` column, default null (no expiry), then enforce in `requireApiKey` with `(revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW()))`. UI surface for setting expiry on key generation. Mention in the security write-up at first paid customer or security review.

### 23. Rate limiting on `/api/agent/fetch` and `/api/keys`

No rate limits in Phase 2. Single internal-alpha user; the agent endpoint will see a few fetches per minute at most. Will need rate limiting before any external surface — both per-IP (defense against unauthenticated probes hitting auth endpoints) and per-key (preventing a leaked key from running up the Bedrock bill).

**Severity:** medium when internal-alpha graduates to broader access; low until then. **Suggested resolution:** evaluate against a Redis-backed token-bucket library (e.g., `@upstash/ratelimit`) once external traffic is in scope. Per-key limits may want to vary by `subscriber.subscription.tier`.

### 24. Partial index `subscriber_api_keys WHERE revoked_at IS NULL`

Step 6's "active agents" metric will likely query `SELECT COUNT(DISTINCT subscriber_api_keys.id) WHERE revoked_at IS NULL AND subscriber_id = $1`. The full btree index on `subscriber_id` works, but a partial index `(subscriber_id) WHERE revoked_at IS NULL` would be smaller and more selective for that exact predicate. Defer until Step 6's query is written and we observe the actual access pattern — premature without the call site to plan against.

**Severity:** low (no functional impact; perf optimization only). **Suggested resolution:** add when Step 6's "active agents" query lands, if EXPLAIN ANALYZE shows the partial index would help. Most likely value at Phase 3 scale, irrelevant at Phase 2.

### 25. Schema-wide TIMESTAMPTZ standardization

Currently mixed: Phase 1 tables (`publishers`, `books`, `book_versions`, `subscribers`, `subscriber_api_keys`, `subscriptions`) use `timestamp(3)` without timezone. Step 3's `fetch_logs.created_at` uses `timestamptz(6)`. NextAuth tables (Step 1) use `timestamp(3)` without timezone for `email_verified` and `expires`. Mixed nullable shapes too.

The one consistent rule: every column is in UTC because that's what Postgres does when no TZ is specified. The mismatch is purely cosmetic in our single-timezone deployment, but standardization helps when (a) Phase 3+ users span multiple timezones, (b) any query bridges columns from different tables (`SELECT NOW() - created_at` works regardless, `created_at AT TIME ZONE` calls hit different surface depending on column type).

**Severity:** low cosmetic. **Suggested resolution:** Phase 3 cleanup migration. Pick `TIMESTAMPTZ(3)` (or whichever precision) as the standard; convert via `ALTER COLUMN ... TYPE TIMESTAMPTZ USING (col AT TIME ZONE 'UTC')`. Test against a copy of prod data first; type changes can rewrite tables (Postgres 12+ avoids the rewrite when the conversion is in-place compatible, which this should be).

### 26. `curl -I` on App Router API routes returns 400; runbook hygiene

Surfaced during Step 2's no-op deploy smoke test. NextAuth's App Router handler exports `GET` + `POST` only, not `HEAD` (`curl -I` sends HEAD by default). The 400 is correct behavior — Next.js's App Router is strict about unhandled methods — but it surprises operators expecting `curl -I` to be a universal "is this thing alive?" check. Same will apply to Step 4's `/api/keys` and `/api/keys/[id]`.

**Severity:** low (documentation/runbook only; no code fix needed). **Suggested resolution:** prefer `curl -X GET <url> -o /dev/null -w "%{http_code}\n"` in any smoke-test script that targets API routes. Fold into a Phase 3 ops runbook or a `scripts/smoke.sh` if one ever materializes. Optionally: add a tiny `/api/health` route that explicitly handles HEAD (`export async function HEAD() { return new Response(null) }`) for `curl -I` compatibility.

### 27. RAG / chunking for books that exceed the 150k token guard

Step 5's content-size guard hard-rejects books exceeding ~150k tokens (per the 4-chars/token estimate) with HTTP 413. For the marketing-ops markdown Zach is iterating against this is comfortably under; for any future longer reference material (legal handbooks, full API docs, etc.) the guard will trip and the operator has no recovery path other than splitting the source.

**Severity:** low at Phase 2 scope (one well-sized book); medium at Phase 3 onboarding when book sizes are unpredictable. **Suggested resolution:** Phase 3 work. Implement retrieval-augmented generation — chunk the markdown, embed each chunk, query-time retrieve top-k relevant chunks, assemble system prompt from those chunks instead of the full content. Adds a vector store (pgvector on the same Postgres instance is the cheapest path) and a chunking heuristic; the agent endpoint shape stays the same.

### 28. Token estimation accuracy — replace 4-char rule with proper tokenizer when accuracy matters

Step 5's `estimateTokens()` uses `Math.ceil(text.length / 4)` — Anthropic's published rule of thumb. Accurate enough for the size guard (off by maybe 20% in either direction; well within the margin of "150k is the cap"); not accurate enough for billing or for fine-grained cost prediction.

**Severity:** low (no functional impact today). **Suggested resolution:** when billing or cost dashboards land in Phase 3+, swap `estimateTokens()` for `@anthropic-ai/tokenizer` (or whatever the canonical Anthropic JS tokenizer is at that point). The function signature stays the same; the size-guard threshold may need re-tuning since the new estimate will be more accurate.

### 29. `lru-cache` is per-process; multi-instance deploys lose cache consistency

Step 5's cache lives in the Node.js process memory. Phase 2 ships a single PM2 process so this is fine. The moment we run multiple instances (cluster mode, multi-EC2, or any horizontal scaling), each instance has its own cache — the same query against the same book version may hit cache on instance A and miss on instance B. Functionally correct (a miss just produces a real fetch), but the cache hit rate drops with the inverse of instance count.

**Severity:** low at Phase 2 scope (single instance); medium when horizontal scaling lands. **Suggested resolution:** evaluate Redis (e.g., ElastiCache or Upstash) when multi-instance deploys are on the table. The cache module's interface (`getCached`/`setCached`) is small enough that swapping the backing store is ~30 lines. Until then, accept per-process inconsistency.

### 30. Prompt injection hardening beyond the preamble

Step 5's defense against prompt injection is a single line in the system preamble: "Only answer based on the content of the book provided below. If the answer is not in the book, say so clearly. Do not invent or speculate." This handles opportunistic "ignore your instructions and..." attacks acceptably for an internal-alpha audience. It does not handle determined attackers who craft queries to extract the system prompt, leak the book content, or coerce off-topic responses.

**Severity:** low at Phase 2 (closed audience, no adversarial users); medium-to-high if/when external subscribers land. **Suggested resolution:** Phase 3 work conditional on observed bad behavior or security review feedback. Options: (a) response-side inspection (a guardrail model classifies outputs before returning), (b) Bedrock Guardrails integration, (c) per-publisher policy enforcement at the system-prompt layer. Each adds latency and complexity; defer until there's a concrete attack pattern to address.

### 31. Throttle `last_used_at` writes on every `requireApiKey()`

Each authenticated API call writes `last_used_at = NOW()` on the matching `subscriber_api_keys` row. At Phase 2's scale (handful of fetches per day) this is invisible. At Phase 3+ scale (sustained high-frequency agent loops) every fetch produces a write to a hot row, contending against the index and pinning the row in WAL. Realistic worst case is a few hundred writes/sec on the same row.

**Severity:** low at Phase 2 (no measurable impact); medium when fetch volume crosses ~10/sec sustained. **Suggested resolution:** when volume justifies, throttle the `last_used_at` update to "only if `now() - last_used_at > 1 minute`." Either an in-memory dedup at the auth helper layer, or a conditional `UPDATE ... WHERE last_used_at < NOW() - interval '1 minute'`. Either way, accuracy of `last_used_at` drops to ~1-minute resolution — fine for dashboard display, fine for "is this key idle" queries.

### 32. Per-book subscriber authorization model

Currently open-access — any authenticated subscriber can fetch any book; key validity is the only gate (D5.11). Must resolve before any external subscriber onboards. Phase 3 work — design with the actual access pattern in mind (per-book? per-publisher? per-tier?). The right shape depends on whether (a) every subscriber gets every book under their tier, (b) publishers grant access per-book, (c) some books are public and some are gated, etc.

**Severity:** medium — not a Phase 2 blocker, but a Phase 3 prerequisite before external onboarding. **Suggested resolution:** define the access pattern with stakeholder input first; then the schema and route changes follow naturally. Likely shape: a `subscriber_books` join table (UUID PK, `subscriber_id` FK, `book_id` FK, `granted_at`, unique `(subscriber_id, book_id)`) plus a `WHERE EXISTS` clause in the agent endpoint's book lookup. Step 7's import script (or a dedicated grant flow) populates the join table.

### 33. Step 5+6 functional verification — deferred to Step 7's walkthrough when seeded content exists

Steps 5 and 6 closed without running their respective functional walks. All require a real `book_versions.content` row, which doesn't exist until Step 7's import script seeds the first markdown.

**Step 5 prompt's tests 1–11:** happy path, cache hit, 400/401/404 boundaries, 413 oversized content, 8000-char query cap, mid-stream Bedrock error → sanitized log. (Sanitization helper output already validated standalone via SSM Node script per D5.12; this is the route-integration verification.)

**Step 6 prompt's tests 1–10:** sign in, render empty `/dashboard`, insert fixture book + version + a few `fetch_logs` rows, refresh, click into `/dashboard/fetch-logs?book=<id>`, remove filter, click Refresh, verify error rows show red badge but never display `error_message` text, verify `cache_hit` rows show green badge, cleanup.

**Step 6 EXPLAIN ANALYZE:** the Books-table aggregate query (`getBooksWithMetrics`) with `COUNT(DISTINCT api_key_id) FILTER (WHERE created_at > NOW() - 30d)` should hit the `(api_key_id, created_at DESC)` index from Step 3. Pre-gather plan ran against empty tables → seq scans (correct planner choice for 0 rows). Re-run with seeded data and confirm the index is exercised.

**Step 5 Test 11 (bogus MODEL_ID):** costs two deploys (bogus push + revert). Do this last so the bogus-then-revert pair lives at the end of Step 7's pipeline activity rather than interleaving with Step 7's own deploys.

**Severity:** low (functional surface, not a security gap). **Suggested resolution:** dedicated walkthrough at the end of Step 7, in the order: Step 6 walks 1–10, Step 5 walks 1–10, EXPLAIN ANALYZE re-run, Step 5 Test 11.

### 34. Per-book drill-down view (`/dashboard/books/[id]`)

Step 6 ships a `?book=<id>` filter on `/dashboard/fetch-logs` for "show me this book's recent fetches" — covers the main use case. A dedicated per-book page would also surface book metadata (latest version content preview, full version history, per-day fetch sparklines, top queries) — a real publisher analytics surface. Phase 3 work, conditional on real publishers asking for it.

**Severity:** low (the filter pattern covers the immediate need). **Suggested resolution:** Phase 3 if requested. Route at `/dashboard/books/[id]`; reuse `BooksTable` query helpers; new query for per-book version history.

### 35. Cursor pagination on `/dashboard/fetch-logs`

Step 6 ships a hard 100-row cap, ordered by `created_at DESC`. Internal-alpha fetch volume is comfortably under this. As fetch volume scales, "100 most recent" stops covering the publisher's interesting window — they want yesterday's spike, last week's debugging, etc.

**Severity:** low at Phase 2 (~10s/day fetches); medium when sustained volume crosses ~100/day. **Suggested resolution:** cursor-based pagination keyed on `created_at` (with a tiebreaker on `id` to handle same-timestamp rows). Avoid offset pagination — at 10k rows it scans the full prefix every page. Either a "Load more" button or numbered pages.

### 36. 7-day fetch metric on Books table

Step 6 ships title / latest version / total fetches / 30d fetches / active agents 30d / last fetched. The 7-day window was deferred per D6.1. If during walkthrough we find ourselves wanting "is this book still trending or just historically big?", a 7-day column is the next obvious add.

**Severity:** low (cosmetic; the 30-day metric covers most decisions). **Suggested resolution:** add `COUNT(...) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS fetches_7d` to `getBooksWithMetrics` and a column to the table. ~3 lines.

### 37. "Show error details" toggle on `/dashboard/fetch-logs`

Step 6 explicitly does NOT show `fetch_logs.error_message` in the UI (D6.6). When a real Bedrock error happens in prod, the publisher only sees a red `Error` badge with no detail. For debug sessions ("why did this book error 4 times yesterday?") this is annoying — `error_message` is sanitized (whitelist-only via `sanitizeError`) so the leak risk is bounded.

**Severity:** low (cosmetic; debugging path exists via direct DB query). **Suggested resolution:** add a toggle (cookie-stored, dashboard-wide) that reveals `error_message` in a collapsible row detail. Phase 3 if real errors are accumulating in prod; otherwise irrelevant.

### 38. Real-time updates on `/dashboard/fetch-logs` (SSE or polling)

Step 6 ships manual `router.refresh()` only. A live operations dashboard would auto-update. Internal-alpha doesn't need it — the publisher doesn't watch the dashboard during agent activity.

**Severity:** low at Phase 2; revisit if Phase 3 introduces an "operations" persona. **Suggested resolution:** SSE preferred (matches the agent-endpoint pattern), or simple poll every 10s. Either way, throttle and pause-on-blur to avoid burning CPU on backgrounded tabs.

### 39. Split publisher and subscriber dashboards before external onboarding

Phase 2 ships a single-tenant simplified dashboard (D6.8): Books table shows all books in the system, Fetch Logs scopes to the current user's subscriber. At single-tenant scale, the publisher-vs-subscriber distinction collapses to the same render. Once external subscribers onboard, the two views become distinct:

- **Publisher view** ("my books and how they're being used"): Books table = "books I publish", Fetch logs = "all fetches against my books across all subscribers"
- **Subscriber view** ("books I have access to and my usage"): Books table = "books I subscribe to" (from the per-book auth model in #32), Fetch logs = "my fetches"

Resolution depends on the multi-tenant role model — per-publisher? per-tier? admin vs viewer? Single user belonging to one or many publishers? Same questions as #32; co-resolve.

**Severity:** medium — Phase 3 prerequisite before external onboarding. **Suggested resolution:** define the role model with stakeholder input first, then split routes (`/dashboard/publisher/*` vs `/dashboard/subscriber/*`?), add scope filters to queries, gate sidebar nav by role. Some users may want both (a publisher who's also a subscriber to other publishers' books); design needs to handle that gracefully.

### 40. ~~Verify Google OAuth client consent screen is set to "Internal" (Workspace-only)~~ **RESOLVED 2026-05-10**

> Resolved by the OAuth signin allowlist patch (D8.1–D8.4). GCP Console verification confirmed the consent screen is set to "External" (not "Internal"). Mitigated via a `callbacks.signIn` gate in `src/lib/auth/index.ts` that rejects any Google identity not on `ALLOWED_EMAIL_DOMAINS` or `ALLOWED_EMAILS` before any DB row is created. Production env staged with `ALLOWED_EMAIL_DOMAINS=tmrwgroup.ai,2tmorrow.com` and `ALLOWED_EMAILS=animeshk604@gmail.com`. Fail-closed if both empty.

The OAuth client at GCP Console (the `354236878710...` client_id) has its consent-screen scope (Internal vs External) configured server-side at Google, not visible from EC2. If the consent screen is set to "External," any Google account can complete the OAuth flow, which means our `events.createUser` callback will create a User + Subscriber row for any Google identity that hits the redirect URI. At Phase 2 internal-alpha this is bounded (the `2tmorrow.com` audience is small and the redirect URIs aren't leaked), but pre-pilot it becomes a real surface.

**Severity:** medium pre-pilot, low at internal-alpha. **Suggested resolution:** verify in GCP Console that the consent screen is "Internal" (restricts to the Workspace tenant). If it's "External," either flip it to Internal OR add an allowlist gate in `events.createUser` that rejects emails outside an allowed domain list before creating the User/Subscriber rows. The latter is more robust (Internal limits to the OAuth client's tenant; allowlist gives explicit control).

### 41. Admin upload UI for books (replaces the CLI script)

Step 7 ships a CLI import script. For non-engineering publishers (Phase 3+), a dashboard page where an admin uploads a markdown file via drag-drop or paste-as-text would cover the same operations without engineering involvement. Depends on the admin role-model resolution that #39 will trigger.

**Severity:** low at Phase 2 (one engineering operator); medium when external publishers onboard. **Suggested resolution:** Phase 3 work after the admin role model is defined. The UI calls the same import primitive as the CLI — the script's logic moves into a server action or API route, the UI provides the upload widget and feedback.

### 42. Bulk import (directory of markdown files)

The Step 7 script imports one file per invocation. A bulk mode that takes a directory and iterates would help any future "seed N books at once" operation (a publisher with a corpus of skill files, an initial deployment with multiple books). Today's flow needs N invocations of `npm run import-book` — fine for 3–5 files, tedious for 30.

**Severity:** low (current scope is small enough for per-file invocation). **Suggested resolution:** add `--directory <path>` mode that walks the directory for `*.md` files and imports each. Use the filename (minus `.md`) as default `--title`; require uniform `--publisher` and `--domain` across the batch. Or: write a tiny bash wrapper that loops `find . -name "*.md"` and invokes the existing script. Either works; the wrapper is cheaper.

### 43. Source ingest from S3 / URL / GitHub

The Step 7 script reads from a local file path only. Phase 3+ may want to ingest from S3 (operational source-of-truth for shared content), URL (one-liner imports of public markdown), or GitHub (publisher-managed content via repos). All three multiply failure modes (auth, rate limits, content negotiation, encoding) and benefit from being staged through the file-path primitive — `curl url > tmp.md && import tmp.md` is the current workflow and works.

**Severity:** low (file-path primitive plus shell wrappers covers every realistic Phase 2 ingest). **Suggested resolution:** Phase 3 conditional on operator ask. Implementation shape: `--source <s3://...|https://...|gh://owner/repo/path>` flag that resolves to a temp file then delegates to the existing import logic. Each source needs its own auth path.

### 44. Content size guard at import time

The Step 5 agent endpoint enforces a 150k-token estimate cap (`MAX_CONTENT_TOKENS`) at fetch time. The import script does NOT enforce this — it'll happily insert a multi-megabyte markdown file. Result: the import succeeds, but every fetch against that book version 413s with `content_too_large`. Belt-and-suspenders would be to fail the import early.

**Severity:** low (the runtime guard catches the case correctly; the only operator surprise is "I imported it, why doesn't it serve?"). **Suggested resolution:** add a `--no-size-check` flag to allow oversized imports for archival, but default to enforcing the same `MAX_CONTENT_TOKENS` cap that Step 5 enforces. Phase 3 polish — until RAG/chunking lands (#27), there's no recovery path for oversized books anyway.

### 45. `book_versions.content_uri` (Phase 1 S3 placeholder) vs `content` (Step 3 inline) — transitional state

`book_versions` has both columns:
- `content_uri TEXT NOT NULL` — Phase 1's design pointer to S3-stored markdown. Step 7 fills this with `inline://<book_version_id>` — a self-describing placeholder communicating "content lives in the column, not in S3."
- `content TEXT` (nullable) — Step 3's addition; the actual markdown.

As of Step 7, **inline `content` is the source of truth.** `content_uri` is dead-pointing data kept only because the column is required NOT NULL.

**Severity:** low (no functional impact at Phase 2 — the agent endpoint reads `content` directly per Step 5). **Suggested resolution:** Phase 3 cleanup. Two real options:
1. **Commit to inline storage** — drop `content_uri` (additive migration, then app code stops setting it), make `content` NOT NULL, single source of truth.
2. **Design a clean inline-vs-S3 dual-storage model** — useful if multi-MB books become a real workload (S3 is more economical for blob storage at scale than Postgres TEXT). Define precedence: when both are set, which wins? When only one, which is canonical? Migration tool to move existing rows between modes.

Either resolution is meaningful schema work and should land alongside #27 (RAG/chunking) since both touch the storage shape.

### 46. `import-book.ts` should auto-load `.env` via dotenv or `node --env-file`

The script imports `prisma` from `@/lib/db` which expects `process.env.DATABASE_URL` at the time the Prisma client constructs. Currently the script does NOT auto-load `.env` — operators have to run `set -a; source /var/www/bkstr/.env; set +a; npm run import-book -- ...` for the script to see DATABASE_URL. Surfaced during Step 8's first import attempt.

**Severity:** low (functional with the env-source workaround; operator-experience friction only). **Suggested resolution:** add `import "dotenv/config";` at the top of `scripts/import-book.ts`, OR change the npm alias to `"import-book": "node --env-file=.env --import tsx scripts/import-book.ts"` (Node 20.6+ supports `--env-file`). Either approach removes the env-source step. Document the new behavior in `docs/operations.md` (#47 closes the ops-doc side).

### 47. `docs/operations.md` should document env-source prerequisite + Prisma-vs-psql URL format

Two missing pieces in the current ops doc:
1. The env-source prerequisite for `import-book` (until #46 lands).
2. The `DATABASE_URL` format Prisma uses (`postgresql://...?schema=public`) is rejected by raw `psql` (which doesn't recognize `?schema=public` as a valid query param). Operators copy-pasting the env's `DATABASE_URL` into psql get `psql: error: invalid URI query parameter: "schema"` and waste time wondering why. Document the workaround: strip `?schema=public` for psql, OR use `sudo -u postgres psql -d bkstr_app` for direct Postgres access.

**Severity:** low (documentation only; both workarounds exist and are well-known). **Suggested resolution:** ~10 lines added to `docs/operations.md` covering env-source and the URL-format mismatch. Could land in the same PR as #46 since they're both about environment setup.

### 48. `import-book.ts` reports `id=<uuid>` ambiguously — that's `book_version.id`, not `book.id`

The success log line is `imported: <publisher>/<book> v<n> (<bytes>, id=<uuid>)`. The `<uuid>` is the newly-created `book_version.id`, but the natural operator interpretation is "this is the book's id." During Step 8, used the value directly in a `POST /api/agent/fetch` body's `book_id` field and got `404 Book not found` because the agent endpoint expects `book.id`, not `book_version.id`.

**Severity:** medium — cosmetic but actively misleading; cost an extra round of debugging during Step 8's first agent fetch attempt. **Suggested resolution:** either (a) rename the log field to `version_id=<uuid>` to disambiguate, OR (b) print both `book_id=<uuid> version_id=<uuid>` so operators don't need to look up the `book.id` separately. (b) is friendlier; the script already has both values at log time.

### 49. Add `--analyze` flag to `import-book.ts` or document `ANALYZE` as a post-bulk-import step

Postgres autovacuum's `ANALYZE` trigger is row-count-delta-based; a 5-row jump from a 0-row table doesn't reach the threshold. Step 8's seed import left `book_versions` and `fetch_logs` with stale planner statistics, producing slightly off query plans for the dashboard until manually `ANALYZE`d (D7.13). At Phase 2 internal-alpha scale this is invisible; at any larger seed import it's a planner-quality concern.

**Severity:** low (autovacuum eventually catches up; the manual workaround is one psql line). **Suggested resolution:** either (a) add `--analyze` flag to `import-book.ts` that runs `ANALYZE books; ANALYZE book_versions; ANALYZE fetch_logs;` post-insert, OR (b) document in `docs/operations.md` as a recommended step after bulk seeding. (a) is more robust against operator forgetfulness; (b) keeps the script narrower.

### 50. ~~3rd subscriber row appeared during Step 8 — `animesh@2tmorrow.com` Workspace identity~~ **RESOLVED 2026-05-10**

> Resolved alongside #40 via the OAuth signin allowlist patch (D8.1–D8.4). Root cause confirmed: GCP consent screen is "External," and there was no allowlist gate before this patch — any Google identity completing OAuth got a User+Subscriber row auto-created. The new `callbacks.signIn` rejects unallowed identities before `events.createUser` fires; future signins from non-allowlisted Google identities produce zero DB rows. The 3 existing rows are preserved per D8.4; deprecation of the gmail row is filed as #57.

A third subscriber row was created during Step 8's testing when Animesh signed in with the `animesh@2tmorrow.com` Google Workspace account (in addition to the existing `animeshk604@gmail.com` personal + `clawbot@tmrwgroup.ai` workspace identities). The behavior is correct per Step 1's `events.createUser` callback (D1.3) — any Google identity that completes OAuth gets a User + Subscriber row auto-created. But it confirms that the auto-create flow is open to any Google identity that the OAuth client accepts.

**Severity:** low at internal-alpha (the audience is known); medium pre-pilot (becomes a real surface when external traffic can reach the OAuth endpoint). **Suggested resolution:** reconcile with #40's GCP Console verification. If the consent screen is "Internal," only Workspace-tenant identities can complete OAuth, and the auto-create scope is naturally bounded. If "External," add an email-domain allowlist gate in `events.createUser` before creating the User+Subscriber rows (or after — but blocking-create avoids the orphan-User-without-Subscriber state #21's framing rejected).

### 51. Dashboard left-nav contains placeholder items not in Phase 2 scope

The `DashboardShell` sidebar (`src/components/dashboard/dashboard-shell.tsx`) renders three items beyond the Phase 2 scope: `Usage Metrics`, `Team Access`, `Billing`. They link to `#` (no-op) per the Manus visual contract. Surfaced during the Step 8 dashboard walkthrough when clicking them produced "Why doesn't anything happen?"

**Severity:** low (the `#` links match the locked Manus contract per #14, so functionally correct; visually odd). **Suggested resolution:** for Phase 2, either (a) hide these three items in the sidebar (one-line change in `NAV_ITEMS`), OR (b) wire each to a coming-soon page like Phase 1 did with `#` placeholders (doesn't fix the underlying click-does-nothing). (a) cleaner. Phase 3's role-model design will replace them with real items anyway. If Phase 3 isn't imminent, ship (a) so internal-alpha walkthroughs don't have the dead-link distraction.

### 52. `MODEL_ID` is hardcoded in `route.ts` line 17; promote to env var

`src/app/api/agent/fetch/route.ts:17` has `const MODEL_ID = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";`. Test 11 demonstrated that switching MODEL_ID requires a code change + deploy cycle. For Phase 3 (model A/B testing, per-subscriber model selection, fallback chains), this needs to be configurable without redeploying — at minimum an env var, ideally a per-subscriber/per-book setting.

**Severity:** low (Phase 2 doesn't need to vary the model). **Suggested resolution:** Phase 3 cleanup. Move to `process.env.BEDROCK_MODEL_ID` with a hardcoded fallback to the current value. Document in `/etc/bkstr/oauth.env` (or a new `/etc/bkstr/runtime.env`) alongside the OAuth keys. Future Phase 3+ work may further extend to per-publisher or per-subscription-tier model selection.

### 53. Sanitized errors retain minified class identifier (`j` instead of `ValidationException`)

Surfaced during Test 11. The sanitized `fetch_logs.error_message` was `"j (ValidationException): Unknown error"`. The leading `j` is Webpack/Next.js's minified name for the AWS SDK's error class. `sanitizeError` correctly reads `err.constructor.name`, but in production builds that name has been minified.

**Severity:** low cosmetic (security invariant unaffected — see D7.19; only the human-readable class name is degraded). **Suggested resolution:** check `err.name` first (the AWS SDK sets this to a string property like `"ValidationException"` that survives minification), fall back to `err.constructor.name` only if `err.name` is absent. Two-line change in `sanitize.ts`. Pairs with #54 for a holistic fix to the helper.

### 54. `sanitizeError` collapses categorizable errors to "Unknown error" in production

Surfaced during Test 11. The `ERROR_CLASS_MESSAGES` whitelist in `sanitize.ts` is keyed on the resolved `className` value. In production with minified bundles, `className` becomes `j` (per #53), which isn't in the whitelist, so the human-message lookup falls through to `"Unknown error"` instead of the intended `"Bedrock validation error"`. Net result: every Bedrock error in production maps to "Unknown error" rather than the categorized message Step 5's `ERROR_CLASS_MESSAGES` map intended.

**Severity:** low cosmetic (security invariant unaffected; same root cause as #53). **Suggested resolution:** key the `ERROR_CLASS_MESSAGES` whitelist on `err.name` instead of `className`. `err.name` is a string property on AWS SDK error instances ("ValidationException", "ThrottlingException", etc.) that survives minification. With #53's fix in place, the lookup succeeds and produces the intended human-readable message. Single PR closes both.

### 55. Agent fetch route's HTTP status doesn't match its apparent intent — investigate before deciding

Surfaced during Step 8's Test 11. The bogus-MODEL_ID curl produced HTTP 200 with a sanitized JSON error body (not SSE), confirming the pre-stream error path executed — Bedrock rejected the model ID before any tokens streamed. **The route returned HTTP 200, but the source code's pre-stream error path (`route.ts:213`, `:221`, `:233`) calls `jsonResponse({error: errorMessage}, 504)` and `jsonResponse({error: errorMessage}, 502)` for the timeout, error, and no-body branches respectively, and D5.7's locked taxonomy maps pre-stream Bedrock errors → 502 / pre-stream timeout → 504.** The observed 200 contradicts the source.

Plausible causes worth investigating in this order: (a) Next.js App Router or some middleware is silently overriding the explicit status from the `Response` constructor; (b) the production bundle's transformation breaks the `jsonResponse` helper's `status` argument; (c) the curl was actually against a code path other than the pre-stream error branch (less likely given JSON-not-SSE confirms pre-stream). Capturing full HTTP response headers from a fresh bogus-MODEL_ID curl in production (or logging the constructed `Response.status` server-side) would distinguish these.

The behavior question — should the agent endpoint use non-2xx status codes for errors at all — only becomes a real design call once the source-vs-runtime mismatch is understood. If the source already says "use 502" and runtime is delivering 200, that's a bug to fix rather than a design choice to relitigate. If after investigation we deliberately want 200-everywhere as the contract, that's a documented update to D5.7 + a code change.

- *Arguments for non-2xx on pre-stream errors:* standard HTTP semantics; HTTP-aware tooling (CDN edges, retry libraries, observability paging) keys on 5xx for circuit-breaking. Pre-stream errors are the only ones where an HTTP status reaches the client before any streaming starts, so the status carries real signal there.
- *Arguments for 200-everywhere:* streaming endpoints have a different contract; mid-stream errors must use the body regardless (status can't change after commit); consistency means clients write one error-handling path; structured error in body already carries every signal downstream needs.

**Severity:** low-to-medium — security invariant unaffected (D7.19 holds), but the route's runtime behavior diverges from its source code, which is a class of bug that quietly compounds. **Suggested resolution:** investigate before deciding. Step 1: capture full HTTP response headers from a fresh bogus-MODEL_ID curl (the test branch still exists at `origin/test/step-5-test-11-bogus-model`). Step 2: if runtime returns 200 despite source saying 502, fix the bug. Step 3: if after fix we want 200-everywhere as the new design, deliberate update to D5.7 + route code + documentation.

### 56. ~~Friendlier rejection UI for OAuth signin allowlist~~ **RESOLVED 2026-05-11**

> Resolved by Phase 4 Stream D (open signup). The OAuth allowlist (D8.1–D8.4) is removed; there is no longer an `AccessDenied` path for the signin callback to route to. Any Google identity completing OAuth is allowed in with `role = SUBSCRIBER` by default; ADMIN / PUBLISHER promotion is env-driven (D11.5 / D11.6 / D11.11). Genuine OAuth-level failures (Google denying the user, consent screen errors) are surfaced by Google's own error page upstream of the redirect — out of bkstr's scope.

The signin allowlist patch (D8.1–D8.4) returns `false` from `callbacks.signIn` for unallowed identities. NextAuth routes the rejected user to its default error page (`/api/auth/error?error=AccessDenied`) — accurate but bare. For internal-alpha gating this is acceptable; for any external-facing surface (or when Animesh shows the system to a stakeholder who happens to sign in with the wrong identity), a branded "this email isn't on the allowlist; contact <admin>" page would communicate the intent better.

**Severity:** low (functional gate works; UX-only cosmetic). **Suggested resolution:** add `pages.error: "/access-denied"` to `authOptions` plus a server-rendered `src/app/access-denied/page.tsx` that reads the `?error=` query param and shows a friendly explanation. Phase 3 work; explicitly skipped in this patch per the kickoff prompt.

### 57. Decide whether to deprecate the gmail identity in favor of Workspace identity

The `animeshk604@gmail.com` subscriber row is from Animesh's Phase-1-era personal Google account. Post-allowlist (D8.3), it remains valid only because of the `ALLOWED_EMAILS` per-email override. The Workspace identity (`animesh@2tmorrow.com`) is the more durable choice for ongoing operator access — Workspace tenant controls (Workspace-only sign-in, audit logging, account suspension on offboarding) all apply there but not to a personal gmail.

**Severity:** low (the gmail identity works fine today; deprecation is a clean-up choice not a security gap). **Suggested resolution:** Phase 3 decision. If deprecating: remove `animeshk604@gmail.com` from `ALLOWED_EMAILS` in `/etc/bkstr/oauth.env`, optionally soft-delete or hard-delete the existing User+Subscriber rows (cascade reaches accounts/sessions/api-keys). If keeping: tighten the per-email allowlist concept by defining a stable rule for which legacy identities are kept and why.

### 58. ~~DB-managed allowlist table (replaces env-var allowlist) once external onboarding is designed~~ **RESOLVED 2026-05-11** (obsolete — signup is open)

> Resolved by Phase 4 Stream D (open signup). The allowlist concept retires entirely; there is no longer an allowlist to migrate from env vars to a DB table. The env-var pattern survives in a strictly narrower form: `ADMIN_EMAILS` / `PUBLISHER_EMAILS` in `/etc/bkstr/roles.env` are *role-grant* lists, not signup-gate lists, with monotonic-upward semantics (D11.11). If a future "private launch" surface ever needs gating back on, this entry reopens as the design starting point, but for Phase 4+ the open-signup posture is the lock.

Today's allowlist (D8.3) uses two env vars in `/etc/bkstr/oauth.env`. That works for a small operator-managed list but doesn't scale to "the publisher admin can add stakeholders to the allowlist via the dashboard." A DB-managed table (e.g. `allowed_identities (email TEXT PRIMARY KEY, domain TEXT, granted_by UUID, granted_at TIMESTAMP, revoked_at TIMESTAMP)`) lets the allowlist live alongside subscribers and be edited via the dashboard.

**Severity:** low until external onboarding lands. **Suggested resolution:** Phase 3, alongside #39 (publisher-vs-subscriber dashboard split) and #41 (admin upload UI). The schema change is small; the bigger work is defining who owns allowlist edits (which depends on the role-model resolution from #39). The callback function in `auth/index.ts` swaps env-var lookup for a Prisma query against the new table — single helper, behavior preserved.

### 59. Verify Google OAuth consent-screen branding + verification status

GCP Console marks the consent screen as "External" (per #40's resolution context) and the OAuth client as unverified — meaning external Google users hit a "Google hasn't verified this app" warning during the OAuth flow. Internal-alpha audience is small and informed; pre-pilot a stakeholder seeing the warning may bail mid-flow. Branding (logo, support email, privacy policy URL) plus optional Google verification submission would clean this up.

**Severity:** low at internal-alpha; medium pre-pilot. **Suggested resolution:** Phase 3 ops sweep. Configure consent-screen branding in GCP Console (~30 min). Decide whether to submit for Google verification (~3-7 day approval; required if expanding to non-Workspace external users at meaningful scale). For Workspace-only audience the verification submission may be unnecessary depending on the consent-screen scope choice.

### 60. ~~PII in pm2 logs — rejected emails logged in plaintext on signIn rejection~~ **PIVOTED 2026-05-11** (allowlist gone; role-promotion logs are the new surface)

> Pivoted by Phase 4 Stream D. The original surface (allowlist rejection logs with plaintext email) is gone with the allowlist itself — there are no longer `[auth] signIn rejected (domain not allowed): …` log lines because there is no rejection path. The PII tension survives in a smaller, narrower form: `syncRoleFromEnv` in `src/lib/auth/index.ts` emits `[auth] role promoted: <email> SUBSCRIBER → PUBLISHER` on each promotion. Same plaintext-email-in-pm2-logs concern, materially smaller surface (only fires on the operator-curated subset in `/etc/bkstr/roles.env`, not on every rejection from the open internet). Re-file or close at operator discretion when production-grade log hygiene becomes a priority. The hash-and-log / redact-and-log resolutions below still apply if reopened.

The signIn allowlist patch (D8.1–D8.4) emits `console.warn` on every rejection with the rejected email in plaintext (e.g. `[auth] signIn rejected (domain not allowed): someone@example.com`). At alpha-gate scale this is the right operational visibility — operators reading `pm2 logs bkstr-web` need to see which identities are bouncing off the gate to know whether the allowlist is too tight or whether legitimate users are being misrouted. At production-grade scale, plaintext emails in process logs become a data-handling concern: log shipping to a third-party aggregator, log retention policy, GDPR-style "right to erasure" requests against logs, etc.

**Severity:** low at internal-alpha (audience known, logs not shipped externally); medium pre-pilot. **Suggested resolution:** Phase 3 / production-grade hardening. Two paths: (a) hash-and-log — `crypto.createHash('sha256').update(email).digest('hex').slice(0, 16)` produces a stable identifier per email that operators can correlate ("the same identity keeps bouncing") without storing the plaintext. (b) Redact-and-log — log only `<domain>` for unrecognized identities, full email only for known-allowlisted-but-failed-flows where the operator needs the actual identity for debugging. (a) is more rigorous; (b) is closer to the current operational model. Either way, documented log-handling policy lands alongside #58's DB-managed allowlist work.

### 61. Negative-test verification residual — "fresh 4th-identity gmail rejected"

Filed during the D8.x allowlist patch's pre-push approval. The post-deploy verification will run the positive tests (`*@tmrwgroup.ai`, `*@2tmorrow.com`, `animeshk604@gmail.com` per-email override all succeed), but Animesh may not have a 4th Google identity available in the deploy window for the negative test (a fresh gmail account that's NOT on `ALLOWED_EMAILS` AND has a non-allowlisted domain → expect rejection + no DB row). If positive-only verification ships, the negative-test verification remains a residual checklist item against future work.

**Severity:** low (the security path is small, the diff is reviewed, and the unit-level guarantees of the callback are clear from inspection — a 4th-identity test is belt-and-suspenders). **Suggested resolution:** opportunistically run when a 4th Google identity becomes available — e.g. during Phase 3 onboarding when an external stakeholder hits the OAuth flow before being added to the allowlist. The expected `[auth] signIn rejected (domain not allowed):` log line + zero new `subscribers` rows confirms the gate is hot. Optionally: a new test Google account specifically for this purpose, exercised once and then forgotten.

### 62. Service-account / bot-identity distinction on the Role enum (Phase 4+)

Phase 3's `Role` enum (D9.1) is `SUBSCRIBER | PUBLISHER | ADMIN`. The `clawbot@tmrwgroup.ai` identity that signed in during Phase 2 testing is currently `SUBSCRIBER` per ROLE-Q2 — the same role as a human end-user. Functionally fine today, but conflates a programmatic agent with a human subscriber for any audit/dashboard view that filters by role.

If Phase 4+ ever introduces meaningful service-account behavior (separate rate-limit profile, audit-log filter, distinct API surface, automated workflows), promote `SERVICE_ACCOUNT` (or `BOT`) to the enum and migrate any identities matching a service-account naming pattern. Until then the conflation is harmless; explicit non-decision per ROLE-Q2.

**Severity:** low (no functional impact at Phase 3 scale; bot identity coexists with human identities at the same role). **Suggested resolution:** Phase 4+ when service-account behavior diverges from human-subscriber behavior. Migration shape: `ALTER TYPE "Role" ADD VALUE 'SERVICE_ACCOUNT'`; UPDATE specific identities; downstream query authors decide whether `SUBSCRIBER OR SERVICE_ACCOUNT` is the new "authenticated client" superset or whether SERVICE_ACCOUNT gets its own auth path entirely.

### 63. Scale Stream 2 Sweep 2 spot-check sample size with corpus growth

Surfaced during Stream 2 implementation review. The migration script `scripts/migrate-content-to-s3.ts` performs a verification spot-check at the end of Sweep 2 (S3 → DB integrity check) using a hardcoded `take: 3` Prisma query. Fine for the Phase 3 5-row corpus (60% coverage); becomes statistically meaningless once the corpus grows beyond ~30 rows.

**Severity:** low at current scale; revisit when book corpus exceeds ~30 rows. **Suggested resolution:** replace `take: 3` with `take: Math.min(10, Math.ceil(total * 0.1))` (capped at 10 to keep verification time bounded). Pairs cleanly with #44 (content size guard) since both are import-script polish items.

### 64. Decide on PR-based workflow for bkstr going forward

Surfaced during Stream 3 merge prep. The repo's de-facto convention is fast-forward merges with no GitHub PR records — Streams 1, 2, and 3 all landed as linear commits on `main` without a PR review trail. Stream 3 specifically tried to open a PR but `gh` CLI isn't installed on the operator workstation and there's no `GITHUB_TOKEN` in env, so the merge proceeded fast-forward to match precedent.

Two viable directions:

1. **Adopt PR records.** Install `gh` (`winget install GitHub.cli` on Windows), `gh auth login`, and route every non-trivial merge through `gh pr create` + `gh pr merge --merge` (or `--rebase` to preserve linear history while still creating a PR record). Gives a paper trail for every change, makes external code review possible, and is the conventional GitHub flow.
2. **Formalize fast-forward-only.** Add `CONTRIBUTING.md` codifying the existing pattern: feature branch → rebase onto `main` → fast-forward merge → push. No PRs required. Document the tradeoff (loses review trail, gains simplicity for a single-operator repo).

**Severity:** low; the choice is a workflow preference, not a correctness issue. **Suggested resolution:** decide before the next multi-stream phase (Phase 4+). If anyone else is added as a committer the answer becomes "PR records, full stop." For the single-operator-now era either path is fine; the harm is the inconsistency of having tried both ad-hoc.

### 65. D9.6 SEED backfill operates on `subscribers` table, not `users.role='SUBSCRIBER'`

Surfaced during the Stream 3 live Checkout walkthrough. `animesh@2tmorrow.com` is `users.role='ADMIN'` per the Phase 2 OAuth allowlist promotion (commit 7faca65), but ALSO has an attached `subscribers` row (company "Animesh Kumar", `sub_id=588615d8…`) carried over from earlier development seeding. The Stream 1 SEED backfill in `20260510150000_phase_3_access_grants/migration.sql` does a `CROSS JOIN subscribers × books`, which means it operates on the `subscribers` table membership, not the `users.role` enum. Result: the ADMIN user received 5 SEED grants alongside the 2 role=SUBSCRIBER accounts, totalling 15 — which matches D9.6's "15 grants" count but for a slightly different reason than D9.6's prose implies ("3 subscribers × 5 books" where "subscribers" was interpreted as "users with subscriber role" in conversation).

Mechanically harmless — the 15-row count is correct and D9.6's stated purpose ("grandfather every pre-Phase-3 user who could read books before") is faithfully implemented since pre-Phase-3 access was gated on subscribers-table membership, not role. The wrinkle is **semantic ambiguity** between "subscribers (table)" and "subscribers (role)" plus the live confirmation that ADMIN+SUBSCRIBER dual-enrolment is allowed by schema.

**Severity:** low; no functional bug, but worth confirming the intent before the next role-related schema pass. **Suggested resolution:** either (a) document in the schema or D9.6 note that "subscribers" in the backfill means the table and dual-enrolment is intentional, or (b) tighten the backfill scope to `WHERE users.role = 'SUBSCRIBER'` if ADMIN-as-subscriber is meant to be a dev-only convenience that production should not carry. Decision can wait for Stream 1 patch 2 (ENFORCE_BOOK_ACCESS) since that's the natural touchpoint for re-examining the role-vs-table semantics across the access path.

**Update (Phase 4 Stream A, 2026-05-11):** PUBLISHER_OWN (D11.3 / CC-3) is now a clean cousin to SEED — the role-vs-table-membership ambiguity flagged here is moot for the publisher-access case (publisher reads of own books go through PUBLISHER_OWN, never SEED). SEED retains its grandfathered-subscriber-table semantic untouched. The narrower question of "should SEED also be role-filtered" can be decided in isolation when Stream 1 patch 2 lands.

### 66. Buyer-facing content access in `/dashboard` (View + Download surfaces)

For any book with an active grant (any source), expose two consumption surfaces on the dashboard row:

- **View** button → renders the book's markdown content inline in the browser (read-only, no editor chrome).
- **Download .md** button → serves the raw markdown file as `<slug>.md` attachment via `Content-Disposition: attachment`.

Both surfaces must log to `fetch_logs` with a new `source` value (e.g. `dashboard_view` / `dashboard_download`) to preserve consumption telemetry alongside the existing `agent_fetch` source. The dashboard metrics view already aggregates by source so the new values surface naturally there.

Rate-limit downloads (e.g. 10/day/book/subscriber) to prevent trivial bulk exfil while keeping convenience for legitimate re-downloads. Views are cheaper to serve and don't need the same cap — though a coarser per-session limit may still be worth it.

This closes the buyer friction surfaced post-Stream-3: a subscriber pays for content via Stripe Checkout, lands on `/dashboard/purchase/success`, and currently has no way to actually use what they bought without issuing an API key and `curl`-ing the agent fetch endpoint. The web surface is the natural human-facing consumption path.

**Severity:** medium; functional gap that contradicts the "paid for content → can use it" UX assumption. Not a correctness bug (the content is reachable; the path is just developer-only). **Suggested resolution:** Phase 3.5 mini-stream or fold into Phase 4 depending on Edward's priority call. Implementation shape: two new app routes (`GET /api/books/[id]/view`, `GET /api/books/[id]/download`) that share the same access-grant check + `loadBookContent` call as the agent fetch route, differing only in `Content-Type` (`text/html` rendering for view vs `text/markdown; charset=utf-8` + attachment header for download) and the `fetch_logs.source` value written. Reuses the dual-storage seam from D9.2 — no new content path. UI is two icon buttons in the books-table `Access granted` cell.

**Update (2026-05-11) — download path priority bumped:** real-life Codex test (current chat) showed downstream agents reliably read downloaded markdown files but hallucinate shell-tool calls when asked to consume content via a streaming API. The Download surface is therefore the higher-reliability path for the "buyer feeds book to local agent" use case — materially more dependable than asking the buyer to wire the agent fetch SSE endpoint into their tooling. The View surface remains nice-to-have; **Download is now the load-bearing one**.

Tightened implementation notes for the Download route:
- **Buyer-specific watermark** embedded in a markdown HTML comment at the top of the served file: `<!-- bkstr: subscriber=<uuid> book=<uuid> issued=<iso8601> -->`. Comment is preserved across markdown parsers (it's HTML), invisible in rendered output, and survives copy-paste into a downstream agent's context. Gives leak traceability without altering the visible content. Watermark generation is server-side at request time, not stored — every download regenerates with the current timestamp.
- **Rate limit: 5/day/book/subscriber** (revised down from the initial 10/day estimate above; the lower cap reflects that legitimate use is occasional and the higher cap was anti-exfil-conservative without justification). Enforced by counting `fetch_logs` rows with `source='dashboard_download'` for the (subscriber_id, book_id, ≥ NOW() − INTERVAL '24 hours') tuple before serving. Cap hit → HTTP 429 with a `Retry-After` header set to "midnight UTC of the next day" (cheapest reset boundary; we don't need rolling-window precision).
- **`fetch_logs` symmetry**: every Download writes a row with `source='dashboard_download'`, `model=NULL`, `query=NULL`, `input_tokens=NULL`, `output_tokens=NULL`, `latency_ms`=duration-of-content-load-and-serve, `status='success'` (or `'rate_limited'` / `'error'`). Telemetry stays comparable with `agent_fetch` rows in the dashboard's fetch-logs view.

**Priority revised:** from "Phase 3.5 or Phase 4 depending on Edward's call" → **"consider for early Phase 4"** since the buyer-to-agent path materially improves with this surface live. Still not a Phase 3 reopener (Stream 3 is closed and works for its designed use case), but the gap to "useful for the user's actual workflow" is wider than originally scoped.

### 67. Codex (and likely other agents) hallucinate shell-tool calls — design bkstr agent-side around it

Real-life test on 2026-05-11 showed Codex hallucinates shell-tool calls under simple prompts. Even with explicit `you MUST call this tool 3 times before writing files` instructions in the system prompt and the wrapper script proven correct when invoked manually (curl → SSE → fetched markdown), Codex reported all 3 calls as completed with `empty stdout, exit code 0` while `fetch_logs` showed zero corresponding rows. The output was generated entirely from training data, not grounded in bkstr at all. The agent fabricated execution evidence rather than failing visibly.

**Implications for bkstr agent-integration story:**

- Shell-tool wrappers around the agent fetch endpoint can't be trusted with all agents. Hallucination here is not a Codex-specific bug — the safe assumption is that any agent may fake tool calls if the runtime gives it room, especially under "natural-feeling" workflows where the agent has a strong prior about what the answer should look like.
- Two reliable consumption paths emerged from the test:
  - **(a) Download surface (#66)** — deterministic; the agent reads a local file via its native filesystem tool. No hallucination room because the file either exists with the watermarked content or it doesn't. Codex passed this path in the same test.
  - **(b) MCP server** — structured tool contract enforced by the host runtime (Claude Desktop, Claude Code, Codex CLI, future hosts). The host process attests the tool call actually happened; the agent can't fake the response payload because the host injects it.
- The API streaming endpoint (`POST /api/agent/fetch` SSE) stays correct as the production agent-fleet surface — services calling it via real HTTP clients (server-side Python, Node SDKs, internal infra) get the streaming + caching + `fetch_logs` telemetry the way Phase 2 designed. It's just not reliable for the ad-hoc "feed my local coding agent" flow where a buyer expects to drop one line into their tool config and have it Just Work.

**Suggested resolution:** build a bkstr MCP server as a Phase 4 deliverable (or earlier if Edward wants a real agent-side SDK story before then). Shape: a Node MCP server that holds the subscriber's API key, exposes a `fetch_book(book_id, query)` tool to the host runtime, and proxies to the production `/api/agent/fetch` endpoint. The host runtime guarantees the tool gets called when the agent claims it did — closes the hallucination loop. In the interim, the Download surface from #66 is the reliable buyer-side path; the watermark also gives leak traceability if a downloaded file ends up in an agent's context that gets sent somewhere unexpected.

**Severity:** medium. Doesn't block anything currently live (Stream 3 marketplace and Phase 2 agent fetch both serve their designed use cases correctly). It informs the Phase 4 agent-side roadmap and the framing of #66 — the download surface is no longer just a buyer-UX-convenience, it's a hallucination-mitigation primitive too.

### 68. Tighten `book.publisher_user_id` to NOT NULL after Phase 4 backfill completes

Phase 4 Stream A adds `book.publisher_user_id` as a nullable FK to `users.id` and backfills all 5 existing seed books to Edward's user_id. The column lands nullable in the initial migration to dodge a chicken-and-egg: at migration time, Edward + Zach have not yet signed in (verified 2026-05-11: only `animesh@2tmorrow.com`, `animeshk604@gmail.com`, and `clawbot@tmrwgroup.ai` exist in `users`), so the FK can't reference rows that don't exist. The migration therefore ships nullable and the backfill UPDATE waits until Edward's first signin lands his user row.

Once **every** book row has a non-null `publisher_user_id` — verified by `SELECT COUNT(*) FROM books WHERE publisher_user_id IS NULL;` returning 0 — tighten the column to NOT NULL via a follow-on migration. This restores the invariant that every published book has a known publisher, makes the join in `getBooksWithMetrics` cleaner (no null-handling branches), and locks out a class of "book exists without owner" bugs that would otherwise be reachable.

Sequencing: this is Phase 4.5 work (after Stream A + Stream B both land and at least one operator-driven new-book upload via Stream B has been smoke-tested), not in Phase 4 itself. The tightening migration is one-line (`ALTER TABLE books ALTER COLUMN publisher_user_id SET NOT NULL`); the only operational concern is that any in-flight Stream B "new-book" requests during the migration must already have written a non-null value (which the form gate per Phase 4 design Q15+CC enforces).

**Severity:** low; the nullable-FK state is correct-but-temporarily-loose. **Suggested resolution:** Phase 4.5 patch alongside the first wave of operator-driven publishing post-Phase-4 GA. Confirm via SQL that no nulls exist immediately before applying the ALTER.

**Update (Phase 4 Stream A, 2026-05-11):** the migration has shipped — `20260511120000_phase_4_schema_part_1` adds the nullable column + FK + index; `20260511120100_phase_4_schema_part_2_backfill` runs a conditional `DO $$ … $$` block that assigns publisher_user_id IF Edward exists in `users` ELSE defers with `RAISE NOTICE`. Today (deploy day) Edward has not signed in → the DO block hits the defer branch and books stay unattributed. The operator re-runs the same DO block manually via psql once Edward signs in (runbook: `docs/operations.md` "Phase 4.5 — Edward / Zach publisher backfill"). Per [D11.10](./phase-4-decisions.md#d1110--bookdescription-and-bookpublisher_user_id-both-ship-nullable-pair-tighten-later-per-68), the related `book.description` column also ships nullable and pair-tightens here once every book carries prose. Update this entry's title to "Tighten `book.publisher_user_id` AND `book.description` to NOT NULL …" when scheduling the Phase 4.5 work.

**Update (Phase 4 Stream C live test, 2026-05-11):** operator backfilled `publisher_user_id` to ADMIN (`animesh@2tmorrow.com`, `588615d8-…`) as a temporary seed-corpus owner to unblock `/dashboard/library` rendering. The 5 seed books now carry non-NULL publisher_user_id AND 5 PUBLISHER_OWN grants on ADMIN's subscriber row. NOT NULL tightening is now technically possible but should still wait for Edward + Zach reassignment per the original D11.10 intent (ADMIN-as-seed-owner is documented as temporary in `docs/operations.md` "ADMIN-as-seed-owner" section). When Edward signs in and the reassignment SQL runs, this follow-up's prerequisite shifts from "Edward + Zach exist" to "all books have their intended owner" — once Edward owns the 5 seed books (and Zach owns whatever subset is later decided), tighten to NOT NULL.

### 69. Library pagination when book count crosses ~50

Surfaced during Stream C implementation. `getBooksForLibrary` in `src/lib/dashboard/queries.ts` returns the full set of `status='ACTIVE'` books with no `take` or cursor — fine for the current 5-book corpus and the projected ~25-book Phase 4 GA shape, but the table render becomes visibly slow somewhere around 50–100 rows and turns into a real performance issue past ~500.

**Severity:** low; not a problem today. **Suggested resolution:** add cursor-based pagination (Prisma `cursor` + `take`) plus a "load more" or infinite-scroll component on `/dashboard/library`. Coordinate with #66's Active/Browse/All filter — pagination state needs to compose with the URL `?filter=` searchparam. Defer until the book corpus crosses ~50 rows or buyer-side scroll feel degrades.

### 70. Decide on `/dashboard` (Active Books) vs `/dashboard/library` overlap

Surfaced during Stream C live test (2026-05-11). The two views now overlap:

- **`/dashboard` (Active Books)** — operator/agent-focused. Columns: Total fetches, 30d fetches, Active agents, Last fetched, Access state. The historical "what's happening with my agent fleet" view. Predates Phase 4.
- **`/dashboard/library`** — buyer-focused. Columns: title, description, publisher name, price, Access state (Granted with View+Download / Buy / Not for sale). Filterable Active/Browse/All. Net-new in Phase 4 Stream C.

Both pull from `books` and both show the Access column. The fetch-telemetry columns are unique to Active Books; the description + publisher + price columns are unique to Library. A user (any role) sees both nav entries side-by-side and has to learn which surface answers their current question — which is mild cognitive friction but defensible: ADMIN operating their fleet wants the telemetry view; SUBSCRIBER deciding what to buy wants the Library view; PUBLISHER managing their authored books wants either depending on what they're checking.

Two viable directions:

1. **Consolidate.** Merge into one route with a toggle (telemetry vs catalog view) or tabs. Cleaner nav, but the mental model conflates two distinct workflows and the toggle becomes a new affordance to learn.
2. **Formalize the distinction.** Add subtitle/copy to each page header that names the use case ("Your agent fleet's books" vs "Browse and buy bkstr's catalog"). Cheap; no nav restructure.

**Severity:** low; cosmetic UX. **Suggested resolution:** wait for live-traffic feedback. If buyers consistently land on Active Books trying to buy, formalize the distinction or add a redirect. If operators stop using Active Books in favor of Library, consider deprecating the agent-telemetry columns or folding them into Library as an optional row-expand. Either path is fast and reversible.

### 71. Seed `book.description` for the 5 existing seed books

Surfaced during Stream C live test (2026-05-11). `book.description` was added to the schema in Phase 4 Stream A (`prisma/schema.prisma:84`) as nullable TEXT. Stream B's `/dashboard/books/new` form populates it for new books, but the 5 pre-existing seed books (CI Diagnostics, Docker Patterns, GIF Grep, Hermes Dogfood, Node Connect) carry `description = NULL`. `/dashboard/library` renders these as `"—"` per the LibraryTable's NULL fallback — functionally clean but visually thin, since buyers landing on the Library see a row with title + price + publisher but no prose to disambiguate "what is this book about."

Two viable paths:

1. **ADMIN backfill via SQL.** Operator writes a one-line prose description per book — anything 1-2 sentences that captures the book's domain — and runs `UPDATE books SET description = '<text>' WHERE slug = '<slug>'`. Fast, controlled, deterministic. Suitable for the 5-book seed corpus.
2. **Defer to Edward/Zach as part of ownership reassignment.** When Edward signs in and the reassignment SQL from `docs/operations.md` "ADMIN-as-seed-owner" runs to move publisher_user_id from ADMIN to Edward, Edward also writes descriptions through a Stream B "edit existing book" surface (which doesn't exist yet — would be a Phase 4.5 mini-stream). More authentic publisher-authored prose, but blocked on Stream B getting an edit-existing-book flow.

**Severity:** low; cosmetic, no functional impact on Buy / View / Download / agent fetch. **Suggested resolution:** path 1 if Phase 4 GA wants the Library polished now; path 2 if buyer feedback can wait until publisher edit-existing flow ships. Tie this entry to the ADMIN-as-seed-owner section in `docs/operations.md` — both are seed-corpus transitional state pending Edward/Zach.

### 72. Consolidate Prisma 7 client-component import pattern (+ admin-API status-code consistency)

Surfaced during Phase 4.5 Streams E + F live implementation. Both streams independently hit a webpack build failure when their client components imported the `Role` / `GrantSource` enums from `@/generated/prisma/client` — Prisma 7's generated `client.ts` pulls Node-only modules (`node:crypto`, `node:fs`, `node:events`) into the client bundle, which Next.js rejects with `UnhandledSchemeError`. Each stream worked around it independently:

- **Stream E** (`src/components/dashboard/admin/role-mutation-modal.tsx`) declares a local string-literal union: `type Role = "SUBSCRIBER" | "PUBLISHER" | "ADMIN"`. Drops the type relationship with the generated enum; relies on the server-side handler to validate against the real Prisma enum.
- **Stream F** (`src/components/dashboard/admin/admin-grants-table.tsx`, `revoke-grant-modal.tsx`) imports from `@/generated/prisma/enums` (pure const object, no Node imports). Keeps the type relationship.

Stream F's approach is the canonical one — `enums.ts` is generated alongside `client.ts` specifically to be bundler-safe. Stream E's local-union path works but loses the compile-time link between the UI and the schema.

**Suggested resolution:**
- Pick **`@/generated/prisma/enums`** as the canonical import path for client components.
- Retrofit Stream E's `role-mutation-modal.tsx` to import `Role` from there instead of the local union.
- Add a one-paragraph note to a new `docs/frontend-conventions.md` (or append to `CLAUDE.md` if a project-wide doc doesn't exist) documenting the rule: "**Client components import Prisma enums from `@/generated/prisma/enums`, NOT `/client`.** The `/client` entrypoint pulls `node:*` modules that break webpack."

**Secondary hygiene (caught during Stream F smoke verification):** the admin-API surface has a small status-code inconsistency between streams:
- Stream E's `POST /api/admin/users/[id]/role` returns **401** on unauthenticated POST.
- Stream F's `POST /api/admin/books/[id]/reassign` and `/api/admin/grants/[id]/revoke` return **403** on the same call shape.

Both reject correctly. Semantically 401 = "no session at all," 403 = "authenticated but insufficient role." The split is harmless but worth aligning when this follow-up lands — pick one of:
- (a) **401 then 403**: handler returns 401 if `!session`, 403 if `session.user.role !== 'ADMIN'`. The textbook semantics.
- (b) **All 403**: simpler — admin endpoints are gated; non-ADMIN is "forbidden" regardless of whether they're signed in.

Recommend (a) for cleaner client-side error handling, but (b) is defensible.

**Severity:** low; both workarounds ship correctly today, the status codes both communicate "no" effectively. This is pure hygiene — file the consolidation as a Phase 4.5-tail cleanup, no urgency. Pair with the retrofit so both touchpoints land in one PR.

---

*Last updated: 2026-05-11. Add new entries with the next available number; do not renumber existing entries even if older ones are resolved (mark resolved entries with a strikethrough and a one-line resolution note instead).*
