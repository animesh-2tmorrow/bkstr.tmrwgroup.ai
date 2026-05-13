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
});
