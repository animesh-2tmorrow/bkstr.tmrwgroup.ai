# bkstr.tmrwgroup.ai — Phase 4.5 Decision Log

Phase 4.5 ships the ADMIN-only mutation surfaces (Streams E + F) and the audit-log foundation (Stream G) that records every mutation. Decisions locked at stakeholder review on 2026-05-11. Phase 4 history lives in [`phase-4-decisions.md`](./phase-4-decisions.md); Phase 3 in [`phase-3-decisions.md`](./phase-3-decisions.md); Phase 2 in [`phase-2-decisions.md`](./phase-2-decisions.md). All prior files are left intact — Phase 4.5 entries are additive, never overwriting.

Numbering convention: `D12.x` per the Phase 4.5 slot. Format mirrors Phase 4's D11.x entries. Each decision has:

- **Choice:** the locked answer, sometimes with sub-bullets for compound rules.
- **Reasoning:** rationale, alternatives considered, why this default.
- **Supersedes / cross-references:** other D entries this builds on.

---

## D12 — Phase 4.5 cross-cutting decisions (Stream G — audit log foundation, ships first)

### D12.1 — Stream ordering: G → [H] → {E, F}

**Choice:** Ship Stream G first as a foundation patch (schema + helper). Then optionally ship Stream H (`users.last_signin_at` column + signin write) if D12.3 picks the "add column" option. Then Streams E (`/dashboard/admin/users` + role mutation) and F (`/dashboard/admin/books` + `/dashboard/admin/grants`) land in parallel.

**Reasoning:** Stream G's `admin_actions` table + `writeAuditEntry` helper is the schema-level prerequisite for E + F. E's role-mutation handler and F's reassign + revoke handlers all need `admin_actions` to exist and `writeAuditEntry(tx, …)` to be callable inside their transactions. G is small + self-contained (one `CREATE TABLE`, one FK, three indexes, no enum, no backfill); ships standalone in a few hours. With G merged, E + F have no mutual dependency on each other and can land in parallel.

**Alternatives rejected:**
- **(a) All three streams in parallel with G's helper stubbed behind a feature flag.** E + F's mutation handlers would need a flag-gated branch (call helper vs no-op). The no-op state means **no audit row written for the first cohort of operator actions** — defeats Phase 4.5's central purpose. Mirrors Phase 4's "Stream A first, B + C parallel" pattern (D11.1) applied to the smaller G-then-parallel shape.
- **(b) Defer G entirely; ship E + F without audit; backfill audit table later.** Retroactive audit is impossible — we can't reconstruct `before_state` for past mutations. Permanent forensic gap.

