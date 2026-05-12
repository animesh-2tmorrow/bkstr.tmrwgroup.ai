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

---

> **Note (2026-05-12):** D14.8–D14.10 describe the intended SAST baseline. Stream D shipped these decisions at `fec707e` but the CI gating mechanism was reverted at `e4ab6f5` due to a Semgrep install failure in CodeBuild (pip 26 + Python 3.11.15 wheel-resolution gap). The local `npm run security:scan` script reflects the gating intent and works correctly. CI re-merge tracked as follow-up #89. The decisions themselves remain authoritative for the eventual re-merge — re-text them verbatim into the v2 branch.

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

### D14.11 Gating-proof tests for CI changes MUST run in CI itself, not locally

**Choice:** Any stream that adds a CI gate or modifies the buildspec MUST include a CodeBuild-verified gating-proof as a STOP gate before merge to main. The gating-proof must: (1) push a throwaway branch with a deliberate-failure commit, (2) trigger an actual CodeBuild run against that branch (e.g. via `aws codebuild start-build --source-version <branch> --artifacts-override type=NO_ARTIFACTS`), (3) observe the build fail at the expected phase with the expected error context, (4) clean up the throwaway branch. Local execution of the gate script does NOT satisfy this requirement — local environment can mask CI-specific install/runtime failures.

**Reasoning:** Stream D's original dispatch specified a gating-proof test (deliberate-ERROR throwaway PR to confirm CodeBuild halts at the security stage). The test was apparently run only against the local `npm run security:scan` script, which masked a CodeBuild-specific Semgrep install failure (pip 26 wheel-resolution gap on Python 3.11.15) that did not reproduce locally. The buildspec change merged to main, the next pipeline run failed at install — caught post-merge, requiring a revert. The cost: one revert commit on main, one pipeline cycle of operator attention, ~1 hour of debugging to root-cause. The benefit of CI-verified gating: caught at gate-2, not post-merge. Cost going forward: one additional CodePipeline run per CI-affecting stream (~3 minutes). Net positive at first incident, dominant after the second.

**Scope:** applies to any change that modifies `buildspec.yml`, adds dependencies that need CI installation, or otherwise alters the CI environment. Does NOT apply to pure code changes that the existing CI happily builds. Does NOT apply to documentation-only commits. The discipline kicks in specifically when the change is "the CI itself behaves differently after this commit."

**Cross-references:** D14.8 (the SAST baseline this lesson originated from), follow-up #89 (Stream D re-merge; will be the first stream to apply this discipline).

---

## Phase 5 Stream E — admin email invitations + publisher book archive (2026-05-12)

### D15.1 Magic-link email invitations, plaintext-only in transit, SHA-256 hash at rest

**Choice:** ADMIN can invite users to bkstr via email. The invitation flow generates a 32-byte (256-bit) cryptographically-random token, encodes it base64url, includes it as the `?token=` query string of a magic link, and emails the link to the recipient. The DB persists ONLY the SHA-256 hex hash of the plaintext (`user_invitations.token_hash` VARCHAR(64)). Recipient clicks the link → server validates server-side → POST to `/api/invitations/accept-init` sets the `bkstr_pending_invitation` cookie (HttpOnly, Secure, SameSite=Lax, Path=/, 15-min TTL, value=plaintext) → redirect to NextAuth `/api/auth/signin` → OAuth completes → `events.signIn` hook reads the cookie, re-hashes, validates, applies the role + marks the invitation accepted. Invitations are restricted to **PUBLISHER** and **SUBSCRIBER** roles at the API layer (the schema allows any Role enum value but the POST handler at `/api/admin/invitations` rejects ADMIN — promotion to ADMIN stays gated behind the existing asymmetric-friction modal at D12.10).

**Reasoning:** plaintext-in-email + hash-at-rest is the canonical password-reset / magic-link pattern. DB compromise alone cannot replay accepts (an attacker would need both DB read AND a way to forge the email-delivery side). The cookie carries plaintext for the same reason a session cookie does: HttpOnly + Secure + SameSite=Lax makes cross-site exfiltration infeasible, and an attacker who can read the cookie already controls the browser session. Server-side validation BEFORE setting the cookie prevents an invalid `?token=` from materializing a cookie that would survive 15 minutes of subsequent traffic. ADMIN-invitations-via-email forbidden because the asymmetric-friction modal (D12.10) is the load-bearing safety property for ADMIN promotion — relaxing it to an email click would re-open the regression window. Per Q1, the schema scope is just the `UserInvitation` table + relations; `BookStatus.ARCHIVED` already exists in the enum since Phase 1 so no enum migration is needed.

