# /get-started MCP tab expansion — verification

Branch: `feat/get-started-mcp-tab-expansion-2026-05-20`
Base: `main` at `2d3df1c`
Touch surface: **one file** — `src/app/get-started/_components/get-started-tabs.tsx` (the `MCPTab` function and its helpers only).

---

## What changed

Expanded the MCP tab on `/get-started` from a short teaser (hero + one-line setup + four Capability cards + CTA) into a six-section "understand and connect" page. The other two tabs (Subscribers, Agent Developers) and the tab mechanism (`GetStartedTabs` + `useSearchParams` + `<Suspense>`) are untouched.

### Six sections, in render order

| # | Section | What it covers |
|---|---|---|
| 1 | **What MCP is and why you'd use it** | Three short paragraphs. MCP is the open standard hosts use to call tools from a model turn; bkstr hosts an MCP server at `https://mcp.bkstr.tmrwgroup.ai/mcp`; seven tools appear in the agent's tool list; the agent can search the catalog and load owned content mid-conversation without copy-paste; install paths from the Agent Developers tab still work — MCP is one more shape, not a replacement. |
| 2 | **The two modes** | Side-by-side `ModeCard`s. Anonymous = four browse tools, no signup. Authenticated = three more tools (`my_library` / `load_item` / `ask_book`), Bearer `bks_` key required, same key as the install endpoint and the CLI. |
| 3 | **Setup for all three clients** | `ClientSetup` block per client. Claude Code (via `claude mcp add` with `--transport http` and `--header`), Cursor (`mcp.json`), Codex CLI (`config.toml`). Each block shows both anonymous and authenticated config. Snippets are byte-identical to `src/content/docs/mcp.md` — cross-checked (see "Snippet fidelity" below). |
| 4 | **The seven tools — plain overview** | `ToolGroup` per mode. Each tool is name (mono) + a single sentence in user terms. No input/output schemas — the reference page owns those. |
| 5 | **Your first call** | Five-step walkthrough via `WalkStep`: add anonymous → search → get an API key → reconnect with key → list + load. Onboarding-toned; consistent with but shorter than the `mcp.md` walkthrough. |
| 6 | **Full reference** | Bordered card with copy explicitly listing what the reference page carries (schemas, error-code table, rate-limit specifics, kill-switch contract, troubleshooting). Button-CTA to `/dashboard/docs/mcp` — same style as the pre-expansion CTA. |

### Helpers (new)

- `ModeCard` — eyebrow + pill + serif title + body paragraph.
- `ClientSetup` — eyebrow + pill + summary + monospace code block.
- `ToolGroup` — eyebrow + blurb + list of `<code> — sentence` pairs.
- `WalkStep` — numbered list item with mono step number + serif title + body.

All four mirror the existing design-system patterns (Eyebrow, Pill, SectionRule, `border-t-2 border-ink pt-5` cards) used by `MentalModelColumn`, `StepRow`, `ProvisionalAgent`, etc. on `/get-started`. No new component library imported.

### Removed

- The four `Capability` cards (Anonymous / Owned library / Grounded Q&A / Attribution). Their content is absorbed:
  - "Anonymous" → §2 ModeCard ("Browse the catalog") + §4 ToolGroup.
  - "Owned library" → §2 ModeCard ("Read what you own") + §4 ToolGroup.
  - "Grounded Q&A" → §4 ToolGroup row + footer copy in §1 + §5.
  - "Attribution" — fully dropped from the tab. The factual claim ("same `bks_` key, `ask_book` writes its `fetch_logs` row attributed to that key") is reference-level detail that belongs only on `mcp.md` (§Authentication + `ask_book` sections there).
- The `Capability` helper function (no remaining callers).

---

## No reference-level content duplicated

The boundary called out in the prompt is honored. Specifically:

- **Per-tool input/output schemas** — not in the tab; §4 only carries name + one sentence per tool. The schemas are on `mcp.md`.
- **Full error-code table** — not in the tab. The six error codes (`UNAUTHENTICATED`, `NOT_OWNED`, `NOT_FOUND`, `RATE_LIMITED`, `UPSTREAM`, `INTERNAL`) appear only on `mcp.md`'s Errors table.
- **Rate-limit specifics** — not in the tab. The "60 calls per minute per key, sliding window, anonymous IP-keyed" detail lives only on `mcp.md`'s Rate limits section.
- **Detailed troubleshooting** — not in the tab. The seven `> **Label.**` callouts (transport mismatch, `UNAUTHENTICATED`, `NOT_OWNED`, kill-switch, `RATE_LIMITED`, `UPSTREAM`, TLS errors) live only on `mcp.md`'s Troubleshooting section.
- The kill-switch contract appears only as a brief gloss in §2 ("operator kill-switch" implicit) and is named explicitly only in §6's reference-page-framing. The exact message text and the `UPSTREAM`-code mechanic stay on `mcp.md`.

