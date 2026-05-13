import { describe, it, expect } from "vitest";
import { parseManifest } from "./manifest-parser";

describe("parseManifest", () => {
  it("minimum-subset manifest (only chapters[]) returns ManifestParsed with empty/undefined optional fields", () => {
    const yaml = `chapters:\n  - slug: intro\n  - slug: body\n`;
    const out = parseManifest(yaml);
    if ("code" in out) throw new Error(`expected success, got ${out.code}`);
    expect(out.chapters).toHaveLength(2);
    expect(out.chapters[0].slug).toBe("intro");
    expect(out.chapters[1].slug).toBe("body");
    expect(out.title).toBeUndefined();
    expect(out.domain).toBeUndefined();
    expect(out.description).toBeUndefined();
    expect(out.tokenEstimate).toBeUndefined();
    // K.1 — both chapters are slug-only → mode "manifest_derived_from_slug".
    expect(out.slugDerivationMode).toBe("manifest_derived_from_slug");
  });

  it("full manifest (Zach-shape) returns all declared fields including snake_case token_estimate", () => {
    const yaml = `
title: Agentic QA Manual
slug: agentic-qa-manual
domain: qa
description: A manual for agentic QA.
audience: qa-engineers
token_estimate: 65000
version: 1
conventions:
  voice: instructive
  examples: minimal
chapters:
  - slug: ch00-core
    file: chapters/ch00-core.md
    title: Core principles
    token_estimate: 2400
    audience: all
  - slug: ch01-intro
    file: chapters/ch01-intro.md
`;
    const out = parseManifest(yaml);
    if ("code" in out) throw new Error(`expected success, got ${out.code}`);
    expect(out.title).toBe("Agentic QA Manual");
    expect(out.slug).toBe("agentic-qa-manual");
    expect(out.domain).toBe("qa");
    expect(out.description).toBe("A manual for agentic QA.");
    expect(out.audience).toBe("qa-engineers");
    expect(out.tokenEstimate).toBe(65000);
    expect(out.version).toBe(1);
    expect(out.conventions).toEqual({ voice: "instructive", examples: "minimal" });
    expect(out.chapters).toHaveLength(2);
    expect(out.chapters[0]).toMatchObject({
      slug: "ch00-core",
      file: "chapters/ch00-core.md",
      title: "Core principles",
      tokenEstimate: 2400,
      audience: "all",
    });
    expect(out.chapters[1]).toMatchObject({
      slug: "ch01-intro",
      file: "chapters/ch01-intro.md",
    });
    expect(out.raw).toBeDefined();
  });

  it("manifest missing chapters key returns ManifestParseError code=MISSING_CHAPTERS", () => {
    const yaml = `title: No chapters here\n`;
    const out = parseManifest(yaml);
    expect("code" in out && out.code).toBe("MISSING_CHAPTERS");
  });

  it("manifest with non-list chapters returns ManifestParseError code=INVALID_CHAPTERS_SHAPE", () => {
    const yaml = `chapters: "not a list"\n`;
    const out = parseManifest(yaml);
    expect("code" in out && out.code).toBe("INVALID_CHAPTERS_SHAPE");
  });

  it("malformed YAML returns ManifestParseError code=YAML_PARSE_ERROR with the underlying parser's message", () => {
    const yaml = `chapters:\n  - slug: ok\n  - {malformed:[unbalanced\n`;
    const out = parseManifest(yaml);
    if (!("code" in out)) throw new Error("expected error");
    expect(out.code).toBe("YAML_PARSE_ERROR");
    expect(out.message).toMatch(/Invalid YAML/);
  });

  // Phase 6 Stream K.1 (D17.2) — slug-derivation tests.

  it("K.1: chapter with only file: derives slug from basename without OQ-1 prefix stripping", () => {
    const yaml = `chapters:\n  - file: chapters/ch00-core.md\n  - file: chapters/ch01-intro.md\n`;
    const out = parseManifest(yaml);
    if ("code" in out) throw new Error(`expected success, got ${out.code}`);
    // Manifest-mode preserves filename fidelity — no prefix strip.
    expect(out.chapters[0].slug).toBe("ch00-core");
    expect(out.chapters[1].slug).toBe("ch01-intro");
    expect(out.chapters[0].file).toBe("chapters/ch00-core.md");
    expect(out.slugDerivationMode).toBe("manifest_derived_from_file");
  });

  it("K.1: chapter with only slug: leaves file undefined (file derivation happens at the resolution layer)", () => {
    const yaml = `chapters:\n  - slug: intro\n  - slug: body\n`;
    const out = parseManifest(yaml);
    if ("code" in out) throw new Error(`expected success, got ${out.code}`);
    expect(out.chapters.map((c) => c.slug)).toEqual(["intro", "body"]);
    expect(out.chapters.every((c) => c.file === undefined)).toBe(true);
    expect(out.slugDerivationMode).toBe("manifest_derived_from_slug");
  });

  it("K.1: chapter with both file: and slug: uses both verbatim; slugDerivationMode='manifest_explicit'", () => {
    const yaml = `chapters:\n  - slug: introduction\n    file: chapters/ch00-intro.md\n  - slug: body\n    file: chapters/ch01-body.md\n`;
    const out = parseManifest(yaml);
    if ("code" in out) throw new Error(`expected success, got ${out.code}`);
    expect(out.chapters[0].slug).toBe("introduction");
    expect(out.chapters[0].file).toBe("chapters/ch00-intro.md");
    expect(out.slugDerivationMode).toBe("manifest_explicit");
  });

  it("K.1: chapter with neither file: nor slug: returns ManifestParseError code=CHAPTER_MISSING_FILE_AND_SLUG including the chapter index", () => {
    const yaml = `chapters:\n  - slug: ok\n  - title: I have no file or slug\n`;
    const out = parseManifest(yaml);
    if (!("code" in out)) throw new Error("expected error");
    expect(out.code).toBe("CHAPTER_MISSING_FILE_AND_SLUG");
    expect(out.message).toMatch(/chapters\[1\]/);
  });

  it("K.1: two chapters whose derived slugs collide return DUPLICATE_SLUG_AFTER_DERIVATION naming both offenders", () => {
    // Both basenames are "ch00" after extension strip — same derived slug.
    const yaml = `chapters:\n  - file: ch00.md\n  - file: subdir/ch00.md\n`;
    const out = parseManifest(yaml);
    if (!("code" in out)) throw new Error("expected error");
    expect(out.code).toBe("DUPLICATE_SLUG_AFTER_DERIVATION");
    expect(out.message).toMatch(/chapters\[0\].*chapters\[1\].*ch00/);
  });
});
