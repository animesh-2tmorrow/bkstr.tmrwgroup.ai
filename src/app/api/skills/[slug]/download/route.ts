// Phase 6 Stream L (D18.1) — skill download endpoint.
//
// GET /api/skills/[slug]/download — authorize via AccessGrant (skillId match;
// any active source; non-revoked, non-expired) and return a freshly-
// re-archived .zip built from the latest SkillVersion's skill_files rows.
// The `path` field on each row restores the original layout (relative to
// the original virtual root — `SKILL.md` at the archive root, the rest
// following their stored paths). adm-zip is already a runtime dep (Stream K).
//
// Stream L follow-up #122 refactor: auth + resolve + AccessGrant check are
// shared with the new /api/skills/[slug]/files JSON endpoint via the
// `requireSkillAccess` helper. This route is now a thin formatter on top.

import type { NextRequest } from "next/server";
import AdmZip from "adm-zip";
import { requireSkillAccess, skillAccessErrorResponse } from "@/lib/skills/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await ctx.params;

  let bundle;
  try {
    bundle = await requireSkillAccess(request, slug);
  } catch (err) {
    const resp = skillAccessErrorResponse(err);
    if (resp) return resp;
    throw err;
  }

  // Re-archive the SkillFile rows into a fresh in-memory zip. `path` is
  // relative to the original virtual root, so the resulting archive is
  // layout-equivalent to what the publisher uploaded (modulo their original
  // wrapping-directory prefix, which was stripped at processZipUpload time).
  // File ordering inside the zip changed from `order ASC` to `path ASC`
  // when the auth helper consolidated — zip extractors don't preserve
  // in-archive order semantically so this is a no-op for consumers.
  const zip = new AdmZip();
  for (const f of bundle.files) {
    zip.addFile(f.path, Buffer.from(f.content, "utf8"));
  }
  const buffer = zip.toBuffer();

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${bundle.skill.slug}-v${bundle.version.version}.zip"`,
      "Content-Length": String(buffer.length),
      // No caching: every download is a fresh re-archive (cheap; ≤ tens of KB).
      "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
    },
  });
}