The tab links out to `/dashboard/docs/mcp` from §4 footer and §6 — both label it as the schema-level reference.

---

## Snippet fidelity vs `src/content/docs/mcp.md`

Cross-checked via `sed -n` on `mcp.md`. The three configuration blocks in the tab match byte-for-byte:

```bash
# Claude Code — both forms
claude mcp add bkstr --transport http https://mcp.bkstr.tmrwgroup.ai/mcp
claude mcp add bkstr --transport http https://mcp.bkstr.tmrwgroup.ai/mcp \
  --header "Authorization: Bearer $BKSTR_KEY"
```

```json
{
  "mcpServers": {
    "bkstr": {
      "url": "https://mcp.bkstr.tmrwgroup.ai/mcp",
      "headers": {
        "Authorization": "Bearer bks_your_key_here"
      }
    }
  }
}
```

```toml
[mcp_servers.bkstr]
url = "https://mcp.bkstr.tmrwgroup.ai/mcp"

[mcp_servers.bkstr.headers]
Authorization = "Bearer bks_your_key_here"
```

No paraphrase, no abridgement. If `mcp.md` ever changes a snippet, this tab must follow.

---

## Verification commands

| Step | Command | Result |
|---|---|---|
| Pre-flight | `git checkout main && git pull` | `main` HEAD `2d3df1c` (post-deploy of the three-tab restructure) |
| Branch | `git checkout -b feat/get-started-mcp-tab-expansion-2026-05-20` | clean off main; working tree only the known untracked items |
| Typecheck | `npx tsc --noEmit` | clean for `src/`. Two pre-existing TS2578 errors remain in `scripts/screenshots/{authed,public}-shots.spec.ts` — unrelated to this branch. |
| Build | `npm run build` | succeeds. `/get-started` `○ (Static)` 13.6 kB (up from 11.8 kB, +1.8 kB JS for the additional content). `/dashboard/docs/[slug]` `ƒ (Dynamic)` unchanged. |
| Tab mechanism | `GetStartedTabs` + Suspense + useSearchParams + the three `<button role="tab">` buttons untouched. Subscribers (default) / Agent Developers / MCP all still switch. | unchanged |
| Other tabs | `SubscribersTab` (three step rows + `StepRow` helper) and `AgentDevelopersTab` (Claude Code canonical + bkstr CLI + Cursor / Cline / Aider three-column + Advanced JSON + Q&A footnote) untouched. | unchanged |
| Reference page | `src/content/docs/mcp.md` not edited in this branch. | unchanged |

`/get-started`'s First Load JS rose from 203 kB → 204 kB — within rounding for one additional client component section.

---

## SCREENSHOT NEEDED — none in this pass

The expanded MCP tab is text-and-code-only, matching the absence of screenshots in the original (teaser) version. The reference page (`mcp.md`) is the one with screenshot placeholders (`m-01`, `m-02` from the prior polish pass). Adding screenshots to the tab would create the same `<!-- SCREENSHOT NEEDED -->` parallel placeholder set on a marketing surface — possible later if you want the tab to lead with a visual, but out of scope for this expansion.

If you do want one, the obvious candidate is a Claude Code `/mcp` panel screenshot near §3 (Setup) — the same shape as `m-01` on the reference page. If captured once, both surfaces can reference the same PNG under `public/docs/screenshots/`.

---

## Open questions

1. **No deep-link for sub-content within the MCP tab.** §3 (Setup) is the only section a user might want to share directly ("here's the Codex CLI config"). The tab itself is deep-linkable via `?tab=mcp`, but the sub-sections aren't anchor-targeted. Cheap to add (`id="setup"` / `id="walkthrough"` etc., scroll-mt for masthead clearance), but only worth it if the operator finds the tab long enough to warrant intra-page navigation.
2. **The `MCP` tab label.** Other tabs are full words ("Subscribers", "Agent Developers"); the third is the acronym. Considered "MCP server" or "Agent-native (MCP)" but kept the current "MCP" for brevity in the segmented control. Easy to change if you want consistency.

---

MCP TAB — operator review
