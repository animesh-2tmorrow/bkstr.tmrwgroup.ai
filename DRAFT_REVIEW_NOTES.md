# Draft review notes — docs writing pass (`docs/writing-pass-2026-05-17`)

Every inline assumption made while drafting. Organized so review is fast.
STOP 2 covers `/get-started` + the Subscriber track + the renderer. STOP 3 will
append Publisher / Agent-developer / shared-reference notes.

---

## A. STOP 1 resolutions proceeded on

STOP 1 ended with five open questions; the go-ahead was "continue" without
itemizing them, so I proceeded on the STOP 1 recommendations. Flagging here so
any of these can still be reversed:

1. **Renderer rebuilt as multi-page** (the recommended option, not the
   single-page fallback). Detail in §B.
2. **Admin content dropped** from `/dashboard/docs`. The old `index.md` had a
   large `:::role admin` section (Admin · Users / Books / Grants, audit log,
   role-env, seed data). The §17 IA has no Admin track; that content is assumed
   to belong in the internal runbook and is **not carried into the new docs**.
   If admin docs should live in `/dashboard/docs`, a 15th page is needed.
3. **`src/content/docs/index.md` removed.** The hub page is generated from
   frontmatter; there is no longer a hand-written docs index file.
4. **Callouts = GFM blockquote** with a bold lead-in (`> **Lead.** text`). No
   custom callout-container plugin exists. Per the style rule, callouts are
   reserved for beta caveats / not-yet-implemented / breaking-change only —
   other emphasis is a bold-led plain paragraph.
5. **Login gate kept.** All `/dashboard/docs` pages still require sign-in
   (current behavior). "Public" track = visible to every signed-in role, not
   anonymous visitors. If the Subscriber / Agent-developer tracks should be
   readable logged-out, that is a further renderer change — not done.

**Page count:** the prompt's Done definition says "13 … (4+4+4+2)", but
4+4+4+2 = 14 and the IA enumerates 14 pages. Proceeding with **14**.

---

## B. Renderer changes

All new code is inside `src/app/dashboard/docs/` (underscore folders are not
routed by Next.js), honoring the "no code outside the allowed dirs" constraint.
**No new npm dependencies** — `yaml` is already a dependency; `react-markdown`
+ `remark-gfm` were already used.

| File | Action |
|---|---|
| `_lib/docs.ts` | New — globs `src/content/docs/*.md`, parses YAML frontmatter, role-filters. Re-declares the 3-line `ROLE_RANK` map locally (the copy in `src/lib/docs/filter-by-role.ts` is not exported and that file is outside the editable surface). |
| `_components/DocsArticle.tsx` | New — shared `ReactMarkdown` surface; carries the old article styling plus blockquote / table / image rules. |
| `_components/DocsNav.tsx` | New — in-docs track navigation, role-filtered. |
| `_components/DocsUserBlock.tsx` | New — shared dashboard user block. |
| `page.tsx` | Rewritten — now the docs hub (frontmatter-generated track index). |
| `[slug]/page.tsx` | New — renders one doc page; enforces the page-level role-gate (`notFound()` if gated); still runs `filterByRole` for any inline fences. |

**Frontmatter contract** (every page):

```yaml
title: "Getting started"
track: subscriber        # subscriber | agent | publisher | shared
role: SUBSCRIBER         # min role — SUBSCRIBER = all signed-in users
order: 1                 # sort within track
summary: "One line for the hub index."
```

Assumptions:
- Page bodies start at `##` (h2). The page `<h1>` is rendered from the
  frontmatter `title` by `[slug]/page.tsx`, so a body h1 would double it.
- Doc-to-doc links use **absolute** `/dashboard/docs/<slug>` paths (not
  relative URLs) for unambiguous resolution. Read this as the prompt's
  "relative within `/dashboard/docs/`" — links that stay inside the docs set.
