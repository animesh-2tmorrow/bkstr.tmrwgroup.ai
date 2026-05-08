# bkstr.tmrwgroup.ai — Operations

Operational runbook for tasks that don't fit in the deploy chain. Add new entries when a recurring task needs to be repeatable across operators.

---

## Importing books

The system stores book content in `book_versions.content` (TEXT, populated inline as of Step 7). The import primitive is a CLI script that takes a markdown file and inserts it as a `publisher → book → book_version` chain.

### When to use

- Seeding a fresh environment with a corpus of books
- Adding a new book to an existing publisher
- Updating an existing book with new markdown (creates a new version row; the old version stays for audit / rollback)

### Where to put the source files

`./seed-content/` at the repo root. The directory is tracked in git (via `.gitkeep`); the `.md` files inside it are gitignored (D7.5 — operational test data, may have licensing/attribution concerns we haven't audited, not source code).

### Running the script

```bash
npm run import-book -- \
  --publisher "tmrwgroup" \
  --title "NotebookLM Skill" \
  --domain "skill" \
  --file ./seed-content/notebooklm-skill.md
```

Optional: `--slug <custom-slug>` to override the auto-slugified title.

### Argument shape

| Flag | Required | Description |
|---|---|---|
| `--publisher <name>` | yes | Publisher display name. Slug auto-generated from this — e.g. `"tmrwgroup"` → slug `tmrwgroup`, `"TMRW Group"` → slug `tmrw-group`. **Different inputs produce different rows; getting the publisher name consistent across imports matters.** |
| `--title <title>` | yes | Book title displayed in the dashboard. |
| `--domain <domain>` | yes | Free-text taxonomy tag (e.g. `"skill"`, `"reference"`, `"playbook"`). Shown in the dashboard's `<slug> · <domain>` row metadata. Required so we don't silently accumulate `"general"` placeholder noise. |
| `--file <path>` | yes | Path to a UTF-8 markdown file. Empty files rejected with exit 1. |
| `--slug <slug>` | optional | Overrides the auto-slugified `--title`. Useful when the auto-slug is ugly (e.g. title with lots of punctuation). |

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Success — either a new version was inserted or the import was unchanged (no-op). |
| 1 | Usage error: missing arg, file not found, file empty, slug-after-trim is empty. |
| 2 | DB error or any other unexpected failure. |

### Idempotency contract

The script is safe to re-run. Behavior:

1. Publisher upserted by slug — re-running with the same `--publisher` name reuses the row.
2. Book upserted by `(publisher_id, slug)` — re-running with the same title (or `--slug`) reuses the row, and updates `title` + `domain` if those changed.
3. Latest `book_version`'s `content` is SHA-256-compared against the new file's content. If equal, no-op (logs `unchanged: ... no-op.`). If different, a new `book_version` is inserted with `version = max + 1`.

The "unchanged" path means re-running the script in CI/cron is safe — no version churn from no-op imports.

### content_uri convention

`book_versions.content_uri` is set to `inline://<book_version_id>`. This is intentional placeholder data signaling "content lives in the `content` column, not in S3" (D7.3). The `content_uri` column itself is required NOT NULL by Phase 1's schema; cleanup is filed as follow-up #45 (drop the column or commit to a clean inline-vs-S3 dual-storage model).

### Common operations

**See what's been imported:**
```sql
SELECT p.slug AS publisher, b.slug AS book, b.domain, bv.version,
       length(bv.content) AS content_chars, bv.byte_size, bv.created_at
FROM publishers p
JOIN books b ON b.publisher_id = p.id
JOIN book_versions bv ON bv.book_id = b.id
ORDER BY bv.created_at DESC;
```

**See version history of one book:**
```sql
SELECT bv.version, bv.byte_size, bv.created_at
FROM book_versions bv
JOIN books b ON b.id = bv.book_id
WHERE b.slug = '<book-slug>'
ORDER BY bv.version;
```

**Roll back to a previous version (manual):** there's no built-in rollback — the agent endpoint always serves the latest version. If a rollback is needed, either re-import the older content (creates a new version that's a copy of the old one), or directly `DELETE FROM book_versions WHERE id = <newer-version-id>` once any `fetch_logs` referencing it have been migrated. The `book_version_id` FK on `fetch_logs` is `ON DELETE RESTRICT` — hard delete is blocked while any fetch references the version. Re-import is almost always the right answer.
