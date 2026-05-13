// Phase 6 Stream L follow-up #122 — agent-consumption JSON endpoint.
//
// GET /api/skills/[slug]/files — same auth + resolve + AccessGrant gate as
// /api/skills/[slug]/download, but returns the skill's files as inline JSON
// suitable for an agent (Codex, Claude Code, etc.) to fetch programmatically
// and write to disk. UTF-8 strict on upload guarantees raw-string safety;
// no base64.
//
// Response shape — see docs/api/skills.md.
// Auth — session (cookie) OR API-key (Authorization: Bearer bks_…), via
// the shared requireSkillAccess helper.

import type { NextRequest } from "next/server";
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

  return new Response(
    JSON.stringify({
      skill: {
        slug: bundle.skill.slug,
        name: bundle.skill.name,
        // Version as STRING per the dispatch contract — keeps the response
        // shape stable if we ever introduce non-integer version labels.
        version: String(bundle.version.version),
        description: bundle.skill.description,
      },
      files: bundle.files.map((f) => ({
        path: f.path,
        content: f.content,
        sha256: f.contentHash,
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
