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
