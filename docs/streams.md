# bkstr.tmrwgroup.ai — Stream Registry

Thin canonical index of work-streams: one line per stream — letter, status, merge SHA(s), headline decision(s), one-line description. This is an **index, not a record** — full rationale lives in `docs/decisions.md` (and the `docs/phase-N-decisions.md` archives) and in git history. If a row needs more than a line, the detail belongs in the decisions log, not here.

**Conventions** (mirrors `docs/follow-ups.md`): append-only; do not renumber or re-letter; mark a superseded / reverted stream in place with a strikethrough + a one-line note rather than deleting the row.

---

## ⚠️ The stream-letter-reuse hazard — read this first

Before Phase 6, stream letters were namespaced *within a phase* and **reused across phases**:

- **Phase 4** used Stream A, B, C, D.
- **Phase 4.5** used Stream E, F, G, H.
- **Phase 5** used Stream A, B, C, D, E, F, G, H — a *fresh* A–H.
- **Phase 5 (final) onward** continues the letter sequence **unprefixed and globally unique**: I, J, K, …

So a bare "Stream G" is ambiguous unless you know the phase. This registry resolves it: the **Phase 6+ table** uses globally-unique letters; the **pre-Phase-6 tables** list the phase-prefixed streams with their SHAs for archaeology. (There was also a *third, erroneous* referent: an outgoing-chat memory at the Phase 5 close used "Stream G" to mean the Manus storefront integration — that work actually shipped as Phase 5 Stream H / H.1–H.9. See the note on the Phase 5 / G row.)

This drift has bitten three times: (1) the markdown-upload work wanted "Stream H" but that letter was taken by storefront iteration, so it became Stream I; (2) the Stream J dispatch referred to "Stream G" meaning the storefront work, which was actually Stream H; (3) the 2026-05-14 handover queue labeled paste→zip default-mode promotion as "Stream M" but the registry already had M reserved for agent-persona positioning — resolved by reserving Stream T for the paste→zip work. This file exists so that doesn't happen again.

> **Procedure (for dispatchers, operators, and any future session):** when a stream letter is referenced in a dispatch document, handover, or chat, first identify which phase it belongs to. If unspecified, **ASK — do not infer.** The letter alone is insufficient.

---

## Phase 6+ streams (globally-unique letters)

