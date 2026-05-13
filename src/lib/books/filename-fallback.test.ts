import { describe, it, expect } from "vitest";
import { deriveChaptersFromFilenames } from "./filename-fallback";

describe("deriveChaptersFromFilenames", () => {
  it("sorts entries lexicographically across nested directories", () => {
    const out = deriveChaptersFromFilenames([
      { name: "zzz/late.md" },
      { name: "chapters/ch01-second.md" },
      { name: "chapters/ch00-first.md" },
      { name: "intro.md" },
    ]);
    // Lexicographic on the full path: 'chapters/...' < 'intro.md' < 'zzz/...'
    expect(out.map((c) => c.metadata.originalPath)).toEqual([
      "chapters/ch00-first.md",
      "chapters/ch01-second.md",
      "intro.md",
      "zzz/late.md",
    ]);
    expect(out.map((c) => c.order)).toEqual([0, 1, 2, 3]);
  });

  it("applies the OQ-1 (d) prefix-strip rule on the basename", () => {
    const out = deriveChaptersFromFilenames([
      { name: "ch00-core.md" },
      { name: "01_intro.md" },
      { name: "overview.md" },
      { name: "chapters/ch12-conclusion.markdown" },
    ]);
    const bySlug = Object.fromEntries(out.map((c) => [c.metadata.originalPath, c.slug]));
    expect(bySlug["ch00-core.md"]).toBe("core");
    expect(bySlug["01_intro.md"]).toBe("intro");
    expect(bySlug["overview.md"]).toBe("overview");
    expect(bySlug["chapters/ch12-conclusion.markdown"]).toBe("conclusion");
  });

  it("ignores non-markdown entries (.txt / .yaml / .png / README)", () => {
    const out = deriveChaptersFromFilenames([
      { name: "intro.md" },
      { name: "manifest.yaml" },
      { name: "cover.png" },
      { name: "notes.txt" },
      { name: "README" },
      { name: "body.markdown" },
    ]);
    expect(out.map((c) => c.metadata.originalPath)).toEqual(["body.markdown", "intro.md"]);
  });

  it("leaves title=null (first-H1 enrichment deferred to follow-up #112)", () => {
    const out = deriveChaptersFromFilenames([
      { name: "ch00-core.md" },
      { name: "ch01-intro.md" },
    ]);
    expect(out.every((c) => c.title === null)).toBe(true);
    expect(out.every((c) => c.content === "")).toBe(true);
    expect(out.every((c) => c.tokenEstimate === null)).toBe(true);
  });
});
