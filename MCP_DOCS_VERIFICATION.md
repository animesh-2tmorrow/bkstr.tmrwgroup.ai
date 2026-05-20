# MCP docs polish + /get-started tabs — verification

Branch: `docs/mcp-polish-and-get-started-tabs-2026-05-20`
Base: `main` at `4e84940` (the merge of `docs/writing-pass-2026-05-17` and `docs/mcp-setup-page-2026-05-20`)
Commits (in order):

```
3a5ec07 fix(get-started): tighten MCP attribution copy
d14b71a feat(get-started): three-tab layout with MCP tab
cc772bf feat(docs): polish mcp.md with walkthrough and troubleshooting
4e84940 (origin/main) Merge remote-tracking branch 'origin/docs/mcp-setup-page-2026-05-20' q
```

---

## Part 1 — `src/content/docs/mcp.md`

### Added

- **Your first call** — new H2 section between *Add the server to your client* and *Authentication*. Five steps, anonymous through to owned content, Claude Code as the example: (1) anonymous `claude mcp add` + `/mcp` panel check, (2) `search_catalog` on a real query, (3) generate a key at `/dashboard/api-keys`, (4) re-add with `--header "Authorization: Bearer $BKSTR_KEY"`, (5) `my_library` + `load_item` to confirm authenticated tools work. One short paragraph per step.
- **Troubleshooting** — new H2 section between *`ask_book` and the kill-switch* and *Errors*. Seven realistic failure modes as GFM blockquote callouts (`> **Label.**` pattern lifted from `billing.md` / `getting-started.md`): client shows server but no tools (transport mismatch), `UNAUTHENTICATED`, `NOT_OWNED`, `ask_book` kill-switch message, `RATE_LIMITED`, generic `UPSTREAM`, connection / TLS errors.

### Fixed (factual claims that did not trace to bkstr-mcp/docs/architecture.md)

The recon report flagged the existing `mcp.md` as text-complete. Cross-checking each claim against `bkstr-mcp/docs/architecture.md` §8 + §11.5 + §13.2 and `bkstr-mcp/src/server/errors.ts` surfaced three concrete divergences. All fixed in commit `cc772bf`.

| Was | Now | Source of truth |
|---|---|---|
| Errors table listed `ACCESS_DENIED` | `NOT_OWNED` | `errors.ts:7` declares the union; STOP D2 verification empirically confirmed the server returns `NOT_OWNED` |
| Errors table listed `UPSTREAM_ERROR` | `UPSTREAM` | `errors.ts:10` |
| Errors table listed `FEATURE_DISABLED` for the kill-switch | row removed — kill-switch returns `UPSTREAM` with the message *"ask_book is currently disabled by operator configuration"* | `src/tools/ask-book.ts:122-123` (`throw new UpstreamError(…)`); architecture §13.2 |
| Authentication paragraph: "with a key but no grant … `ACCESS_DENIED`" | `NOT_OWNED` | same as above |
| Kill-switch section: "returns a `FEATURE_DISABLED` error" | "returns an `UPSTREAM` error with the message *'ask_book is currently disabled by operator configuration'*" | same as above |
| Rate-limits paragraph: shape only ("one shared budget per Bearer key") | adds the **60 calls per minute** number stated in the dispatch | dispatch prompt |
| Rate-limits paragraph: "returns a `RATE_LIMITED` error with a `retry_after_seconds` field" | dropped — the `RATE_LIMITED` error carries `{ code, message }` only | `errors.ts:48` constructor takes `(message, cause)`; no `retry_after_seconds` field in the canonical error shape |

The canonical error code set is now exactly six: `UNAUTHENTICATED`, `NOT_OWNED`, `NOT_FOUND`, `RATE_LIMITED`, `UPSTREAM`, `INTERNAL` — matching architecture §8 / §11.5 verbatim.

### Frontmatter — already conformant

```yaml
title: "MCP server"
track: agent
role: SUBSCRIBER
order: 5
summary: "Connect Claude Code, Cursor, Codex CLI, or any MCP-compatible client to bkstr through the hosted MCP server."
```

Matches the writing-pass contract documented in the recon report §2.6. `track: agent + order: 5` slots after `scripting.md (order: 4)` in the Agent-developer track. `role: SUBSCRIBER` makes the page visible to every signed-in user. No frontmatter change in this branch.

---

## Part 2 — `/get-started` three-tab restructure

### File layout

