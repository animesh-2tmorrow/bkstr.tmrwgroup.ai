# bkstr docs

Welcome to bkstr. This page contains operational guidance for using the platform. Sections below are filtered to your role — you only see what applies to you.

## Getting started

bkstr is an internal marketplace for markdown books. The model is simple: **publishers** put books up for sale, **subscribers** buy access. Once you own a book, you can read it inline, download a watermarked copy, or query its content via an authenticated API endpoint — useful when you want an agent to ground its answers in book content rather than its training data.

You're signed in. That means a user row exists for you, and a subscribers row was auto-created on first signin. Your role was assigned at signin based on your email — there are three: **SUBSCRIBER** (default, can buy and use books), **PUBLISHER** (can also publish books), **ADMIN** (can also manage users, books, grants, and audit logs).

The sidebar on the left is your map. Items visible depend on your role. Everyone sees Active Books, Library, API Keys, Fetch Logs, Billing, Docs, Usage Metrics, and Team Access. Publishers additionally see New Book and Pricing. Admins additionally see Admin · Users, Admin · Books, and Admin · Grants.

If anything below references a route you don't see in your sidebar, that's expected — it means the route belongs to a role you don't have.

## Need more help?

If you hit something this docs page doesn't cover, ping the platform operator (animesh@2tmorrow.com). The follow-ups list grows from those pings — questions that come up more than once usually become new sections here.

:::role subscriber

## For subscribers

This section walks you through everything a subscriber does on bkstr: finding books, buying access, reading them, and querying them programmatically.

### Finding a book

Go to **Library** in the sidebar. You'll see three tabs: **Active** (books you already own), **Browse** (books you don't own yet), and **All** (everything in the catalog).

Each book row shows the title, slug, domain tag, description, publisher, price, and your current access state. If a book has a green "Access granted" pill, you already own it — open the API access disclosure under the title to see how to query it, or click View / Download.

If a book shows a "Buy — $X.XX" button, you don't own it yet. Click the button to start a purchase.

### Buying a book

Clicking Buy redirects you to Stripe Checkout. (Note: payments currently run on Stripe sandbox — only test cards work. Real payment processing turns on once a separate platform decision lands, but everything else about the flow is production-ready.)

Pay with a card. On success, you're redirected back to bkstr with an API instructions block — a short curl recipe showing how to query the book you just bought. Save the API key shown there, or grab it later from the API Keys section in the sidebar.

Behind the scenes, your purchase writes an access grant linked to your Stripe payment intent ID. The grant is permanent unless an admin revokes it (which would only happen for cases like accidental purchases or refunds).

### Reading a book

Once you own a book, you have three ways to consume it:

**View** — renders the book's markdown inline in the dashboard. Open it from the Library row or from Active Books. Headings, code blocks, tables, lists all render. Good for browsing or copying snippets.

**Download** — gives you a watermarked `.md` file. The watermark identifies you as the licensed reader and is embedded as a comment in the markdown source — it doesn't show up in rendered output, but it's there if anyone shares the file. Downloads are rate-limited to 5 per day per book per subscriber. If you hit that limit, you're not locked out of the book — just out of fresh downloads for the day.

**API query** — the most powerful option. Send an authenticated request to the agent endpoint, include the book slug, and ask a question in natural language. The server fetches the book content, hands it to Bedrock with your question as context, and streams back a grounded answer. This is what makes bkstr useful as agent infrastructure rather than just a content shop. Your agents can call this in a loop without hallucinating, because the answer is anchored to actual book text.

Every API query is recorded in **Fetch Logs** with a timestamp, the book queried, and the answer length. Useful for debugging what your agents have been asking, or auditing usage on a per-book basis.

### Managing access

**API Keys** — generate, name, and revoke keys here. You can have multiple keys (e.g. one per agent, one for local dev, one for CI). Revoking a key immediately stops all requests authenticated with it.

**Active Books** — your owned books with usage telemetry: total fetches, last 30 days, active agents (distinct API keys that fetched in the window), last fetch time. Useful for seeing which books your agents actually use vs. which are sitting cold.

**Billing** — payment history. Every purchase shows up here with the book, price paid, and a link to the Stripe payment.

**Usage Metrics** — aggregate usage view. Fetch counts, distinct books accessed, time-series of activity. The numbers here can lag a minute or two behind reality but converge fast.