**Cross-references:** D11.11 (monotonic-upward role promotion — applied unchanged here), D12.10 (asymmetric-friction modal — preserved for ADMIN), follow-ups #90 (invite-expiry policy), #91 (resend SMTP-failed invitations).

### D15.2 Audit shape: invitation.send / invitation.cancel / invitation.accept, actor varies

**Choice:** Three audit `actionType` values, all with `targetType="invitation"` (extends `AuditTargetType` union by one string; column stays VARCHAR(32)):

- `invitation.send` — actor is the ADMIN who issued the invitation. Written inside the POST `/api/admin/invitations` TX.
- `invitation.cancel` — actor is the ADMIN who cancelled the invitation. Written inside the DELETE `/api/admin/invitations/[id]` TX.
- `invitation.accept` — actor is the **recipient themselves** (per Q5). Written inside the `events.signIn` TX when the cookie-bound invitation is consumed.

The "actor is the recipient" choice for `invitation.accept` is the unusual one: every prior audit row was actor=ADMIN. The rationale (inlined verbatim at `src/lib/auth/index.ts` `applyPendingInvitation`): "actor is recipient per D15.2 — state transitions, not click attempts; recipient caused the transition by accepting." The ADMIN's contribution was the `invitation.send` row (already audited); the recipient's acceptance is a distinct downstream event with a distinct actor. NO new D-slot for this decision — it's a row-shape choice inside an existing audit precedent, not a new audit-system concept.

**Reasoning:** the `admin_actions` table's contract per D12.4 / D12.7 is "every meaningful state change is a row." An accept IS a state change (role + invitation rows both move). Attributing it to the ADMIN-as-actor would suggest the ADMIN caused the accept at the moment it occurred — they didn't; they caused the SEND moments-to-days earlier. Attributing it to the recipient gives a faithful per-row "who caused this" story when an operator queries the table.

**Cross-references:** D12.4 (audit-write-in-TX contract), D12.7 (admin_actions schema + the four target-type strings), Q5 lock.

### D15.3 Email mismatch handling: row stays pending + emailMismatchNote column

**Choice:** When the OAuth-returned email does NOT match the invitation email (case-insensitive comparison), the signin proceeds normally (user can use bkstr with their default role) but the invitation is NOT applied — the row's `acceptedAt` stays NULL. The mismatch is documented on a NEW column `user_invitations.email_mismatch_note TEXT` (semantically distinct from `email_send_error`; both columns coexist on the same row even though it's a column-add). The admin pending-invitations table surfaces the note as a column so the operator can decide whether to cancel + reissue.

**Reasoning:** the operator's intent was to send the invitation to email X; a recipient who signs in as email Y proves they weren't the intended recipient (or they were, but they used a different Google account than expected). Blocking the signin would be over-friction — the user has a valid OAuth identity and bkstr is open-signup per D11.5. Auto-applying the role to email Y would be a security regression: an attacker who intercepts an invitation link could redeem it on any Google account they control. Leaving the invitation pending + documenting the mismatch + showing it in the admin UI gives the operator the right next step: cancel + reissue to the correct email. Two separate columns (`email_send_error` vs `email_mismatch_note`) so the admin UI can render two distinct status signals — "SMTP couldn't deliver" vs "delivered but redeemed by wrong email" are operationally different problems.

**Cross-references:** D11.5 (open-signup), D11.11 (monotonic-upward role promotion — never lowers, even on mismatch).

### D15.4 SMTP env file (`/etc/bkstr/smtp.env`) with fail-graceful boot contract

