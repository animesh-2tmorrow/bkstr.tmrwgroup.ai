---
title: "API reference"
track: agent
role: SUBSCRIBER
order: 2
summary: "The install, library, and per-file endpoints — auth, requests, responses."
---

bkstr exposes a small HTTP surface. This page covers the endpoints you call to install items and to read what an account owns. The book question-and-answer endpoint has its own page — see [Q&A endpoint](/dashboard/docs/qa-endpoint).

All examples use `https://bkstr.tmrwgroup.ai` as the host.

## Authentication

API requests authenticate with a `bks_` API key in a Bearer header:

```bash
curl -H "Authorization: Bearer $BKSTR_KEY" ...
```

Create and revoke keys at [/dashboard/api-keys](/dashboard/api-keys). A key belongs to your subscriber account; what it can fetch is decided by the access grants on that account. The install endpoint is the one exception — it serves free items with no key at all.

## GET /api/install/&lt;slug&gt;

The install endpoint streams an item's files as a gzipped tar archive. It is what the `curl` one-liner and the `bkstr` CLI both call.

```bash
# Free item — no key
curl -sL https://bkstr.tmrwgroup.ai/api/install/<slug> | tar xz -C ~/.claude/skills/

# Paid item — Bearer key plus a grant on the item
curl -sL -H "Authorization: Bearer $BKSTR_KEY" \
  https://bkstr.tmrwgroup.ai/api/install/<slug> | tar xz -C ~/.claude/skills/
```

The archive holds every file namespaced under `<slug>/`, so extraction drops one `<slug>/` directory. The first entry is `.bkstr-install`, a one-line record of the fetch. Books and skills use the same endpoint.

Access is decided after the item's price is resolved:

- A **free** item is served to anyone, with or without a key.
- A **paid** item requires a valid key *and* a live grant. No key or an invalid key returns `401`; a valid key with no grant returns `403`.

Error responses are JSON — `{ "error": <message>, "code": <CODE> }` — with codes `NOT_FOUND`, `UNAUTHENTICATED`, `ACCESS_DENIED`, `NO_CONTENT`, `RATE_LIMITED`, and `TARBALL_FAILED`.

## GET /api/cli/library

The library endpoint returns the account a key belongs to and the items it owns. It is Bearer-only — there is no anonymous or session form. `bkstr list` and `bkstr whoami` are both built on it.

```bash
curl -H "Authorization: Bearer $BKSTR_KEY" \
  https://bkstr.tmrwgroup.ai/api/cli/library
```

```json
{
  "account": { "email": "you@example.com", "subscriberId": "<uuid>" },
  "items": [
    {
      "kind": "book",
      "slug": "agentic-qa-manual",
      "title": "Agentic Quality Assurance Manual",
      "description": "...",
      "unitAmountCents": 1200,
      "isFree": false,
      "publisher": "...",
      "grantedAt": "2026-05-18T02:20:26.017Z"
    }
  ]
}
```

`items` lists only granted items, so free items never appear. Archived items are excluded. An item owned through more than one grant is listed once.

## Per-file endpoints

When you want each file as JSON rather than a tar archive, use the files endpoints. They return each file as a `path`, its `content`, and a `sha256` hash, and they accept either a Bearer key or a signed-in session.

```bash
# A book — identified by its book id
curl -H "Authorization: Bearer $BKSTR_KEY" \
  https://bkstr.tmrwgroup.ai/api/books/<book-id>/files

# A skill — identified by its slug
curl -H "Authorization: Bearer $BKSTR_KEY" \
  https://bkstr.tmrwgroup.ai/api/skills/<slug>/files
```

The two endpoints return the same shape, and both require a live grant on the item. Note the asymmetry: the books endpoint identifies a book by its **id**, and the skills endpoint identifies a skill by its **slug**.

A skill also offers `GET /api/skills/<slug>/download` — the skill rebuilt as a single `.zip`, for when you want one artifact instead of per-file JSON.

## Rate limits

The install and library endpoints share one request budget per client IP address. A burst of automated calls from one address can reach it; a `429` response carries a `Retry-After` interval. Space out automated calls, and on a `429` retry after the interval the response gives.