| Stream | Status | Merge SHA(s) | Decision(s) | Description |
|---|---|---|---|---|
| I | SHIPPED 2026-05-13 | `6646ccd` | D15.13 | Markdown file upload on the new-book form — client-side `FileReader`, dual paste / `.md`-file-pick mode; no server endpoint, no payload-shape change. *(Logged as "Phase 5 Stream I" in the decisions log; first stream of the unprefixed letter sequence.)* |
| J | SHIPPED 2026-05-13 | `0b1ee88` (AD1 revision), `c04762a` (feature), `7b85538` (docs status) | D16.1 | Multi-chapter book schema foundation — `book_chapters` table FK → `BookVersion` (`onDelete: Cascade`), `manifest` JSONB on `BookVersion`, `getVersionContent()` helper. Additive-only, no backfill of the 6 legacy versions. Roadmap AD1 revised (chapters key to `BookVersion`, not `Book`). |
| K | SHIPPED 2026-05-13 | `a9258cd` (registry housekeeping), `cc7db19` (deps: adm-zip + yaml), `e226b7b` (check-slug endpoint), `cfd9ed7` (feature), `c1aa515` (docs) | D17.1 | Zip upload creates a single multi-chapter book — parse `manifest.yaml` if present, else derive chapter order from filename sort; first WRITER of `book_chapters` rows. Extends `/api/books/new` (no parallel route). |
| K.1 | SHIPPED 2026-05-13 | `d713cd7` (feature), `78742a6` (docs) | D17.2 | **Hotfix of K** — virtual-root resolution for wrapped zip uploads (single-directory wrap, ≤3 levels deep; `__MACOSX/` resource-fork siblings stripped) + slug derivation from `file:`-only manifest chapters (no OQ-1 prefix stripping in manifest mode). Audit row gains `virtual_root` + `slug_derivation`. Surfaced by operator smoke prep against Zach's actual zip + a flat repack before any production upload. |
| L | SHIPPED 2026-05-13 | `1d18b7a` (schema), `924205b` (zip lib refactor — closes #116), `d4d22e7` (api + check-slug ?kind=skill), `4dbc0bb` (ui kind toggle + storefront + checkout + download + webhook refactor + tests), `1ee6633` (docs c5; ff-merge HEAD), `312c01c` (sidebar deep-link follow-up 2026-05-13), `19846ad` (follow-up #122 agent-consumption JSON API 2026-05-14) | D18.1 | Skills as a separate content class (AD2). Separate `skills`/`skill_versions`/`skill_files`/`skill_prices` tables; `AccessGrant.skillId` XOR with `bookId` via partial unique indexes + CHECK; webhook switches to `$executeRaw INSERT … ON CONFLICT (… ) WHERE … DO UPDATE` because Prisma's compound where-input disappeared when `bookId` went nullable. Shared zip helpers extracted to `src/lib/zip/` (closes #116). New `/api/skills/new`, `/skills`, `/skills/[slug]`, `/api/skills/[slug]/download`, `/api/skills/[slug]/files` (follow-up #122). Stream-K-style audit semantics extended unchanged (`target_type='skill'`, no schema change). 5-commit chain ff-merged as a single unit per §0a — intermediate commits 1–3 not individually deployable (schema-and-code lockstep). Catches absorbed: webhook composite-key disappearance (caught at `tsc`), XOR partial-unique-index discipline (Postgres NULL semantics), strict UTF-8 for executable file uploads, and the §0a deploy model itself. Dashboard-parity gaps (My Skills tab, owned-skills list, pricing edit, admin skills page) tracked as follow-up #129. |
| M | RESERVED | — | — | Agent-persona positioning (storefront / marketing copy). |
| N | SHIPPED 2026-05-14 | *(content-only — no merge SHA; uploaded via `/dashboard/books/new` zip mode)* | — | Flagship self-upgrade book — *"The Self-Upgrade Book: Becoming a Better Operator-Engineer"* (slug `self-upgrade-engineer`, 8 chapters, manifest-ordered). Content-only stream per #131's first half; rides Stream J/K rails (multi-chapter zip upload). Becomes the canonical demo input for Stream O. Edward's #131 anchor (msg 1–2): *"a skill about learning from a book (md file) and turning it into an action plan."* Cover image generated (1360×1800 PNG, eight-bar chapter-stack design). |
| O | SHIPPED 2026-05-14 | *(skill-bundle-only — no merge SHA; uploaded via `/dashboard/books/new` skill mode + post-upload slug correction in DB)* | — | Generic action-plan skill (slug `action-plan`). SKILL.md + 6 Python helpers: `fetch_book.py` (bkstr API client, sha256 integrity), `parse_outline.py` (markdown → Outline), `derive_plan.py` (Outline → ActionPlan via Bedrock Sonnet 4.5), `execute_parallel.py` (asyncio + semaphore, dependency-aware sub-agent spawn), `render.py` (plan + report → markdown), package `__init__.py`. Dual input: passed content OR bkstr fetch via API key. Closes #131's second half. Skill-bundle stream — rides Stream L rails (no code changes to bkstr). **Catches absorbed:** (1) SKILL.md frontmatter YAML parse error (unquoted description with `:` + parens triggered nested-mapping error on first upload; fixed by quoting the value); (2) slug auto-derived from filename was `stream-o-action-plan-skill` not `action-plan` — corrected in place via `UPDATE skills SET slug='action-plan' WHERE …` because Stream L did not ship skill-edit UI (gap tracked in #129). |
| P | RESERVED | — | — | Eval framework (publisher-authored, bkstr-stored, displayed). |
| Q | RESERVED | — | — | Library-card subscription (recurring billing). |
| R | RESERVED | — | — | Stripe Connect + publisher payouts. |
| S | RESERVED | — | — | Open marketplace UX + moderation. |
| T | RESERVED 2026-05-14 | — | — | Paste → zip default-mode promotion (ex-follow-up #113) — make zip upload the default mode on the new-book form; paste-mode becomes secondary. *Reserved to resolve the M/T conflict: 2026-05-14 handover queue erroneously labeled this work as "Stream M"; Stream M remains agent-persona positioning per this registry.* |
| U | SHIPPED 2026-05-14 | `183099d` (feature) | — | Books-side agent-consumption JSON API — mirror of follow-up #122 for books. New `GET /api/books/[slug]/files` (route file is `src/app/api/books/[id]/files/route.ts` — `[id]` directory name is a Next.js sibling-route constraint, handler accepts slug only). New `BookFetchAccessError` + `requireBookFetchAccess` helper in `src/lib/books/agent-access.ts` (composes existing `requireBookAccess` for grant check; doesn't touch the 3 live callers: view/download/cover). Manifest-aware multi-chapter assembly (uses `BookVersion.manifest.chapters[i].file ?? "chapters/${chapter.slug}.md"`); legacy inline-content fallback (single `content.md` file when manifest empty + `BookChapter` rows missing). UUID-shaped slugs rejected with `BOOK_NOT_FOUND` (slug-only contract). sha256 byte-for-byte parity with skills-side (`update(content, 'utf8').digest('hex')`). Response shape matches `/api/skills/[slug]/files` so Stream O's `fetch_book.py` uses a single code path. 112/112 vitest (was 106/106, +6 cases). Out-of-scope observations logged for future follow-ups: per-chapter `content_hash` column (cache opt), UUID/slug routing asymmetry across `[id]` siblings, fetch_logs polymorphism (already #128). Unblocked the Stream O demo loop. Surfaced because the original Stream O draft assumed books-side API parity with skills (follow-up #122 had only shipped for skills). |
| V | SHIPPED 2026-05-14 | `0cfe717` | D19.1 | Admin grant-revoke self-protection for PUBLISHER_OWN-on-own-content. Two-rail design: **hard 409 `SELF_PROTECTION` at `/api/admin/grants/[id]/revoke`** (gate placed INSIDE the existing TX, BEFORE both `accessGrant.update` and `writeAuditEntry` — the TX rollback on throw guarantees zero rows touched in `access_grants` AND zero rows in `admin_actions` on blocked attempts; load-bearing invariant proved by V-1's explicit `txAdminActionCreateMock.not.toHaveBeenCalled()` assertion), and **soft destructive-confirmation in the revoke modal** (red-bordered warning, typed-email match required with trim + case-insensitive RFC compare, Confirm button disabled until match, red `bg-red-700` styling on Confirm — mirrors D12.9 / D12.10 role-mutation-modal pattern verbatim). Predicate intentionally duplicated server-side (`grant.subscriber.userId === session.user.id`) vs client-side (`grant.subscriberUserId === currentUserId`) — rule-of-three threshold reserved for future helper extraction. `HandlerError` extended additively with optional `code?: string` field. `AdminGrantRow` gains `subscriberUserId: string \| null` (nullable because `Subscriber.userId` is `String?` in schema). Cross-publisher revoke (Stream F / D12.13) intact — gate only fires when the actor IS the underlying subscriber's user. 116/116 vitest (was 112, +4 cases); tsc 0, build success. Closed the friction surfaced 2026-05-13 + 2026-05-14 where the operator swept their own publisher grants while clearing test grants; audit log (D12.4) proved no auto-revoke bug existed — the friction was UX. Friction investigation `friction-1-2-pregather.md` grounded the design. Smoke: prod Test A → 409 SELF_PROTECTION + red destructive modal rendered + grant `624bbcfe-…` (action-plan) remained un-revoked; Test C verified DB invariant (admin_actions count 49 → 49 unchanged, both publisher grants still active, zero grant.revoke rows in last hour). |

**Next unreserved letter: `W`.** L–S are reserved by `docs/phase-6-roadmap.md`; T is reserved by follow-up #113; A–H are spent in the pre-Phase-6 namespaces (below) and are not reused for new work.

---

## Pre-Phase-6 streams (letter-namespaced per phase — historical, for archaeology)

> Note: Phases 1–3 did **not** use stream letters — Phase 1 was "Steps", Phase 2 was "Steps", Phase 3 was numbered "Stream 1/2/3". The first lettered streams appear in Phase 4. (Phase 3 highlights, for reference: Stream 1 — role enum + `access_grants` + `book_prices` + `webhook_events` schema (`bfe84f3`); Stream 2 — S3 dual-storage seam + `loadBookContent` helper (`7e81d5e`, D9.2/D10.1); Stream 3 — Stripe sandbox: Checkout + webhooks + pricing UI (`b049c79`, D9.7).)

### Phase 4 — schema → publisher UI → library → open signup

| Stream | Status | Merge SHA | Decision(s) | Description |
|---|---|---|---|---|
| Phase 4 / D | SHIPPED | `bb2d69a` | D11.5, D11.6, D11.11 | Open signup — env-driven role promotion (`/etc/bkstr/roles.env`), allowlist removal; **monotonic-upward role invariant** (env presence promotes; absence is a no-op). Ordered first per D11.1. |
| Phase 4 / A | SHIPPED | `04d2b5c` | D11.1–D11.3, D11.10, D11.12, D11.13 | Unified schema patch — `book.description`, `book.publisher_user_id` (both nullable, #68), `fetch_logs` reshape, `PUBLISHER_OWN` grant source. |
| Phase 4 / B | SHIPPED | `bab7838` | D11.7, D11.8 | Publisher UI — new-book form (`/dashboard/books/new` + `POST /api/books/new`) + publisher-scoped pricing. Stripe-first atomicity; inline content storage as `BookVersion` v1. |
| Phase 4 / C | SHIPPED | `94a5658` | D11.4, D11.9 | Book library — `/dashboard/library` + View/Download content-egress + API-instructions block. `requireBookAccess` helper (`src/lib/books/access.ts`); fixed-UTC-day download rate limit. |

### Phase 4.5 — audit foundation → last-signin → admin surfaces

| Stream | Status | Merge SHA | Decision(s) | Description |
|---|---|---|---|---|
| Phase 4.5 / G | SHIPPED | `37fd513` | D12.1, D12.4, D12.5, D12.7, D12.14 | `admin_actions` audit-log foundation — table + `writeAuditEntry()` helper (writes INSIDE the mutation TX); dot-delimited `action_type`; `before_state`/`after_state` capture changing fields only. Ordered first per D12.1. |
| Phase 4.5 / H | SHIPPED | `409d9f2` | D12.3 | `users.last_signin_at` column + auth-hook write on every signin (new-user + returning paths). |
| Phase 4.5 / E | SHIPPED | `591f0ac` | D12.2, D12.9, D12.10 | Admin users list + role promote/demote — `/dashboard/admin/users`; self-protection gates; asymmetric-friction confirmation modal. |
| Phase 4.5 / F | SHIPPED | `40fb642` | D12.6, D12.13 | Admin book reassignment + access-grant revoke (soft-revoke via `revoked_at`); reassign does not touch MANUAL grants. |

### Phase 5 — docs surface → admin assistant → branding → SAST → invites → invite hotfixes → storefront

| Stream | Status | Merge SHA | Decision(s) | Description |
|---|---|---|---|---|
| Phase 5 / A | SHIPPED | `5f2757b` (surface), `34615e9` (content) | D13.1, D13.2 | `/dashboard/docs` — role-aware static-markdown rendering surface, then filled with real content (closes #77). |
| Phase 5 / B | SHIPPED | `a2b1fde` | D14.1–D14.6 | Read-only admin AI assistant at `/dashboard/admin/assistant` — Bedrock (`@anthropic-ai/bedrock-sdk`), 5 typed read-only tools (200-row cap, no SQL escape hatch), two new tables (`assistant_conversations`/`assistant_messages`). |
| Phase 5 / C | SHIPPED | `5449549` | D14.7 | TMRW Group brand attribution — favicon + dashboard logo + "A product by" microcopy. |
| Phase 5 / D | ~~SHIPPED~~ → **REVERTED** | `fec707e` + `a2b4d3d` (merged), `e4ab6f5` (revert) | D14.8–D14.11 | SAST baseline — Semgrep + `npm audit` with CodeBuild gating. Reverted; re-merge tracked as **follow-up #89** (`36b59ed` logs the plan + D14.11 "CI-gating tests must run in CI itself"). |
| Phase 5 / E | SHIPPED | `fb1e561` | D15.1–D15.5 | Admin email invitations (magic-link; plaintext-in-transit, SHA-256-at-rest) + publisher book archive (`BookStatus.ARCHIVED` + per-status routes). |
| Phase 5 / F | SHIPPED | `0dd4718` | (row-shape under D15.2 — no new D-slot) | Invite hotfix #1 — `accept-init` route consumes the request body once via content-type dispatch; adds `/etc/bkstr/smtp.env` to `start.sh`. (Two bugs found in live testing.) |
| Phase 5 / G | SHIPPED | `323e7c6` | (no new D-slot) | Invite hotfix #2 — use `NEXTAUTH_URL` as the redirect origin (the `accept-init` `Location` header was `https://localhost:3000`). **⚠️ Disambiguation:** an outgoing-chat memory at the Phase 5 close erroneously used "Stream G" to mean the Manus storefront integration — that work shipped as Phase 5 Stream H / H.1–H.9 (next row). The repo's "Stream G" is *this* invite redirect fix. |
| Phase 5 / H (incl. H.1–H.9) | SHIPPED | `f697b77` (cover images), `52c138d` … `f74bfee` (storefront H.1–H.9) | D15.6–D15.12 | Publisher-uploaded book cover images (S3, public bucket policy on `bkstr-tmrw-prod`, domain-initial placeholder) → public storefront homepage integrating Manus's design, iterated through H.1–H.9 (layout flip-flops, locked spec). **Manus's static-AWS-keys pattern was REJECTED — the EC2 IAM role (`bkstr-ec2-role`) / `/etc/bkstr/*.env` convention was preserved. Manus's nav-removal was NOT applied** ("Usage Metrics" / "Team Access" placeholder links remain). |

---

*Last updated: 2026-05-14 evening. Streams N + O + U shipped 2026-05-14 — full Edward-thread #131 demo loop now end-to-end (book → API → skill → planned parallel execution). Stream U at `183099d` (books-side agent-consumption JSON API). Streams N and O are content/skill uploads (no merge SHAs).*
