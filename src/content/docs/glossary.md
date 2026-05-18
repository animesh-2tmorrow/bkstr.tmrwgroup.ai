---
title: "Glossary"
track: shared
role: SUBSCRIBER
order: 2
summary: "One-line definitions of the terms used across these docs."
---

Short definitions for the terms used across bkstr's docs. For the model behind them, see [Concepts](/dashboard/docs/concepts).

**Access grant** — A record that your account may fetch a specific book or skill. Created by a purchase, by publishing the item, or by an admin.

**API key** — A `bks_`-prefixed secret that authenticates API and CLI requests. Created and revoked at [/dashboard/api-keys](/dashboard/api-keys); shown in full only once.

**Archived** — A status for a book that hides it from the storefront, the catalog, and `bkstr list`. Existing owners keep access.

**bkstr** — This platform: a catalog of books and skills your AI agent can read and run.

**Book** — A bundle of markdown chapters your agent reads as context.

**Catalog** — The set of active books and skills, browsable at [/storefront](/storefront).

**CLI** — The `bkstr` command-line tool, distributed on npm as `@clawbot678/bkstr`.

**Domain** — A free-text category a publisher tags a book with, used as a filter on the storefront.

**Fetch** — Any request that retrieves an item's files or queries a book.

**Install endpoint** — `GET /api/install/<slug>`, which streams an item's files as a gzipped archive.

**Library** — Your dashboard view of owned and browsable items, at [/dashboard/library](/dashboard/library).

**Owned** — Holding a live access grant for an item.

**Publisher** — A role that can author, price, and manage books and skills.

**Skill** — A `.zip` bundle of a `SKILL.md` plus supporting files your agent installs and runs.

**Slug** — An item's short, lowercase, hyphenated identifier, for example `agentic-qa-manual`.

**Storefront** — The public catalog at [/storefront](/storefront).

**Subscriber** — The default role: an account that can buy and use books and skills.

**Version** — A numbered revision of a book or skill (v1, v2, and so on). The latest is served by default.

**Watermark** — A `.bkstr-install` record placed in every installed bundle, noting when and what was fetched.
