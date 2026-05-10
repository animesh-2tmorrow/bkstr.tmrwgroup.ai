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

---

## Migrating book content to S3

Phase 3 Stream 2 (D9.2) moves `book_versions.content` from inline Postgres TEXT to S3-backed storage, with the dual-storage seam keeping both reads functional during the transition. The application code ships ready (`src/lib/storage/book-content.ts` + the agent fetch route's helper call), but the actual data move is an **operator-triggered** action. This runbook covers provisioning, running the migration, and the verification + null-content sweep.

### Fresh-checkout note (for contributors building locally)

A fresh git checkout requires `npx prisma generate` before the first `npm run build` or `npx tsc --noEmit`. The generated client lives at `src/generated/prisma/` and is gitignored, so it doesn't ship in the repo — Prisma regenerates it from `prisma/schema.prisma` on demand. The deploy pipeline already runs `prisma generate` (per Phase 2 deploy chain), so this only matters for fresh local checkouts. Symptom of forgetting: `tsc` fails with `Cannot find module '@/generated/prisma/client'`.

### Prerequisites (one-time, manual AWS console / CLI)

These steps create AWS resources outside the deploy chain. They are NOT automated — running them is a deliberate operator action and the resources persist across deploys. None are part of any commit.

1. **Create the S3 bucket** `bkstr-book-content-049405321468-us-east-1` in `us-east-1` with:
   - Block Public Access: ON (all four switches)
   - Default encryption: SSE-S3 (AES-256, AWS-managed)
   - Versioning: Enabled
   - Lifecycle rule: noncurrent-version expiration after 30 days
   - Tags: `Application=bkstr`, `Environment=production`, `ManagedBy=stream-2`

   ```bash
   aws s3api create-bucket --bucket bkstr-book-content-049405321468-us-east-1 --region us-east-1
   aws s3api put-public-access-block --bucket bkstr-book-content-049405321468-us-east-1 \
     --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
   aws s3api put-bucket-encryption --bucket bkstr-book-content-049405321468-us-east-1 \
     --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
   aws s3api put-bucket-versioning --bucket bkstr-book-content-049405321468-us-east-1 \
     --versioning-configuration Status=Enabled
   aws s3api put-bucket-lifecycle-configuration --bucket bkstr-book-content-049405321468-us-east-1 \
     --lifecycle-configuration '{"Rules":[{"ID":"ExpireNoncurrent30d","Status":"Enabled","Filter":{},"NoncurrentVersionExpiration":{"NoncurrentDays":30}}]}'
   aws s3api put-bucket-tagging --bucket bkstr-book-content-049405321468-us-east-1 \
     --tagging '{"TagSet":[{"Key":"Application","Value":"bkstr"},{"Key":"Environment","Value":"production"},{"Key":"ManagedBy","Value":"stream-2"}]}'
   ```

2. **Attach the inline IAM policy** `bkstr-content-storage` to `bkstr-ec2-role`:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "ReadWriteBookContentObjects",
         "Effect": "Allow",
         "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
         "Resource": "arn:aws:s3:::bkstr-book-content-049405321468-us-east-1/*"
       },
       {
         "Sid": "ListBookContentBucket",
         "Effect": "Allow",
         "Action": "s3:ListBucket",
         "Resource": "arn:aws:s3:::bkstr-book-content-049405321468-us-east-1"
       }
     ]
   }
   ```

   ```bash
   aws iam put-role-policy --role-name bkstr-ec2-role \
     --policy-name bkstr-content-storage \
     --policy-document file://bkstr-content-storage.json
   ```

3. **Stage `/etc/bkstr/aws.env` on EC2** (mode 600 root) via SSM session:

   ```bash
   aws ssm start-session --target i-0e25e88f90738b9dc
   sudo tee /etc/bkstr/aws.env > /dev/null <<'EOF'
   AWS_REGION=us-east-1
   BKSTR_CONTENT_BUCKET=bkstr-book-content-049405321468-us-east-1
   EOF
   sudo chmod 600 /etc/bkstr/aws.env
   sudo chown root:root /etc/bkstr/aws.env
   ```

4. **Verify** from EC2 (still in SSM session) that the instance role can list the bucket:

   ```bash
   aws s3 ls s3://bkstr-book-content-049405321468-us-east-1/  # expect empty success
   aws iam get-role-policy --role-name bkstr-ec2-role --policy-name bkstr-content-storage  # expect the policy doc
   ```

5. **Reload pm2** so the running app picks up `aws.env`:

   ```bash
   sudo -u ubuntu -E pm2 reload bkstr-web --update-env
   pm2 logs bkstr-web --nostream | grep aws.env  # expect "[start.sh] AWS env sourced..."
   ```

   The dual-storage code already deployed will fall back to inline reads (rows still have `content_uri = inline://*`); no S3 calls happen yet.

### Pause book imports

While the migration runs, do NOT run `npm run import-book`. A new row inserted between Sweep 1's row enumeration and the per-row UPDATE would either be missed by the migration (if the script already snapshotted the row list) or doubly migrated (no harm) but then ambiguously logged. At ~5 rows total the window is seconds; pausing is trivial. Resume after Sweep 1's verification clears.

