import type { Role } from "@/generated/prisma/client";

// Phase 5 Stream A (D13.2) — strip :::role <name> ... ::: blocks the caller
// can't see, return the filtered markdown.
//
// Tier semantics: ADMIN(2) >= PUBLISHER(1) >= SUBSCRIBER(0). A block is visible
// iff userRank >= blockRank. Unmarked content is always visible.
//
// Fail-closed: unknown role tag and unterminated blocks both strip the block.
// Spurious lone closing fences are dropped silently.
//
// Pure / synchronous / no I/O. Unit-tested at filter-by-role.test.ts.

const ROLE_RANK: Record<string, number> = {
  SUBSCRIBER: 0,
  PUBLISHER: 1,
  ADMIN: 2,
};

const OPEN_RE = /^:::role\s+(\w+)\s*$/;
const CLOSE_RE = /^:::\s*$/;

export function filterByRole(markdown: string, role: Role): string {
  const userRank = ROLE_RANK[role] ?? -1; // unknown role -> sees only common
  const lines = markdown.split("\n");
  const out: string[] = [];

  // When inside a role block, buffer its lines until we see the closing fence.
  // Only flush to `out` on a clean close AND if visible. Unterminated blocks
  // (buffer still non-null at EOF) discard the buffer -> fail-closed.
  let buffer: string[] | null = null;
  let bufferVisible = false;

  for (const line of lines) {
    if (buffer === null) {
      const openMatch = OPEN_RE.exec(line);
      if (openMatch) {
        const blockRole = openMatch[1].toUpperCase();
        const blockRank = ROLE_RANK[blockRole];
        bufferVisible = blockRank !== undefined && userRank >= blockRank;
        buffer = [];
        continue;
      }
      // Spurious lone closing fence outside any block -> drop silently.
      if (CLOSE_RE.test(line)) continue;
      out.push(line);
    } else {
      if (CLOSE_RE.test(line)) {
        // Proper close. Flush buffered lines iff this block is visible.
        if (bufferVisible) out.push(...buffer);
        buffer = null;
        bufferVisible = false;
        continue;
      }
      buffer.push(line);
    }
  }

  // EOF with open buffer -> block never closed -> discard (fail-closed).
  return out.join("\n");
}
