# Skills API

External-facing endpoints under `/api/skills/*`. All routes are runtime-Node, force-dynamic, and authenticate via either a NextAuth session cookie OR an API key in `Authorization: Bearer bks_…`.

Two consumption shapes for a purchased skill:

- **`GET /api/skills/{slug}/download`** — zip download for humans (browser).
- **`GET /api/skills/{slug}/files`** — inline JSON for agents (Codex, Claude Code, etc.).

Both gate on the same `AccessGrant.skillId` check; both serve the latest `ACTIVE` `skill_versions` row for the skill; both work with either session or API-key auth.

---

## GET `/api/skills/{slug}/files`

Returns the latest active version's files as inline JSON.

### Auth

Either:

- **Session cookie** — for browser-based dev (visit while signed in).
- **API key** — header `Authorization: Bearer bks_<24-char-secret>`. Issue keys at `/dashboard/api-keys`. Keys are subscriber-scoped: the lookup that gates this endpoint is `AccessGrant.subscriberId = <owner-of-key>`.

If both forms are present, the API-key path wins (the helper checks for the `Authorization` header first).

### Path parameters

| Name | Type | Validation |
|---|---|---|
| `slug` | string | `/^[a-z0-9-]+$/`, 1–128 chars. Malformed → `404 SKILL_NOT_FOUND`. |

### Response — `200 OK`

```json
{
  "skill": {
    "slug": "agent-book-author",
    "name": "agent-book-author",
    "version": "1",
    "description": "Use this skill to create, convert, or improve reference books for the agent bookstore."
  },
  "files": [
    {
      "path": "SKILL.md",
      "content": "---\nname: agent-book-author\ndescription: ...\n---\n\n# ...",
      "sha256": "a3f2…64-hex"
    },
    {
      "path": "scripts/setup.py",
      "content": "import os\n…",
      "sha256": "9b4c…64-hex"
    }
  ]
}
```

### Field semantics

| Field | Source | Notes |
|---|---|---|
| `skill.slug` | `skills.slug` | Stable identifier; URL-safe. |
| `skill.name` | `skills.name` | From the publisher's `SKILL.md` frontmatter `name:`. |
| `skill.version` | `skill_versions.version` (latest active) | Serialized as a **string** to keep the field stable if non-integer version labels are introduced later. |
| `skill.description` | `skills.description` | From the publisher's `SKILL.md` frontmatter `description:`. |
| `files[].path` | `skill_files.path` | Relative to the skill's virtual root. `SKILL.md` lives at the root; supporting files keep their stored relative paths. Wrapping directories (single-dir wrap, up to 3 deep, plus macOS `__MACOSX/` siblings) were stripped at upload time. |
| `files[].content` | `skill_files.content` | **Raw UTF-8 string** — no base64. Skill upload enforces strict UTF-8 (`TextDecoder("utf-8", { fatal: true })`), so this is round-trip safe. |
| `files[].sha256` | `skill_files.content_hash` | SHA-256 hex digest of the file content bytes. Use for client-side integrity verification when writing files to disk. |
| `files` order | — | Sorted by `path` ascending (deterministic; stable between calls). |

### Error envelopes

All errors return:

```json
{ "error": "<human message>", "code": "<error_code>" }
```

| Status | `code` | When |
|---|---|---|
| `401` | `UNAUTHENTICATED` | No session AND no `Authorization` header, OR API-key validation failed (bad prefix / unknown / revoked). |
| `403` | `ACCESS_DENIED` | Authenticated but no non-revoked, non-expired `AccessGrant` with `skillId = <skill.id>` for this subscriber. |
| `404` | `SKILL_NOT_FOUND` | Slug doesn't match any row, OR slug is malformed. |
| `404` | `NO_ACTIVE_VERSION` | Skill exists but its status is `ARCHIVED` (no active version). |

### Quotas

No per-request rate limit in v1. Payload caps are implicit from the upload pipeline:

- Total uncompressed: ≤ 20 MB
- Per-file content: ≤ 1 MB
- File count: ≤ 500

A maxed-out skill JSON response is ≈ 25 MB on the wire (UTF-8 strings + JSON envelope overhead). Future optimization paths if this becomes a problem: streaming response, per-file fetch endpoint, base64 + gzip. None of those are needed today.

### Agent usage example

```python
import os
import hashlib
import json
import urllib.request

API_KEY = os.environ["BKSTR_API_KEY"]
SLUG = "agent-book-author"

req = urllib.request.Request(
    f"https://bkstr.tmrwgroup.ai/api/skills/{SLUG}/files",
    headers={"Authorization": f"Bearer {API_KEY}"},
)
with urllib.request.urlopen(req) as resp:
    payload = json.load(resp)

# Write to disk, integrity-checking against the per-file sha256
for f in payload["files"]:
    expected = f["sha256"]
    body = f["content"].encode("utf-8")
    actual = hashlib.sha256(body).hexdigest()
    assert actual == expected, f"sha256 mismatch on {f['path']}"
    os.makedirs(os.path.dirname(f["path"]) or ".", exist_ok=True)
    with open(f["path"], "wb") as out:
        out.write(body)
print(f"Wrote {len(payload['files'])} files for skill {payload['skill']['slug']} v{payload['skill']['version']}")
```

### Versioning

No `?version=` parameter in v1. Always returns the latest `ACTIVE` `skill_versions` row. If you need a stable pin (e.g. an agent that wants to redownload exactly v3), file a request — the parameter is trivial to add (`skill_versions_skill_id_version_key` already enforces uniqueness).

---

## GET `/api/skills/{slug}/download`

Returns a freshly re-archived `.zip` of the same files this endpoint returns as JSON. Same auth, same `AccessGrant` gate, same file set. Use for human-driven download flows (browser link). For agent consumption, prefer `/files`.

### Headers

```
Content-Type: application/zip
Content-Disposition: attachment; filename="{slug}-v{version}.zip"
Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
```

### Errors

Same code set as `/files` (`UNAUTHENTICATED`, `ACCESS_DENIED`, `SKILL_NOT_FOUND`, `NO_ACTIVE_VERSION`), since both routes share the `requireSkillAccess` helper.

---

## See also

- `docs/decisions.md` — D18.1 (skills as a separate content class)
- `docs/follow-ups.md` — #122 (this endpoint, resolved); #128 (`fetch_logs.skillId` polymorphism for observability)
- `src/lib/skills/auth.ts` — shared `requireSkillAccess` helper used by both routes
