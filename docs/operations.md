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

---

## SEED grants and the checkout-block rule (D10.2)

**SEED grants are operator-only.** Do **not** insert `INSERT INTO access_grants ... source='SEED'` rows for real subscribers casually — per [D10.2](./phase-3-decisions.md#d102--checkout-dedup-blocks-any-active-access_grant-regardless-of-source), any active `access_grant` blocks Stripe Checkout Session creation regardless of source, so a misplaced `SEED` grant will prevent legitimate purchases (the subscriber gets HTTP 409 from `POST /api/checkout` with `{ source: 'SEED' }` until the SEED row is removed or revoked).

`SEED`'s only sanctioned uses are:

1. **Grandfathered backfills.** The Phase 3 Stream 1 patch (D9.6) inserted 15 SEED rows — one per `(subscriber, book)` pair that existed before per-book authorization was enforced. That's a known, deliberate, one-time backfill.
2. **Test data in dev/staging only.** Local seed scripts may create SEED grants to bypass the Stripe sandbox.

For real production grants from operator action (manual unlock, support escalation, comp), use `source='MANUAL'` and populate `granted_by` with the operator's `users.id`. To unblock a Checkout that's wrongly 409'ing because of a SEED row, either:

- Soft-revoke: `UPDATE access_grants SET revoked_at = NOW() WHERE subscriber_id = ? AND book_id = ? AND source = 'SEED';` — preserves the audit trail.
- Hard-delete: `DELETE FROM access_grants WHERE subscriber_id = ? AND book_id = ? AND source = 'SEED';` — only when the grant should never have existed.

The 15 backfilled rows are intentional. Do not bulk-revoke them without separately confirming each subscriber has paid (or has another `MANUAL`/`SUBSCRIPTION` grant).

---

## Stripe webhook setup runbook

Stream 3's Stripe integration relies on the webhook endpoint at `POST /api/webhooks/stripe` receiving and verifying Stripe events. Configuration lives entirely in the Stripe Dashboard — there's nothing to flip in our codebase. Re-run this runbook whenever an environment is rotated, the webhook signing secret is leaked, or the public origin changes.

### One-time per environment

1. **Pick the Stripe account.** Phase 3 OQ-1 — existing `tmrwgroup` account or new dedicated `bkstr` account. **Operator decision required before staging keys.** This decision is sticky: once Customer/Product/Price objects exist in one account, migrating them is a manual rebuild.
2. **Open the Stripe Dashboard webhook page** for the chosen account, in the right mode:
   - Test mode: <https://dashboard.stripe.com/test/webhooks>
   - Live mode: <https://dashboard.stripe.com/webhooks>
3. **Add a new endpoint** with URL `https://bkstr.tmrwgroup.ai/api/webhooks/stripe` (production) or your dev tunnel URL for local. Do not use `localhost:3000` directly; Stripe needs a public HTTPS URL. Use Stripe CLI (`stripe listen --forward-to localhost:3000/api/webhooks/stripe`) for local development — the CLI prints a one-time webhook signing secret that you put in your local `.env`.
4. **Subscribe to event types** — minimal Phase 3 Stream 3 set:
   - `payment_intent.succeeded` — the only event with a handler today; provisions the `access_grant`.
   - (Future, no handler yet but enabling them now gives early signal in `webhook_events`): `payment_intent.payment_failed`, `charge.refunded`, `checkout.session.completed`.
5. **Copy the signing secret** (`whsec_…`) shown after endpoint creation. This is the **only** time Stripe shows it; rotate by deleting and recreating the endpoint.
6. **Stage the secret on EC2** in `/etc/bkstr/stripe.env`:
   ```bash
   sudo tee /etc/bkstr/stripe.env <<'EOF'
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_PUBLISHABLE_KEY=pk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   EOF
   sudo chmod 600 /etc/bkstr/stripe.env
   sudo chown root:root /etc/bkstr/stripe.env
   ```
   `scripts/start.sh` sources this file at deploy time; for an immediate reload without redeploying, run `sudo -u ubuntu pm2 reload bkstr-web --update-env` (the env vars must already be in the shell that runs that command — easiest to invoke through `start.sh`'s logic).

### Sanity checks after staging

- **Pm2 logs at boot:** `pm2 logs bkstr-web | grep -i stripe` should show `[start.sh] Stripe env sourced from /etc/bkstr/stripe.env (keys: ...)` rather than `WARN: /etc/bkstr/stripe.env not present`.
- **Send a test event from Stripe Dashboard.** Endpoint → Send test webhook → pick `payment_intent.succeeded`. Stripe shows the response code; we want **200**. If you see **400 Invalid signature**, the `STRIPE_WEBHOOK_SECRET` doesn't match the endpoint — re-copy from Dashboard.
- **Verify the row landed:** `SELECT event_id, source, status, processed_at FROM webhook_events ORDER BY received_at DESC LIMIT 5;` should show the test event with `status='processed'`.

### Day-to-day operation

- **Stuck handler diagnosis:** `SELECT event_id, status, error_message, received_at FROM webhook_events WHERE status = 'error' ORDER BY received_at DESC;` — these rows are events that hit our handler but threw. Stripe will retry on its own schedule; you can also force a retry from the Dashboard endpoint page. After fixing the underlying issue, the next retry transitions the row to `processed`.
- **Replaying a missed event:** Stripe Dashboard → Endpoint → Events → individual event → Resend.
- **Webhook IP allowlisting:** **NOT** wired into nginx today (per design OQ-11). Signature verification is the security primitive; IP allowlist would be a defense-in-depth layer for Phase 4 if log-noise from spam POSTs becomes an issue.

---

## Stripe pricing sync

Pricing is operator-managed via the dashboard at `/dashboard/pricing` (ADMIN-only). The form lets an admin set or change USD pricing per book. Submitting the form:

1. Searches Stripe for an existing Product with `metadata.book_id = <bookId>`. If absent, creates one with `name = book.title` + that metadata.
2. Creates a fresh Stripe Price object (Stripe Prices are immutable; every change is a new Price).
3. Upserts the local `book_prices` row, repointing `stripe_price_id` at the new Price.

Old Price objects stay alive in Stripe — they're the audit trail per D9.7. Do not delete them via the Stripe Dashboard unless you're certain no historical Checkout Session, refund report, or analytics dashboard references them.

For one-off pricing changes outside the dashboard (CSV import, scripted bulk update), the SQL path is `INSERT … ON CONFLICT (book_id, currency) DO UPDATE SET unit_amount_cents = …, stripe_price_id = …, updated_at = NOW();` — but the operator is responsible for separately creating the matching Stripe Price object so `stripe_price_id` points somewhere real. Easier and less error-prone to use the UI.

---

## Roles env file (`/etc/bkstr/roles.env`)

Phase 4 Stream D replaces the Phase 2 OAuth allowlist (D8.1–D8.4) with an env-driven role-promotion model. Signup is open — any Google identity that completes OAuth gets a `users` row with the schema default `role = SUBSCRIBER`. Identities listed in `/etc/bkstr/roles.env` are auto-promoted to `ADMIN` or `PUBLISHER` on signin. See [D11.5](./phase-4-decisions.md#d115--pre-stage-etcbkstrrolesenv-before-stream-d-deploys), [D11.6](./phase-4-decisions.md#d116--role-grant-env-lives-in-its-own-file-etcbkstrrolesenv-not-folded-into-oauthenv), and [D11.11](./phase-4-decisions.md#d1111--monotonic-upward-role-promotion-env-absence-is-a-no-op-demotion-only-via-explicit-admin-sql) for the decision rationale.

### File location, mode, owner

- **Path:** `/etc/bkstr/roles.env`
- **Mode:** `600`
- **Owner:** `root:root`
- **Sourced by:** `scripts/start.sh` at app start, via the per-service `[ -f /etc/bkstr/roles.env ] && source …` block above the D10.3 marker. Absence is tolerated and logged: `[start.sh] WARN: /etc/bkstr/roles.env not present — role auto-promotion disabled; existing roles preserved.`

### Format

`KEY=value`, one per line, no quotes, no `export` prefix, no shell expansion. Empty trailing lines fine. Two keys are read by the app today:

```
ADMIN_EMAILS=animesh@2tmorrow.com
PUBLISHER_EMAILS=edward@tmrwgroup.ai,zach@tmrwgroup.ai
```

Both values are comma-separated, trimmed, lowercased by the app's `parseList` helper. Spacing around commas is tolerated. Capitalization in the file is tolerated (`Edward@TmrwGroup.AI` matches `edward@tmrwgroup.ai`).

### Adding an email (promote a user to ADMIN or PUBLISHER)

1. Open an SSM session to the EC2 box:
   ```bash
   aws ssm start-session --target i-0e25e88f90738b9dc
   ```
2. Edit the file:
   ```bash
   sudo nano /etc/bkstr/roles.env
   ```
   Add the new email to the appropriate comma-separated list. Preserve the `600 root:root` mode (sudo nano keeps it).
3. Reload pm2 so the running process picks up the new env vars:
   ```bash
   sudo -u ubuntu -E pm2 reload bkstr-web --update-env
   ```
   The `--update-env` flag is critical — without it, pm2 reuses the env captured at the original `pm2 start` invocation and the new env vars never reach the Node process. (Mechanics match the [Stripe webhook setup runbook](#stripe-webhook-setup-runbook) above; same `pm2 reload --update-env` rationale.)
4. **Verify the env reached the app:**
   ```bash
   pm2 logs bkstr-web --nostream | grep "Roles env sourced"
   ```
   Expect: `[start.sh] Roles env sourced from /etc/bkstr/roles.env (keys: ADMIN_EMAILS PUBLISHER_EMAILS )`.
5. **Verify the promotion fires:** ask the target user to sign in (or sign out + back in if they have an existing session). On the signin event, `events.signIn` in `src/lib/auth/index.ts` calls `syncRoleFromEnv`, reads the env, and `UPDATE users SET role = …` for the matching email. Database-strategy sessions refetch the user row every request, so the promoted role takes effect on the next page load without requiring sign-out.
6. Confirm via SQL:
   ```sql
   SELECT email, role FROM users WHERE email IN ('<the-email>');
   ```

### Removing an email (intent: revoke ADMIN or PUBLISHER)

**Important:** removing an email from `/etc/bkstr/roles.env` does **NOT** demote the user. D11.11's monotonic-upward invariant is intentional — env absence is a no-op, never a demotion. Demotion is an explicit, two-step operator action:

1. Remove the email from the relevant list in `/etc/bkstr/roles.env` (same edit + reload sequence as the "Adding" path above). This prevents the user from being **re-promoted** on a future signin.
2. **AND** explicitly demote them in the DB:
   ```bash
   psql "$DATABASE_URL" -c "UPDATE users SET role = 'SUBSCRIBER' WHERE email = '<the-email>';"
   ```
   (If your `DATABASE_URL` carries `?schema=public`, strip that for raw psql per [follow-up #47](./follow-ups.md#47-docsoperationsmd-should-document-env-source-prerequisite--prisma-vs-psql-url-format).)

If you only do step 1 (remove from env), nothing changes for the user — the role-sync hook sees no env match → no-op → the existing DB role is preserved. If you only do step 2 (SQL demote) without removing from env, the user is re-promoted on their very next signin. Both steps are required.

### Why no demotion-via-env-removal? (D11.11 invariant)

The symmetric design (env presence promotes, env removal demotes) was considered and rejected. The three failure modes that informed the decision:

1. **ADMIN auto-demotion catastrophe.** A missing or empty `/etc/bkstr/roles.env` (fresh box, deleted file, typo in `start.sh`) under symmetric semantics would demote every ADMIN to SUBSCRIBER on their next signin, locking the operator out of pricing / moderation surfaces. The asymmetric design (env-presence-promotes, env-absence-is-no-op) makes this failure mode impossible by construction.
2. **Silent publisher-attribution drift.** Removing a publisher's email under symmetric semantics flips their role but leaves their `book.publisher_user_id` attributions unchanged. The PUBLISHER now can't manage books they're still attributed to. Forcing the demotion to be explicit forces the operator to consider the attribution implications.
3. **`pm2 reload` race.** A brief window during a reload where env vars are unset (between processes) could trigger a wave of demotions if a signin lands in that window. The asymmetric design eliminates the race.

See [D11.11](./phase-4-decisions.md#d1111--monotonic-upward-role-promotion-env-absence-is-a-no-op-demotion-only-via-explicit-admin-sql) for full reasoning.

### What if I want to bulk-promote a list of publishers?

Edit `/etc/bkstr/roles.env`, append the new emails to `PUBLISHER_EMAILS`, reload pm2 (same sequence as "Adding"). All users in the new list will be promoted on their next individual signins — there is no bulk-resync command, by design (per-signin is the only re-sync trigger). If a publisher needs to be promoted *before* their next signin (e.g. they're already logged in and you don't want to wait), have them sign out + back in, or run the SQL UPDATE directly:

```bash
psql "$DATABASE_URL" -c "UPDATE users SET role = 'PUBLISHER' WHERE email = '<the-email>' AND role = 'SUBSCRIBER';"
```

(The `AND role = 'SUBSCRIBER'` guard preserves the monotonic-upward semantic — an existing ADMIN won't be downgraded by a fat-fingered manual UPDATE.)

### Recovering from a misplaced demotion

If `UPDATE users SET role='SUBSCRIBER'` was run against the wrong user, recovery is symmetric: `UPDATE users SET role='ADMIN' WHERE email='…'`. The role column carries no history; for an audit trail of role mutations performed via `/dashboard/admin/users` (Stream E) or the supporting API, query `admin_actions` — see "Querying admin_actions via psql" near the bottom of this document. Note that the audit table only captures mutations that flow through the Phase 4.5 admin UI / API surfaces; raw SQL `UPDATE users SET role=…` runs OUTSIDE that path and therefore writes NO `admin_actions` row. The `webhook_events` table is unrelated and won't help.

If the only ADMIN was accidentally demoted: provided their email is still in `ADMIN_EMAILS` in `/etc/bkstr/roles.env`, they'll be re-promoted automatically on their next signin (D11.11 rule 1, env presence promotes). If their email isn't in the file, re-add it, reload pm2, ask them to sign in. If the file itself is missing, restore it (the contents are operator-stable across deploys; the canonical values are recorded in this runbook and in the deploy decision log).

---

## ADMIN-as-seed-owner — temporary publisher attribution for the 5 seed books (2026-05-11)

**Current live state:** all 5 existing seed books are attributed to `animesh@2tmorrow.com` (user_id `588615d8-c2e7-4808-9e9b-997ba09e6cbd`, role=ADMIN) via `book.publisher_user_id`, with matching `PUBLISHER_OWN`-source `access_grants` rows on ADMIN's subscriber row (`sub_id=588615d8…`). This was an explicit operator action on 2026-05-11, triggered when `/dashboard/library` showed empty because:

1. The 5 seed books were `status='DRAFT'` (the schema default; `import-book.ts` never sets ACTIVE). Stream C's Library route filters `status='ACTIVE'`. **Fix:** `UPDATE books SET status='ACTIVE' WHERE status='DRAFT'`.
2. Stream A's Part-2 backfill deferred (Edward had not signed in), so `publisher_user_id` was NULL on every row. The Library doesn't filter on that, but the ownership model expected non-NULL. **Fix:** the SQL block under "Reassign seed books later" below was run with ADMIN's user_id as the temporary owner.

ADMIN-as-seed-owner is a deliberate temporary state until Edward + Zach sign in and the planned ownership model lands (Edward owns all 5 seed books per design Q1 / D11.10). The state is harmless: ADMIN-as-publisher just means the "Pricing" surface shows the 5 books to ADMIN, which is the same behavior they had before Phase 4 (ADMIN-sees-all).

### Reassign seed books later

When Edward signs in (creates a `users` row with `email='edward@tmrwgroup.ai'`), run this SQL to move ownership from ADMIN to Edward and re-issue the PUBLISHER_OWN grants. Soft-revoke ADMIN's old grants for audit-trail preservation rather than hard-delete.

```sql
BEGIN;

-- Move book ownership
UPDATE books
   SET publisher_user_id = (SELECT id FROM users WHERE email = 'edward@tmrwgroup.ai')
 WHERE publisher_user_id = '588615d8-c2e7-4808-9e9b-997ba09e6cbd';

-- Soft-revoke ADMIN's stale PUBLISHER_OWN grants
UPDATE access_grants
   SET revoked_at = NOW()
 WHERE source = 'PUBLISHER_OWN'
   AND subscriber_id = (SELECT s.id FROM subscribers s JOIN users u ON u.id = s.user_id WHERE u.email = 'animesh@2tmorrow.com')
   AND revoked_at IS NULL;

-- Issue fresh PUBLISHER_OWN grants to Edward
INSERT INTO access_grants (id, subscriber_id, book_id, source, granted_at)
SELECT gen_random_uuid(),
       (SELECT s.id FROM subscribers s JOIN users u ON u.id = s.user_id WHERE u.email = 'edward@tmrwgroup.ai'),
       b.id,
       'PUBLISHER_OWN'::"GrantSource",
       NOW()
  FROM books b
 WHERE b.publisher_user_id = (SELECT id FROM users WHERE email = 'edward@tmrwgroup.ai')
    ON CONFLICT (subscriber_id, book_id, source) DO NOTHING;

COMMIT;
```

After running, ADMIN keeps role=ADMIN (independent of any grant changes) and loses the PUBLISHER_OWN grant rows (they're revoked, not deleted — searchable via `SELECT * FROM access_grants WHERE revoked_at IS NOT NULL`). Edward gets fresh PUBLISHER_OWN grants and shows up as the books' publisher in `/dashboard/pricing` and `/dashboard/library`.

The same shape applies to Zach with `zach@tmrwgroup.ai` — but only for books explicitly intended to be Zach's (none of the 5 seed books per D11.10; Zach's books are first-class new-book creations via Stream B).

---

## Phase 4.5 — Edward / Zach publisher backfill (original migration path; partly superseded by ADMIN-as-seed-owner above)

Phase 4 Stream A's migration `20260511120100_phase_4_schema_part_2_backfill` carries a conditional `DO $$ … $$` block that assigns `book.publisher_user_id` to Edward and creates a `PUBLISHER_OWN`-source `access_grants` row per book. The block runs at migration-deploy time. If Edward (`edward@tmrwgroup.ai`) has not yet signed in when the migration deploys, the DO block hits an `IF edward_id IS NULL THEN RAISE NOTICE … RETURN` branch and books stay unattributed. **However:** on 2026-05-11 the operator opted to attribute books to ADMIN as a temporary state (see "ADMIN-as-seed-owner" section above) rather than wait for Edward. The migration's DO block is therefore no longer the canonical path forward — once Edward signs in, run the "Reassign seed books later" SQL from the ADMIN-as-seed-owner section instead, which handles the existing ADMIN-as-owner state correctly. The block below remains accurate as a runbook for the no-ADMIN-as-seed-owner scenario, but does not apply to the live bkstr DB as of 2026-05-11.

Zach is intentionally NOT in the automated backfill (per D11.10 — Edward owns all 5 existing seed books). When Zach's email lands, his books are first-class new-book creations via Stream B's `/dashboard/books/new` form. If a future operator decision reassigns existing books to Zach, hand-edit a fresh SQL patch — do not extend the migration's DO block (the migration is immutable history once deployed).

### When to run this runbook

The DO block returned at the `RAISE NOTICE 'Phase 4 Stream A: edward@tmrwgroup.ai not yet in users; publisher backfill deferred…'` branch. Verify by checking pm2 logs from the Stream A deploy:

```bash
pm2 logs bkstr-web --nostream | grep "Phase 4 Stream A"
```

Or by querying directly — every book row carries `publisher_user_id IS NULL` post-deploy:

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) AS unattributed_books FROM books WHERE publisher_user_id IS NULL;"
```

If `unattributed_books > 0` AND Edward exists in `users`, this runbook applies. Skip the runbook if `unattributed_books = 0` (the migration completed the backfill successfully on the first try).

### Step 0 — Confirm Edward has signed in

```bash
psql "$DATABASE_URL" -c "SELECT id, email, role, created_at FROM users WHERE email = 'edward@tmrwgroup.ai';"
```

Expected: one row. If empty → Edward has not signed in yet, and re-running the DO block now will hit the same `IF edward_id IS NULL` branch and no-op. Wait for him to sign in (or chase him to do so), then re-run Step 0 before proceeding.

Also confirm his `subscribers` row exists (the auto-creation in `src/lib/auth/index.ts:154`):

```bash
psql "$DATABASE_URL" -c "SELECT s.id, s.company_name, s.email FROM subscribers s JOIN users u ON u.id = s.user_id WHERE u.email = 'edward@tmrwgroup.ai';"
```

Expected: one row. If empty → the auto-creation may have failed (rare; would also have surfaced as a signin error in pm2 logs). Run the DO block anyway — it sets `publisher_user_id` on books and defers `PUBLISHER_OWN` access_grants per its inner `IF edward_sub_id IS NOT NULL` guard.

### Step 1 — Re-run the DO block

The DO block is preserved verbatim in `prisma/migrations/20260511120100_phase_4_schema_part_2_backfill/migration.sql`. Operator can either copy it from that file or paste the block below directly. The DO block is idempotent via `ON CONFLICT DO NOTHING` on the (subscriber_id, book_id, source) unique index — re-running after partial success is safe.

```bash
psql "$DATABASE_URL" <<'SQL'
DO $$
DECLARE
  edward_id     UUID;
  edward_sub_id UUID;
  books_updated INT := 0;
  grants_made   INT := 0;
BEGIN
  SELECT "id" INTO edward_id FROM "users" WHERE "email" = 'edward@tmrwgroup.ai';
  IF edward_id IS NULL THEN
    RAISE NOTICE 'Phase 4 Stream A: edward@tmrwgroup.ai not yet in users; publisher backfill deferred.';
    RETURN;
  END IF;

  SELECT "id" INTO edward_sub_id FROM "subscribers" WHERE "user_id" = edward_id;
  IF edward_sub_id IS NULL THEN
    RAISE NOTICE 'Phase 4 Stream A: edward user row exists but no subscribers row; PUBLISHER_OWN grants deferred.';
  END IF;

  UPDATE "books" SET "publisher_user_id" = edward_id WHERE "publisher_user_id" IS NULL;
  GET DIAGNOSTICS books_updated = ROW_COUNT;
  RAISE NOTICE 'Phase 4 Stream A: assigned % book(s) to edward@tmrwgroup.ai', books_updated;

  IF edward_sub_id IS NOT NULL THEN
    INSERT INTO "access_grants" ("id", "subscriber_id", "book_id", "source", "granted_at")
    SELECT gen_random_uuid(), edward_sub_id, b."id", 'PUBLISHER_OWN'::"GrantSource", CURRENT_TIMESTAMP
      FROM "books" b
     WHERE b."publisher_user_id" = edward_id
        ON CONFLICT ("subscriber_id", "book_id", "source") DO NOTHING;
    GET DIAGNOSTICS grants_made = ROW_COUNT;
    RAISE NOTICE 'Phase 4 Stream A: created % PUBLISHER_OWN grant(s) for edward@tmrwgroup.ai', grants_made;
  END IF;
END $$;
SQL
```

Expected `NOTICE` output for the typical case (Edward signed in, subscribers row exists, books still unattributed):
```
NOTICE:  Phase 4 Stream A: assigned 5 book(s) to edward@tmrwgroup.ai
NOTICE:  Phase 4 Stream A: created 5 PUBLISHER_OWN grant(s) for edward@tmrwgroup.ai
```

If re-running after partial success, the `ON CONFLICT` clause swallows duplicate grants and the UPDATE only touches rows still NULL — the counts may be lower (or zero) on the second run.

### Step 2 — Verify the backfill

```bash
psql "$DATABASE_URL" <<'SQL'
-- Every book has a publisher_user_id.
SELECT COUNT(*) AS unattributed_books FROM books WHERE publisher_user_id IS NULL;
-- Expected: 0

-- Every book has a corresponding PUBLISHER_OWN grant for Edward.
SELECT COUNT(*) AS publisher_own_grants
FROM access_grants ag
JOIN subscribers s ON s.id = ag.subscriber_id
JOIN users u       ON u.id = s.user_id
WHERE ag.source = 'PUBLISHER_OWN' AND u.email = 'edward@tmrwgroup.ai';
-- Expected: 5

-- Spot-check: book slug + publisher email pair.
SELECT b.slug, u.email
FROM books b
JOIN users u ON u.id = b.publisher_user_id
ORDER BY b.slug;
-- Expected: 5 rows, all u.email = edward@tmrwgroup.ai
```

### Step 3 — Schedule the NOT NULL tightening

Per [follow-up #68](./follow-ups.md#68-tighten-bookpublisher_user_id-to-not-null-after-phase-4-backfill-completes), once `SELECT COUNT(*) FROM books WHERE publisher_user_id IS NULL` returns 0 AND Stream B has been smoke-tested with at least one operator-driven new-book upload (so the form's `publisher_user_id = session.user.id` write is verified), open a follow-on migration:

```sql
ALTER TABLE "books" ALTER COLUMN "publisher_user_id" SET NOT NULL;
```

Paired with the same one-line tightening on `book.description` if/when the invariant becomes "every book has prose description." Both columns currently ship nullable per D11.10. The tightening is one-line per column and runs in seconds against the production corpus.

The publisher_user_id FK's `ON DELETE` clause stays at `SET NULL` even after the NOT NULL flip — the rationale being that a publisher User deletion shouldn't cascade-delete their books (which may have buyers via access_grants). If the publisher_user_id is briefly null during such a delete, a follow-up reassignment task lifts the column back to non-null. The schema invariant in steady-state is "publisher_user_id is non-null" without precluding the rare publisher-User-deletion path.

### When Zach onboards (and any future publisher)

Stream B's `/dashboard/books/new` form is the canonical path. The form writes `publisher_user_id = session.user.id` server-side per the route's auth gate, and the inline `prisma.$transaction` inserts the matching `access_grants` row with `source = 'PUBLISHER_OWN'` (mirror of this runbook's DO block, but per-book at create time). No manual SQL needed for new books once Stream B has shipped.

If a stakeholder wants to retroactively reassign EXISTING books to a different publisher (e.g. some of Edward's seed books are actually Zach's), hand-edit:

```sql
UPDATE "books" SET "publisher_user_id" = (SELECT id FROM users WHERE email = 'zach@tmrwgroup.ai')
 WHERE slug IN ('<zach-book-1>', '<zach-book-2>');

-- Also issue the matching PUBLISHER_OWN grants for Zach
INSERT INTO "access_grants" ("id", "subscriber_id", "book_id", "source", "granted_at")
SELECT gen_random_uuid(), s.id, b.id, 'PUBLISHER_OWN'::"GrantSource", CURRENT_TIMESTAMP
  FROM "books" b
  JOIN "subscribers" s ON s.user_id = b.publisher_user_id
 WHERE b.publisher_user_id = (SELECT id FROM users WHERE email = 'zach@tmrwgroup.ai')
    ON CONFLICT ("subscriber_id", "book_id", "source") DO NOTHING;

-- Optional: revoke Edward's now-stale PUBLISHER_OWN grants for those books.
-- Stream A's design keeps revoked rows for audit; revoke rather than delete.
UPDATE "access_grants" SET "revoked_at" = NOW()
 WHERE source = 'PUBLISHER_OWN'
   AND book_id IN (SELECT id FROM books WHERE slug IN ('<zach-book-1>', '<zach-book-2>'))
   AND subscriber_id = (SELECT s.id FROM subscribers s JOIN users u ON u.id = s.user_id WHERE u.email = 'edward@tmrwgroup.ai');
```

Run via psql in a single transaction (`BEGIN; … COMMIT;`) so a mid-step failure doesn't leave Zach's books partially assigned. Document the reassignment in a dated note appended to this runbook section.

---

## Stream B — new book published with Stripe Product/Price success but local TX failure (CC-9 partial-failure recovery)

Stream B's `POST /api/books/new` is Stripe-first per [D11.7](./phase-4-decisions.md#d117--stream-bs-new-book-post-stripe-first--manual-reconcile-logged-here-for-visibility) (and [CC-9](../../AI-Agents/phase-4-design.md) in the design doc). The handler creates a Stripe Product, then a Stripe Price, THEN opens a `prisma.$transaction` that inserts Book + BookVersion + BookPrice + AccessGrant. If the local transaction fails (constraint violation, transient DB issue, etc.) AFTER Stripe succeeded, the request returns 500 with the orphan Stripe IDs surfaced in the JSON body and a copy of this runbook reference. The publisher sees an in-form error message; the orphan Stripe Product + Price persist in Stripe but reference a `book_id` UUID that doesn't exist locally.

### Symptoms

- The publisher reports "Publishing failed" but they CAN sign in and the book is NOT in their /dashboard/library row set.
- `pm2 logs bkstr-web` contains a line shaped: `[books/new] Local TX failed AFTER Stripe Product+Price created. ORPHAN Stripe IDs: product=prod_… price=price_…. metadata.book_slug=<slug>.`
- The JSON response that came back to the form carries `orphanStripeProductId` and `orphanStripePriceId` fields.

### Step 1 — Identify the orphan in Stripe

The orphan Stripe Product carries `metadata.book_slug = <slug>` (the slug the publisher attempted to use). Either:

- **From the pm2 log line:** read the `product=prod_…` and `price=price_…` values directly.
- **From Stripe Dashboard search:** Dashboard → Products → search filter `metadata['book_slug']:'<slug>'`. The orphan will be the only Product with that slug AND no corresponding local Book row.
- **From CLI:** `stripe products search --query "metadata['book_slug']:'<slug>'"`.

Cross-check against the local DB to confirm the orphan is truly orphaned:

```sql
SELECT b.id, b.slug, bp.stripe_price_id
  FROM books b
  LEFT JOIN book_prices bp ON bp.book_id = b.id AND bp.currency = 'USD'
 WHERE b.slug = '<slug>';
```

Expected: zero rows. If you see one row, the local TX actually succeeded — the orphan is NOT orphaned; do NOT delete. Investigate why the response surfaced an orphan claim (likely a transient error AFTER the TX committed; the row is fine to use as-is).

### Step 2 — Decide: retry vs delete

Two recovery paths, picked by the operator based on whether the publisher still wants this book at this slug:

**Path A — Publisher retries the form (preferred).** The slug-collision pre-check in `POST /api/books/new` only consults the LOCAL DB, not Stripe. So a retry will hit step 5 (slug uniqueness), find no local row, and continue. The Stripe Product creation at step 7 creates a SECOND orphan with the same `metadata.book_slug` — Stripe permits this. Result: two Stripe Products with the same `book_slug` metadata, one orphan + one linked to the new local Book. Operator deletes the orphan via Step 3 below. Path A is the canonical recovery; the publisher does not need to know about the orphan.

> NOTE: a future hardening pass could change step 7 to search Stripe by `metadata.book_slug` and reuse an orphan Product if one exists. Not done today — D11.7's "manual reconcile is fine at publisher-write volume" trade-off.

**Path B — Publisher abandons the book.** Operator deletes the orphan Product via Step 3 below. The slug becomes free in Stripe (no `metadata.book_slug` constraint blocks reuse).

### Step 3 — Delete the orphan Stripe Product

Stripe Prices are NOT deletable (immutable per D9.7). Stripe Products are deletable only if no active Prices exist on them. So the operator must first archive the Price, then delete the Product.

Dashboard path:

1. Dashboard → Products → click the orphan Product.
2. The Prices tab → archive the Price (Stripe permits archiving even with no charges).
3. Back on the Product → Archive Product (or Delete if Stripe shows the option after the Price archive).

CLI path:

```bash
stripe prices update <price_id> --active=false
stripe products delete <product_id>
```

If Stripe rejects the Product delete with "active prices exist," that's the archive step missing — re-run the price update with `--active=false` and retry the product delete. Stripe permits hard-delete only on Products with zero active Prices.

### Step 4 — When NOT to delete

- **The local TX succeeded.** Step 1's SQL check found a row. Leave Stripe alone; the orphan claim was spurious.
- **The Product has other Prices not tied to the failed attempt.** Unlikely with Stream B's flow (each create makes a fresh Product), but worth checking the Prices list — if there are multiple, only archive the one whose `metadata.book_slug` matches the failed slug AND whose `created` timestamp is close to the failure window.
- **You're not sure.** Better to leave the orphan than to delete a Product a buyer's Checkout might still reference. Stripe orphan Products are invisible to buyers (nothing links to them) and have no operational cost beyond Dashboard noise.

### Audit trail

Append a dated note to this runbook section with the orphan IDs and the resolution path taken. Stream B's stakeholder review uses this trail to calibrate whether the "best-effort + manual reconcile" trade-off (D11.7) needs to escalate to a saga or outbox pattern.

---

## Stream B — publisher cannot see their books in /dashboard/pricing

Stream B's `/dashboard/pricing` filters by `book.publisher_user_id = session.user.id` when the caller's role is PUBLISHER (see `getPricingBooks` in `src/lib/dashboard/queries.ts`). If a publisher reports "I don't see any of my books on the Pricing tab," the filter is the suspect. ADMIN sees every book; SUBSCRIBER is redirected before reaching the page.

### Step 1 — Confirm role

```bash
psql "$DATABASE_URL" -c "SELECT id, email, role FROM users WHERE email = '<publisher-email>';"
```

Expected: one row, `role='PUBLISHER'`. If `role='SUBSCRIBER'`, the page redirects to `/dashboard` — the publisher reports it as "the link doesn't work." Fix: stage the email in `/etc/bkstr/roles.env` and ask the user to sign in again (D11.5 / D11.11 — see the Roles env file runbook above).

### Step 2 — Confirm publisher_user_id on the missing book(s)

```bash
psql "$DATABASE_URL" -c "SELECT id, slug, title, publisher_user_id FROM books WHERE slug = '<slug>';"
```

Two failure modes:

- **`publisher_user_id` is NULL.** The book has not been attributed to any publisher. Either Stream A's backfill didn't run for this book (rare; the migration's DO block scans every existing row) OR the book was created outside Stream B's `POST /api/books/new` (e.g. `npm run import-book`, which does NOT set `publisher_user_id`). Fix: assign manually.

  ```bash
  psql "$DATABASE_URL" -c "UPDATE books SET publisher_user_id = (SELECT id FROM users WHERE email = '<publisher-email>') WHERE slug = '<slug>';"
  ```

  After the UPDATE, also seed the matching `PUBLISHER_OWN` grant so the publisher can read their own book through the (eventual) `ENFORCE_BOOK_ACCESS` enforcement path:

  ```bash
  psql "$DATABASE_URL" <<'SQL'
  INSERT INTO "access_grants" ("id", "subscriber_id", "book_id", "source", "granted_at")
  SELECT gen_random_uuid(), s.id, b.id, 'PUBLISHER_OWN'::"GrantSource", CURRENT_TIMESTAMP
    FROM "books" b
    JOIN "subscribers" s ON s.user_id = b.publisher_user_id
   WHERE b.slug = '<slug>'
   ON CONFLICT ("subscriber_id", "book_id", "source") DO NOTHING;
  SQL
  ```

- **`publisher_user_id` is non-NULL but belongs to a different user.** Mis-attribution. Either the book was created by a different publisher, or Stream A's backfill picked up the wrong owner. Fix: same `UPDATE books SET publisher_user_id = …` as above. Then revoke the prior owner's stale `PUBLISHER_OWN` grant (audit trail preserved per D9.6's soft-revoke convention; do not hard-delete):

  ```bash
  psql "$DATABASE_URL" <<'SQL'
  UPDATE "access_grants"
     SET "revoked_at" = NOW()
   WHERE source = 'PUBLISHER_OWN'
     AND book_id = (SELECT id FROM books WHERE slug = '<slug>')
     AND subscriber_id = (SELECT s.id FROM subscribers s JOIN users u ON u.id = s.user_id WHERE u.email = '<prior-owner-email>');
  SQL
  ```

  Then INSERT a fresh `PUBLISHER_OWN` grant for the new owner (same SQL as the NULL branch above).

### Step 3 — Confirm the publisher's signed-in user.id matches

```bash
psql "$DATABASE_URL" -c "SELECT u.id, u.email FROM users u WHERE u.id = (SELECT publisher_user_id FROM books WHERE slug = '<slug>');"
```

If the email returned matches the publisher who reported "I can't see my book," the fix has landed. Ask the publisher to refresh `/dashboard/pricing`; the book should now appear in the list.

### Step 4 — If the symptom persists

- Did the publisher sign out + back in since the role was changed? Database-strategy sessions refetch the user row every request so this should not be required, but if `session.user.role` looks stale in the page render (verify by checking pm2 logs for the role hydration line), a sign-out + back in fixes it.
- Is there a CDN / proxy cache between the publisher and pm2? `/dashboard/pricing` is `export const dynamic = "force-dynamic"` so should never be cached, but a misconfigured intermediary could. Ask the publisher to hard-refresh (Ctrl+Shift+R) before assuming the SQL fix didn't take.

---

## Stream C — Download rate-limit override

The Download surface at `GET /api/books/[id]/download` rate-limits to 5/day/book/subscriber per CC-7 / D11.9 (fixed UTC day boundary). Count rows: `fetch_logs` where `source='dashboard_download'`, `subscriber_id = <S>`, the row's `book_version` belongs to book `<B>`, and `created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')`. Including 429 (`status='rate_limited'`) rows in the count is intentional — conservative-and-cheap; cf. the CC-7 note in `docs/phase-4-decisions.md`.

If a legitimate user gets stuck under the cap (lost downloads to a flaky network, working through a re-issue, etc.), delete today's `dashboard_download` rows for the (subscriber, book) tuple to reset their quota without touching the agent-fetch history:

```sql
-- Substitute <S> and <B> with the subscriber + book UUIDs.
DELETE FROM "fetch_logs"
 WHERE source = 'dashboard_download'
   AND subscriber_id = '<S>'
   AND book_version_id IN (SELECT id FROM book_versions WHERE book_id = '<B>')
   AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC');
```

Prefer DELETE over UPDATE-status — the rate-limit count is `SELECT COUNT(*) … WHERE source='dashboard_download'` regardless of `status`. The deleted rows lose their audit trace; if the override is granted under operator review, paste the deleted-row count + tuple into the dated note for this section. The user gets their next download immediately; the cap resets normally at 00:00 UTC tomorrow.

---

## Stream C — Download leak forensics

The Download surface prepends an HTML-comment watermark to every served file (D11.4 cross-ref / #66 implementation notes):

```
<!-- bkstr: subscriber=<uuid> book=<uuid> issued=<iso8601> -->
```

Given a leaked .md file, the operator can re-key it to a specific download event by reading the three watermark fields and querying `fetch_logs`:

```sql
-- Substitute <S>, <B>, and the issued timestamp from the watermark line.
SELECT id, subscriber_id, book_version_id, status, latency_ms, created_at
  FROM fetch_logs
 WHERE source = 'dashboard_download'
   AND subscriber_id = '<S>'
   AND book_version_id IN (SELECT id FROM book_versions WHERE book_id = '<B>')
   AND created_at = '<issued-iso8601>';
```

Caveats:

- The `created_at` precision in `fetch_logs` is `timestamptz(6)` (microsecond) but `Date.prototype.toISOString()` emits millisecond precision; the equality match is exact at ms but the DB row may carry trailing-zero microseconds. If exact-equality misses, widen to `>= <ts> AND < <ts> + INTERVAL '1 millisecond'`.
- If `fetch_logs` retention sweeps land later (`#19`), the forensics window narrows to the retained period. Pull the row sooner rather than later.
- The watermark is regenerated on every download — re-downloading a book produces a fresh `issued` stamp, which is how multiple downloads disambiguate.

---

## Querying admin_actions via psql

Phase 4.5 Stream G ships the `admin_actions` table (per `docs/phase-4.5-decisions.md` D12.7) as a durable audit trail of every ADMIN mutation that flows through the Phase 4.5 admin UI / API surfaces: user role changes (Stream E's `/dashboard/admin/users` + `POST /api/admin/users/[id]/role`), book ownership reassignment (Stream F's `POST /api/admin/books/[id]/reassign`), and access-grant revoke (Stream F's `POST /api/admin/grants/[id]/revoke`). The write surface lands in Streams E + F via the `writeAuditEntry(tx, …)` helper at `src/lib/admin/audit.ts` (D12.4 / D12.8); the read surface (`/dashboard/admin/audit`) is **deferred** per D12.12 — operators query the table directly via psql until it ships.

**What is and isn't captured:**

- Captured: mutations performed via the admin UI / API. Stream E's role changes, Stream F's book reassigns + grant revokes. Each row has an `actor_user_id` (the ADMIN who clicked), an `action_type` (D12.5 dot-delimited string), a `target_type` + `target_id`, and JSONB `before_state` / `after_state` showing the changed fields (D12.14 — changing fields only, not full row snapshots).
- NOT captured: raw SQL UPDATEs run from psql, env-driven role syncs at signin (D11.11 rule 1 promotions), Stripe-webhook-driven grant insertions, or any background process. Only deliberate operator clicks through the admin UI flow through `writeAuditEntry` and write to this table.
- The three composite indexes (per D12.7) are pre-aligned with the queries below — filtering on `actor_user_id`, `(target_type, target_id)`, or `action_type` with `created_at DESC` ordering hits an index cleanly.

### Most recent admin actions

```sql
SELECT created_at, actor_user_id, action_type, target_type, target_id,
       before_state, after_state
  FROM admin_actions
 ORDER BY created_at DESC
 LIMIT 20;
```

### All admin actions in the last 24 hours

```sql
SELECT actor_user_id, action_type, target_type, target_id, created_at
  FROM admin_actions
 WHERE created_at >= NOW() - INTERVAL '1 day'
 ORDER BY created_at DESC;
```

### All role mutations against a specific user (target-history lookup)

Substitute the target user's UUID:

```sql
SELECT created_at, actor_user_id, action_type,
       before_state->>'role' AS old_role,
       after_state->>'role'  AS new_role
  FROM admin_actions
 WHERE target_type = 'user'
   AND target_id = '<user-uuid>'
 ORDER BY created_at DESC;
```

Resolves the canonical "who did what to Edward and when" question after a role flap.

### All actions performed by a specific ADMIN (actor-history lookup)

Substitute the actor's UUID:

```sql
SELECT created_at, action_type, target_type, target_id,
       before_state, after_state
  FROM admin_actions
 WHERE actor_user_id = '<admin-uuid>'
 ORDER BY created_at DESC
 LIMIT 100;
```

Resolves "what has Animesh been doing this week" / accountability questions.

### Decode JSONB state for role transitions

The `before_state` / `after_state` columns are JSONB; the `->>` operator extracts a string-typed field, `->` returns a JSONB sub-document. Common pivot:

```sql
-- Every promotion / demotion in the last week with old → new role visible
SELECT created_at,
       actor_user_id,
       target_id,
       action_type,
       before_state->>'role' AS old_role,
       after_state->>'role'  AS new_role
  FROM admin_actions
 WHERE action_type LIKE 'user.role%'
   AND created_at >= NOW() - INTERVAL '7 days'
 ORDER BY created_at DESC;
```

For book reassignments, the analogous decode (per D12.14):

```sql
SELECT created_at,
       actor_user_id,
       target_id AS book_id,
       before_state->>'publisher_user_id' AS old_publisher_user_id,
       after_state->>'publisher_user_id'  AS new_publisher_user_id
  FROM admin_actions
 WHERE action_type = 'book.reassign_publisher'
 ORDER BY created_at DESC;
```

For grant revokes:

```sql
SELECT created_at,
       actor_user_id,
       target_id AS grant_id,
       after_state->>'revoked_at' AS revoked_at_iso
  FROM admin_actions
 WHERE action_type = 'grant.revoke'
 ORDER BY created_at DESC;
```

### Resolving the placeholder above

The "Recovering from a misplaced demotion" section earlier in this document (around line 433) used to note that no audit trail existed — that gap is now closed by `admin_actions` for mutations performed via the Phase 4.5 admin UI. For raw-SQL UPDATEs done outside the UI (e.g. break-glass recovery via psql), the audit trail still does not exist by construction — running `UPDATE users SET role=…` bypasses the `writeAuditEntry` helper entirely. Capture any such operator-direct SQL in a dated runbook note rather than relying on `admin_actions` to reflect it.

---

## Stream E — role mutation operator guide

Phase 4.5 Stream E ships `/dashboard/admin/users` (the table) and `POST /api/admin/users/[id]/role` (the mutation handler). The handler enforces five self-protection gates per D12.9 and writes one row to `admin_actions` per successful mutation per D12.4 / D12.5. The asymmetric modal at `src/components/dashboard/admin/role-mutation-modal.tsx` (D12.10) requires the operator to type the target email for any demote or any ADMIN promotion; the SUBSCRIBER→PUBLISHER promotion goes through with a simple OK/Cancel.

### The env-file-vs-UI consistency story (R1 mitigation)

D12.2 carves out a deliberate asymmetry between the env-driven role sync (`src/lib/auth/index.ts:74-101`, `syncRoleFromEnv`) and the UI role mutation (`POST /api/admin/users/[id]/role`):

- **Env path is monotonic-upward only** (D11.11 rules 1-3). Removing an email from `PUBLISHER_EMAILS` does NOT demote that user; it just stops re-promoting them.
- **UI path may demote** (D12.2 rule 4). Stream E's handler is allowed to write `role = 'SUBSCRIBER'` against a target user.

The two paths interact at signin time. If an operator demotes Edward via the UI but leaves `edward@tmrwgroup.ai` in `PUBLISHER_EMAILS`, then on Edward's next signin the env-sync runs first (in `events.signIn` per `src/lib/auth/index.ts:183-223`), reads the DB role (now SUBSCRIBER), sees the env-derived role is PUBLISHER, and re-promotes Edward to PUBLISHER. The UI demote effectively had a TTL of "until next signin."

**Operator workflow for a permanent demote:**

1. Demote via the UI (`/dashboard/admin/users` → "Change role" → pick target role → type target email → confirm). This writes the audit row to `admin_actions`.
2. Pull the email from the relevant list in `/etc/bkstr/roles.env` (the same edit + `pm2 reload --update-env` sequence as the "Adding" path in the Roles env file runbook above). This prevents the re-promote.

Until both steps have run, the demote is best-thought-of as a "until next signin" annotation. The audit row in `admin_actions` records the UI action; the env-driven re-promotion at signin does NOT write to `admin_actions` (no admin actor — it runs from `events.signIn`), so a later "I demoted X yesterday; today X is back to PUBLISHER" mystery resolves to "the env file still has them" by direct file inspection.

### SQL fallback for when the UI is unavailable

If the dashboard is down, the deploy is mid-promotion, or the operator otherwise cannot reach `/dashboard/admin/users`, the direct UPDATE remains the break-glass path:

```sql
-- Demote a single user. Note: this path does NOT write to admin_actions.
UPDATE users SET role = 'SUBSCRIBER' WHERE email = 'edward@tmrwgroup.ai';

-- Promote a single user (env-file is the preferred path; this UPDATE is for
-- the rare "I need to promote them right now without a signin" case).
UPDATE users SET role = 'PUBLISHER' WHERE email = 'edward@tmrwgroup.ai';
```

**Caveats:**

- Raw-SQL paths bypass `writeAuditEntry` entirely — there is no `admin_actions` row to point to later. Capture the rationale in a dated note in `docs/operations.md` (or this runbook's history) so the action is auditable by inspection of the docs.
- The env-file-vs-UI consistency story above applies to the SQL path too. If you UPDATE Edward to SUBSCRIBER but leave him in `PUBLISHER_EMAILS`, his next signin re-promotes him.
- For full auditability, prefer the UI path. The SQL fallback exists for break-glass scenarios.

### Querying admin_actions for role-change history

Use the existing "Querying admin_actions via psql" runbook section above. The canonical pivot for role-change history on a specific user is reproduced here for convenience:

```sql
-- Resolves "who changed Edward's role, when, from what to what"
SELECT created_at, actor_user_id, action_type,
       before_state->>'role' AS old_role,
       after_state->>'role'  AS new_role
  FROM admin_actions
 WHERE target_type = 'user'
   AND target_id = '<edward-user-uuid>'
 ORDER BY created_at DESC;
```

For "every role-mutation in the last 7 days across every user":

```sql
SELECT created_at, actor_user_id, target_id, action_type,
       before_state->>'role' AS old_role,
       after_state->>'role'  AS new_role
  FROM admin_actions
 WHERE action_type LIKE 'user.role%'
   AND created_at >= NOW() - INTERVAL '7 days'
 ORDER BY created_at DESC;
```

`action_type` values written by Stream E (per D12.5):

- `user.role_promote_publisher` — SUBSCRIBER → PUBLISHER (the routine Edward-onboarding shape).
- `user.role_promote_admin` — any → ADMIN (rare; high-consequence security event).
- `user.role_demote_publisher` — ADMIN → PUBLISHER (rare; enumerated for completeness).
- `user.role_demote_subscriber` — PUBLISHER → SUBSCRIBER or ADMIN → SUBSCRIBER (the operator-explicit demote path).

---
