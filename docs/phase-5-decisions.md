# bkstr.tmrwgroup.ai — Phase 5 decisions (D13.x slot)

Phase 5 opens with the in-product docs surface at `/dashboard/docs`. Decisions logged here are Phase-5-scoped; D9-D12 remain closed in their respective phase docs. Future Phase 5 streams append D13.3+ as they ship.

## D13.1 — Route + nav: `/dashboard/docs`, visible to all signed-in users

**Choice:** A new route at `/dashboard/docs` renders the in-product docs as a server component. The sidebar nav surfaces it as `{ key: "docs", href: "/dashboard/docs", label: "Docs" }` with no role flag — every signed-in user (SUBSCRIBER, PUBLISHER, ADMIN) sees it. Placement: last entry in `NAV_ITEMS`, after `admin-grants`. Renders as the bottom of the role-filtered visible nav across all three roles (after Billing for SUBSCRIBER; after admin items for ADMIN).

**Reasoning:** Docs are universal context — every role benefits from knowing how the platform works at the level applicable to them. Gating the surface itself by role would hide entry points from users who legitimately need them; per-section filtering (D13.2) handles role-specific content inside the page. Placement at the bottom of the nav reflects the docs surface as reference material, not primary workflow.

**Cross-references:** D11.10 (`publisherOrAdmin` flag precedent for PUBLISHER-visible nav items); D11.11 (role-promotion mechanics that determine which role `session.user.role` reports).

## D13.2 — Role-marker syntax + hide-on-no-access semantics

**Choice:** Markdown role markers use a fenced-block syntax:

```
:::role <subscriber|publisher|admin>
... content visible to that role and higher ...
:::
```

Tier semantics are rank-based: `ADMIN(2) ≥ PUBLISHER(1) ≥ SUBSCRIBER(0)`. A `:::role X` block renders iff `userRank >= blockRank`. Unmarked content is always visible. The implementation lives at `src/lib/docs/filter-by-role.ts` as a pure synchronous function `filterByRole(markdown, role)` invoked server-side at request time before passing the filtered string to `react-markdown`.

UX: blocks the caller can't access are **hidden entirely** (the heading, body, and marker lines all vanish). Users don't see breadcrumbs of content they're not entitled to.

**Fail-closed rules:**
- **Unknown role tag** (e.g. `:::role moderator`) → block is stripped for all roles, including ADMIN. Defaults to "hide rather than expose."
- **Unterminated block** (opener without closing `:::` before EOF) → block content is stripped for all roles. Defends against the "publisher forgot the closing fence" scenario leaking admin content to subscribers.
- **Spurious lone closing fence** (`:::` outside any open block) → line is silently dropped; surrounding content preserved.

**Reasoning:** Markdown's `:::name` fenced directives are a recognized convention (used by remark-directive, MkDocs Material, etc.) so the syntax is legible to anyone editing the file. Rank-based tier semantics keep authoring simple — a `:::role publisher` block automatically also shows to ADMIN; the author doesn't write three near-duplicate blocks for "PUBLISHER", "PUBLISHER + ADMIN", and "ADMIN only" cases. Fail-closed on malformed input means typos can't accidentally leak privileged content; the worst case is "section silently missing for everyone, file a follow-up to fix the markdown." Server-side filtering keeps role-targeted content out of the wire entirely — non-ADMIN users never receive ADMIN-block bytes.

**Alternatives considered:**
- **(a) Remark-directive AST plugin.** More principled but adds a dep and introduces remark's plugin API surface for a single use case. Pre-processing the markdown string with a simple state machine is sufficient.
- **(b) Per-tier separate files** (`docs/subscriber.md`, `docs/publisher.md`, `docs/admin.md`). Eliminates the filter logic but explodes duplication for common content; common-section updates would touch three files.
- **(c) Comment-based syntax** (e.g. `<!-- role:publisher -->`). Invisible in raw markdown previews (e.g. GitHub), which makes authoring harder. The visible `:::role` markers self-document.

**Cross-references:** Stream A's pure-function extraction at `src/lib/docs/filter-by-role.ts` (unit-tested); follow-up #77 (placeholder → real content).
