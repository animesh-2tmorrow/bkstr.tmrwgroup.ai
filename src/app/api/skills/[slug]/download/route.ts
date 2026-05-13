// Phase 6 Stream L (D18.1) — skill download endpoint.
//
// GET /api/skills/[slug]/download — authorize via AccessGrant (skillId match;
// source ∈ {PURCHASE, PUBLISHER_OWN}; non-revoked, non-expired) and return
// a freshly-re-archived .zip built from the latest SkillVersion's skill_files
// rows. The `path` field on each row restores the original layout (relative
// to the original virtual root — `SKILL.md` at the archive root, the rest
// following their stored paths). adm-zip is already a runtime dep (Stream K).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import AdmZip from "adm-zip";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLUG_REGEX = /^[a-z0-9-]+$/;

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await ctx.params;
  if (!SLUG_REGEX.test(slug) || slug.length === 0 || slug.length > 128) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 1. Auth (session cookie).
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Resolve the skill by slug + load the latest version's files. Single
  //    round trip via nested select.
  const skill = await prisma.skill.findFirst({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: {
          id: true,
          version: true,
          files: {
            orderBy: { order: "asc" },
            select: { path: true, content: true },
          },
        },
      },
    },
  });
  if (!skill) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }
  const latest = skill.versions[0];
  if (!latest) {
    return NextResponse.json({ error: "Skill has no versions yet" }, { status: 404 });
  }

  // 3. Authorize via AccessGrant. Accepts PURCHASE (subscriber bought) and
  //    PUBLISHER_OWN (publisher downloading their own skill). SEED/MANUAL
  //    could also be granted by operators; allowlist them too.
  const subscriber = await prisma.subscriber.findFirst({
    where: { user: { email: session.user.email } },
    select: { id: true },
  });
  if (!subscriber) {
    return NextResponse.json({ error: "No subscriber for current user" }, { status: 403 });
  }
  const grant = await prisma.accessGrant.findFirst({
    where: {
      subscriberId: subscriber.id,
      skillId: skill.id,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true, source: true },
  });
  if (!grant) {
    return NextResponse.json({ error: "Access required to download this skill" }, { status: 403 });
  }

  // 4. Re-archive the SkillFile rows into a fresh in-memory zip. `path` is
  //    relative to the original virtual root, so the resulting archive is
  //    layout-equivalent to what the publisher uploaded (modulo their original
  //    wrapping-directory prefix, which was stripped at processZipUpload time).
  const zip = new AdmZip();
  for (const f of latest.files) {
    zip.addFile(f.path, Buffer.from(f.content, "utf8"));
  }
  const buffer = zip.toBuffer();

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${skill.slug}-v${latest.version}.zip"`,
      "Content-Length": String(buffer.length),
      // No caching: every download is a fresh re-archive (cheap; ≤ tens of KB).
      "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
    },
  });
}
