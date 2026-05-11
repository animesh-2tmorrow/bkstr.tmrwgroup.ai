import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { BookAccessError, requireBookAccess } from "@/lib/books/access";
import {
  EmptyBookContentError,
  loadBookContent,
  servedFrom,
} from "@/lib/storage/book-content";

// Phase 4 Stream C — content-egress: View.
// Session-cookie authenticated; requires an active access_grant for
// (subscriber, book). On success returns raw markdown for in-browser
// display (no Content-Disposition: attachment, no watermark — the
// download path owns leak forensics).
//
// Scenario E in the implementation prompt: a SUBSCRIBER constructing the
// URL manually for a book they don't have a grant for must hit 403 here
// (requireBookAccess throws BookAccessError(403)).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // 2. Resolve subscriber. events.createUser auto-creates the row so this
  //    should never miss for a signed-in user; treat as 500 if it does.
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

  // 4. Latest version. Mirrors the agent/fetch select shape.
  const version = await prisma.bookVersion.findFirst({
    where: { bookId },
    orderBy: { version: "desc" },
    select: { id: true, bookId: true, content: true, contentUri: true },
  });
  if (!version) {
    return NextResponse.json({ error: "Book version not found" }, { status: 404 });
  }

  // 5. Load content via the dual-storage seam.
  const start = Date.now();
  let body: string;
  try {
    body = await loadBookContent(version);
    console.log(
      `[books/view] served_from=${servedFrom(version)} version_id=${version.id} bytes=${body.length}`,
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
    console.error("[books/view] loadBookContent failed:", err);
    return NextResponse.json({ error: "Failed to load book content" }, { status: 502 });
  }

  // 6. fetch_logs row — D11.13: source='dashboard_view'. apiKeyId=null per
  //    D11.12. model/query are NOT NULL in schema; pass empty string.
  await writeFetchLog({
    subscriberId: subscriber.id,
    bookVersionId: version.id,
    status: "success",
    latencyMs: Date.now() - start,
  });

  // 7. Raw markdown response. No attachment header — browser displays inline.
  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function writeFetchLog(opts: {
  subscriberId: string;
  bookVersionId: string;
  status: "success" | "error";
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
        source: "dashboard_view",
      },
    });
  } catch (err) {
    console.error("[books/view] failed to write fetch_logs:", err);
  }
}
