// Move 2 / Phase 1.5 — GET /api/cli/library.
//
// One Bearer-authed endpoint that serves the bkstr CLI's `whoami` (reads
// `account`) and `list` (reads `items`) commands in a single round-trip.
//
// Auth: Bearer only — the bks_… API key from /api/install. No NextAuth
// session fallback (see require-cli-auth.ts). /api/storefront/items keeps
// its session-only model for the web storefront; this endpoint is the
// Bearer-side counterpart for the CLI.
//
// This route also establishes the /api/cli/* conventions every future CLI
// endpoint follows:
//   - requireCliAuth for Bearer resolution,
//   - the shared per-IP rate-limit bucket (one budget across CLI ops),
//   - an X-Bkstr-CLI-Min-Version response header (kill-switch hook for
//     old clients; hard-coded "0.0.0" / unenforced for now).

import type { NextRequest } from "next/server";
import { requireCliAuth, CliAuthError } from "@/lib/cli/require-cli-auth";
import { listOwnedItems } from "@/lib/cli/list-owned-items";
import { checkRateLimit } from "@/lib/install/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Min CLI version this server still accepts. Hard-coded and UNENFORCED in
// Phase 1.5 — it ships as a header so a future breaking CLI change has a
// kill-switch already wired into deployed clients. Cheap now, impossible
// to retrofit later.
const CLI_MIN_VERSION = "0.0.0";

// Duplicated verbatim from /api/install/[slug]/route.ts. The install route
// is out of scope to touch this phase, so the helper can't be hoisted to a
// shared module yet — extract it when a third caller appears. NextRequest.ip
// was removed in Next 15; behind nginx the real client is the first hop of
// x-forwarded-for, with x-real-ip as the single-value fallback.
function clientIp(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

// Every /api/cli/* response carries the min-version header + no-store
// (this data is per-subscriber and changes on purchase — never cache).
function cliJson(
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Bkstr-CLI-Min-Version": CLI_MIN_VERSION,
      ...(extraHeaders ?? {}),
    },
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  // 1. Rate limit FIRST — shares the in-memory per-IP LRU bucket with
  //    /api/install (60/hr/IP). Gating before auth keeps the budget honest
  //    (every hit counts) and limits unauthenticated floods too.
  const ip = clientIp(request);
  const rl = checkRateLimit(ip);
  if (!rl.allowed) {
    return cliJson(
      429,
      { error: "Too many requests", message: "Rate limit exceeded — try again later" },
      { "Retry-After": String(rl.retryAfterSec) },
    );
  }

  // 2. Auth — Bearer only, no session path.
  let auth;
  try {
    auth = await requireCliAuth(request);
  } catch (err) {
    if (err instanceof CliAuthError) {
      return cliJson(err.status, { error: "Unauthorized", message: err.message });
    }
    throw err; // genuinely unexpected — let it surface as a 500
  }

  // 3. Owned items for this subscriber (books + skills, ARCHIVED excluded).
  let items;
  try {
    items = await listOwnedItems(auth.subscriberId);
  } catch (err) {
    console.error("[cli/library] listOwnedItems failed:", err);
    return cliJson(500, {
      error: "Internal Server Error",
      message: "Failed to load library",
    });
  }

  // 4. account + items in one payload — CLI `whoami` and `list` both feed
  //    off this. items may be [] (a subscriber with zero live grants).
  return cliJson(200, {
    account: { email: auth.email, subscriberId: auth.subscriberId },
    items,
  });
}
