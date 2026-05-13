// Phase 6 Stream L (D18.1) — POST /api/skills/new.
//
// Mirrors /api/books/new's dispatch shape: shared auth + role check at the top,
// then Content-Type dispatch. Skills accept ONLY multipart/form-data (no JSON
// path); 415 for anything else.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { Role } from "@/generated/prisma/client";
import { handleSkillUpload } from "./skill-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email || !session.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== Role.PUBLISHER && session.user.role !== Role.ADMIN) {
    return NextResponse.json({ error: "PUBLISHER or ADMIN role required" }, { status: 403 });
  }

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "Skill upload requires multipart/form-data" },
      { status: 415 },
    );
  }

  return handleSkillUpload(request, session);
}
