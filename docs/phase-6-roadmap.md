# bkstr — Phase 6 Roadmap

**Drafted:** 2026-05-13 (end of Phase 5 session)
**Status:** Draft. Author was tired when drafting. Re-read with fresh eyes before treating as authoritative. Decisions tagged `[REVIEW]` are the ones to scrutinize first.
**Scope:** Six product directions from Edward Unthank (2026-05-13 Discord thread, 9 messages) + Zach Simmons's multi-chapter book ask (revealed by the agentic-qa-manual.zip he sent the same day).
**Anti-scope:** This is NOT a commitment to ship every stream. It's a decomposition that allows priority + sequencing decisions to be made deliberately rather than ad-hoc.

---

## The six directions + Zach's ask, restated

E1. **Agent-persona books** — positioning shift; books are the operating definition of specialized agents, not just reference docs.
E2. **Self-upgrade book** — flagship book example, written by someone (TBD: Edward? 2tmorrow? bkstr itself? a publisher?).
E3. **Book → action plan skill** — a tool (probably Anthropic skill format) any agent installs once and uses to consume any bkstr book. Reads markdown, derives action plan, executes in parallel where applicable.
E4. **A/B evals** — for every book, measure agent-output quality with-book vs without-book on a defined task. Catalog ranked by measured impact delta.
E5. **Library card subscription** — monthly recurring billing giving access to all books. New revenue model alongside (or replacing) per-book purchase.
E6. **Open marketplace** — external publishers sign up, list books, earn real money. Bkstr takes a revenue share. Stripe Connect for payouts.

