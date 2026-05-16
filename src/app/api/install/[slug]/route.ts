// Move 1 — GET /api/install/[slug] — the one-liner install endpoint.
//
//   curl -sL https://bkstr.tmrwgroup.ai/api/install/<slug> | tar xz -C ~/.claude/skills/
//
// Streams a gzipped tar of a book's or skill's file bodies, every entry
// namespaced under <slug>/ so the bundle lands at ~/.claude/skills/<slug>/.
// Kind-agnostic — resolveSlug (via resolveInstallAccess) handles book vs
// skill. The existing JSON endpoints (/api/{books,skills}/<slug>/files)
// are untouched and stay for backward compatibility.
//
// Free items install anonymously (IP-watermarked, edge-cacheable); paid
// items require a Bearer token + AccessGrant (subscriber-watermarked,
// never cached). The optional-auth branch lives in resolveInstallAccess.

import type { NextRequest } from "next/server";
import {
  resolveInstallAccess,
  InstallAccessError,
} from "@/lib/install/resolve-install-access";
import { loadContent, EmptyInstallContentError } from "@/lib/install/load-content";
import { buildTarball } from "@/lib/install/build-tarball";
import { checkRateLimit } from "@/lib/install/rate-limit";
import { buildWatermark } from "@/lib/install/watermark";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// NextRequest.ip was removed in Next 15. Behind nginx the real client is
// the first hop of x-forwarded-for; x-real-ip is nginx's single-value
// fallback. "unknown" keeps the rate-limiter keyable for dev / direct hits.
function clientIp(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function jsonError(
  status: number,
  code: string,
  message: string,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ error: message, code }), {
    status,
    headers: { "Content-Type": "application/json", ...(extraHeaders ?? {}) },
  });
}

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await ctx.params;
  const ip = clientIp(request);

  // 1. Rate limit FIRST (dispatch flow) — 60/hr/IP, in-memory sliding window.
  const rl = checkRateLimit(ip);
  if (!rl.allowed) {
    return jsonError(429, "RATE_LIMITED", "Too many requests", {
      "Retry-After": String(rl.retryAfterSec),
    });
  }

  // 2. Resolve slug + decide access. Free → anonymous OK; paid → Bearer + grant.
  const token = request.headers.get("authorization");
  let access;
  try {
    access = await resolveInstallAccess(slug, token, request);
  } catch (err) {
    if (err instanceof InstallAccessError) {
      return jsonError(err.status, err.code, err.message);
    }
    throw err;
  }

  // 3. Load file bodies (kind-aware; reads `content` columns directly).
  let files;
  try {
    files = await loadContent(access.kind, access.id);
  } catch (err) {
    if (err instanceof EmptyInstallContentError) {
      return jsonError(404, "NO_CONTENT", err.message);
    }
    throw err;
  }

  // 4. Build the gzipped tarball, in memory, with the forensic watermark.
  const watermark = buildWatermark({
    isFree: access.isFree,
    ip,
    subscriberId: access.subscriberId,
    slug: access.slug,
    kind: access.kind,
  });

  let tarball: Buffer;
  try {
    tarball = await buildTarball({ slug: access.slug, files, watermark });
  } catch (err) {
    console.error("[install] tarball build failed:", err);
    return jsonError(500, "TARBALL_FAILED", "Failed to build install archive");
  }

  // 5. Respond. Free content is stable + shareable → edge-cacheable for
  // 5 min; paid content is per-subscriber → never cached (no-store —
  // load-bearing if Cloudflare fronts prod, so a paid bundle is never
  // served from cache to another requester).
  return new Response(new Uint8Array(tarball), {
    status: 200,
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${access.slug}.tar.gz"`,
      "Content-Length": String(tarball.length),
      "Cache-Control": access.isFree ? "public, max-age=300" : "no-store",
    },
  });
}
