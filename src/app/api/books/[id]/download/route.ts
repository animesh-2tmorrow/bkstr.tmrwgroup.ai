import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { BookAccessError, requireBookAccess } from "@/lib/books/access";
import { EmptyBookContentError, servedFrom } from "@/lib/storage/book-content";
import { getVersionContent } from "@/lib/books/content";

// Phase 4 Stream C — content-egress: Download.
// Session-cookie authenticated; requires an active access_grant for
// (subscriber, book). Rate-limited per CC-7 / D11.9 to 5/UTC-day/book/subscriber.
// On success prepends an HTML-comment watermark (per #66's leak-forensics
// requirement; D11.4 cross-ref) then returns text/markdown with
// `Content-Disposition: attachment; filename="<slug>.md"`.
//
// Watermark format: `<!-- bkstr: subscriber=<uuid> book=<uuid> issued=<iso8601> -->\n\n`.
// HTML comment is preserved by all conforming markdown parsers, invisible in
// rendered output, regenerated on every download (NOT stored). The trailing
// blank line keeps the comment from being absorbed into the first paragraph's
// source mapping in stricter parsers — see #66's tightened implementation
// notes in docs/follow-ups.md.
//
// Forensic regex (operator runbook): the watermark line anchors to start-of-file
// and the three named fields are extractable with:
//   ^<!-- bkstr: subscriber=([0-9a-f-]{36}) book=([0-9a-f-]{36}) issued=([^ ]+) -->$
// The regex is verified to match the literal template-literal output: the only
// dynamic substrings are the three UUIDs/timestamp, and they slot into the
// fixed `subscriber=…`, `book=…`, `issued=…` keyed slots.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RATE_LIMIT_PER_DAY = 5;

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: bookId } = await ctx.params;
  if (!UUID_REGEX.test(bookId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 1. Auth (session cookie).
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Resolve subscriber.
  const subscriber = await prisma.subscriber.findFirst({
    where: { user: { email: session.user.email } },
    select: { id: true },
  });
  if (!subscriber) {
    return NextResponse.json({ error: "No subscriber for current user" }, { status: 500 });
  }

  // 3. Access check (CC-4 / D11.4).
  try {
    await requireBookAccess(subscriber.id, bookId);
  } catch (err) {
    if (err instanceof BookAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  // 4. Look up book + latest version. Slug is needed for Content-Disposition.
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: { slug: true },
  });
  if (!book) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }

  const version = await prisma.bookVersion.findFirst({
    where: { bookId },
    orderBy: { version: "desc" },
    select: {
      id: true,
      bookId: true,
      content: true,
      contentUri: true,
      chapters: { orderBy: { order: "asc" }, select: { order: true, content: true } },
    },
  });
  if (!version) {
    return NextResponse.json({ error: "Book version not found" }, { status: 404 });
  }

  // 5. Rate limit (CC-7 / D11.9). Count dashboard_download rows for this
  //    subscriber against any version of this book since 00:00 UTC today.
  //    fetch_logs keys on book_version_id; we JOIN through bookVersion to
  //    map version → book. Per CC-7 there's no book_id denorm. With ~5
  //    versions per book × 1 row per download the count stays sub-ms.
  const startOfUtcDay = new Date();
  startOfUtcDay.setUTCHours(0, 0, 0, 0);

  const downloadsToday = await prisma.fetchLog.count({
    where: {
      subscriberId: subscriber.id,
      source: "dashboard_download",
      bookVersion: { bookId },
      createdAt: { gte: startOfUtcDay },
    },
  });

  if (downloadsToday >= RATE_LIMIT_PER_DAY) {
    const tomorrow = new Date(startOfUtcDay);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const retryAfterSec = Math.max(1, Math.ceil((tomorrow.getTime() - Date.now()) / 1000));

    // Per CC-7: the 429 row counts against tomorrow's quota too — cheap and
    // conservative. (Anything counting `dashboard_download` regardless of
    // status would catch this; if a future change filters by status='success'
    // the rate-limit branch becomes self-resetting, which is fine but worth
    // noting if the count query is ever tightened.)
    await writeFetchLog({
      subscriberId: subscriber.id,
      bookVersionId: version.id,
      status: "rate_limited",
      latencyMs: 0,
    });

    return NextResponse.json(
      {
        error: "Rate limit exceeded",
        retry_after_seconds: retryAfterSec,
      },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterSec) },
      },
    );
  }

  // 6. Load content via dual-storage seam.
  const start = Date.now();
  let content: string;
  try {
    content = await getVersionContent(version);
    console.log(
      `[books/download] served_from=${servedFrom(version)} version_id=${version.id} bytes=${content.length}`,
    );
  } catch (err) {
    await writeFetchLog({
      subscriberId: subscriber.id,
      bookVersionId: version.id,
      status: "error",
      latencyMs: Date.now() - start,
    });
    if (err instanceof EmptyBookContentError) {
      return NextResponse.json({ error: "Book version has no content" }, { status: 404 });
    }
    console.error("[books/download] loadBookContent failed:", err);
    return NextResponse.json({ error: "Failed to load book content" }, { status: 502 });
  }

  // 7. Watermark prepend. Server-side, request-time, NOT stored.
  const watermark = `<!-- bkstr: subscriber=${subscriber.id} book=${bookId} issued=${new Date().toISOString()} -->\n\n`;
  const body = watermark + content;

  // 8. fetch_logs row (success).
  await writeFetchLog({
    subscriberId: subscriber.id,
    bookVersionId: version.id,
    status: "success",
    latencyMs: Date.now() - start,
  });

  // 9. Response — attachment download.
  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${book.slug}.md"`,
      "Cache-Control": "no-store",
    },
  });
}

async function writeFetchLog(opts: {
  subscriberId: string;
  bookVersionId: string;
  status: "success" | "error" | "rate_limited";
  latencyMs: number;
}): Promise<void> {
  try {
    await prisma.fetchLog.create({
      data: {
        subscriberId: opts.subscriberId,
        bookVersionId: opts.bookVersionId,
        apiKeyId: null,
        model: "",
        query: "",
        latencyMs: opts.latencyMs,
        status: opts.status,
        source: "dashboard_download",
      },
    });
  } catch (err) {
    console.error("[books/download] failed to write fetch_logs:", err);
  }
}