### Sweep 1 — write S3 + set `content_uri`

Run on EC2 via SSM session (preferred — see design doc OQ-4 for venue rationale):

```bash
cd /var/www/bkstr
sudo -u ubuntu -E npm run migrate-content-to-s3 -- --dry-run
```

The dry-run prints every intended PUT + DB UPDATE without performing any. Review the output: bucket name, candidate rows, expected keys.

Then execute:

```bash
sudo -u ubuntu -E npm run migrate-content-to-s3 -- --confirm
```

What it does:

1. Writes a pre-migration snapshot to `migrations/content-to-s3-snapshot-<timestamp>.json` keyed `{ id -> { sha256, byte_size, version, book_id } }` for every candidate row. Keep this file — it is the durable evidence that the S3 objects match the original DB content (Sweep 2 will null the inline column).
2. For each row with `content IS NOT NULL AND content_uri NOT LIKE 's3://%'`:
   - `PutObject` with `ContentType: text/markdown` and `Content-MD5: base64(md5(content))`.
   - `HeadObject` and verify ETag matches the local MD5 (single-part uploads only — content well under 5GB).
   - `UPDATE book_versions SET content_uri = 's3://<bucket>/<key>' WHERE id = $1 AND content_uri NOT LIKE 's3://%'` (idempotent — won't overwrite a row that's already migrated).
3. Prints a summary line and exits non-zero if any row failed.

The script is idempotent: re-running picks up where a partial failure left off. Transient S3 errors (5xx, `SlowDown`, `RequestTimeout`) get one retry with a 1-second sleep. Configuration errors (`AccessDenied`, `NoSuchBucket`, `InvalidAccessKeyId`) abort the whole run.

### Verify Sweep 1

```sql
-- Cardinality: every row should have an s3:// content_uri now.
SELECT COUNT(*) FROM book_versions WHERE content_uri NOT LIKE 's3://%';
-- Expect 0.

-- Each row's content_uri matches the expected key shape.
SELECT id, book_id, content_uri FROM book_versions ORDER BY created_at;
```

```bash
# S3 listing matches DB row count.
aws s3 ls s3://bkstr-book-content-049405321468-us-east-1/books/ --recursive | wc -l

# Sample SHA-256 spot check against the snapshot file.
jq -r 'to_entries[] | "\(.key) \(.value.sha256) \(.value.book_id)"' \
  migrations/content-to-s3-snapshot-*.json | while read id sha book; do
    aws s3 cp "s3://bkstr-book-content-049405321468-us-east-1/books/$book/versions/$id.md" - \
      | sha256sum | awk -v id="$id" -v expected="$sha" '$1==expected{print id" OK"; next}{print id" MISMATCH "$1" vs "expected; exit 1}'
  done
```

```bash
# Round-trip read through the route. served_from=s3 in pm2 logs is the success signal.
curl -s -X POST https://bkstr.tmrwgroup.ai/api/agent/fetch \
  -H "Authorization: Bearer <SUBSCRIBER_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"book_id":"<uuid>","query":"summarize this book"}' \
  -N
pm2 logs bkstr-web --nostream | grep served_from
# Expect: served_from=s3 version_id=<uuid> bytes=<n>
```

If any of those checks fails, **do not proceed to Sweep 2** — the inline `content` column is still the safety net. Re-run Sweep 1 (idempotent) or investigate the specific failure.

### Verification window

Watch production reads for at least 24h (per design A8 step 4). Confirm:
- `pm2 logs` consistently shows `served_from=s3` for every fetch.
- No S3-side errors in CloudWatch or the route's `fetch_logs` table (`status='error'`).
- LLM response shapes unchanged from Phase 2 baseline.

### Sweep 2 — null the inline `content` column

After the verification window, run:

```bash
sudo -u ubuntu -E npm run migrate-content-to-s3 -- --null-content --dry-run
sudo -u ubuntu -E npm run migrate-content-to-s3 -- --null-content --confirm
```

Sweep 2's safety nets:
- Refuses to run if any row still has `content IS NOT NULL AND content_uri NOT LIKE 's3://%'`. That state means Sweep 1 missed a row.
- Spot-checks the first 3 S3-backed rows by `GetObject`-ing them, refusing if the read fails. Catches the failure mode "Sweep 1 reported success but the IAM role lost GetObject permission since."
- Then `UPDATE book_versions SET content = NULL WHERE content_uri LIKE 's3://%' AND content IS NOT NULL`.

Reversible: re-import the affected book (creates a new version with inline content), or restore from a Postgres backup. Not common; the snapshot file from Sweep 1 is the more accessible recovery path for content-byte-equality verification.

### Resume book imports

After Sweep 2 verifies, `npm run import-book` is safe to run again. Note that import-book still writes inline content + `content_uri = inline://<id>`; converting import-book to write directly to S3 is filed as a separate piece of work (design A8 step 5; Phase 4-tail).
