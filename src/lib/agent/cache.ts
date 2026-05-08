import { createHash } from "node:crypto";
import { LRUCache } from "lru-cache";

export type CacheEntry = { text: string; input_tokens: number; output_tokens: number };

const cache = new LRUCache<string, CacheEntry>({
  max: 100,
  ttl: 15 * 60 * 1000,
});

export function cacheKey(bookVersionId: string, query: string): string {
  const normalized = query.trim().toLowerCase();
  const hash = createHash("sha256").update(normalized).digest("hex");
  return `${bookVersionId}:${hash}`;
}

export function getCached(key: string): CacheEntry | undefined {
  return cache.get(key);
}

export function setCached(key: string, entry: CacheEntry): void {
  cache.set(key, entry);
}
