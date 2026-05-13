// Phase 6 Stream L follow-up #122 — shared skill access helper.
//
// Both /api/skills/[slug]/download (Stream L c4, returns zip) and
// /api/skills/[slug]/files (follow-up #122, returns inline JSON) need the
// same auth-and-resolve flow: dual auth (session OR API-key) → subscriber
// lookup → skill + latest version + files → AccessGrant check. This helper
// is the single source of truth; both routes thread their response shape
// off the same returned bundle.
//
// Auth dispatch (operator-selected via gate-2 clarification):
//   - If an `Authorization: Bearer bks_…` header is present → API-key path
//     (requireApiKey returns the subscriber directly).
//   - Otherwise → session via auth() → look up subscriber by user email.
// One path or the other; never both. The choice is observable in the
// returned `authMethod` field for log/metric purposes if a caller wants it.
//
// File ordering — `path ASC` (matches the dispatch's deterministic ordering
// for the JSON response; the download route was previously `order ASC` but
// is now path-ASC after this helper consolidation. Zip bytes change shape
// but functional behavior is identical — zip extractors don't preserve
// in-archive order semantically).

import { auth } from "@/lib/auth";
import { ApiKeyAuthError, requireApiKey } from "@/lib/auth/api-key";
import { prisma } from "@/lib/db";

const SLUG_REGEX = /^[a-z0-9-]+$/;
const SLUG_MAX_LEN = 128;

export type SkillAccessErrorCode =
  | "SKILL_NOT_FOUND"
  | "NO_ACTIVE_VERSION"
  | "UNAUTHENTICATED"
  | "ACCESS_DENIED";

export class SkillAccessError extends Error {
  status: number;
  code: SkillAccessErrorCode;
  constructor(status: number, code: SkillAccessErrorCode, message: string) {
    super(message);
    this.name = "SkillAccessError";
    this.status = status;
    this.code = code;
  }
}

export type SkillAccessFile = {
  id: string;
  path: string;
  content: string;
  extension: string;
  byteSize: number;
  contentHash: string;
};

export type SkillAccessBundle = {
  authMethod: "session" | "api_key";
  subscriber: { id: string };
  skill: {
    id: string;
    slug: string;
    name: string;
    description: string;
  };
  version: {
    id: string;
    version: number;
    manifest: unknown;
    normalizedHash: string;
  };
  files: SkillAccessFile[];
  grant: { id: string; source: string };
};

/**
 * Resolve a skill by slug, authorize the requester via session OR API-key,
 * and return everything callers need to build a response. Throws
 * SkillAccessError on any of the four documented failure modes.
 */
export async function requireSkillAccess(
  request: Request,
  slug: string,
): Promise<SkillAccessBundle> {
  // ─── 1. Slug shape gate ────────────────────────────────────────────────
  // Same regex/length as the download route's pre-check, lifted here so
  // both endpoints behave identically against malformed paths.
  if (typeof slug !== "string" || slug.length === 0 || slug.length > SLUG_MAX_LEN || !SLUG_REGEX.test(slug)) {
    throw new SkillAccessError(404, "SKILL_NOT_FOUND", "Skill not found");
  }

  // ─── 2. Auth — API-key first if Authorization header present, else session ─
  let subscriberId: string;
  let authMethod: "session" | "api_key";
  const authHeader = request.headers.get("authorization") ?? request.headers.get("Authorization");

  if (authHeader) {
    try {
      const apiAuth = await requireApiKey(request);
      subscriberId = apiAuth.subscriber.id;
      authMethod = "api_key";
    } catch (err) {
      if (err instanceof ApiKeyAuthError) {
        throw new SkillAccessError(err.status, "UNAUTHENTICATED", err.message);
      }
      throw err;
    }
  } else {
    const session = await auth();
    if (!session?.user?.email) {
      throw new SkillAccessError(401, "UNAUTHENTICATED", "Unauthorized");
    }
    const sub = await prisma.subscriber.findFirst({
      where: { user: { email: session.user.email } },
      select: { id: true },
    });
    if (!sub) {
      // Authenticated user has no subscriber row — practically impossible
      // (subscribers row is auto-created on first signin) but surface as
      // 403 rather than 500 so the error envelope is clean for clients.
      throw new SkillAccessError(403, "ACCESS_DENIED", "No subscriber for current user");
    }
    subscriberId = sub.id;
    authMethod = "session";
  }

  // ─── 3. Resolve skill + latest version + files (single round trip) ─────
  // No status filter on the skill itself — we differentiate "skill doesn't
  // exist" (SKILL_NOT_FOUND) from "skill exists but is ARCHIVED with no
  // ACTIVE version" (NO_ACTIVE_VERSION) for the dispatch's two distinct
  // 404 envelopes.
  const skill = await prisma.skill.findFirst({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      status: true,
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: {
          id: true,
          version: true,
          manifest: true,
          normalizedHash: true,
          files: {
            // Dispatch §contract — files ordered by path ASC for
            // deterministic response shape.
            orderBy: { path: "asc" },
            select: {
              id: true,
              path: true,
              content: true,
              extension: true,
              byteSize: true,
              contentHash: true,
            },
          },
        },
      },
    },
  });

  if (!skill) {
    throw new SkillAccessError(404, "SKILL_NOT_FOUND", "Skill not found");
  }
  const version = skill.versions[0];
  if (!version || skill.status !== "ACTIVE") {
    throw new SkillAccessError(404, "NO_ACTIVE_VERSION", "Skill has no active version");
  }

  // ─── 4. AccessGrant — non-revoked, non-expired ─────────────────────────
  // Allowlist is implicit: any source counts (PURCHASE, PUBLISHER_OWN, and
  // operator-issued SEED/MANUAL). The download route's prior comment
  // captured the same rationale.
  const grant = await prisma.accessGrant.findFirst({
    where: {
      subscriberId,
      skillId: skill.id,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true, source: true },
  });
  if (!grant) {
    throw new SkillAccessError(403, "ACCESS_DENIED", "Access required for this skill");
  }

  return {
    authMethod,
    subscriber: { id: subscriberId },
    skill: {
      id: skill.id,
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
    },
    version: {
      id: version.id,
      version: version.version,
      manifest: version.manifest,
      normalizedHash: version.normalizedHash,
    },
    files: version.files,
    grant: { id: grant.id, source: String(grant.source) },
  };
}

/**
 * Convenience for routes — converts a SkillAccessError to the standard
 * `{ error, code }` envelope. Other thrown errors propagate.
 */
export function skillAccessErrorResponse(err: unknown): Response | null {
  if (err instanceof SkillAccessError) {
    return new Response(JSON.stringify({ error: err.message, code: err.code }), {
      status: err.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}
