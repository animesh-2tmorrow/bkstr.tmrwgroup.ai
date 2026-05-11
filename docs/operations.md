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

If `UPDATE users SET role='SUBSCRIBER'` was run against the wrong user, recovery is symmetric: `UPDATE users SET role='ADMIN' WHERE email='…'`. The role column carries no history; if you need an audit trail, the `webhook_events` table is unrelated and won't help here (this is a future hardening surface — operator-action audit log).

If the only ADMIN was accidentally demoted: provided their email is still in `ADMIN_EMAILS` in `/etc/bkstr/roles.env`, they'll be re-promoted automatically on their next signin (D11.11 rule 1, env presence promotes). If their email isn't in the file, re-add it, reload pm2, ask them to sign in. If the file itself is missing, restore it (the contents are operator-stable across deploys; the canonical values are recorded in this runbook and in the deploy decision log).

---