**Choice:** Six required env vars: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_NAME`, `SMTP_FROM_ADDRESS`. File path `/etc/bkstr/smtp.env`, mode 600, root:root, sourced by `scripts/start.sh` on every deploy via the same `/etc/bkstr/*.env` pattern as oauth/stripe/aws/roles/assistant (D9.4 / D10.3 / D14.2). Module-load WARN per missing variable: `[smtp] WARN: <VAR> missing — invitation emails will fail to send. Stage /etc/bkstr/smtp.env to silence.` Nodemailer transporter is lazy-Proxy-instantiated on first send call (D10.4 stripe pattern). Failed sends do NOT block invitation creation — the row writes with `email_send_status='failed'` + `email_send_error=<message>` and the admin UI surfaces the magic link for copy-paste fallback.

**Reasoning:** mirrors every other operator env-file at bkstr. Lazy instantiation so `next build` doesn't try to construct the transporter at compile time. Fail-graceful so a fresh deploy with no `/etc/bkstr/smtp.env` doesn't break the admin UI — operator can create invitations, see "email send failed" on the UI, copy the magic link out of the response, and share it via Slack until they stage the env file. This decouples the invitation surface from operator SMTP-provisioning timing — both can ship at their own pace. Plain-text email body (no HTML) for the same reason buyer-side fetch responses are JSON-not-HTML: portable across SMTP relays, no rendering-engine surprises, phishing-conscious recipients trust plain-text more.

**Cross-references:** D9.4 (per-service env files), D10.3 (WARN-on-missing precedent), D10.4 (lazy Proxy pattern for client construction), D14.2 (assistant.env precedent for default + WARN behavior).

### D15.5 Book archive via existing `BookStatus.ARCHIVED` enum + per-status routes

**Choice:** Add four endpoints (no schema change — `BookStatus.ARCHIVED` already exists per Q1):

- `POST /api/publisher/books/[id]/archive` — PUBLISHER or ADMIN; if PUBLISHER, ownership check (`book.publisherUserId === session.user.id`). Atomic TX: `tx.book.update({status: ARCHIVED}) + writeAuditEntry(actionType: "book.archive")`.
- `POST /api/publisher/books/[id]/unarchive` — mirror, ARCHIVED → ACTIVE. `actionType: "book.unarchive"`.
- `POST /api/admin/books/[id]/archive` — ADMIN-only (no ownership check). Same audit shape; actor is the admin.
- `POST /api/admin/books/[id]/unarchive` — mirror.

The archive button placement is **`/dashboard/pricing` only for v1** (Q2). Not Active Books — the pricing surface is already publisher-scoped per Stream B, so the button belongs where the publisher already lives. The button uses the asymmetric-friction modal pattern (D12.10) with **typed-slug confirmation** for archive; unarchive is benign one-click. `/dashboard/admin/books` also gets the button (next to the existing Reassign button) since ADMIN is publisher-of-last-resort.

**Load-bearing UX invariant (Q6 + Q8 verified):** an ARCHIVED book stays accessible to grant-holders. `getBooksWithMetrics` has NO status filter (verified — the `where` clause is empty; the raw SQL has no `b.status` constraint). `requireBookAccess` has NO status filter on the book side (verified — the predicate is grant-side only: revokedAt + expiresAt). Together: a buyer with a PURCHASE grant on an ARCHIVED book continues to see it in their Active Books tab and continues to fetch its content. Archive is a Library-visibility toggle, NOT an access revocation. Price-edit on `/dashboard/pricing` stays visible on ARCHIVED rows (Q9) so publishers may adjust price before unarchiving.

**Reasoning:** the existing enum value pre-dates this stream — using it costs zero migration. Two separate `/api/publisher/...` + `/api/admin/...` URL families because the ownership check differs (publisher must own; admin bypasses), and routing the difference through one handler with branch-on-role logic would muddy the audit shape (we still want the actor on the audit row to be whoever clicked). The two-family layout matches the existing reassign pattern at `/api/admin/books/[id]/reassign`. The "ARCHIVED stays accessible" invariant matters: archiving a book the user already paid for should not retroactively revoke their access — that would surprise buyers and undermine the marketplace contract. The Library hides it; the access-grant honors it.

**Cross-references:** D12.10 (asymmetric-friction destructive-action pattern — applied here as typed-slug), D11.4 (`requireBookAccess` predicate — unchanged; verified to have no status filter), follow-ups #92 (verified clean in this stream — see follow-ups doc), #93 (Active Books surface ARCHIVED-row affordance), #94 (per-role placement audit).