**Team Access** — if your account is part of a team or organization, share access to your books here. (Currently single-tenant per subscriber; team workflows expand as the platform matures.)

:::

:::role publisher

## For publishers

This section is everything you need to publish, price, and manage books as a publisher. Your role was promoted to PUBLISHER automatically because your email is on the publisher allowlist.

### Publishing your first book

The publishing route is **New Book** in the sidebar, or directly at `/dashboard/books/new`.

The form takes seven fields:

- **Title** — 1–255 chars, required.
- **Slug** — 1–128 chars, lowercase letters, digits, and hyphens only. Auto-derived from your title until you manually edit it. Must be unique within your publisher account.
- **Domain** — 1–64 chars, free-text taxonomy tag (e.g. `skill`, `reference`, `playbook`, `runbook`). This is for grouping; no one searches on it yet.
- **Description** — 0–5000 chars, optional but strongly recommended. This is the prose summary buyers see in the Library. Front-load the most relevant info in the first ~150 chars because the Library table truncates descriptions in the row view.
- **Content** — 1–1,000,000 chars markdown, required. The actual book body. Headings, code blocks, tables, lists, images via URL, links — anything standard markdown supports renders correctly.
- **Price (USD)** — minimum $0.50 (the payment processor floor), max two decimal places. No upper cap.

When you click submit, the server runs an atomic transaction: validates inputs, creates a Stripe Product and Price in the platform's payment processor account, then inserts the book row, the first BookVersion, the price record, and a PUBLISHER_OWN access grant for you — all in one database transaction. Either everything lands or nothing does. If the payment processor call fails before the local writes, you get a clean 502 and no orphan rows.

Your book is `ACTIVE` and visible in the Library the moment the form submission succeeds. There's no draft state.

### Uploading a `.zip` folder (multi-chapter)

For books that span multiple chapters, upload a `.zip` archive instead of pasting markdown. Switch the form's upload mode to **"Upload a .zip folder"**.

**What goes in the zip:**

- **Optional `manifest.yaml` at the zip root.** If present, declares the ordered list of chapters plus book-level metadata. If absent, the server derives chapters from the `.md`/`.markdown` files in filename order. Minimum required field in the manifest: `chapters:` (a non-empty ordered list). Everything else (`title`, `slug`, `domain`, `description`, `audience`, `token_estimate`, `conventions`) is optional with form fallback.
- **Chapter files**, typically under `chapters/`. Each chapter is a single `.md` or `.markdown` file.

**Manifest chapter entries** accept either or both of `file:` and `slug:`:

```
chapters:
  - file: chapters/ch00-core.md        # slug derived as "ch00-core" (no prefix stripping)
  - slug: appendix-a                   # file derived as "chapters/appendix-a.md"
  - file: chapters/ch01-intro.md       # both used as given
    slug: introduction
```

In **manifest mode**, slugs derived from `file:` keep the full basename — no prefix stripping. In **filename-fallback mode** (no manifest), a leading `ch00-` or `01_` prefix on the filename IS stripped (`ch00-core.md` → slug `core`). The split is deliberate: manifest authors usually want filename fidelity; filename-fallback authors are getting a best-effort guess at slugs.