- `src/app/get-started/page.tsx` (modified, server) — keeps the audience-neutral chrome (Masthead, Hero, What-is-bkstr, FAQ, Ready-CTA, MarketingFooter) and the page-level `metadata` export. Imports `<GetStartedTabs />` from the new client component, wrapped in `<Suspense fallback={null}>` so the route stays statically prerendered despite the child's `useSearchParams` call.
- `src/app/get-started/_components/get-started-tabs.tsx` (new, client, `"use client"`) — holds the tab UI, tab state, and the three tab bodies. Lifted from the original `page.tsx`: `ThreeStepsSection` + `StepRow` (Subscribers tab) and `InstallReferenceSection` + `ProvisionalAgent` (Agent Developers tab), both verbatim. New: `MCPTab` and `Capability`.

### Tabs

| Tab | Default? | Content | Source |
|---|---|---|---|
| Subscribers | yes | The original *THE 3 STEPS* section (sign up, browse, install — three `<StepRow>` rows with screenshots `s-05`, `s-12`, `s-22`) | lifted verbatim |
| Agent Developers | — | The original *INSTALL · FOR YOUR AGENT* section: Claude Code canonical, the bkstr-CLI alternative, the Cursor / Cline / Aider three-column provisional block, the Advanced raw-JSON callout, and the Q&A endpoint footnote | lifted verbatim |
| MCP | — | New. Hero pitch ("Your agent reads bkstr *in-conversation*") + one-line Claude Code `claude mcp add` setup snippet + four capability cards (Anonymous catalog, Owned library, Grounded Q&A, Attribution) + a button-CTA to `/dashboard/docs/mcp` for the full reference | new |

### Tab-bar UI

Segmented control, full-width on `sm:` and up, stacks on mobile. Each tab carries a *Track 0N* eyebrow, the tab label in serif, and a one-line blurb. Active tab inverts to ink-background / paper-text — matches the editorial high-contrast aesthetic already used elsewhere on `/get-started` (the Ready-CTA section uses the same ink-on-paper inversion). Built from `<button role="tab">` elements with `aria-selected` and `aria-controls`; the three panels carry `role="tabpanel"` + `aria-labelledby` + `hidden`. No new design components — `Eyebrow`, `Pill`, `SectionRule` from `@/components/design` only.

### Deep-linking

`?tab=subscribers | agents | mcp` is read once on mount via `useSearchParams`. Tab clicks update state only — they do not push history. Out-of-range or missing values default to Subscribers. The parent page wraps the tabs component in `<Suspense fallback={null}>` because `useSearchParams` in a client component opts the route out of static prerendering otherwise; with the boundary, `/get-started` stays static (confirmed: `○ /get-started   11.8 kB   202 kB` in the build output).

### Audience-neutral copy edits

Three small edits in `page.tsx` to acknowledge the new third path:

- Hero subtitle: appends *"Or skip the install entirely and connect your agent over MCP."*
- Honesty callout (*"What bkstr is."*): adds *"or connect over MCP"* to the install-paths list.
- Mental-model Agent column: *"… or anything that speaks MCP."*

Two FAQ entries updated to point at the new tabs:

- *"Can I use bkstr with [agent X]?"* — now references both the Agent Developers tab and the MCP tab as alternatives.
- (Implicit elsewhere — no other FAQ needed editing.)

### No content lost

Every section that used to render on `/get-started` still renders. The Subscribers tab carries the three-step body verbatim (same `<StepRow>` props, same screenshots, same copy). The Agent Developers tab carries the install-reference body verbatim (Claude Code section, bkstr-CLI section, three-column provisional block, Advanced raw-JSON, Q&A footnote). FAQ and CTA stay below the tabs unchanged (modulo the small FAQ copy edits above).

---

## Verification commands

| Step | Command | Result |
|---|---|---|
| Pre-flight | `git checkout main && git pull` | HEAD `4e84940`; both prereq branches merged |
| mcp.md exists | `test -f src/content/docs/mcp.md` | yes |
| Multi-page renderer | `[slug]/page.tsx` and `_lib/docs.ts` | present |
| Old single page gone | `src/content/docs/index.md` | absent |
| Typecheck | `npx tsc --noEmit` | clean for `src/` — two pre-existing TS2578 errors remain in `scripts/screenshots/{authed,public}-shots.spec.ts` (unrelated to this branch) |
| Build | `npm run build` | succeeds; `/get-started` renders as `○ (Static)` 11.8 kB, `/dashboard/docs/[slug]` as `ƒ (Dynamic)` |