- Image styling is a Tailwind `[&_img]` rule (border, full-width). No
  `components={{ img }}` override was added, to keep the Next.js
  `no-img-element` lint rule off the source entirely; consequently embedded
  captures are **not** lazy-loaded. Flag if lazy-loading is wanted.
- The in-docs left-rail nav (`DocsNav`) is hidden below `lg`. A mobile
  disclosure for it is not built — flag if needed.

---

## C. `/get-started` — freshness pass

Per the prompt: content freshness only, no restructure. Changes made:
- The three step images swapped from the old `public/get-started/0*.png`
  captures to the new captures: step 1 → `s-05`, step 2 → `s-12`, step 3 →
  `s-22`. Dimensions updated to 1440×900; alt text set from `MANIFEST.md`.
- Step 2 body rewritten to match the new image (it now shows Stripe checkout,
  not the storefront grid) and to carry the test-mode-during-beta line.

**Assumption — captures `s-25` / `s-26` / `s-27` were NOT embedded in
`/get-started`.** The prompt's get-started list says embed `s-25` (hero) and
`s-26` / `s-27` (install reference). Those three captures are screenshots *of
the `/get-started` page itself* — embedding them back into that page would put
a picture of a section inside the section. `s-26` / `s-27` are instead embedded
in the Subscriber `installing.md` page (where the prompt's IA also lists them),
which is their sensible home. `s-25` is currently **unused** anywhere. Please
confirm this reading, or say where `s-25` should land.

**Orphaned assets:** the old `public/get-started/0*.png` screenshots are no
longer referenced by the page. `public/get-started/` is outside this pass's
editable dirs, so they were left in place — clean up separately if desired.

---

## D. Subscriber-track page assumptions

General:
- Voice: second person, present, active; no "simply / easily / just"; no
  emojis. Reference-toned (vs the more marketing-leaning `/get-started`).
- Alt text is taken **verbatim from `MANIFEST.md`'s description column**, per
  the embedding rule ("do not invent new descriptions"). Several descriptions
  are capture-shorthand and read oddly as alt text — e.g. `s-08` / `s-11`
  carry "(clawbot)", `s-13` has "4242...", `s-17` has "(post-040a21b)". They
  are used as-is; **recommend a light alt-text polish pass** before publish.

`getting-started.md`:
- States free items have no checkout / no owned state and routes the reader to
  `installing.md` — per walkthrough §4.5 and preflight §2.1.
- Describes the grant landing "in seconds" via the Stripe webhook (§9.1).

`installing.md`:
- Links to the Agent-developer `cli.md` page for the full CLI reference
  (per the cross-link spec). `cli.md` does not exist until STOP 3 — the link
  is dead until then.
- The per-agent install directories (Cursor `.cursor/rules/`, Cline `./bkstr/`,
  Aider) are taken from the existing `/get-started` page copy, which states
  they are provisional / based on each agent's documented model.

`your-library.md`:
- Says the Library has Active / Browse / All tabs with `?filter=` URLs (§11).
- Archived items: states they drop out of the storefront, the catalog grid,
  and `bkstr list` (§4.6). It does **not** claim whether the dashboard Library
  Active tab itself hides an archived *owned* item — the walkthrough only
  confirms hiding from storefront / `resolveSlug` / CLI library. **Unverified
  point — flag.**
- See §F on the `s-17` API-access key display.

`billing.md`:
- No mention of refunds anywhere (locked decision; the refund UI was removed
  in `7ea3628`).
- Describes a **3-stat** strip (matches `s-30`). Walkthrough §11 says "4-stat";
  that count predates the refund-stat removal — 3 is current.
- Links to the Publisher `pricing.md` page, phrased so a subscriber knows it
  is a publisher page. `pricing.md` is role-gated, so a subscriber who follows
  the link gets a 404. This is the prompt's cross-link spec ("Publisher
  pricing ↔ Subscriber billing") meeting page-level gating — flag if the link
  should be dropped for non-publishers instead.

---

## E. Capture / screenshot notes

- 65 captures copied to `public/docs/screenshots/` (filenames unchanged),
  served at `/docs/screenshots/<id>-<name>.png`.
- `s-07` (empty dashboard) and `s-18` (empty API-keys list) were never
  captured — worked around in prose, no image, per the embedding rule.
- Subscriber track embeds 21 captures: getting-started (s-01,02,03,05,08,11,
  12,13,14), installing (s-09,10,22,23,24,26,27), your-library (s-15,16,17,32),
  billing (s-30).
- `s-25` is unused (see §C).

---

## F. Factual flags against the walkthrough

1. **`s-17` / library API-access key.** Walkthrough §15 lists "ApiInstructions
   Block paid path shows a placeholder key (`bks_your_key_here`)" as a gap, and
   preflight §2.3 flagged the same. The `s-17` capture (and its MANIFEST note
   "post-040a21b") shows a **real masked key prefix** — the gap appears to have
   been fixed after the walkthrough was written. `your-library.md` is written
   to the fixed behavior (the disclosure shows your key prefix). Confirm.
2. **`/api/books/.../files` — id vs slug.** Walkthrough §1 names the route
   `GET /api/books/[id]/files` (by id) while the skills route is
   `/api/skills/[slug]/files` (by slug). The existing `/get-started` "advanced
   raw JSON" block and the old `index.md` both wrote `/api/books/<slug>/files`.
   This was **left untouched** in `/get-started` (out of freshness-pass scope)
   and must be resolved precisely when `api.md` is written in STOP 3.
3. **Support email.** The old `index.md` pointed help requests at
   `animesh@2tmorrow.com`; `/get-started` uses `lab@tmrwgroup.ai` for
   corrections. The new Subscriber pages include no support email — pick one
   for the docs and apply consistently (candidate: a "Need help?" line on the
   docs hub).

---

## G. Walkthrough §17 open questions — disposition

| Question | How it was handled in STOP 2 |
|---|---|
| Tone calibration | `/get-started` editorial voice left intact; docs pages reference-toned, second person, no marketing adjectives. |
| Architecture depth in user docs | Subscriber pages stay task-focused; mechanism surfaced only where it affects the user (grant-via-webhook, the `.bkstr-install` record). The §15 honest-gaps (per-IP rate limit, unthrottled Q&A, etc.) are **not** exposed in Subscriber docs — assumed agent-dev / internal. Confirm at STOP 3. |
| Test-vs-live copy | Locked-decision phrasing applied: "test mode during beta; live mode coming" — in getting-started, billing, and get-started step 2. |
| CLI versioning narrative | Docs say "install the latest `@clawbot678/bkstr`"; no version number pinned. The `X-Bkstr-CLI-Min-Version` kill-switch is not mentioned in Subscriber docs (a `cli.md` concern at most). |
| Cross-capability visibility | Subscriber pages cross-link to `cli` (agent track) and `pricing` (publisher, gated) per the prompt's cross-link spec — see §D for the gated-link consequence. |
| Glossary scope | Deferred to STOP 3. Proposed: ~12–18 core terms (book, skill, grant, version, slug, publisher, subscriber, API key, install endpoint, watermark, domain, archived, owned, catalog). Confirm scope at STOP 3. |
| License copy | Skills' `SKILL.md` frontmatter has an optional `license:` field the server ignores (§8.2). No user-facing licensing/terms copy exists; the docs **introduce none**. Flag if a licensing story is wanted. |
| Persona naming | Used Subscriber / Publisher / Agent-developer (locked decision). |

---

## H. Deferred to STOP 3

- Agent-developer track: `cli.md`, `api.md`, `qa-endpoint.md`, `scripting.md`.
- Publisher track: `authoring-books.md`, `authoring-skills.md`, `pricing.md`,
  `catalog-management.md`.
- Shared reference: `concepts.md`, `glossary.md`.
- Cross-links from Subscriber pages to `cli` and `concepts` are dead until
  those pages exist.
- Resolve flag §F.2 (`/api/books/.../files` id-vs-slug) when writing `api.md`.
- Local render verification of all pages + role-gates (STOP 3 step 5).

---

# STOP 3 — appended

The Agent-developer track, Publisher track, and shared reference — 10 pages,
14 total. New assumptions below; sections A–H above still stand.

## I. STOP 3 page assumptions

- **`cli.md` stub captures.** The "Not yet implemented" section opens with the
  verbatim callout (a blockquote), then embeds `a-06`/`a-07`/`a-08` (help) and
  `a-12`/`a-13` (stub output) in the same section. The prompt says "inside this
  callout" — five images literally inside a `>` blockquote render as a bordered
  gallery and read poorly, so they sit in the section the callout opens. Flag
  if they must be literally inside the blockquote.
- **`api.md` — books-by-id, skills-by-slug** (resolves flag §F.2). Documented
  `/api/books/<book-id>/files` (by id) and `/api/skills/<slug>/files` (by slug)
  per walkthrough §1's route names; the asymmetry is stated on the page.
  Consequence: **no documented endpoint returns a book's id** — the library
  endpoint returns slugs only — so "how to obtain a book id" (for the files
  endpoint and the Q&A endpoint's `book_id`) is an undocumented gap. Flag.
- **`/get-started` advanced JSON block** still shows `/api/books/<slug>/files`
  (slug form), inconsistent with `api.md`'s id form. Left untouched — the
  get-started freshness pass was STOP 2 and is approved; re-opening it is out
  of STOP-3 scope. Operator may want to align it.
- **`qa-endpoint.md` soft-pedalled** per the locked decision: documents Bearer
  auth and the request/response shape; does not surface the no-per-book-authz
  or no-rate-limit characteristics. No captures (per the IA).
- **`api.md` rate-limits section** states the install + library endpoints
  share a per-IP request budget and that callers should handle `429` with
  `Retry-After`. The exact request count is not pinned (internal limit).
- **Skill file-count cap = 50** (walkthrough §3.3 / §8.2). The old `index.md`
  said 500 — a book/skill mix-up (books allow 500 chapters). 50 used.
- **Skill pricing.** The dashboard Pricing page is books-only (§8.3).
  `pricing.md` is written about books; `authoring-skills.md` states a skill's
  price is set on the authoring form (minimum $0.50). There is no skill
  re-pricing surface — not dwelt on. Publisher revenue is "coming soon".
- **`catalog-management.md`** does not mention skill archival at all (locked
  decision: silent). `p-16` (admin catalog ledger) is embedded in this
  PUBLISHER-gated page and framed as admin-only — a non-admin publisher sees
  the screenshot and the note; an admin gets a working reference.
- **Code-fence language.** The `manifest.yaml` example in `authoring-books.md`
  is tagged `yaml`. The style rule lists `bash`/`ts`/`json`; `yaml` is the
  correct, honest tag for YAML content and satisfies "no untagged".
- All 14 pages now exist — the STOP-2 dead cross-links (to `cli`, `concepts`)
  resolve.

## J. Verification performed

- `npx tsc --noEmit` — renderer files clean. The only 2 errors are
  pre-existing in untouched `scripts/screenshots/*.spec.ts` (outside scope).
- `verify-docs.ts` (exercises the real `_lib/docs.ts`): 14 pages, all with
  valid frontmatter; 56 capture embeds, every one resolving to a file in
  `public/docs/screenshots/`; role-gates correct (SUBSCRIBER sees 10,
  PUBLISHER and ADMIN see 14); `getDoc` rejects `../` traversal slugs.
- `npm run build` — succeeded. `/dashboard/docs` and `/dashboard/docs/[slug]`
  compile as dynamic routes; `/get-started` prerenders static.
- **Not done headlessly:** a visual render in a browser with a logged-in
  session. Recommended as an operator spot-check before publish.