**Wrapping is transparent.** If your zip wraps everything under a single top-level directory (the default when running `zip -r foo.zip foo/` from the CLI, or using Finder's "Compress", or right-clicking → "Send to → Compressed folder" in Explorer), the server detects the wrapping directory and uses it as the virtual root for all path resolution — including the `manifest.yaml` lookup and chapter file references. Up to 3 levels of nested single-directory wrapping is accepted. No need to repack flat. macOS Finder's `__MACOSX/` resource-fork siblings are stripped silently.

**Caps** (server-enforced):

- Zip file size: 10 MB
- Per-chapter content: 1 MB
- Total uncompressed: 20 MB
- Maximum chapter count: 500

**Re-uploading the same zip** is idempotent — the server computes a hash of the chapter content; an identical re-upload returns `200 {unchanged: true}` with the existing version's id. An *edited* zip creates a new `BookVersion` (v2, v3, …) of the same book. The price stays at the current value when uploading a new version — the form's price field is locked for existing slugs. Price changes happen on the Pricing page, not on upload.

**Skill bundles are rejected.** A zip with `SKILL.md` at the root (or at the virtual root) whose first frontmatter block contains a `name:` field is rejected with a clear error pointing at the (future) Skills surface. Don't try to upload skills via the book form.

### ⚠️ Three sharp edges to know before you click submit

These are real limitations of the current build. Both fixes are scheduled (follow-ups #73 and #74) but not implemented yet.

**1. Submission is instantly live, no draft or preview.** The moment you hit submit, the book is ACTIVE and visible in the Library Browse tab. There is no draft state, no preview surface, no "publish later" button. Whatever you submit, buyers see right away. Before clicking submit, paste your content into a normal markdown previewer (VS Code, Obsidian, GitHub) to confirm it renders the way you want. Don't use the form as a preview.

**2. No edit-after-create on title, slug, description, domain, or content.** Once a book is published, the only field editable from the UI is the price. Title typos, slug changes, description rewrites, content updates — none of these have a UI today. Write your markdown in your own editor first, fully proofread, decide title and slug before you start the form. If you need to fix something after publishing, ping the platform operator — there's a server-side script that can create a new BookVersion with updated content, but it's not self-serve.

**3. Price is editable later.** Go to **Pricing** in the sidebar to see your own books with inline price-edit affordances. Price changes don't require re-publishing or re-uploading content; they're a single-field update and take effect immediately. Stripe Product and Price records are updated in lockstep.

### What happens after you publish

Your book appears in the Library Browse tab for any signed-in subscriber who doesn't own it. They see your title, description, price, and your name as the publisher. They click Buy, go through Stripe Checkout, and on success a PURCHASE access grant is written for them. They get View, Download, and API access immediately.

You see usage telemetry for your own books in **Active Books** — total fetches, recent activity, distinct agents querying. Useful for spotting which books are getting traction and which aren't.

### Managing your books over time

**Pricing** — adjust prices anytime. Use this to run sales, react to market signal, or test elasticity.

**API Keys, Fetch Logs, Usage Metrics** — same as any subscriber. As a publisher you also have full subscriber access to your own books via the auto-created PUBLISHER_OWN grants. You can query your books via the API the same way buyers do, which is useful for testing the grounded-answer experience before pushing content updates.

**Billing** — your payment history as a buyer (if you've bought books). Publisher payout reporting is not yet built — the platform runs on a single payment-processor account, so revenue-share is currently a manual reconciliation. Expect this to evolve.

### What you can't do (and who can)

- Edit a published book's title, content, or metadata → platform operator runs a script
- Reassign a book to another publisher → admins can, via Admin · Books
- See other publishers' books in your dashboards → no, scoped to your own
- Bulk-publish via API → not yet, form is the only path

:::

:::role admin

## For admins

This section covers admin-only surfaces and operational concerns. Admin actions mutate state across all publishers and subscribers, so the affordances here are deliberately friction-heavy — destructive operations require typed confirmation, self-protection gates prevent you from demoting yourself, and every mutation writes an audit row.

### Admin · Users

Lists every user on the platform with their role, email, signin counts, and last-signin timestamp. The two operations here are **promote** (SUBSCRIBER → PUBLISHER or → ADMIN) and **demote** (PUBLISHER → SUBSCRIBER, or ADMIN → PUBLISHER/SUBSCRIBER).

Promotion is a one-click modal. Demotion is asymmetric — destructive operations require you to type the target's email to confirm. This is a deliberate friction gate so accidental demotes don't happen mid-meeting.

**Self-protection gates** apply to every admin mutation on your own user row:

- You cannot demote yourself
- You cannot revoke your own access grants
- You cannot reassign books away from yourself if you'd be the last admin
- You cannot delete yourself (no delete UI exists, but the API would reject it)
- The role hook (`syncRoleFromEnv`) only promotes; it never demotes. Explicit ADMIN demote actions are required to step someone down.

If you need to demote yourself or remove yourself as the last admin, you cannot do it via the UI. Modify the role environment variable first and have another admin do the action.

### Admin · Books

Lists every book in the catalog, regardless of publisher. The primary operation is **reassign publisher** — change which user owns a book, including its Stripe Product link and PUBLISHER_OWN grant.

The reassign modal's dropdown filters to PUBLISHER + ADMIN users only (no SUBSCRIBER can own a book). The operation runs as a single transaction: updates `publisher_user_id`, creates a new PUBLISHER_OWN grant for the new owner, and writes an audit row to `admin_actions` with before/after JSONB.

Self-reassign (picking the current owner from the dropdown) is detected and short-circuits with a 200 `{status: "unchanged"}` — it does NOT write an audit row. This is by design: the audit log records state transitions, not click attempts. If you need forensic visibility into "operator clicked reassign but no change happened," that's a different feature (would land in a separate `admin_attempts` table; not built).

Typical use case: a publisher signs in for the first time and the platform operator reassigns existing seed books from ADMIN ownership to the new publisher.

### Admin · Grants

Lists every access grant on the platform with filterable source (SEED, PURCHASE, PUBLISHER_OWN). The primary operation is **soft-revoke** — set `revoked_at` to now on a grant, immediately stripping access without deleting the record.

Soft-revoke fires a confirmation modal. Once confirmed, the grant's `revoked_at` populates and the subscriber loses access on their next request. The grant row is preserved for audit — you can see who had access, when, and why it was revoked.

An audit row lands in `admin_actions` with the grant ID, before-state (`revoked_at: null`), and after-state (`revoked_at: <timestamp>`). The whole operation runs in one transaction; either the grant updates and the audit row writes, or neither does.

**When to use revoke:**
- Refund processed externally; need to strip access
- Account compromise or credential leak suspected
- Misassigned grant during testing or migration
- Subscriber requested removal of seed access

**When NOT to use revoke:**
- Subscriber asks to "pause" access — there's no resume; revoke is one-way today (re-grant is a separate operation)
- General account cleanup — revoke is per-grant, not per-user

### The audit log

`admin_actions` is the append-only ledger of every admin mutation. Schema: `id`, `actor_user_id`, `action`, `target_type`, `target_id`, `before` (JSONB), `after` (JSONB), `created_at`. Every reassign and revoke writes a row.

To inspect: SSH to the EC2, then psql per the runbook in `docs/operations.md`. Useful queries are pinned there. Common ones:

- Recent actions by a given admin: `SELECT * FROM admin_actions WHERE actor_user_id = '<uuid>' ORDER BY created_at DESC LIMIT 20`
- All revokes in the last 7 days: `SELECT * FROM admin_actions WHERE action = 'grant.revoke' AND created_at > now() - interval '7 days'`
- Books reassigned in a window: `SELECT * FROM admin_actions WHERE action = 'book.reassign_publisher' AND created_at BETWEEN ... AND ...`

### Operational concerns specific to admins

**Role promotion via environment.** PUBLISHER and ADMIN allowlists live in `/etc/bkstr/roles.env` as `PUBLISHER_EMAILS` and `ADMIN_EMAILS` (comma-separated). The role-sync hook fires on every signin and only ever promotes; it never demotes. To remove someone from an env-driven role, strip their email from the env file AND run an explicit demote in Admin · Users — env removal alone is not enough.

**The platform runs on a single payment-processor account** (currently sandbox keys). All purchase revenue flows into one place. There's no per-publisher Stripe Connect; payout splits are off-platform manual reconciliation today. Whatever revenue-share model lands is operator-managed, not platform-managed. This is tracked as open question OQ-1.

**Backfilled and seed data:**
- All early seed books (~6 of them) were initially owned by the first ADMIN as temporary seed-corpus owner
- SEED-source grants were created during platform bootstrap for testing
- The `publisher_user_id` column is currently nullable to accommodate the bootstrap state; #68 tracks tightening this to NOT NULL once all seed books are reassigned to real publishers

**Runbooks** for operational tasks (content updates, env rotation, schema migrations, S3 migration) live in `docs/operations.md`. Read before doing anything destructive in production.

### What this section deliberately doesn't cover

- **Schema migrations** — operator-only, runs via Prisma + a checked-in migration workflow. See `docs/operations.md`.
- **Content editing scripts** — `scripts/import-book.ts` updates a published book's content by creating a new BookVersion. Operator-only, requires SSM access.
- **Stripe rotation, secret rotation, env management** — operator runbook territory, not admin UI territory.
- **Pen-test and security review** — pre-launch checklist lives in the operator's notes.

:::
