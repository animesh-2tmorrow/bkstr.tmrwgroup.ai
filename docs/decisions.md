Running decisions log. New entries append here. For historical decisions from Phases 3, 4, 4.5, and 5, see the corresponding `phase-N-decisions.md` files.

## Phase 5 Stream B — admin AI assistant (2026-05-11)

### D14.1 Read-only against the rest of the schema

**Choice:** Stream B's assistant queries Prisma but never mutates. No `admin_actions` rows written from the assistant code path; no `fetch_logs`, no `users`/`books`/`access_grants` writes. The new tables `assistant_conversations` + `assistant_messages` are the ONLY tables this stream writes to, and those writes hold conversation history — not state changes the rest of the system observes.

**Reasoning:** The assistant ITSELF is not an admin mutation, so the audit-log contract documented at `src/lib/admin/audit.ts:16-30` does not apply. D12.4 / D12.7 audit semantics are for human-intent admin operations — the user clicked Reassign / Revoke / Change role and the system carried out their action against a known target row. An LLM Q&A session has no such "the admin asked the system to mutate row X" semantic; folding it into `admin_actions` would dilute the table's signal (every chat message would become a row) and conflate operator intent with model output. Stream C ("propose" mode) and Stream D ("execute" mode) will revisit — proposed/executed mutations DO carry admin intent and WILL write to `admin_actions` when they land.

**Cross-references:** D12.4 (audit-write-in-TX contract), D12.7 (admin_actions schema), follow-ups #81 (Stream C propose) and #82 (Stream D execute).

### D14.2 Model ID resolution from env with Sonnet 4.5 fallback