Z1. **Multi-chapter books with manifest.yaml** — books structured as directories of chapter markdown files plus a manifest, uploaded as zip, ingested with structure preserved.
Z2. **Skills as a content class on bkstr** — separate from books (per the SKILL.md + Python helper files in Zach's files.zip). Either co-distributed with books or sold/given separately.

---

## Cross-cutting architectural decisions [REVIEW]

These shape multiple streams. Locking them early avoids re-work.

**AD1 — Multi-chapter book structure (revised after Stream J pre-gather).**

Chapters are a property of a `BookVersion`, not of a `Book`. A `BookVersion` may have zero chapters (legacy single-blob shape — content lives in `BookVersion.content` / `.contentUri` via the D9.2 dual-storage seam) or N chapters (new multi-chapter shape — content lives in `BookChapter` rows ordered by `order`, read via the `getVersionContent(version)` helper).

Existing single-blob versions are NOT retroactively normalized into "1-chapter versions." They remain chapterless and continue to be served via `loadBookContent` unchanged. The multi-chapter shape is the canonical shape for *new* uploads going forward (Stream K onward); the legacy shape is preserved indefinitely as a readable archive form.

Manifest metadata (`tokenEstimate`, `conventions`, `dependencies`, `sourceRefs`, `audience`, `accessPattern`, `version`, the chapter listing) lives on `BookVersion` as JSONB, since manifest data is per-snapshot and may change between versions of the same book. Chapter-level access tiers are deferred (no `accessTier` field in Stream J).

> *Original AD1 wording (pre-Stream-J) put `BookChapter` FK on `Book` and `manifest` fields on `Book`, and described legacy books being rewritten as "1-chapter books with slug 'main'." The Stream J pre-gather found that `Book` has no `content` column at all — content lives in the versioned `BookVersion` chain — so chapters key to `BookVersion`, manifest is per-version, and legacy versions are left as-is rather than backfilled. See `docs/decisions.md` D16.1.*

**AD2 — Skills are a separate content class, not a kind of book.** Different table (`Skill`), different upload flow, different access model (probably free + bundled with bkstr publisher onboarding, OR sold separately like books, OR both). Skills can contain executable code (Python) — bkstr does NOT execute it; that's the agent's responsibility. Bkstr stores + distributes; security model is "you ran it, it's on you" with clear publisher attribution.

**AD3 — Evals attach to books, not chapters.** A book ships with zero or more eval suites. Each suite: a prompt template, a task description, an evaluation rubric (or pointer to an eval model). Eval runs are stored, scored, displayed alongside the book on storefront. Open question: does bkstr run evals on-demand for buyers, or only as part of publisher onboarding? Defaulting to "publisher runs evals during onboarding, bkstr stores + displays results" for v1.

**AD4 — Subscription is additive to per-book, not replacing.** Per-book purchase remains. Subscription is an additional product Stripe sells. A subscriber's grant is "active subscription" — a different `AccessGrant.source` value, expires when subscription cancels. Both models coexist permanently.

**AD5 — Open marketplace gated behind invite for v1 of v1.** Per E6, eventually anyone can submit. Initially: still invite-gated (Stream E machinery), but the *plumbing* (Stripe Connect, payouts, publisher onboarding, content moderation hooks) gets built so the gate can be lifted later without rebuild. "Open" is a config flag, not an architecture.

**AD6 — Evals are required for marketplace listing.** When the open marketplace launches, books MUST have at least one passing eval suite to be listed. This is bkstr's quality control mechanism — no evals, no listing. Pre-marketplace publishers (you, Zach, anyone invited) are grandfathered without this requirement initially, but the catalog gradually fills in.

---

## Stream decomposition (8-12 streams, with sizing + dependencies)

Sizing notation: **S** = ~1 day, **M** = 2-3 days, **L** = 4-7 days, **XL** = 1-2 weeks. Real ranges, not aspirational.

### Foundation streams (must come first; rest depends on these)

**Stream J — Multi-chapter schema migration** [M] — ✅ **SHIPPED 2026-05-13** (`main` @ `c04762a`; AD1 revision @ `0b1ee88`; deployed-and-verified — see `docs/decisions.md` D16.1).
> The bullets below describe the *pre-pre-gather* plan and are superseded. What actually shipped: `BookChapter` keyed to `BookVersion` (not `Book` — `Book` has no `content` column), `manifest` JSONB on `BookVersion` (not `Book`), additive-only (no backfill — the 6 legacy versions stay chapterless and readable via `loadBookContent`), reads route through `getVersionContent(version)`. Test baseline now 46/46.

- New `BookChapter` table; book.content becomes book.chapters[0].content for legacy books via migration; new `manifest` JSONB column on Book for the rest of the manifest.yaml metadata
- Backfill: existing 7 books each become 1-chapter books with the existing content as chapter[0], manifest minimal
- Update all `Book.content`-reading code paths to read `Book.chapters[0].content` for legacy access OR fetch a specific chapter
- Update queries (getBooksForLibrary, getBooksWithMetrics, etc.) — read manifest where needed
- **No new UX, no upload changes yet.** Just the schema and the migration.
- Deferred: chapter-level access grants (a future stream if needed)
- Tests: existing 42 still pass; new tests for chapter ordering + manifest parsing
- Depends on: nothing
- Resolves: Z1 (partial — the schema part)

**Stream K — Zip upload + manifest ingestion** [M] — ✅ **SHIPPED 2026-05-13** (`main` @ `c1aa515`; see `docs/decisions.md` D17.1).
> Same-day hotfix as **Stream K.1** (hotfix at SHA TBD on top of K's `c1aa515`; D17.2): virtual-root resolution for wrapped zips + slug derivation from `file:`-only manifest chapter entries. Surfaced by operator smoke prep against Zach's actual `agentic-qa-manual.zip` and a flat repack before any production upload.
- ~~Replace/extend the new-book form to accept a zip upload~~ — done; mode selector with paste / `.md` / `.zip` (default paste per T5).
- ~~Server-side: parse manifest.yaml, validate, atomically write Book + chapters in transaction~~ — done with `adm-zip@0.5.17` (in-memory Buffer, no `/tmp`), `yaml@2.9.0`, interactive `prisma.$transaction` with `writeAuditEntry` inside.
- ~~Validation: zip size, chapter count, per-entry size, total uncompressed; filetype handling~~ — done; constants in `src/lib/books/zip-validate.ts` (10 MB / 500 / 1 MB / 20 MB).
- Depends on: Stream J (schema must support chapters first) — landed.
- Resolves: Z1 (fully).

**Stream L — Skill content class** [M, ~2-3 days]
- New `Skill` table: id, slug, title, description, version, files[] (array of {path, content, type})
- Upload flow: zip with SKILL.md at root + supporting files. SKILL.md frontmatter (`name`, `description`) parsed as metadata.
- Allowed file types: .md, .py, .yaml, .json, .txt (configurable allowlist). NO executable shell scripts. NO binaries.
- Distribution: download as zip; no buy/sell yet — skills are free-distributed for v1
- New routes: `/skills/[slug]` (public detail page), `/skills/[slug]/download` (zip download), `/dashboard/skills/new` (upload form for admin or invited publishers)
- Depends on: nothing (parallel-buildable with J/K)
- Resolves: Z2

### Edward's vision (independent of foundation streams, but better with them)

**Stream M — Agent-persona positioning** [S, ~1 day]
- Pure copy/marketing change. No schema. No code beyond storefront text + book detail text + maybe a new `/agent-personas` landing page
- Update storefront hero copy to lead with the agent-persona framing
- Update book metadata UI to surface "What kind of agent is this for?" (audience field exists per manifest, just needs surfacing)
- Add "How to use a bkstr book" docs page (probably extends Stream A's /dashboard/docs)
- Depends on: nothing (can ship today, refines as we learn)
- Resolves: E1

**Stream N — Self-upgrade book (the actual content)** [variable, depends on who writes it]
- NOT a code stream. Content creation.
- Open question: who writes it? Edward implied "a book of self-upgrade for any agent" — if TMRW Group authors, S-M effort for content. If we ask a third party (you? Manus? a specialized writer?), separate scope.
- Once written, ships via Stream K's upload flow as a normal multi-chapter book
- Worth doing because it's the flagship example that proves the agent-persona positioning concrete
- Depends on: Stream K for ingestion, Stream M for positioning context
- Resolves: E2

**Stream O — Book→action plan skill (first-party)** [L, ~4-7 days]
- The most interesting platform-leverage piece. Bkstr ships a SKILL.md (and supporting code) that any agent installs once. Given a bkstr book in context, the skill produces:
  - An action plan (numbered, dependency-ordered steps)
  - Parallel execution where possible (which steps can run concurrently)
  - Verification checkpoints (per the book's eval suite, if present — connects to Stream P)
- Implementation language: probably Python or TypeScript, depending on what agent runtimes bkstr expects to support
- Distribution: as a Skill via Stream L's machinery
- Scope choices: do we ship for Claude only, OpenAI-format also, agent-vendor-agnostic? Affects scope by 2x.
- **This is where bkstr stops being a content marketplace and becomes a platform.** Highest-leverage stream. Also highest risk if it ships and nobody uses it.
- Depends on: Stream J (multi-chapter books to consume), Stream K (uploading), Stream L (distribution), Stream P (evals to verify against)
- Resolves: E3

**Stream P — Eval framework (publisher-authored, bkstr-stored, displayed)** [L, ~4-7 days]
- Schema: new `EvalSuite` table (FK to Book), `EvalRun` table (per-run results, FK to EvalSuite), `EvalScore` (individual scores per metric)
- Eval suite shape: a YAML/JSON describing prompts, expected output rubric, scoring criteria. Lives in `evals/` folder inside book zip
- Publisher workflow: write eval suite alongside book, upload as part of zip, eval suite ingested + stored
- bkstr UI: storefront book detail shows eval scores ("Improves task X by Y% on Z metric"); publisher dashboard shows eval run history
- Open question [REVIEW]: who runs the evals? Three options:
  - **(a) Publisher runs evals on their machine, uploads results** — simplest, cheapest for bkstr, trust-based
  - **(b) bkstr runs evals on-demand using Bedrock/Anthropic API** — costs real money per eval, but verified-by-bkstr is more trustworthy
  - **(c) Hybrid** — publisher uploads claimed scores, bkstr spot-checks via re-run
  - Default for v1: option (a), with option (c) introduced when fraud becomes a problem
- Connects to E6: evals become the trust mechanism for open marketplace listings
- Depends on: Stream J (book schema to attach to)
- Resolves: E4

### Marketplace + monetization (last, depends on most foundation work)

**Stream Q — Library card subscription** [L, ~4-7 days]
- Stripe subscription product alongside per-book products
- New AccessGrant.source = 'SUBSCRIPTION'; expires when subscription cancels (Stripe webhook updates `expiresAt`)
- Subscriber sees "all books unlocked" in their Library; UI surfaces remaining days, renew status, cancellation
- Per-book purchases still work; subscribers don't see "Buy" buttons (or see "Already accessible via subscription")
- Pricing decision [REVIEW]: how much per month? $X/month for unlimited access. Edward called this "library card" — implies modest pricing, not enterprise. Likely $20-50/month range, decided closer to launch
- Tax: Stripe Tax handles VAT/GST if enabled; verify it's on
- Depends on: nothing strictly, but cleaner if multi-chapter is in (subscribers consume longer books)
- Resolves: E5

**Stream R — Stripe Connect + publisher payouts** [XL, ~1-2 weeks]
- The big one. Migrates from single-merchant Stripe (current) to platform-with-connected-accounts (Stripe Connect Express)
- Publisher onboarding: when accepted to bkstr, complete Stripe Connect Express onboarding (KYC, bank account, tax info — Stripe handles UX)
- Per-purchase: bkstr's Stripe receives payment, instantly transfers (revenue share - platform fee%) to publisher's connected account
- Revenue split decision [REVIEW]: typical platforms take 15-30%. Decide closer to marketplace open. Default: 20% platform fee, 80% to publisher.
- 1099 / tax reporting: Stripe Connect handles much of this automatically
- New schema: `Publisher.stripeConnectAccountId`, `Sale.platformFee`, `Sale.publisherPayout` columns
- Refund handling: clawback from publisher payout if refund issued
- This is non-trivial. Stripe Connect has real edge cases. Plan for unknown unknowns.
- Depends on: nothing strictly, but coherent only after Stream Q's subscription model is decided (subscription payouts split too)
- Resolves: E6 (the payments side)

**Stream S — Open marketplace UX + moderation** [L, ~4-7 days]
- Self-serve publisher signup (currently invite-only via Stream E)
- Publisher dashboard tweaks: clearer onboarding flow, "publish your first book" guidance
- Content moderation: admin queue for first-book-from-new-publisher (manual review). Eventually automated with eval-suite-required gate (per AD6).
- Abuse handling: report-this-book button on storefront, admin review flow, takedown process
- Eval-required gate for marketplace listing per AD6
- Depends on: Stream R (payouts must work first), Stream P (eval mechanism for quality gate)
- Resolves: E6 (the access side)

---

## Recommended dependency order + sequencing

```
Foundation (parallel-able)
├── J: Multi-chapter schema [M]
├── L: Skills content class [M] (parallel with J)
└── M: Agent-persona positioning [S] (parallel with anything)

Then:
├── K: Zip upload + manifest [M] (needs J)
└── P: Eval framework [L] (needs J)

Then mid-tier:
├── O: Book→action skill [L] (needs J, K, L, P)
├── N: Self-upgrade book (content) [variable] (needs J+K, ideally O+P)
└── Q: Library card subscription [L] (independent)

Then end-tier:
├── R: Stripe Connect + payouts [XL] (independent, but coherent only after Q decides)
└── S: Open marketplace UX [L] (needs R, P)
```

**Realistic total: ~8-10 weeks of focused work** if streams are done sequentially. ~5-6 weeks if parallel work is genuinely parallel and there's no rework.

**Suggested first sprint (next 2-3 weeks):**
- ~~Stream J (multi-chapter schema)~~ — ✅ shipped 2026-05-13 (`c04762a`)
- ~~Stream K (zip upload + manifest)~~ — ✅ shipped 2026-05-13 (`c1aa515`) + same-day **K.1** hotfix (virtual-root + slug derivation)
- Stream L (skills content class) — next-up
- Stream M (agent-persona positioning copy)

Why these four first:
- Unblocks Zach immediately (he gets multi-chapter book upload working — Stream K)
- Unblocks skill distribution (Stream L) — Zach's files.zip becomes usable as bkstr content
- Establishes the schema foundation for everything else (Stream J)
- Cheap positioning win that signals direction to Edward without a code commitment (Stream M)

The harder, higher-leverage streams (O, P, Q, R, S) come after this foundation is solid. Sequencing them depends on what Edward says when he sees the foundation shipped.

---

## Open questions to bring back to Edward + Zach

Before Stream O or P starts, lock these:

**To Edward:**
- The skill (Stream O) — first-party or community? If first-party, language preference (Python/TS)? Target agent runtimes (Claude only? OpenAI? both?)?
- Evals (Stream P) — option (a) publisher-runs-uploads-results, (b) bkstr-runs-on-demand, or (c) hybrid? Affects budget + scope by 2-3x.
- Subscription pricing rough range (Stream Q) — close to launch, but useful to know if we're targeting $20/mo or $500/mo
- Open marketplace timing (Stream R+S) — quarter? Half? Affects whether we build Stripe Connect plumbing now vs later

**To Zach:**
- The agentic-qa-manual.zip — is this the standard book shape he expects, or an experiment?
- The files.zip (skill) — does he want to distribute it via bkstr (Stream L), or is it private tooling for 2tmorrow's authoring workflow?
- For folder/zip upload: confirm "one book per zip, manifest-driven structure" is the right shape. Reject (a) "one book per file" he might have meant originally.

---

## What NOT to do

Listing these so they don't accidentally creep into scope:
- ❌ Per-chapter purchase (buy chapter 5 of a book): Edward never said this; complexity explosion; defer indefinitely
- ❌ Multi-author books (multiple publishers on one book): defer; assume single-author per-book for now
- ❌ Book versioning beyond what BookVersion already does: defer; manifest.version is informational
- ❌ Free books as a separate product class: defer; price=0 books work today, no schema change needed
- ❌ Comments/reviews on books: defer; trust is built via evals (Stream P), not social proof
- ❌ Book recommendations / search beyond simple text search: defer; catalog is small enough that browse works
- ❌ Affiliate program / revenue share with referrers: defer to a much later phase
- ❌ Multiple languages / localization: defer
- ❌ Mobile app: defer; web works

---

## Risks + mitigations

**R1 — Edward's vision shifts.** This roadmap is built on one Discord thread (9 messages, May 13). If Edward changes direction in a future conversation, much of the back-half of this roadmap (E3-E6, streams O/P/Q/R/S) could be wrong. *Mitigation:* schedule a checkpoint conversation with Edward after Stream M ships (~3 weeks out). Sanity-check before committing the heavier streams.

**R2 — Zach's actual usage diverges from his test zips.** The agentic-qa-manual is impressive but may not be representative. *Mitigation:* before Stream K (zip upload) ships, test with 2-3 of Zach's real books, not just the test sample.

**R3 — Stream O (the book→action skill) is the hardest to scope.** It's also the highest-leverage. If it falls apart on the implementation side, the marketplace flywheel doesn't spin. *Mitigation:* before Stream O starts, build a one-day proof-of-concept skill manually + run it against one bkstr book + measure value. If POC doesn't deliver clear improvement, the whole skill idea may need rethinking — better to know early.

**R4 — Stripe Connect (Stream R) has unknown unknowns.** Connect is its own world. *Mitigation:* before Stream R starts, do a 1-day discovery pass: read Connect docs, build sample integration in a sandbox, identify the 3-5 hardest decisions. Don't go in blind.

**R5 — Eval costs add up if bkstr runs them (Stream P option b/c).** Each eval is N Bedrock API calls. Cost scales linearly with catalog size × books × runs. *Mitigation:* start with option (a) (publisher uploads results). Move to (c) hybrid only when fraud becomes evident.

**R6 — Pending security debt.** NEXTAUTH_SECRET + other keys leaked in this conversation's transcript. Operator declared "security phase before going live." Real risk window between now and that phase. *Mitigation:* security phase must happen BEFORE Stream R (Stripe Connect) ships — Stripe Connect involves real money flowing to real publishers; the platform must be hardened before that.

---

## What to do next (concrete actions)

**Tomorrow / this week:**
1. Re-read this roadmap with fresh eyes. Mark `[REVIEW]` items as locked or revised.
2. Reply to Zach: "Got your two zips, scoping multi-chapter book + skill support properly. A few questions" — pose the To-Zach open questions above.
3. Reply to Edward: NO new message unless he writes first. Or — schedule a 30-min sync to walk through the roadmap. He'll appreciate the rigor.
4. ~~Pick a first stream to dispatch.~~ — Stream J shipped 2026-05-13 (`c04762a`), Stream K shipped 2026-05-13 (`c1aa515`) + K.1 hotfix same-day. Next-up: **Stream L** (skills content class); Stream M (agent-persona positioning copy) remains a cheap parallel win.

**Within 2 weeks:**
- ~~Ship Stream J~~ ✅ done; ~~ship Stream K~~ ✅ done (with K.1 hotfix) — ship Stream M next
- Begin Stream K (Stream J has landed — its schema is the foundation Stream K builds on)
- Begin Stream L in parallel

**Within 4 weeks:**
- Foundation streams (J, K, L, M) shipped
- Check in with Edward + Zach with real progress to show
- Lock the harder open questions before committing to Streams O/P

**Within 8-10 weeks (assuming dedicated focus):**
- All 11 streams shipped
- bkstr's transition from "ecommerce for AI books" to "platform for measured agent capabilities" is real and visible
- Open marketplace launch readiness

---

## Status of this doc

**This is a draft.** Open issues:
- `[REVIEW]` tags on AD1-AD6, plus Stream P's option (a/b/c) decision, plus Stream Q's pricing range, plus Stream R's revenue split
- Some sizes are guesses; calibrate after Stream J ships (first real data point)
- Risk R3 (skill POC) might bump Stream O earlier in the sequence if the POC reveals scope changes

Update this doc as decisions get locked. Treat it as a living roadmap, not a contract.
