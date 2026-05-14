// NOTE: the [id] param name is a Next.js routing-tree constraint —
// /api/books/[id]/ already exists with sibling routes (view/download/cover).
// This route accepts SLUG only; UUIDs are rejected with BOOK_NOT_FOUND (404).
//
// Stream U — books-side agent-consumption JSON endpoint. Mirror of
// /api/skills/[slug]/files (follow-up #122). Shares response shape and
// error semantics with the skills-side route exactly, so Stream O's
// fetch_book.py can target both with the same parsing path.

import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import {
  requireBookFetchAccess,
  bookFetchAccessErrorResponse,
} from "@/lib/books/agent-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  // The directory name is [id] but this handler treats the param as a slug.
  // See the file-header comment above for the routing-tree rationale.
  const { id: slug } = await ctx.params;

  let bundle;
  try {
    bundle = await requireBookFetchAccess(request, slug);
  } catch (err) {
    const resp = bookFetchAccessErrorResponse(err);
    if (resp) return resp;
    throw err;
  }

  return new Response(
    JSON.stringify({
      book: {
        slug: bundle.book.slug,
        title: bundle.book.title,
        // Version as STRING for parity with the skills-side endpoint.
        // Keeps the response shape stable if non-integer version labels are
        // ever introduced.
        version: String(bundle.version.version),
      },
      files: bundle.files.map((f) => ({
        path: f.path,
        content: f.content,
        // sha256 computed at response time (UTF-8 bytes, lowercase hex digest)
        // — matches skills-side computation byte-for-byte. Books don't store
        // a per-chapter content hash today, so the helper returns raw content
        // and this route hashes it on the way out.
        sha256: createHash("sha256").update(f.content, "utf8").digest("hex"),
      })),
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        // Per-subscriber response — never cache between subscribers.
        "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
      },
    },
  );
}