The polished `mcp.md` is served by `/dashboard/docs/[slug]` with `slug=mcp` — the loader (`src/app/dashboard/docs/_lib/docs.ts`) reads it via `getDoc("mcp")`, validates the slug against `^[a-z0-9-]+$`, parses YAML frontmatter, and the `[slug]/page.tsx` server component runs `canView(doc, role)` (page-level role-gate) plus `filterByRole(doc.body, role)` (block-level role-gate; the new mcp.md uses no inline `:::role` fences, so the body returns as-is for any role).

---

## SCREENSHOT NEEDED — capture list

Two MCP-specific captures referenced in `mcp.md`'s *Your first call* walkthrough. Both are placeholder comments in the markdown; the page ships text-complete without them. When captured, drop the PNGs into `public/docs/screenshots/` and replace the comments with the standard `<!-- capture: <id> -->\n![alt](/docs/screenshots/<id>.png)` two-line block (matches the pattern documented in the recon report §2.5 and used by every other doc in `src/content/docs/`).

| ID | Description | Suggested capture |
|---|---|---|
| `m-01-claude-code-mcp-list-bkstr` | Claude Code `/mcp` panel showing the `bkstr` server connected with its seven tools listed (`search_catalog`, `get_item`, `get_popular`, `get_publisher`, `my_library`, `load_item`, `ask_book`). Anonymous form is fine — the authenticated tools just show `UNAUTHENTICATED` on hover, which is correct for step 1 of the walkthrough. | Claude Code in a fresh terminal, after running the anonymous `claude mcp add bkstr …` command; `/mcp` typed in chat. |
| `m-02-claude-code-search-catalog-result` | A Claude Code conversation showing a `search_catalog` tool call (the user asked something like *"what books are on bkstr about agents?"*) and the rendered result with two or three real catalog rows (slug, title, kind, price, publisher, `storefront_url`). | Same Claude Code session as `m-01`, one turn later. The query `"agents"` returns real hits from prod today (verified during STOP D2). |

No screenshots needed for the new `/get-started` MCP tab — it deliberately ships without screenshots (it's marketing-toned, code-block-led, and points at the docs for depth).

---

## Open questions for operator review

1. **60-calls-per-minute rate limit number.** The dispatch prompt states this number; `bkstr-mcp/docs/architecture.md §7` deliberately defers thresholds to operator review and does not encode the number. The polished `mcp.md` and the MCP tab on `/get-started` both surface "60 calls per minute". If the production config differs (the runbook in `bkstr-mcp/docs/deployment.md` would have the authoritative value), the docs lie. Worth a one-line check against the deployed `AUTH_RATE_LIMIT_PER_MIN` SSM parameter — `/bkstr-mcp/prod/AUTH_RATE_LIMIT_PER_MIN` per the STOP D2 inventory.
2. **`ask_book` substitution in the walkthrough example.** *Your first call* step 5 uses `my_library` + `load_item` rather than `ask_book` to keep the walkthrough cost-free. If you want a worked `ask_book` example (the streamed-answer experience is the differentiator), add a sixth step — but it costs one Bedrock invocation per reader who follows along. Current choice errs cost-conservative.
3. **Tab URL persistence.** Tab clicks update local state only — they do not write back to `?tab=`. So a user who clicks **MCP** and then copies the URL gets `/get-started`, not `/get-started?tab=mcp`. Cheap to add with `router.replace`, but only worth it if share-friendly URLs matter; the dispatch said deep-linking is nice-to-have, not required. Left out by default.
4. **Sentry / instrumentation on the new client component.** The original `page.tsx` is a pure server component with no client JS. The new tabs file ships ~12 kB of client JS (the route's First Load JS rose from minimal to 11.8 kB / 202 kB total per the build output). No Sentry wiring beyond what's already global. Reasonable trade for the interaction; flagging in case the budget matters.
5. **`agentic-qa-manual` grant for the smoke subscriber** (carry-over from STOP D2). Not new in this branch, but the walkthrough's `my_library` step lands on `self-upgrade-engineer` for the smoke key today rather than the documented `agentic-qa-manual`. Same TODO #6 noted in `STOP_D_VERIFICATION.md` §5 in the bkstr-mcp repo.

---

MCP DOCS — operator review
