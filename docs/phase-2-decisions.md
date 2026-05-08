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
