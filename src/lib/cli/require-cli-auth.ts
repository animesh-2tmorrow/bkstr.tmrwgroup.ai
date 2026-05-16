// Move 2 / Phase 1.5 — shared Bearer auth for the /api/cli/* namespace.
//
// Every /api/cli/* route authenticates the SAME way: an
// `Authorization: Bearer bks_…` API key — the very key /api/install
// already accepts for paid items — resolved to a subscriber.
//
// Two deliberate differences from neighbouring auth helpers:
//   - No NextAuth session fallback. The CLI never holds a cookie; unlike
//     /api/storefront/items and /api/skills/[slug]/files this is pure
//     Bearer. Do NOT add a session path here.
//   - No anonymous path. Unlike resolveInstallAccess (Move 1), which lets
//     free items install with no key, every /api/cli/* call requires a
//     valid key — a missing/invalid key is always 401.
//
// Token validation reuses requireApiKey (the same hashing + lookup the
// install endpoint uses), so one key behaves identically across surfaces.
// The specific failure reason from requireApiKey (bad format / unknown /
// revoked) is intentionally collapsed into one opaque message — the CLI,
// and an attacker, learn only "missing or invalid", not which.

import type { NextRequest } from "next/server";
import { ApiKeyAuthError, requireApiKey } from "@/lib/auth/api-key";

export class CliAuthError extends Error {
  status: number;
  constructor(message: string) {
    super(message);
    this.name = "CliAuthError";
    this.status = 401;
  }
}

export type CliAuth = {
  subscriberId: string;
  email: string;
};

/**
 * Resolve the `Authorization: Bearer` API key on a /api/cli/* request to a
 * subscriber. Throws CliAuthError(401) when the header is missing or the
 * key is invalid / unknown / revoked. Pure Bearer — never reads a session.
 */
export async function requireCliAuth(request: NextRequest): Promise<CliAuth> {
  try {
    const { subscriber } = await requireApiKey(request);
    return { subscriberId: subscriber.id, email: subscriber.email };
  } catch (err) {
    if (err instanceof ApiKeyAuthError) {
      throw new CliAuthError("Missing or invalid API key");
    }
    throw err;
  }
}
