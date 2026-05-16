// Move 1 — in-memory rate limiter for /api/install/[slug].
//
// 60 requests / 60 minutes per client IP, sliding window. bkstr runs a
// SINGLE Node process today, so per-process in-memory state is correct.
// IF bkstr ever horizontal-scales, this MUST be replaced by a shared
// store (Redis) — a per-instance limiter would let a client get N×60 by
// spreading requests across N instances.
//
// lru-cache (already a dependency — see package.json) bounds memory: at
// most MAX_TRACKED_IPS entries are kept, and an IP that goes quiet for a
// full window is evicted by the TTL. Each tracked value is a short
// (≤ MAX_PER_WINDOW) ascending list of request timestamps.

import { LRUCache } from "lru-cache";

const WINDOW_MS = 60 * 60 * 1000; // 60 minutes
const MAX_PER_WINDOW = 60;
const MAX_TRACKED_IPS = 10_000;

const hits = new LRUCache<string, number[]>({
  max: MAX_TRACKED_IPS,
  ttl: WINDOW_MS,
});

export type RateLimitResult = { allowed: boolean; retryAfterSec: number };

/**
 * Record a request from `ip` and report whether it is allowed. Prunes
 * timestamps that have aged out of the sliding window before deciding.
 * When denied, `retryAfterSec` is the time until the oldest in-window
 * hit expires (i.e. the soonest the caller could succeed).
 */
export function checkRateLimit(ip: string): RateLimitResult {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const prior = hits.get(ip) ?? [];
  const recent = prior.filter((t) => t > cutoff);

  if (recent.length >= MAX_PER_WINDOW) {
    const oldest = recent[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
    // Re-store the pruned list so the window keeps sliding as old hits expire.
    hits.set(ip, recent);
    return { allowed: false, retryAfterSec };
  }

  recent.push(now);
  hits.set(ip, recent);
  return { allowed: true, retryAfterSec: 0 };
}
