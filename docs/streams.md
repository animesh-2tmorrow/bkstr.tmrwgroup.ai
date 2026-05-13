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

This drift has bitten twice: (1) the markdown-upload work wanted "Stream H" but that letter was taken by storefront iteration, so it became Stream I; (2) the Stream J dispatch referred to "Stream G" meaning the storefront work, which was actually Stream H. This file exists so that doesn't happen again.

> **Procedure (for dispatchers, operators, and any future session):** when a stream letter is referenced in a dispatch document, handover, or chat, first identify which phase it belongs to. If unspecified, **ASK — do not infer.** The letter alone is insufficient.

---

## Phase 6+ streams (globally-unique letters)

| Stream | Status | Merge SHA(s) | Decision(s) | Description |
|---|---|---|---|---|
| I | SHIPPED 2026-05-13 | `6646ccd` | D15.13 | Markdown file upload on the new-book form — client-side `FileReader`, dual paste / `.md`-file-pick mode; no server endpoint, no payload-shape change. *(Logged as "Phase 5 Stream I" in the decisions log; first stream of the unprefixed letter sequence.)* |
| J | SHIPPED 2026-05-13 | `0b1ee88` (AD1 revision), `c04762a` (feature), `7b85538` (docs status) | D16.1 | Multi-chapter book schema foundation — `book_chapters` table FK → `BookVersion` (`onDelete: Cascade`), `manifest` JSONB on `BookVersion`, `getVersionContent()` helper. Additive-only, no backfill of the 6 legacy versions. Roadmap AD1 revised (chapters key to `BookVersion`, not `Book`). |
| K | IN PROGRESS | — | D17.1 (pending) | Zip upload creates a single multi-chapter book — parse `manifest.yaml` if present, else derive chapter order from filename sort; first WRITER of `book_chapters` rows. Extends `/api/books/new` (no parallel route). *(This stream.)* |
| L | RESERVED | — | — | Skills as a separate content class (per roadmap AD2). |
| M | RESERVED | — | — | Agent-persona positioning (storefront / marketing copy). |
| N | RESERVED | — | — | Self-upgrade book (flagship content; not a code stream). |
| O | RESERVED | — | — | Book → action-plan skill (first-party Anthropic skill format). |
| P | RESERVED | — | — | Eval framework (publisher-authored, bkstr-stored, displayed). |
| Q | RESERVED | — | — | Library-card subscription (recurring billing). |
| R | RESERVED | — | — | Stripe Connect + publisher payouts. |
| S | RESERVED | — | — | Open marketplace UX + moderation. |

**Next unreserved letter: `T`.** L–S are reserved by `docs/phase-6-roadmap.md`; A–H are spent in the pre-Phase-6 namespaces (below) and are not reused for new work.

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

*Last updated: 2026-05-13 (created retrospectively as the first task of the Stream K dispatch). When Stream K merges, flip its row to `SHIPPED <date>` + merge SHA(s).*
