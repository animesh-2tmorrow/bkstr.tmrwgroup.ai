#!/usr/bin/env node
/**
 * Migrate book_versions.content from inline Postgres TEXT to S3-backed
 * storage, behind the dual-storage seam locked in D9.2 / Phase 3 Stream 2.
 *
 * Two operations, gated by flags:
 *
 *   Sweep 1 (default — write S3 + set content_uri):
 *     For each row where content IS NOT NULL AND content_uri NOT LIKE 's3://%':
 *       1. Compute key = books/<book_id>/versions/<book_version_id>.md
 *       2. PutObject(bucket, key, body=row.content, ContentType='text/markdown',
 *          ContentMD5=base64(md5(content)))
 *       3. HeadObject + ETag-vs-md5 verify
 *       4. UPDATE book_versions SET content_uri = 's3://<bucket>/<key>'
 *          WHERE id = $1 AND content_uri NOT LIKE 's3://%'
 *     After: every row is servable from EITHER source. Reversible by
 *     re-importing or by NULLing content_uri back to inline://<id>.
 *
 *   Sweep 2 (--null-content):
 *     Refuses to run unless every target row already has content_uri LIKE 's3://%'.
 *     UPDATE book_versions SET content = NULL WHERE content_uri LIKE 's3://%'
 *       AND content IS NOT NULL.
 *
 * Idempotency:
 *   - Rows with content_uri LIKE 's3://%' are skipped (pre-loop filter + the
 *     UPDATE WHERE clause both enforce this).
 *   - Rows with content IS NULL are skipped.
 *   - S3 PutObject is itself idempotent for our shape (same key + same bytes
 *     -> same ETag); re-runs that overwrite an existing key are safe (with
 *     versioning ON, the prior version is retained).
 *
 * Pre-migration safety dump (design OQ-10):
 *   At start of run we write a JSON file at
 *     migrations/content-to-s3-snapshot-<timestamp>.json
 *   keyed { id -> { sha256, byte_size, version, book_id } } for every row
 *   that has non-null content. This is the durable evidence that an S3
 *   object's contents match the original DB content, useful both for the
 *   verification step and for any future audit.
 *
 * Usage:
 *   npm run migrate-content-to-s3 -- [--dry-run | --confirm] [--bucket <name>]
 *                                    [--null-content]
 *
 * Defaults to dry-run (no S3 writes, no DB updates). Pass --confirm to
 * execute Sweep 1. Pass --null-content (alone or with --confirm) to execute
 * Sweep 2.
 *
 * Exit codes:
 *   0  success (or unchanged no-op)
 *   1  usage error / configuration error / refusal-to-run
 *   2  per-row failures encountered (rows_failed > 0)
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { prisma } from "../src/lib/db";

const TRANSIENT_S3_ERRORS = new Set([
  "SlowDown",
  "RequestTimeout",
  "InternalError",
  "ServiceUnavailable",
]);

const USAGE = `Usage: npm run migrate-content-to-s3 -- [options]

Options:
  --dry-run              List intended writes only; no S3 PUT, no DB UPDATE.
                         (Default. Pass --confirm to execute.)
  --confirm              Flip dry-run off — actually perform writes.
  --bucket <name>        Override BKSTR_CONTENT_BUCKET env var.
  --null-content         Sweep 2: null content where content_uri LIKE 's3://%'.
                         Refuses to run unless every target row already
                         migrated. Honors --dry-run / --confirm same as
                         Sweep 1.
  --help                 Print this message.

Sweep 1 (default): write content to S3, set content_uri.
Sweep 2 (--null-content): null the inline content column post-verification.`;

function fail(message: string, code: 1 | 2 = 1): never {
  console.error(message);
  process.exit(code);
}

function md5Base64(text: string): string {
  return createHash("md5").update(text).digest("base64");
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransient(err: unknown): boolean {
  if (err instanceof S3ServiceException) {
    if (TRANSIENT_S3_ERRORS.has(err.name)) return true;
    const status = err.$metadata?.httpStatusCode;
    if (typeof status === "number" && status >= 500 && status <= 599) return true;
  }
  return false;
}

function isFatalConfigError(err: unknown): boolean {
  if (err instanceof S3ServiceException) {
    return ["AccessDenied", "NoSuchBucket", "InvalidAccessKeyId", "SignatureDoesNotMatch"].includes(
      err.name,
    );
  }
  return false;
}

type Args = {
  dryRun: boolean;
  bucket: string;
  nullContent: boolean;
};

function parseArguments(): Args {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean" },
      confirm: { type: "boolean" },
      bucket: { type: "string" },
      "null-content": { type: "boolean" },
      help: { type: "boolean" },
    },
    strict: true,
  });

  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }

  if (values["dry-run"] && values.confirm) {
    fail("--dry-run and --confirm are mutually exclusive\n\n" + USAGE);
  }
  // Default: dry-run unless --confirm is passed.
  const dryRun = values.confirm ? false : true;

  const bucket = (values.bucket ?? process.env.BKSTR_CONTENT_BUCKET ?? "").trim();
  if (!bucket) {
    fail(
      "Bucket name not set. Pass --bucket <name> or stage BKSTR_CONTENT_BUCKET in /etc/bkstr/aws.env.\n\n" +
        USAGE,
    );
  }

  return { dryRun, bucket, nullContent: !!values["null-content"] };
}

function s3KeyFor(bookId: string, versionId: string): string {
  return `books/${bookId}/versions/${versionId}.md`;
}

function s3UriFor(bucket: string, bookId: string, versionId: string): string {
  return `s3://${bucket}/${s3KeyFor(bookId, versionId)}`;
}

function snapshotPath(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `migrations/content-to-s3-snapshot-${ts}.json`;
}

async function writeSnapshot(
  rows: Array<{ id: string; bookId: string; version: number; content: string; byteSize: number }>,
): Promise<string> {
  const path = snapshotPath();
  mkdirSync(dirname(path), { recursive: true });
  const map: Record<string, { sha256: string; byte_size: number; version: number; book_id: string }> = {};
  for (const r of rows) {
    map[r.id] = {
      sha256: sha256Hex(r.content),
      byte_size: r.byteSize,
      version: r.version,
      book_id: r.bookId,
    };
  }
  writeFileSync(path, JSON.stringify(map, null, 2), "utf-8");
  return path;
}

async function sweep1(args: Args, s3: S3Client): Promise<void> {
  const candidates = await prisma.bookVersion.findMany({
    where: {
      content: { not: null },
      NOT: { contentUri: { startsWith: "s3://" } },
    },
    select: { id: true, bookId: true, version: true, content: true, byteSize: true, contentUri: true },
    orderBy: [{ bookId: "asc" }, { version: "asc" }],
  });

  if (candidates.length === 0) {
    console.log("[sweep-1] no rows to migrate (every row with content already has s3:// content_uri).");
    return;
  }

  // Filter out the impossible "content is null" cases that the where can't
  // express cleanly under Prisma's typing, plus refuse to run on totally
  // empty content (treat as a configuration anomaly worth shouting about).
  const rows = candidates.filter((r): r is typeof r & { content: string } => {
    if (!r.content || r.content.length === 0) {
      console.warn(`[sweep-1] skip ${r.id}: content is null/empty despite NOT NULL filter`);
      return false;
    }
    return true;
  });

  console.log(
    `[sweep-1] mode=${args.dryRun ? "dry-run" : "confirm"} bucket=${args.bucket} candidates=${rows.length}`,
  );

  // Pre-migration snapshot (design OQ-10) — durable evidence pre-PUT.
  if (!args.dryRun) {
    const snapPath = await writeSnapshot(rows);
    console.log(`[sweep-1] wrote pre-migration snapshot: ${snapPath}`);
  } else {
    console.log("[sweep-1] dry-run: snapshot skipped");
  }

  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const key = s3KeyFor(row.bookId, row.id);
    const uri = s3UriFor(args.bucket, row.bookId, row.id);
    const md5 = md5Base64(row.content);
    const byteSize = Buffer.byteLength(row.content, "utf-8");

    if (args.dryRun) {
      console.log(
        `[sweep-1] DRY would PUT s3://${args.bucket}/${key} bytes=${byteSize} md5=${md5} && SET content_uri=${uri}`,
      );
      continue;
    }

    let attempt = 0;
    let putOk = false;
    let lastErr: unknown = null;
    while (attempt <= 1 && !putOk) {
      try {
        await s3.send(
          new PutObjectCommand({
            Bucket: args.bucket,
            Key: key,
            Body: row.content,
            ContentType: "text/markdown",
            ContentMD5: md5,
          }),
        );
        putOk = true;
      } catch (err) {
        lastErr = err;
        if (isFatalConfigError(err)) {
          fail(
            `[sweep-1] FATAL configuration error on row ${row.id}: ${(err as Error).message}\n` +
              "Aborting whole run — refusing to mask a misconfigured environment.",
            1,
          );
        }
        if (isTransient(err) && attempt === 0) {
          attempt++;
          await sleep(1000);
          continue;
        }
        break;
      }
    }
    if (!putOk) {
      console.error(
        `[sweep-1] FAIL ${row.id} — PutObject error: ${
          lastErr instanceof Error ? lastErr.message : String(lastErr)
        }`,
      );
      failed++;
      continue;
    }

    // Read-verify via HeadObject ETag (S3 returns the MD5 of the part for
    // single-part uploads; ours always are, content is well under 5GB).
    let etagOk = false;
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: args.bucket, Key: key }));
      const etag = (head.ETag ?? "").replace(/"/g, "");
      const localMd5Hex = createHash("md5").update(row.content).digest("hex");
      etagOk = etag === localMd5Hex;
      if (!etagOk) {
        console.error(
          `[sweep-1] FAIL ${row.id} — ETag mismatch (s3=${etag} local=${localMd5Hex})`,
        );
      }
    } catch (err) {
      console.error(
        `[sweep-1] FAIL ${row.id} — HeadObject error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    if (!etagOk) {
      failed++;
      continue;
    }

    // Idempotent UPDATE — only stamps if not already migrated.
    try {
      const result = await prisma.bookVersion.updateMany({
        where: {
          id: row.id,
          NOT: { contentUri: { startsWith: "s3://" } },
        },
        data: { contentUri: uri },
      });
      if (result.count === 0) {
        skipped++;
        console.log(
          `[sweep-1] SKIP ${row.id} — content_uri was already s3:// at UPDATE time (concurrent migration?)`,
        );
        continue;
      }
      succeeded++;
      console.log(`[sweep-1] OK   ${row.id} key=${key} bytes=${byteSize}`);
    } catch (err) {
      console.error(
        `[sweep-1] FAIL ${row.id} — DB UPDATE error (S3 object already exists; re-run is safe): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      failed++;
    }
  }

  console.log(
    `[sweep-1] summary: candidates=${rows.length} succeeded=${succeeded} skipped=${skipped} failed=${failed}`,
  );
  if (failed > 0) process.exit(2);
}

async function sweep2(args: Args, s3: S3Client): Promise<void> {
  // Refuse to run if any row still has non-null content but content_uri is
  // not s3://. That state is "inline still authoritative" — Sweep 2 would
  // destroy data.
  const unmigrated = await prisma.bookVersion.count({
    where: {
      content: { not: null },
      NOT: { contentUri: { startsWith: "s3://" } },
    },
  });
  if (unmigrated > 0) {
    fail(
      `[sweep-2] REFUSE: ${unmigrated} row(s) have non-null content with non-s3:// content_uri. ` +
        "Run Sweep 1 (--confirm without --null-content) first.",
      1,
    );
  }

  // Optional: spot-check that S3 objects are reachable for at least the
  // first few rows we're about to lose the inline copy of. This catches
  // the failure mode "Sweep 1 reported success but the IAM role lost
  // GetObject permission since" before we commit to nulling the column.
  const sampleRows = await prisma.bookVersion.findMany({
    where: {
      contentUri: { startsWith: "s3://" },
      content: { not: null },
    },
    select: { id: true, contentUri: true },
    take: 3,
  });
  for (const sample of sampleRows) {
    const rest = sample.contentUri.slice("s3://".length);
    const slash = rest.indexOf("/");
    const bucket = rest.slice(0, slash);
    const key = rest.slice(slash + 1);
    try {
      await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    } catch (err) {
      fail(
        `[sweep-2] REFUSE: sample S3 read failed for ${sample.id} (${sample.contentUri}): ${
          err instanceof Error ? err.message : String(err)
        }. Verify IAM + bucket health before nulling content.`,
        1,
      );
    }
  }

  if (args.dryRun) {
    const target = await prisma.bookVersion.count({
      where: {
        contentUri: { startsWith: "s3://" },
        content: { not: null },
      },
    });
    console.log(
      `[sweep-2] DRY would NULL content on ${target} row(s) where content_uri LIKE 's3://%'`,
    );
    return;
  }

  const result = await prisma.bookVersion.updateMany({
    where: {
      contentUri: { startsWith: "s3://" },
      content: { not: null },
    },
    data: { content: null },
  });
  console.log(`[sweep-2] OK   nulled content on ${result.count} row(s)`);
}

async function main(): Promise<void> {
  const args = parseArguments();
  const region = process.env.AWS_REGION ?? "us-east-1";
  const s3 = new S3Client({ region });

  if (args.nullContent) {
    await sweep2(args, s3);
  } else {
    await sweep1(args, s3);
  }
}

main()
  .catch((err) => {
    console.error("migrate-content-to-s3 failed:", err instanceof Error ? err.message : err);
    process.exit(2);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
