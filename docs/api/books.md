# Books API

External-facing endpoints under `/api/books/*`. Mirrors the shape of `docs/api/skills.md`.

The agent-consumption JSON endpoint is documented here. Existing UUID-based human/browser endpoints (`/api/books/{id}/view`, `/api/books/{id}/download`, `/api/books/{id}/cover`) predate this file and continue to live alongside.

---

## GET `/api/books/{slug}/files`

Returns the latest active version's content as inline JSON — multi-chapter books become an array of `{path, content, sha256}` files, legacy single-blob books become a single `content.md` file. Shape and error semantics are byte-identical to `GET /api/skills/{slug}/files` so a single agent-side parser handles both.

**Routing note.** Despite the slug being the natural identifier, the route file lives at `src/app/api/books/[id]/files/route.ts` and the dynamic param in the handler is named `id`. This is a Next.js App Router constraint — `/api/books/[id]/` already exists with sibling routes (`view`, `download`, `cover`), and Next.js does not allow two dynamic segments with different names at the same path level. The handler treats the param as a slug and **rejects UUIDs** with `BOOK_NOT_FOUND` (404). External callers see `/api/books/{slug}/files`.

### Auth

Either:

- **Session cookie** — for browser-based dev (visit while signed in).
- **API key** — header `Authorization: Bearer bks_<24-char-secret>`. Issue keys at `/dashboard/api-keys`. Keys are subscriber-scoped: the lookup that gates this endpoint is `AccessGrant.subscriberId = <owner-of-key>`.

If both forms are present, the API-key path wins (the helper checks for the `Authorization` header first).

### Path parameters

| Name | Type | Validation |
|---|---|---|
| `slug` (passed as `id` in the route directory name) | string | `/^[a-z0-9-]+$/`, 1–128 chars; UUIDs (matching `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`) are rejected with `404 BOOK_NOT_FOUND`. Malformed slugs → `404 BOOK_NOT_FOUND`. |

### Response — `200 OK`

**Multi-chapter book** (Stream J/K — `book_chapters` rows present, `book_versions.manifest.chapters[]` declares paths):

```json
{
  "book": {
    "slug": "agentic-qa-manual",
    "title": "Agentic Quality Assurance Manual",
    "version": "2"
  },
  "files": [
    {
      "path": "chapters/01-foundations.md",
      "content": "# Foundations\n\n…",
      "sha256": "a3f2…64-hex"
    },
    {
      "path": "chapters/02-patterns.md",
      "content": "# Patterns\n\n…",
      "sha256": "9b4c…64-hex"
    }
  ]
}
```

**Legacy single-blob book** (Phases 2–4, pre-Stream-K — inline `book_versions.content`, no chapters, manifest is `{}`):

```json
{
  "book": {
    "slug": "old-book",
    "title": "Older Single-Blob Book",
    "version": "1"
  },
  "files": [
    {
      "path": "content.md",
      "content": "# Old Book\n\nAll one blob…",
      "sha256": "ec5a…64-hex"
    }
  ]
}
```

### Field semantics

| Field | Source | Notes |
|---|---|---|
| `book.slug` | `books.slug` | Stable identifier; URL-safe. |
| `book.title` | `books.title` | Display title. |
| `book.version` | `book_versions.version` (latest, where the book is `status='ACTIVE'`) | Serialized as a **string** for parity with the skills-side endpoint. |
| `files[].path` | manifest-multi-chapter: `manifest.chapters[i].file` if present, else `chapters/{book_chapters.slug}.md`. Legacy: literal `content.md`. | Multi-chapter ordering follows `book_chapters.order ASC`, which matches manifest declaration order from the upload pipeline (Stream K). |
| `files[].content` | `book_chapters.content` (one per file) or `book_versions.content` (legacy). | **Raw UTF-8 string** — no base64. |
| `files[].sha256` | Computed at response time: `crypto.createHash('sha256').update(content, 'utf8').digest('hex')`. | Lowercase hex; books don't yet store a per-chapter content hash so this is recomputed per request. Mirrors the skills-side encoding byte-for-byte. |

### Error envelopes

All errors return:

```json
{ "error": "<human message>", "code": "<error_code>" }
```

| Status | `code` | When |
|---|---|---|
| `401` | `UNAUTHENTICATED` | No session AND no `Authorization` header, OR API-key validation failed (bad prefix / unknown / revoked). |
| `403` | `ACCESS_DENIED` | Authenticated but no non-revoked, non-expired `AccessGrant` with `bookId = <book.id>` for this subscriber. `PUBLISHER_OWN` grants count — the book's publisher can fetch their own book without a buyer purchase. |
| `404` | `BOOK_NOT_FOUND` | Slug doesn't match any row, slug is malformed, slug is UUID-shaped, OR book row exists but `status` is not `ACTIVE` (existence of `DRAFT`/`ARCHIVED` books is not disclosed at the slug). |
| `404` | `NO_ACTIVE_VERSION` | Book exists and is `ACTIVE`, but has zero versions, OR the latest version has no chapter rows AND no inline `content` (edge case — never returns an empty `files[]`). |

### Quotas

No per-request rate limit on this endpoint. The existing `/api/books/{id}/download` endpoint has a 5/UTC-day/book/subscriber rate limit (Phase 4 Stream C, D11.9) for watermarked `.md` downloads; that limit does NOT apply here. If abuse surfaces, mirror that limit at this route using the same `fetch_logs`-based primitive.

### Agent usage example

```python
import os
import hashlib
import json
import urllib.request

API_KEY = os.environ["BKSTR_API_KEY"]
SLUG = "agentic-qa-manual"

req = urllib.request.Request(
    f"https://bkstr.tmrwgroup.ai/api/books/{SLUG}/files",
    headers={"Authorization": f"Bearer {API_KEY}"},
)
with urllib.request.urlopen(req) as resp:
    payload = json.load(resp)

# Write to disk, integrity-checking against the per-file sha256.
for f in payload["files"]:
    expected = f["sha256"]
    body = f["content"].encode("utf-8")
    actual = hashlib.sha256(body).hexdigest()
    assert actual == expected, f"sha256 mismatch on {f['path']}"
    os.makedirs(os.path.dirname(f["path"]) or ".", exist_ok=True)
    with open(f["path"], "wb") as out:
        out.write(body)
print(f"Wrote {len(payload['files'])} files for book {payload['book']['slug']} v{payload['book']['version']}")
```

This snippet is paste-compatible with Stream O's `helpers/fetch_book.py` — only the URL host + slug substitution differ.

### Versioning

No `?version=` parameter in v1. Always returns the latest `book_versions` row for the book. If a pinned-version variant is needed, add `?version=<int>` to this route; `book_versions_bookId_version_key` already enforces uniqueness.

---

## See also

- `docs/api/skills.md` — the skills-side mirror (same response shape, same error codes).
- `docs/decisions.md` — D11.4 (access-grant primitive), D16.1 (multi-chapter schema, Stream J), D17.1 (zip-upload chapter ingestion, Stream K).
- `src/lib/books/agent-access.ts` — `requireBookFetchAccess` helper. Layers slug-resolve + multi-chapter assembly on top of the leaf `requireBookAccess` primitive in `src/lib/books/access.ts`.
- `src/lib/books/access.ts` — `requireBookAccess(subscriberId, bookId)` — the underlying grant-check primitive shared with `/api/books/{id}/view` and `/api/books/{id}/download`.