**Cross-references:** [D11.1](./phase-4-decisions.md#d111--stream-ordering-d--a--b-c) (Phase 4's analogous "Stream A first, B + C parallel" ordering); D12.4 (the helper contract that forces G-before-E-and-F); the dispatch design doc §0 + §10.

---

### D12.2 — D11.11 reconciliation: extend, do not supersede

**Choice:** D11.11's monotonic-upward invariant stays intact for env-driven role sync. UI demotion via the new `POST /api/admin/users/[id]/role` path (Stream E) is permitted as a new role-mutation surface. The four-rule extension:

1. **Env presence promotes.** UNCHANGED from D11.11 rule 1.
2. **Env absence is a no-op.** UNCHANGED from D11.11 rule 2.
3. **Demotion via env removal is forbidden.** UNCHANGED from D11.11 rule 3 — removing `edward@…` from `PUBLISHER_EMAILS` does NOT demote Edward on his next signin.
4. **Demotion via explicit ADMIN UI action is now PERMITTED.** Stream E's role-mutation handler may write `users.role = 'SUBSCRIBER'` against a target user. UI counts as "explicit operator action" per D11.11's original intent (carved out from the env-driven branch).
5. **SQL demotion remains the deepest fallback.** UNCHANGED from D11.11 rule 4 — operator with DB credentials can still `UPDATE users SET role='SUBSCRIBER' WHERE email=…` (per `docs/operations.md:411-435`).

**Reasoning:** D11.11's three failure modes (env-empty races at deploy time, file-mid-edit reloads, pm2-reload during deploy) are all "non-explicit" demotions — they happen via background process, not deliberate operator click. The UI is explicit-by-construction: an ADMIN clicked a button, typed the confirmation string per D12.10, and the action wrote a durable audit row (D12.7) describing exactly what changed. Allowing UI demotion preserves D11.11's catastrophe-avoidance intent (env path can never lower) while productizing the SQL paths into a usable workflow.

The **env-vs-UI re-promotion loop** is real but tolerable. If the operator demotes Edward via UI but leaves `edward@tmrwgroup.ai` in `PUBLISHER_EMAILS`, the next time Edward signs in, `syncRoleFromEnv` re-promotes him to PUBLISHER (D11.11 rule 1). The operator runbook (`docs/operations.md`) gets a paragraph reminding operators: "UI demotion alone is 'until next signin'; pull the email from `roles.env` and `pm2 reload --update-env` to make it permanent." The audit row in `admin_actions` is durable; the env-driven re-promotion at signin does NOT write to `admin_actions` (no admin actor), so operators can correlate "I demoted X yesterday; today X is back to PUBLISHER" via psql and recognize the env-file gap. See risk R1 in the design doc §9.

**Code touchpoint:** `src/lib/auth/index.ts:74-101` (`syncRoleFromEnv`) **does not need any change** — its monotonic guard at line 94 (`if (ROLE_RANK[envDerived] <= ROLE_RANK[currentRole]) return`) already refuses to lower, which is the correct behavior. UI demotion goes through a separate code path (`POST /api/admin/users/[id]/role`) that does its own checks (D12.9 self-protection gates).

**Alternatives rejected:**
- **(a) Supersede D11.11 — allow env-driven demotion too.** Reintroduces all three D11.11 failure modes (ADMIN auto-demotion, silent-revert, pm2-reload race).
- **(b) Forbid UI demotion entirely — only PROMOTE in UI.** Breaks Stream E's brief ("promote/demote actions"). Operator still needs the SQL path for demotion, defeating Stream E's whole point.

**Cross-references:** [D11.11](./phase-4-decisions.md#d1111--monotonic-upward-role-promotion-env-absence-is-a-no-op-demotion-only-via-explicit-admin-sql) (the underlying monotonic-upward invariant; UNCHANGED for the env-driven path); D12.9 (Stream E self-protection gates); D12.10 (asymmetric modal friction); `docs/operations.md` "Roles env file" section (runbook for the env-vs-UI consistency story).

---

### D12.3 — `last_signin` sourcing: add `users.last_signin_at` column (Stream H)

**Choice:** Add `users.last_signin_at TIMESTAMPTZ NULL` column. Stream H (the optional precursor between G and {E, F}) ships the column + writes from `events.signIn` and `events.createUser`. Stream E consumes the column directly via `getAdminUsers()`.

**Reasoning:** Honest semantics; forward-only data (existing rows backfill as NULL until each one signs in); indexable for future "show me users who haven't signed in in 30 days" filters; the migration is one ALTER TABLE on a NULLABLE column (no backfill required, no NOT NULL flip).

**Alternatives rejected:**
- **(b) Derive from `sessions`.** *Impossible.* The `sessions` table created in `prisma/migrations/20260508120000_add_nextauth_tables/migration.sql:36-43` has only `(id, session_token, user_id, expires)` — no `created_at` column. Confirmed by direct read of that migration file. NextAuth's PrismaAdapter rotates `expires` on every refresh and deletes rows at sign-out/expiry, so even if we added `sessions.created_at`, a signed-out user would have no rows and `MAX(created_at)` would be NULL. The proxy is "still has an active session," not "last signed in." Misleading.
- **(c) Use `users.updated_at`.** Already exists. Prisma's `@updatedAt` bumps on any field write — including the role-mutation UPDATE Stream E itself performs. Stream E's UI would show "Last signin: 2 seconds ago" right after the operator promotes a user, which is a lie. The column also bumps on env-driven re-sync (`syncRoleFromEnv`'s UPDATE at `auth/index.ts:96-99`), so the value is incoherent for display.
- **(d) Defer with em-dash.** Acceptable fallback. Stream E's table renders "—" in the Last Signin column for every row, sorts by `created_at` only. Zero work; loses the verification signal that was the hard gate for Edward/Zach onboarding (operator wants to see "Edward last signed in 3 minutes ago, role still SUBSCRIBER → I need to promote him").

**Owning stream:** Stream H (the optional precursor) — single migration + 2 lines in `src/lib/auth/index.ts`. If the stakeholder picks (d) instead at deploy time, Stream H is dropped and Stream E renders "—" in the column.

**Cross-references:** the design doc §2 for Stream H's migration + code touchpoints; R6 in the design doc §9 (H-before-E sequencing rule).

---

### D12.4 — Audit-write atomicity: `writeAuditEntry` runs INSIDE the mutation TX

**Choice:** The helper exported at `src/lib/admin/audit.ts` (Stream G; D12.8) takes a `Prisma.TransactionClient` as its first parameter and runs as an INSERT inside the same transaction as the mutation it describes. If the mutation rolls back (constraint violation, network drop mid-TX, explicit throw), the audit row rolls back too. **There is no "audit-attempt without mutation success" half-state.**

The helper's TypeScript signature enforces the contract at compile time: any caller passing the global `prisma` client instead of a `tx` obtained from `prisma.$transaction(async (tx) => …)` gets a type error, because `Prisma.TransactionClient` is a narrower type than `PrismaClient` — it lacks `$connect`, `$disconnect`, `$transaction`, `$on`, and `$use`. Compile-time enforcement of the TX-bound contract is the design intent.

**Reasoning:** The operation is pure DB writes — no external side effects (no Stripe API, no S3, no email). Atomicity is the load-bearing property: "every successful mutation has a durable audit row; every failed mutation has no audit row." This is the inverse of `withIdempotency` (D10.1), which deliberately runs the handler OUTSIDE a DB transaction because the webhook handler may call Stripe API / S3 writes that can't be cleanly bracketed in a Postgres TX (rationale at `src/lib/webhooks/idempotency.ts:8-11`). The idempotency ledger commits on success or failure independently, and the handler is re-runnable on retry. Stream G's `writeAuditEntry` has the opposite shape and the opposite rationale: pure DB writes, atomicity with the mutation is required, no retryability needed (a failed mutation is just a 500 the operator re-tries).

**Consumer code-shape implication for Streams E and F:** Stream B's existing `prisma.$transaction([...])` array form (at `src/app/api/books/new/route.ts:273-320`, composing four writes after Stripe Product+Price creation per D11.7) **cannot be used** in Streams E and F. The array form runs every statement independently — there's no way to read the pre-mutation `before` state inside the same TX, and there's no `tx` to thread into `writeAuditEntry`. Streams E + F use the **interactive transaction** shape `prisma.$transaction(async (tx) => { ... })` so they can:

1. Read the pre-mutation row through `tx` (under the same TX).
2. Issue the mutation through `tx`.
3. Call `writeAuditEntry(tx, …)` capturing `before` state.

The interactive form is documented in the helper's JSDoc as the required call shape; the design doc §3 and §4 carry the canonical Stream E / Stream F code-shape examples.

**Trade-off — audit-write-fails-blocks-mutation (R2):** If the audit INSERT itself fails (Postgres infra issue: out-of-disk, lock timeout, unique-constraint nonsense), the parent mutation rolls back too. Mitigations: schema-level NOT NULL on every required column per D12.7 (id, actor_user_id, action_type, target_type, target_id, created_at — no NULL-mismatch errors possible from helper-side inputs); no FK on `target_id` (polymorphic, so target-row deletion-mid-TX can't trigger an FK error); the actor FK has a valid target by construction (caller is the logged-in ADMIN; their User row exists). The remaining failure mode (Postgres infra) takes down the parent mutation too, which is the acceptable behavior — rather than silently losing the audit trail, the operator gets a 500 and the mutation didn't happen.

**Cross-references:** [D10.1](./phase-3-decisions.md#d101--webhook-idempotency-two-phase-received--processed-status-pattern) (`withIdempotency` — the contrasting OUTSIDE-TX shape and its rationale); D12.7 (the schema's NOT NULL discipline that makes the audit INSERT robust); D12.8 (helper module location); design doc §9 R2 (audit-fails-blocks-mutation failure analysis).

---

### D12.5 — `actionType` naming convention: dot-delimited

**Choice:** `actionType` values are dot-delimited `<scope>.<verb>[_<qualifier>]`. The full enumerated value set Streams E + F write:

- `user.role_promote_publisher` — SUBSCRIBER → PUBLISHER promotion
- `user.role_promote_admin` — SUBSCRIBER → ADMIN or PUBLISHER → ADMIN promotion
- `user.role_demote_publisher` — ADMIN → PUBLISHER demotion
- `user.role_demote_subscriber` — PUBLISHER → SUBSCRIBER or ADMIN → SUBSCRIBER demotion
- `book.reassign_publisher` — Stream F's `book.publisher_user_id` mutation
- `grant.revoke` — Stream F's `access_grants.revoked_at = NOW()` soft-revoke

Each distinct role-transition gets a distinct value (so future read-surface filters can pivot on "every promotion to ADMIN" without parsing JSON state). The longest value (`user.role_promote_publisher`, 27 chars) stays well under the VARCHAR(64) DB cap; future values that grow longer than 64 chars require a column widening migration (acceptable cost).

**Reasoning:** Dot-delimited reads target.action naturally. Each Stream-E role-transition gets a distinct value so future read-surface filters can pivot on "every promotion to ADMIN" without parsing JSON. The compound form stays under VARCHAR(64) for all foreseeable values.

App-side discipline (no Postgres enum + no CHECK constraint) enforces the value set per the webhook_events.source precedent (D9.3) — new action types ship without schema migrations. The helper module at `src/lib/admin/audit.ts` accepts `actionType: string`; callers pass the string literal. A future tightening (TypeScript union type listing every value) is a one-line follow-up if drift appears.

**Alternatives rejected:**
- **(b) Underscore-only:** `user_role_promote`, `book_reassign_publisher`. Slightly less readable; loses the target/action separation that's useful for filter UI.
- **(c) Slash-delimited:** `user/role/promote`. URL-like — risks confusion with route paths in logs.

**Cross-references:** [D9.3](./phase-3-decisions.md#d93--stream-3-lands-first-webhook-precedent--webhook_events-idempotency-table) (the VARCHAR-discriminator-not-enum precedent for webhook_events.source); [D11.13](./phase-4-decisions.md#d1113--fetch_logssource-as-varchar32-not-null-default-agent_fetch-not-a-postgres-enum) (the same precedent for fetch_logs.source); D12.7 (the column's VARCHAR(64) DB shape).

---

### D12.6 — Soft-revoke for grants

**Choice:** Stream F's revoke surface sets `revoked_at = NOW()` (UPDATE), not DELETE. Audit-trail preserving. Aligns with [D10.2](./phase-3-decisions.md#d102--checkout-dedup-blocks-any-active-access_grant-regardless-of-source) ("soft-revoke for audit-trail preservation") and the ADMIN-as-seed-owner reassign template at `docs/operations.md:460-465` (which already uses `UPDATE … SET revoked_at = NOW()`). Hard-delete remains psql-only, available to operators with DB credentials in the rare case where a grant should never have existed (e.g. test-data leakage); documented in `docs/operations.md:288`.

**Reasoning:** Hard-delete loses the "was this grant ever active?" history. With soft-revoke, every existing read site filters `revoked_at IS NULL` (the predicate is already established at `src/lib/books/access.ts:42-47` and `src/lib/dashboard/queries.ts:152-157`), so the revoked row is invisible to access checks but visible to audit / reporting. Stream F's UI only surfaces soft-revoke — the runbook retains hard-delete as the escape hatch.

The companion `admin_actions` row (written via `writeAuditEntry`) captures `beforeState: { revoked_at: null }` → `afterState: { revoked_at: '2026-05-11T…' }` per D12.14, giving the operator a double trail: the soft-revoke flag on the `access_grants` row AND the durable audit entry.

**Code shape (Stream F revoke handler):**
```ts
await prisma.$transaction(async (tx) => {
  const before = await tx.accessGrant.findUniqueOrThrow({
    where: { id: grantId },
    select: { revokedAt: true },
  });
  if (before.revokedAt !== null) throw new Error("Grant already revoked");
  const revokedAt = new Date();
  await tx.accessGrant.update({ where: { id: grantId }, data: { revokedAt } });
  await writeAuditEntry(tx, {
    actorUserId: session.user.id,
    actionType: "grant.revoke",
    targetType: "grant",
    targetId: grantId,
    beforeState: { revoked_at: null },
    afterState: { revoked_at: revokedAt.toISOString() },
  });
});
```

**Alternatives rejected:**
- **(b) Hard-delete on revoke.** Loses provenance. The Phase 3 D10.2 lock-in on "any active grant blocks checkout" specifically needs the soft-revoke shape — a hard-deleted SEED grant looks identical to "this subscriber never had access," which is a misleading audit state.

**Cross-references:** [D10.2](./phase-3-decisions.md#d102--checkout-dedup-blocks-any-active-access_grant-regardless-of-source); `docs/operations.md` "Reassign seed books later" (the existing soft-revoke SQL block that Stream F productizes); D12.14 (changing-fields-only state capture).

---

### D12.7 — `admin_actions` schema

**Choice:** Single table, single migration, no enum, no backfill. Column shape:

| Column | Type | Constraint | Rationale |
|---|---|---|---|
| `id` | UUID | NOT NULL PK, default `gen_random_uuid()` | Mirrors every other table's PK shape (`schema.prisma:56,74,113,140,213,238,264,288,330,360`) |
| `actor_user_id` | UUID | NOT NULL, FK → `users.id` ON DELETE RESTRICT ON UPDATE CASCADE | The ADMIN who performed the action; RESTRICT preserves history |
| `action_type` | VARCHAR(64) | NOT NULL | Dot-delimited per D12.5; wider than the VARCHAR(32) precedent because compound values are longer |
| `target_type` | VARCHAR(32) | NOT NULL | `'user' \| 'book' \| 'grant'`; matches `webhook_events.source` (`schema.prisma:385`) + `fetch_logs.source` (`schema.prisma:308`) precedent shape |
| `target_id` | UUID | NOT NULL | No FK (polymorphic across users / books / access_grants) |
| `before_state` | JSONB | NULL | Pre-mutation snapshot of changing fields only (D12.14) |
| `after_state` | JSONB | NULL | Post-mutation snapshot of changing fields only |
| `created_at` | TIMESTAMPTZ(6) | NOT NULL DEFAULT CURRENT_TIMESTAMP | Matches `FetchLog.createdAt` precedent (`schema.prisma:302`) |

**Three composite indexes:**
- `(actor_user_id, created_at DESC)` — supports "who has done what recently" queries
- `(target_type, target_id, created_at DESC)` — supports "history for this user/book/grant" lookups
- `(action_type, created_at DESC)` — supports "every promotion in the last week" filters

**Reasoning — per-column choice anchors:**

- **VARCHAR over Postgres enum** for both discriminator columns. [D9.3](./phase-3-decisions.md#d93--stream-3-lands-first-webhook-precedent--webhook_events-idempotency-table) locks the pattern for `webhook_events.source` ("future events may add values without a migration"); [D11.13](./phase-4-decisions.md#d1113--fetch_logssource-as-varchar32-not-null-default-agent_fetch-not-a-postgres-enum) cites that same precedent inline for `fetch_logs.source`. Stream G adopts the same posture: future streams (e.g. user suspend, book archive) add new action / target types without a schema change. App-side discipline + the dot-delimited convention (D12.5) enforces the value set.

- **JSONB over flat columns** for before/after state. Per-action-type variability (role changes carry `{ role }`, book reassign carries `{ publisher_user_id }`, grant revoke carries `{ revoked_at }`) makes flat columns either rigid (dedicated per-action-type columns) or queryability-lossy (single string column with stringified JSON). JSONB gives both per-row flexibility and Postgres JSONB operators (`->`, `@>`) for future read-surface filters.

- **`onDelete: RESTRICT` on the actor FK.** Preserves history. `SET NULL` would lose forensic value ("which ADMIN did this?"). `CASCADE` would defeat the table's purpose entirely (deleting a User would erase their audit trail). Mirrors the `FetchLog.bookVersionId` RESTRICT precedent (`schema.prisma:311`). A future "delete user" flow must either soft-delete (preserve the User row) or run an explicit audit-rows migration.

- **No FK on `target_id`.** Target is polymorphic across three tables (users, books, access_grants). Schema-level FK would force per-target-type columns (rigid). App-side discipline + the `target_type` discriminator handles correctness.

- **No retention column.** The table is append-only; expected volume at internal-alpha is operator-paced (tens to low hundreds of mutations per week). If volume crosses ~10k rows a separate retention sweep ships then. Mirrors follow-up #19 posture for `fetch_logs`. Design doc §9 R4 documents the risk.

- **`gen_random_uuid()` default at the DB layer.** Aligns with the schema-level UUID default (`@default(uuid())` in Prisma maps to `gen_random_uuid()` via the `pgcrypto` extension). Operator-issued INSERTs via psql don't need to supply the id.

**Migration file:** `prisma/migrations/20260511130000_phase_4_5_stream_g_admin_actions/migration.sql`. Single `CREATE TABLE` + one `ADD CONSTRAINT` (FK) + three `CREATE INDEX` statements. Inline rollback SQL as a comment block at the top per the Phase 4 Stream A precedent (`prisma/migrations/20260511120000_phase_4_schema_part_1/migration.sql:22-45`). No `ALTER TYPE … ADD VALUE` (no enum value adds), so the migration is single-file (the two-file split from Phase 4 Stream A — driven by the ADD-VALUE-then-reference Postgres mechanics per D11.3 — does not apply here).

**Alternatives rejected:**
- **(a) Postgres enum for actionType.** Rejected per D9.3 / D11.13 precedent — adding values requires a migration, the very thing this column is shaped to avoid.
- **(b) Dedicated columns per action type** (e.g. `before_role`, `after_role`, `before_publisher_user_id`, `after_publisher_user_id`, `before_revoked_at`, `after_revoked_at`). Rigid; new action types need migrations; columns are mostly NULL on any given row.
- **(c) ON DELETE SET NULL or CASCADE on the actor FK.** SET NULL loses forensic value; CASCADE defeats the audit table's purpose. Both rejected.
- **(d) Retention column / TTL pruning at ship time.** Append-only at internal-alpha volume costs ~nothing; deferred to a follow-up triggered at ~10k rows.

**Cross-references:** [D9.3](./phase-3-decisions.md#d93--stream-3-lands-first-webhook-precedent--webhook_events-idempotency-table) (VARCHAR-discriminator precedent); [D11.13](./phase-4-decisions.md#d1113--fetch_logssource-as-varchar32-not-null-default-agent_fetch-not-a-postgres-enum) (the same precedent reapplied for fetch_logs); D12.5 (the actionType convention); D12.12 (read surface deferral — the three indexes pre-align to its filter dimensions); D12.14 (state capture convention); design doc §9 R4 (retention deferral) and R5 (migration rollback shape).

---

### D12.8 — Helper module location: `src/lib/admin/audit.ts`

**Choice:** Place `writeAuditEntry` at `src/lib/admin/audit.ts`. Create the `src/lib/admin/` directory.

**Reasoning:** Mirrors `src/lib/books/access.ts` (Stream C shared helper per D11.4) and `src/lib/webhooks/idempotency.ts` (Stream 3 helper per D9.3 / D10.1). The "lib/<domain>/<concern>" layout is the existing convention. `audit.ts` is a clear concern name; `admin/` is the natural domain folder once Streams E and F land (E's `getAdminUsers`-like helpers + F's `getAdminBooks` / `getAdminGrants` are candidates to co-locate here — but those decisions belong to E + F's own decision entries).

**Helper signature** (full JSDoc lives in the module itself):
```ts
import { Prisma } from "@/generated/prisma/client";

export type AuditTargetType = "user" | "book" | "grant";

export type WriteAuditEntryArgs = {
  actorUserId: string;
  actionType: string;
  targetType: AuditTargetType;
  targetId: string;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
};

export async function writeAuditEntry(
  tx: Prisma.TransactionClient,
  args: WriteAuditEntryArgs,
): Promise<void>;
```

The `tx` parameter is load-bearing (D12.4). The helper does NOT use the global `prisma` import; callers obtain `tx` from an interactive `prisma.$transaction(async (tx) => { ... })` block and pass it through. The TypeScript signature enforces the contract at compile time — passing the global `PrismaClient` instead of a `TransactionClient` is a type error by construction.

**Alternatives rejected:**
- **(b) `src/lib/audit/index.ts`.** Top-level "audit" folder. More discoverable if many audit surfaces appear; today only one consumer module exists.
- **(c) Co-locate in `src/lib/auth/`** because admin actions are auth-adjacent. Confusing; this is not authentication — it's audit-of-mutation. Conflating the two muddies the auth module's surface.

**Cross-references:** [D11.4](./phase-4-decisions.md#d114--shared-requirebookaccess-helper-at-srclibbooksaccessts-stream-c-implements-logged-here-for-visibility) (the `src/lib/books/access.ts` precedent); D10.1 (the `src/lib/webhooks/idempotency.ts` precedent); D12.4 (the TX-bound contract this module encodes).

---

### D12.9 — Self-protection gates on Stream E's role-mutation handler

**Choice:** Stream E's `POST /api/admin/users/[id]/role` handler enforces five server-side gates. All checks return HTTP 400 on violation. Modal UX gates (D12.10) are advisory only — server-side is the authority.

1. **ADMIN-self-demote refuse.** `if targetUser.id === session.user.id && targetRole !== Role.ADMIN → 400 "Cannot demote yourself"`. No legitimate workflow demotes self (outgoing ADMIN can promote a successor first, then ask successor to demote them).
2. **Last-remaining-ADMIN demote refuse.** `if targetUser.role === Role.ADMIN && targetRole !== Role.ADMIN: SELECT COUNT(*) FROM users WHERE role = 'ADMIN'; if count <= 1 → 400 "Cannot demote the last ADMIN"`. Defense-in-depth lock-out prevention. Recovery path through `roles.env` re-promotion still exists, but the runbook penalty for hitting this gate is annoying.
3. **Cannot promote above your own role.** `if ROLE_RANK[targetRole] > ROLE_RANK[session.user.role] → 400 "Cannot promote above your own role"`. Moot today (only ADMIN reaches this handler, and ADMIN is the highest rank) but defense-in-depth for a future 4-tier enum.
4. **Target role must be a valid `Role` enum value.** `if !Object.values(Role).includes(targetRole) → 400 "Invalid role"`. Standard input validation; mirror the UUID regex pattern from `src/app/api/pricing/route.ts:27`.
5. **No-op refuse.** `if targetUser.role === targetRole → 400 "User already has this role"`. Prevents spurious audit-log rows.

All five gates run server-side, in order, before the interactive `$transaction` opens. The transaction itself only contains the `findUniqueOrThrow` (capture before-state), `update` (mutate role), and `writeAuditEntry` (audit row).

**Reasoning:** The gates are layered to avoid lock-out catastrophes. Gate 1 prevents the outgoing-ADMIN-demotes-self-by-accident case (the classic "I'll just clean up my account real quick" mistake). Gate 2 prevents the last-ADMIN demotion (no surviving ADMIN means no recovery through the UI; recovery requires `roles.env` + signin). Gate 3 is forward-compatible defense-in-depth. Gate 4 is type-safety at the API boundary. Gate 5 keeps the audit log clean — every row in `admin_actions` should represent an actual state change.

**Race condition note (R3):** Gate 2's `SELECT COUNT(*)` is racy if two ADMINs simultaneously try to demote each other (the second succeeds and both get locked out). Mitigation: row-level lock during the check (`SELECT ... FOR UPDATE` inside the same TX) **OR** accept the race (it's a multi-ADMIN coordination problem, low likelihood given the current 1-ADMIN deployment). Decision: accept the race for v1; document in design doc §9 R3. If the deployment ever has >2 ADMINs concurrently, revisit with `FOR UPDATE`.

**Alternatives considered:**
- **(b) Soft warn + "I understand I'll be signed out" checkbox for self-demote.** Rejected — Gate 1 hard-refusing is the simpler, less-foot-gun shape.
- **(c) Allow last-ADMIN demote with a confirmation modal.** Rejected — the modal-level confirmation isn't enough protection; the operator who clicks past it has no recovery surface until they sign in fresh, which may take time. Server-side hard refuse is the right floor.

**Cross-references:** D12.2 (UI demotion is permitted; these gates are what makes "permitted" safe); D12.10 (modal friction layers on top of server-side gates); design doc §9 R3 (last-ADMIN race risk).

---

### D12.10 — Confirmation modal pattern: asymmetric friction

**Choice:** Match modal friction to action risk.

- **GitHub-style "type the target email to confirm"** for destructive actions:
  - Demotion (any role → lower role; both Stream E paths: PUBLISHER → SUBSCRIBER, ADMIN → SUBSCRIBER, ADMIN → PUBLISHER).
  - ADMIN promotion (anyone → ADMIN; ADMIN is privileged enough that promotion to it is itself a security event).
- **Simple OK / Cancel** for benign actions:
  - PUBLISHER promotion (SUBSCRIBER → PUBLISHER) — routine workflow.
  - Grant revoke (Stream F) — one-click; the action is audit-logged + reversible via psql.
  - Book reassign (Stream F) — one-click; reassign is operator-routine for the seed-book transition.

**Reasoning:** Asymmetric friction matches asymmetric risk. Promoting Edward to PUBLISHER is a routine workflow; demoting an ADMIN is rare and irreversible-by-the-target (the demoted ADMIN can't undo it from their own session — see D12.9 Gate 1). Forcing the operator to type the target's email is the standard idiom for high-consequence actions (GitHub uses it for repo delete, org transfer, etc.); doing the same on every grant revoke would train the operator to muscle-memory-paste through it, defeating the friction's purpose.

**Stream F's grant revoke modal** specifically renders source-specific consequence copy because the load-bearing side effect varies by grant source:
- **SEED revoke** → may unblock Checkout for that subscriber per [D10.2](./phase-3-decisions.md#d102--checkout-dedup-blocks-any-active-access_grant-regardless-of-source).
- **PUBLISHER_OWN revoke** → publisher can no longer read their own book via `requireBookAccess` (D11.4).
- **PURCHASE / SUBSCRIPTION revoke** → paying customer loses access.
- **MANUAL revoke** → comp ticket removed (operator-issued grant per `docs/operations.md:280-285`).

The modal renders the source-specific consequence as a single sentence below the title/email line. Cheap to add; raises operator awareness exactly where it matters.

**Alternatives rejected:**
- **(a) Simple OK / Cancel for everything.** Loses the catastrophe-friction on demotion and ADMIN promotion.
- **(b) Type-the-email for everything.** Trains operators to muscle-memory-paste through the friction; defeats the purpose. Also annoys-tax on the routine workflows (5 seed book reassigns in a row would become 5 email-types).

**Cross-references:** D12.9 (server-side gates are the floor; modal is the ceiling); design doc §1 D12.10 for the canonical mapping; F brief §5 for grant-revoke modal consequence copy.

---

### D12.11 — Bulk operations: out-of-scope for Phase 4.5

**Choice:** No bulk reassign, no bulk revoke. UI exposes one-row-at-a-time only. File as a follow-up if the operator hits friction during Edward's onboarding.

**Reasoning:** The imminent Edward-takeover (5 seed books from ADMIN to Edward) is the highest-volume reassign event on the calendar; 5 clicks. Building bulk infrastructure for a 5-row workflow optimizes a one-time event. Per-row audit shape is also clean: one `admin_actions` row per affected book, with `before_state` / `after_state` clearly diff-able. Bulk would either need an array shape in JSONB (`{ book_ids: [...] }`) or N audit rows from one client action — both add complexity that's not worth it at internal-alpha scale.

**Alternative considered (Q-F2.5):** Client-side bulk-as-N-single-API-calls — the UX wins (one click, five requests fire serially) without complicating Stream G's audit shape. Worth flagging as a deferrable; defer for now, revisit if Edward's onboarding produces a "this would have been faster as bulk" complaint.

**Cross-references:** D12.7 (the per-row audit shape that bulk would muddy); design doc §1 D12.11 for the full alternatives discussion; Edward onboarding is the canonical 5-click workflow per `docs/operations.md` "ADMIN-as-seed-owner" section.

---

### D12.12 — Audit read surface: deferred entirely

**Choice:** Stream G ships the WRITE surface only. No `/dashboard/admin/audit` route. Operators query `admin_actions` via psql until a future read surface ships. The three composite indexes from D12.7 are pre-aligned with the eventual read surface's filter dimensions (actor, target, action type), so when the read surface lands, no additional indexes are needed.

**Reasoning:** The dispatch spec locks "write surface lands now; read surface deferred." Building the read surface would add ~half a stream of work that's not on the dispatch (table layout, filter UI, pagination via `created_at` cursor — even though the three index-aligned filter dimensions are pre-served). The deferral has zero impact on E + F's WRITE path — they write rows regardless of who reads them.

**Operator workflow during deferral** (full set of canonical queries in `docs/operations.md` "Querying admin_actions via psql"):
```sql
-- Most recent operator actions
SELECT created_at, actor_user_id, action_type, target_type, target_id,
       before_state, after_state
  FROM admin_actions
 ORDER BY created_at DESC
 LIMIT 20;

-- All actions against a specific user
SELECT *
  FROM admin_actions
 WHERE target_type = 'user' AND target_id = '<uuid>'
 ORDER BY created_at DESC;
```

**Filed follow-ups** (deferred Phase 4.5-tail work, documented as D12.x decisions rather than `docs/follow-ups.md` entries per the dispatch shape):
- Read surface `/dashboard/admin/audit` — UI sketch in `phase-4.5-pregather-g.md §8` (pagination via `created_at` cursor; three filter dimensions aligned with the three composite indexes; ADMIN-only route mirroring Stream E + F's role gate).
- `admin_actions` retention sweep — revisit if the table crosses ~10k rows. Mirrors follow-up #19 posture for fetch_logs.

**Alternatives rejected:**
- **(b) Include a minimal `/dashboard/admin/audit` list now** (single table, no filters). Adds ~half-stream of work that's not on the dispatch.

**Cross-references:** D12.7 (the three indexes pre-align to filter dimensions); `docs/operations.md` "Querying admin_actions via psql" (the runbook entry that this decision points operators toward); design doc §8 for the deferral list.

---

### D12.13 — Reassign-publisher does NOT touch MANUAL grants

**Choice:** Stream F's book reassign flow ONLY touches `source = 'PUBLISHER_OWN'` grants on the affected book. Other grant sources (MANUAL, SEED, PURCHASE, SUBSCRIPTION) are left untouched.

The reassign transaction does three writes (plus the audit-log row):
1. `UPDATE books SET publisher_user_id = <target_user_id> WHERE id = <book_id>`.
2. `UPDATE access_grants SET revoked_at = NOW() WHERE source = 'PUBLISHER_OWN' AND book_id = <book_id> AND revoked_at IS NULL`.
3. `INSERT INTO access_grants (id, subscriber_id, book_id, source, granted_at) VALUES (gen_random_uuid(), <target_subscriber_id>, <book_id>, 'PUBLISHER_OWN', NOW()) ON CONFLICT (subscriber_id, book_id, source) DO NOTHING`.
4. `writeAuditEntry(tx, { actionType: 'book.reassign_publisher', … })` per D12.14.

**Reasoning:** The reassign workflow productizes the operations.md SQL block at `docs/operations.md:453-478` — which already scopes its `UPDATE access_grants SET revoked_at = NOW()` to `WHERE source = 'PUBLISHER_OWN'`. The narrowness is intentional:

- **MANUAL grants are operator-issued** (comp tickets, support escalations per `docs/operations.md:280-285`). They're intentionally decoupled from publisher attribution. If ADMIN comped a subscriber access to Edward's book in March, reassigning that book from Edward to Zach in May should NOT silently invalidate the comp.
- **SEED, PURCHASE, SUBSCRIPTION** are even more clearly orthogonal — they represent buyer relationships independent of who owns the book. SEED grandfathers pre-Phase-3 access per [D9.6](./phase-3-decisions.md#d96--access_grants-full-table-with-source-enum--lifecycle-closes-32); PURCHASE / SUBSCRIPTION are Stripe-driven buyer access.

The reassign handler header comment makes this explicit: "Reassign only touches PUBLISHER_OWN grants. MANUAL grants are operator-intentional and never auto-touched by reassign."

**Alternatives rejected:**
- **(a) Reassign also revokes MANUAL grants.** Silently invalidates operator-issued comps; would force a re-issue workflow that today's runbook doesn't carry. Worse end-state than "MANUAL grants survive reassign."

**Cross-references:** [D9.6](./phase-3-decisions.md#d96--access_grants-full-table-with-source-enum--lifecycle-closes-32) (the GrantSource enum and its semantics); [D11.3](./phase-4-decisions.md#d113--publisher_own-grant-source--auto-grant-at-fk-assignment-time) (PUBLISHER_OWN auto-grant model); `docs/operations.md:453-478` (the seed-book reassign SQL that this handler productizes); design doc §5 for the full Stream F reassign handler shape.

---

### D12.14 — `before_state` / `after_state` capture: changing fields only

**Choice:** `before_state` / `after_state` JSONB payloads capture **only the fields that changed**, not full row snapshots. The helper signature (D12.8) carries `beforeState?: Record<string, unknown> | null` and `afterState?: Record<string, unknown> | null`; call sites build a minimal object containing only the columns the mutation touched.

Examples:
- **User role change (Stream E):** `beforeState = { role: 'SUBSCRIBER' }`, `afterState = { role: 'PUBLISHER' }`. The 7 other User columns (id, email, name, image, emailVerified, createdAt, updatedAt) are NOT captured.
- **Book reassign (Stream F):** `beforeState = { publisher_user_id: '63f65b…' }`, `afterState = { publisher_user_id: '<edward-id>' }`. The other 9 Book columns are NOT captured.
- **Grant revoke (Stream F):** `beforeState = { revoked_at: null }`, `afterState = { revoked_at: '2026-05-11T…' }`. The other 9 AccessGrant columns are NOT captured.

**Reasoning:** Minimal payload; clear diff; minimal JSONB storage cost. Full row snapshots would be ~10x the payload, and most of the columns are uninteresting in a diff context (id, foreign keys, created_at do not change). The mutation handler knows exactly which fields it's changing — capturing only those gives the cleanest before/after diff and the smallest forensic-adequate payload.

**Forensic adequacy:** For the three mutation surfaces Phase 4.5 covers (user role, book publisher, grant revoke), the changing field IS the forensic signal. "Edward was demoted from PUBLISHER to SUBSCRIBER on 2026-05-15" is fully captured by `{ role: 'PUBLISHER' }` → `{ role: 'SUBSCRIBER' }` + the `actor_user_id` + `created_at` columns. The User's email, name, etc. at the time of the demotion is recoverable from the User row itself (the row still exists; `users.email` doesn't change in this Phase) or from a future user-history table if/when one ships.

**Alternative considered:**
- **(b) Full row snapshot** (`{ id, email, role, name, createdAt, updatedAt }` before/after for User mutations; analogous for Book / AccessGrant). More forensically robust if a column NOT involved in the mutation also changed externally (e.g. Stream E mutates `role`; some other process simultaneously mutates `email`; only `role` is captured in the audit). At Phase 4.5's scale this concern is hypothetical — no concurrent-mutation paths exist for the same rows. If a future scenario needs full forensic depth, individual handlers can opt into full snapshots without changing this helper's signature.

**Cross-references:** D12.7 (the JSONB column shape that this convention writes into); D12.8 (helper signature that takes the minimal-payload arg shape); D12.12 (deferred read surface — when it lands, the minimal-payload shape determines its diff-display rendering).

---

*Last updated: 2026-05-11. Stream G — audit log foundation. Streams H, E, F will add their own D12.x entries (D12.15+ may grow with stream-specific implementation decisions beyond Stream G's pre-log) in their own commits.*
