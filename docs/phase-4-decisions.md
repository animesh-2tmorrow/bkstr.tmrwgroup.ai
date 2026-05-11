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

*Last updated: 2026-05-11. Stream D — open signup. Streams A, B, C will add their own D11.x entries (D11.1–D11.4, D11.7–D11.10, D11.12+) in their own commits.*
