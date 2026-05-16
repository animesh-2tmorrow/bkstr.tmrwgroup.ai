// Move 1 — access resolver for /api/install/[slug].
//
// This is the ONE place bkstr needs "optional auth": free items install
// anonymously, paid items require a valid Bearer token + AccessGrant.
//
// It deliberately does NOT reuse requireSkillAccess / requireBookFetchAccess
// — those hard-reject a missing token (no anonymous path at all). Here,
// whether auth is required is decided AFTER resolving the item's price.
// The token validation + grant check still reuse the SAME primitives those
// helpers use (requireApiKey, requireBookAccess, the skill AccessGrant
// query) so the paid path stays byte-for-byte consistent with the existing
// /files endpoints.
//
// Signature note: the dispatch specified resolveInstallAccess(slug, token).
// `requireApiKey` (a DO-NOT-TOUCH shared primitive) needs the whole
// Request to read the Authorization header, so `request` is threaded
// through as a third argument. `token` is retained for the cheap
// token-present-or-not branch.

import { resolveSlug } from "@/lib/storefront/resolve-slug";
import { ApiKeyAuthError, requireApiKey } from "@/lib/auth/api-key";
import { requireBookAccess, BookAccessError } from "@/lib/books/access";
import { prisma } from "@/lib/db";

export type InstallAccessErrorCode =
  | "NOT_FOUND"
  | "UNAUTHENTICATED"
  | "ACCESS_DENIED";

export class InstallAccessError extends Error {
  status: number;
  code: InstallAccessErrorCode;
  constructor(status: number, code: InstallAccessErrorCode, message: string) {
    super(message);
    this.name = "InstallAccessError";
    this.status = status;
    this.code = code;
  }
}

export type InstallAccess = {
  kind: "book" | "skill";
  id: string;
  slug: string;
  isFree: boolean;
  /** Set when a valid token was supplied (always for paid; best-effort for free). */
  subscriberId: string | null;
};

/**
 * Resolve a slug to a book/skill and decide install access.
 *
 *  - Item not found / not ACTIVE  → InstallAccessError(404, NOT_FOUND)
 *  - Free item                    → anonymous OK. A supplied token is
 *                                    resolved best-effort for the
 *                                    watermark; an invalid token does NOT
 *                                    block a free install.
 *  - Paid item, no token          → InstallAccessError(401, UNAUTHENTICATED)
 *  - Paid item, invalid token     → InstallAccessError(401, UNAUTHENTICATED)
 *  - Paid item, valid token, no
 *    AccessGrant                  → InstallAccessError(403, ACCESS_DENIED)
 *                                    (authenticated-but-unauthorized — 403,
 *                                    not 401; the dispatch's error list
 *                                    omitted 403, but 401 would be wrong
 *                                    here since the caller IS authenticated)
 */
export async function resolveInstallAccess(
  slug: string,
  token: string | null,
  request: Request,
): Promise<InstallAccess> {
  const item = await resolveSlug(slug);
  if (!item) {
    throw new InstallAccessError(404, "NOT_FOUND", "Not found");
  }

  // resolveSlug already joins the price tables — unitAmountCents is null
  // when there is no active USD price row. "Free" = no price or zero.
  const isFree = item.unitAmountCents == null || item.unitAmountCents === 0;

  if (isFree) {
    let subscriberId: string | null = null;
    if (token) {
      // Best-effort attribution for the watermark — a bad token on a free
      // item is tolerated (the content is free; do not 401 on it).
      subscriberId = await tryResolveSubscriber(request);
    }
    return { kind: item.kind, id: item.id, slug: item.slug, isFree: true, subscriberId };
  }

  // Paid — a valid Bearer token is mandatory.
  if (!token) {
    throw new InstallAccessError(
      401,
      "UNAUTHENTICATED",
      "Authentication required for a paid item",
    );
  }
  let subscriberId: string;
  try {
    const apiAuth = await requireApiKey(request);
    subscriberId = apiAuth.subscriber.id;
  } catch (err) {
    if (err instanceof ApiKeyAuthError) {
      throw new InstallAccessError(401, "UNAUTHENTICATED", err.message);
    }
    throw err;
  }

  await assertGrant(item.kind, item.id, subscriberId);

  return { kind: item.kind, id: item.id, slug: item.slug, isFree: false, subscriberId };
}

/** Resolve a Bearer token to a subscriber id without throwing on failure. */
async function tryResolveSubscriber(request: Request): Promise<string | null> {
  try {
    const apiAuth = await requireApiKey(request);
    return apiAuth.subscriber.id;
  } catch {
    return null;
  }
}

/** Assert the subscriber holds a live AccessGrant for the item. */
async function assertGrant(
  kind: "book" | "skill",
  id: string,
  subscriberId: string,
): Promise<void> {
  if (kind === "book") {
    try {
      await requireBookAccess(subscriberId, id);
    } catch (err) {
      if (err instanceof BookAccessError) {
        throw new InstallAccessError(403, "ACCESS_DENIED", "Access required for this item");
      }
      throw err;
    }
    return;
  }
  // Skill — the same AccessGrant predicate requireSkillAccess uses:
  // non-revoked, non-expired, any source (PURCHASE / PUBLISHER_OWN / SEED / MANUAL).
  const grant = await prisma.accessGrant.findFirst({
    where: {
      subscriberId,
      skillId: id,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true },
  });
  if (!grant) {
    throw new InstallAccessError(403, "ACCESS_DENIED", "Access required for this item");
  }
}