**Choice:** `process.env.ASSISTANT_MODEL_ID` is read at module-load time in `src/lib/admin/assistant/bedrock-client.ts`. If unset, defaults to the VERBATIM buyer-side Sonnet 4.5 ID `us.anthropic.claude-sonnet-4-5-20250929-v1:0` (copied from `src/app/api/agent/fetch/route.ts:22`). Boot-time WARN-on-missing (non-fatal); the assistant route works with the default. Opus 4.7 is the eventual destination but Gate 1 IAM smoke test (2026-05-11) returned 403 for that model ID — operator picked path (c) "ship with Sonnet 4.5 default, upgrade later" (follow-up #84).

**Reasoning:** Hard-coding the model ID would make the Opus 4.7 upgrade a code change; reading from env makes it a config-only change once IAM is granted. Defaulting to the buyer-side Sonnet 4.5 ID means even an operator who forgets to stage `/etc/bkstr/assistant.env` gets a working assistant on day one — no "broken until env staged" failure mode. The buyer-side ID is the only model the IAM role can currently invoke per the Gate 1 smoke test, so it's also the only safe default. Boot-time WARN matches the stripe.env / oauth.env / aws.env pattern (D9.4 / D10.3) so the "operator forgot to stage" failure mode shows up in pm2 logs without breaking startup.

**Cross-references:** D9.4 (per-service env files), D10.3 (WARN-on-missing pattern), src/app/api/agent/fetch/route.ts:22 (buyer-side model ID source-of-truth), follow-up #84 (Opus 4.7 upgrade tracker).

### D14.3 Two new tables: assistant_conversations + assistant_messages

**Choice:** Two tables. `assistant_conversations` holds metadata (owner, title, timestamps, soft-archive flag). `assistant_messages` holds ONE row per content BLOCK (text, tool_use, or tool_result), with a `role` VARCHAR(32) discriminator and a JSONB `content` column. The translation from the flat row list to Anthropic's structured messages array shape happens app-side in `src/lib/admin/assistant/agent.ts:rowsToMessages`.

**Reasoning:** One row per block makes each tool call individually addressable for debugging + future read surfaces. Folding text+tool_use into a single "message" row would require a more complex content payload AND make per-block usage attribution awkward. The JSONB content column matches the `admin_actions.before_state / after_state` precedent (D12.14) — flexible payloads without per-role columns. The role VARCHAR(32) (no Postgres enum) follows the webhook_events.source (D9.3) / admin_actions.target_type (D12.7) precedent so future Streams (C: propose, D: execute) can add row types without schema migrations.

**Cross-references:** D9.3 (free-text discriminator precedent), D12.7 (admin_actions polymorphic-target shape), D12.14 (JSONB partial-state precedent).

### D14.4 SDK choice: @anthropic-ai/bedrock-sdk + lazy Proxy singleton + omit thinking/temperature/top_p/top_k

**Choice:** Use Anthropic's `@anthropic-ai/bedrock-sdk` (not the AWS-SDK low-level `@aws-sdk/client-bedrock-runtime` the buyer-side uses, not the Anthropic Agent SDK). Bare-instantiation auth pattern: `new AnthropicBedrock({ awsRegion: 'us-east-1' })` — default AWS credential chain resolves to the EC2 `bkstr-ec2-role` instance profile. Lazy-Proxy-singleton pattern (mirrors `src/lib/stripe.ts:33-62`). Pass ONLY `model`, `max_tokens`, `system`, `tools`, `messages` — omit `thinking`, `temperature`, `top_p`, `top_k`. Agent loop has a 10-tool-call-per-turn cap; on cap-hit, yield error and stop.

**Reasoning:** The Anthropic-authored SDK has native tool-use ergonomics (`messages.stream` returns a typed event stream with `tool_use_start` etc.) that the AWS-SDK path would require ~150 LOC of JSON parsing to match. Bare-instantiation auth works without adding `@aws-sdk/credential-providers` as a dep — one dep added (only `@anthropic-ai/bedrock-sdk`). Lazy Proxy avoids the "next build evaluates module at compile time + AWS creds not present on CI workers" boot crash class (same rationale as D10.4 stripe pattern). Omitting `thinking` is forward-compat with Opus 4.7 (which only supports `adaptive`; omit lets the SDK use no-thinking default — works for both Sonnet 4.5 and Opus 4.7). Omitting `temperature` / `top_p` / `top_k` forward-compats too — Opus 4.7 rejects all three, Sonnet 4.5 tolerates omission. 10-tool-call cap is the load-bearing runaway-loop floor: a misbehaved model that always emits another tool_use can't lock the route indefinitely. The error message names the cap explicitly so the user understands why their turn ended.

**Cross-references:** D9.5 (exact-pin SDK), D10.4 (lazy Proxy pattern, src/lib/stripe.ts template), follow-up #83 (Bedrock SDK consolidation), follow-up #84 (Opus 4.7 upgrade).

### D14.5 Five typed read-only tools with 200-row hard cap; no SQL escape hatch

**Choice:** Five tools — `list_users`, `list_books`, `list_grants`, `read_audit_log`, `recent_fetch_logs`. Each has a JSON Schema for Anthropic's `tools` parameter. Each `executeX` function does manual input validation (no zod dep added — none was present in package.json) and clamps `limit` to `[1, 200]`. No free-form SQL escape hatch — filed as follow-up #80.

**Reasoning:** Five tools cover the load-bearing admin questions (who's on the platform, what books exist, who has access to what, what changed recently, what fetches happened recently) without exposing arbitrary query power. The 200-row cap is the load-bearing safety floor — even if the model emits `limit=10000`, the result-set pulled into the LLM context is bounded. A SQL escape hatch is genuinely useful for the long-tail of admin questions Streams B+C can't answer, but exposing it safely requires parameterized-query semantics + read-only-statement enforcement at the DB layer — too much surface area for Stream B's scope. JSON Schema (not zod) because Anthropic's tools API takes JSON Schema directly, AND zod is not in package.json (no dep added).

**Cross-references:** follow-up #80 (SQL escape-hatch tool), Stream A's filterByRole tool registry pattern.

### D14.6 SEED grant lifecycle and production-readiness perimeter

**Choice:** do not introduce code paths that auto-create `SEED`-source `access_grants` rows. `SEED` remains a valid `GrantSource` enum value for audit and historical-state queries, but new SEED rows are operator-only (manual SQL, runbook-gated per `docs/operations.md:278-288`). The 15 existing SEED rows from the Phase 3 backfill migration (`20260510150000_phase_3_access_grants/migration.sql:42-46`) remain in place with `revoked_at` populated as audit history of the internal-alpha-to-production transition.

**New users acquire access exclusively via two paths:**
- `PURCHASE` — Stripe Checkout success → `payment_intent.succeeded` webhook → `accessGrant.upsert` at `src/app/api/webhooks/stripe/route.ts:105`.
- `PUBLISHER_OWN` — publisher new-book form (`src/app/api/books/new/route.ts:310`) or admin reassignment (`src/app/api/admin/books/[id]/reassign/route.ts:172`).

This pins the system's access-creation perimeter at exactly two well-audited entry points.

**Reasoning:** every grant in production should have a clear provenance — either a paid purchase or an explicit publisher assignment. Implicit/seed grants undermine the audit trail and obscure the actual access-acquisition story. The Phase 3 SEED backfill served a one-time grandfathering purpose (preserving pre-Phase-3 implicit access when the `ENFORCE_BOOK_ACCESS` gate was about to land); that purpose is complete and the rows are all revoked. Leaving the existing rows as revoked audit history preserves the verification chain (Phase 4.5 Stream F's `grant.revoke` smoke test is one of the 15) while ensuring no new rows accumulate. The closing of the SEED creation perimeter means the only way SEED can re-appear is via deliberate operator SQL — an explicit, audited action with a runbook-documented rationale, not an accidental code path.

**Operational implications:**
- **No code change required to enforce this decision** — the trace at follow-up #86 confirmed zero creation paths exist today.
- **`MANUAL`-source grants remain the operator path** for one-off comps / refunds / support escalations, per `docs/operations.md:285`. SEED is reserved for grandfathering-style bulk backfills (none planned).
- **Future audits** can compare against the #86 baseline trace. If a `SEED` row appears with a `granted_at` after 2026-05-11, that's an unaudited new code path that needs investigation.

**Cross-references:** D9.6 (original SEED-backfill rationale), D10.2 (checkout-block respects all active grants including SEED), `docs/operations.md:276-289` (SEED operator runbook), follow-up #86 (the trace that grounded this decision).

### D14.7 TMRW Group brand attribution

**Choice:** bkstr is wholly owned by TMRW Group and the visual identity should reflect that without compromising bkstr's standalone product surface. Three concrete placements:
- **Favicon (browser tab):** TMRW Group icon mark at all standard sizes (16/32/48/96/192/256/512 + apple-touch-icon).
- **Dashboard sidebar header:** TMRW Group icon mark (28×36px) immediately left of the "bkstr" wordmark. Vertical alignment center; gap 8px.
- **Dashboard sidebar footer:** full stacked TMRW Group logo (60×80px) below "A product by" microcopy, separated from the user-info block by a border. Visible on every dashboard page (Active Books, Library, API Keys, Fetch Logs, Pricing, New Book, Billing, all Admin · *, Docs, Assistant).

bkstr remains the primary brand in `<title>`, page H1s, and dashboard nav labels. TMRW Group is secondary attribution everywhere it appears.

**Reasoning:** signals corporate parentage without diluting bkstr's product identity. The "A product by" microcopy frames TMRW Group as the platform owner, not co-equal branding. Easy to lift if bkstr ever needs standalone branding — single component edit (`dashboard-shell.tsx`), swap asset files (`public/logo-*.png`, `public/favicon*`), update metadata icons field. No nested coupling to the rest of the codebase. The Stream C patch touches one component, one metadata file, one decisions doc, and the `public/` asset folder. Zero schema, zero API routes, zero tests touched.

**Cross-references:** D14.1–D14.6 are functional decisions (assistant scope, model, schema, perimeter); D14.7 is the first visual-identity decision in the running log. Future visual/brand decisions append here.

## Phase 5 Stream D — SAST baseline + CodeBuild gating (2026-05-12)

### D14.8 SAST baseline tools: Semgrep + npm audit (NO Snyk, NO CodeQL, NO Sonar, NO ZAP)

**Choice:** Two tools constitute the v1 SAST baseline: **Semgrep** (static code analysis via `pip install semgrep==1.162.0`, rule packs `--config=auto + p/typescript + p/react + p/nextjs + p/owasp-top-ten`) and **`npm audit`** (CVE check against `package-lock.json`). No Snyk, no CodeQL, no SonarQube, no ZAP/DAST. Local invocation via `npm run security:scan`; enforcement in `buildspec.yml` `pre_build` phase that runs the same script.

**Reasoning:** Semgrep + npm audit are free, mature, low-maintenance, with established rule sets that cover Next.js / Prisma / NextAuth / Stripe surfaces. Snyk has a free tier but bills aggressively once you're past the threshold; CodeQL requires GitHub Actions integration (we're on CodeBuild per existing infra); Sonar is heavyweight and overkill for this scale; ZAP/DAST is deferred until staging exists. v1 minimalism — start with the two tools that catch 80% of the categories and add specificity later if drift accumulates.

**Cross-references:** D9.5 (SDK exact-pin precedent — applied to `semgrep==1.162.0`), D14.9 (severity gating), D14.10 (suppression discipline). Follow-up: future stream when staging exists may add ZAP/DAST for runtime-attack coverage.

### D14.9 Severity gating: Semgrep ERROR + npm audit high/critical fail the build; WARNING + moderate/low report-only

**Choice:** `security:scan` invokes `semgrep ... --error` (non-zero exit on Semgrep ERROR) and `npm audit --audit-level=high` (non-zero exit only on high+critical). WARNING-level Semgrep findings + moderate/low npm audit findings are reported in CI output but do not fail the build.

**Reasoning:** balances signal vs noise. ERROR + high/critical are unambiguous "must fix" cases — at v1 baseline scale, the gating bar lands at "stop the pipeline if any of those slip in." WARNING and moderate often include theoretical attack paths or rules with high false-positive rates; gating on them would shut down deploys for cosmetic findings. Tightening the gate upward later (gating on WARNING too) is a 1-character edit; loosening it after the team's habits adapt is operationally painful (people learn to bypass the gate). Start strict on the right things, lenient on the rest, tighten over time if drift demands.

**Cross-references:** D9.4 (per-service env file pattern as the precedent for "tighten over time vs upfront"), D14.8 (tool choice), D14.10 (suppression discipline).

### D14.10 Suppression discipline: inline rationale + path-level rationale; no blanket suppressions

**Choice:** Every suppression of a Semgrep finding requires a written rationale, either inline (`// nosemgrep: <rule-id> -- <specific reason>`) or path-level (`.semgrepignore` with comment lines explaining what the path is and why the rule doesn't apply). Rationale must be specific — "false positive" alone is not enough; cite the framework/API/test purpose that makes the rule fire incorrectly. Blanket suppression of entire rule categories is forbidden — if a rule fires 15 times for the same reason, that's a single `.semgrepignore` pattern with one rationale, not 15 inline suppressions; but it's never "ignore this whole rule everywhere because we don't like it."

**Reasoning:** the cost of a suppression is its erasure of future signal. Every untrustworthy suppression normalizes the next one. Specific rationales create an audit trail — six months from now, the next operator reading `// nosemgrep: detected-aws-access-key-id-value -- test fixture: deliberate fake AKIA pattern...` understands WHY the suppression exists and can re-evaluate it if context changes (e.g. test gets deleted; AKIA pattern becomes shorter). Generic rationales decay into "we suppressed everything." Inline-comment granularity matches the D10.x audit-trail principles (every state-changing decision has a written rationale at the point of effect). Stream D's baseline ships 2 inline suppressions (both AKIA test fixtures) — both with self-contained rationales that don't require cross-referencing.

**Cross-references:** D10.1 (audit-trail principle — every meaningful state change is logged with context), D14.8 (tool choice), D14.9 (severity gating).
