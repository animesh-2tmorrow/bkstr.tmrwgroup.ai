---
title: "Concepts"
track: shared
role: SUBSCRIBER
order: 1
summary: "Books vs skills, slugs, versions, and what an access grant is."
---

bkstr has a small vocabulary. This page defines the terms the rest of the docs lean on. For one-line definitions, see the [Glossary](/dashboard/docs/glossary).

## Books and skills

bkstr sells two classes of content. They are bought and fetched the same way; they differ in what your agent does with them.

- A **book** is a bundle of markdown — chapters of prose your agent reads as *context*. Books support an optional question-and-answer endpoint that grounds answers in the book's text.
- A **skill** is a `.zip` bundle — a `SKILL.md` plus supporting files (scripts, configs, templates) your agent *installs and runs*.

| | Book | Skill |
|---|---|---|
| Content | Markdown chapters | `SKILL.md` plus supporting files |
| Your agent | Reads it as context | Installs and runs it |
| Delivered as | A bundle of files | A bundle of files |
| Question-and-answer endpoint | Yes | No |

The catalog treats them as one product type — the buy-and-fetch flow is identical. Only the install destination and how your agent uses the files differ.

## Slugs and the catalog

Every item has a **slug** — a short, lowercase, hyphenated identifier such as `agentic-qa-manual`. The slug is how every surface names an item: the storefront URL `/storefront/<slug>`, the install endpoint, the CLI.

The **catalog** is the set of active items, browsable at [/storefront](/storefront). bkstr resolves a slug to either a book or a skill — whichever is active under that slug. Archived items do not resolve; a request for one is a not-found.

## Versions

Books and skills are versioned — v1, v2, v3. The latest version is the one served by default. Your purchase covers every version of the item you bought, so you can re-fetch after the publisher ships an update at no extra cost.

A publisher who re-uploads identical content gets the same version back — the upload is idempotent. An upload with changed content creates the next version.

## Access grants and ownership

**Owning** an item means your account holds a live **access grant** for it. A grant records that your account may fetch a specific book or skill.

A grant is created when:

- you complete a purchase — the grant is tied to your Stripe payment;
- you are the publisher of the item — publishers hold a grant on their own content;
- an admin grants you access directly.

A grant is **live** until it is revoked. It does not expire on its own, and re-fetching never consumes it. An admin can revoke a grant — for example, to reverse an accidental purchase — which ends access while keeping the record.

**Free items are never granted.** An item priced at $0 is installable by anyone, anonymously. Because nobody holds a grant for it, a free item never appears in a Library or in `bkstr list` — it is installable by everyone and owned by no one.

## Archived items

A publisher can archive a book. An archived item is hidden from the storefront, the catalog, and `bkstr list`, and it no longer resolves by slug for browsing. Archiving does **not** revoke grants — anyone who already owns an archived book keeps access and can still install it by its slug.
