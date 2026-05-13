import { describe, it, expect } from "vitest";
import { normalizedChapterHash } from "./chapter-hash";

describe("normalizedChapterHash", () => {
  it("is stable across calls with identical draft input", () => {
    const drafts = [
      { order: 0, content: "# Hello" },
      { order: 1, content: "Body text\nmore body" },
      { order: 2, content: "# Goodbye" },
    ];
    const a = normalizedChapterHash(drafts);
    const b = normalizedChapterHash(drafts);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it("changes when content changes AND when order changes (insertion order is irrelevant)", () => {
    const a = normalizedChapterHash([
      { order: 0, content: "alpha" },
      { order: 1, content: "beta" },
    ]);
    // Different content → different hash
    const b = normalizedChapterHash([
      { order: 0, content: "alpha" },
      { order: 1, content: "BETA" },
    ]);
    // Same chapters in different insertion order → SAME hash (we sort by `order`)
    const c = normalizedChapterHash([
      { order: 1, content: "beta" },
      { order: 0, content: "alpha" },
    ]);
    // Re-ordered (different `order` values) → different hash
    const d = normalizedChapterHash([
      { order: 0, content: "beta" },
      { order: 1, content: "alpha" },
    ]);
    expect(a).not.toBe(b);
    expect(a).toBe(c);
    expect(a).not.toBe(d);
  });
});
