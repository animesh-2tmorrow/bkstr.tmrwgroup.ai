/**
 * Dual-storage seam for book_versions content (D9.2 / Phase 3 Stream 2).
 *
 * Read precedence (locked in D9.2):
 *   1. If row.content_uri begins with "s3://" — fetch from S3.
 *   2. Else — return the inline row.content (Phase 1/2 placeholder path).
 *   3. If neither yields a non-empty string — throw EmptyBookContentError.
 *
 * The s3:// scheme check is the precedence signal because today's placeholder
 * values are inline://<uuid> which trivially fail the scheme check, so the
 * read path stays correct on rows where the migration has not yet reached.
 *
 * SDK pinning: see D9.5 — package.json pins @aws-sdk/client-s3 exactly.
 * Credentials: instance-profile via IMDSv2 on EC2 (D2.4 / D9.4); no access
 * keys are read from env. Region from process.env.AWS_REGION (staged via
 * /etc/bkstr/aws.env per D9.4); falls back to "us-east-1" with a loud warn
 * (mirrors the auth/index.ts loud-warn-on-missing-env-var pattern).
 */
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

if (!process.env.AWS_REGION) {
  console.warn(
    "[storage] AWS_REGION missing — defaulting to us-east-1. Stage /etc/bkstr/aws.env to silence.",
  );
}
if (!process.env.BKSTR_CONTENT_BUCKET) {
  console.warn(
    "[storage] BKSTR_CONTENT_BUCKET missing — S3-backed reads will fail until /etc/bkstr/aws.env is sourced. Inline reads are unaffected.",
  );
}

const REGION = process.env.AWS_REGION ?? "us-east-1";

const globalForS3 = globalThis as unknown as { s3Client?: S3Client };

export const s3Client =
  globalForS3.s3Client ?? new S3Client({ region: REGION });

if (process.env.NODE_ENV !== "production") globalForS3.s3Client = s3Client;

export class EmptyBookContentError extends Error {
  constructor(versionId: string) {
    super(`book_version ${versionId} has neither inline content nor an S3-backed content_uri`);
    this.name = "EmptyBookContentError";
  }
}

export type LoadableBookVersion = {
  id: string;
  bookId: string;
  content: string | null;
  contentUri: string;
};

/**
 * Parse an `s3://<bucket>/<key>` URI. Throws on malformed input — callers are
 * expected to gate on the `s3://` prefix before delegating here.
 */
export function parseS3Uri(uri: string): { bucket: string; key: string } {
  if (!uri.startsWith("s3://")) {
    throw new Error(`parseS3Uri: not an s3:// URI: ${uri}`);
  }
  const rest = uri.slice("s3://".length);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) {
    throw new Error(`parseS3Uri: missing bucket or key in ${uri}`);
  }
  const bucket = rest.slice(0, slash);
  const key = rest.slice(slash + 1);
  return { bucket, key };
}

async function streamToString(body: unknown): Promise<string> {
  // The Node runtime returns body as either a Readable stream or an SDK
  // wrapper exposing transformToString(). Prefer the wrapper's helper since
  // it handles ReadableStream (Web) and Readable (Node) under one method.
  if (body && typeof body === "object" && "transformToString" in body) {
    const fn = (body as { transformToString: (encoding?: string) => Promise<string> }).transformToString;
    if (typeof fn === "function") return fn.call(body, "utf-8");
  }
  // Fallback: treat as Node Readable stream and concatenate chunks.
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer | Uint8Array | string>) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf-8") : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Load a book version's content using the D9.2 dual-storage precedence rule.
 *
 * Returns the resolved content string. Throws EmptyBookContentError when
 * neither source yields a non-empty string — callers translate this to HTTP
 * 404 ("Book version has no content") at the route boundary.
 */
export async function loadBookContent(row: LoadableBookVersion): Promise<string> {
  if (row.contentUri && row.contentUri.startsWith("s3://")) {
    const { bucket, key } = parseS3Uri(row.contentUri);
    const resp = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!resp.Body) {
      throw new Error(`S3 GetObject returned empty body for ${row.contentUri}`);
    }
    const text = await streamToString(resp.Body);
    if (text.length === 0) throw new EmptyBookContentError(row.id);
    return text;
  }
  if (row.content && row.content.length > 0) return row.content;
  throw new EmptyBookContentError(row.id);
}

/**
 * Tag indicating which arm of the precedence rule served a given row. Used
 * by callers (e.g. agent/fetch route) for observability logging — see CC-4
 * in /tmp/stream-2-design.md (logs-only, no fetch_logs schema column).
 */
export function servedFrom(row: { contentUri: string }): "s3" | "inline" {
  return row.contentUri && row.contentUri.startsWith("s3://") ? "s3" : "inline";
}
