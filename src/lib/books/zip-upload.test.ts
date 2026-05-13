import { describe, it, expect } from "vitest";
import AdmZip from "adm-zip";
import { processZipUpload } from "./zip-upload";
import type { ZipUploadFields } from "./zip-upload.types";

// Phase 6 Stream K (D17.1) — processZipUpload pipeline tests. Builds real zip
// buffers via adm-zip itself (since the lib is the parser too), which is more
// robust than mocking the parser. Eight tests per the Gate 2 spec.

function buildZip(entries: Array<{ name: string; content: string | Buffer }>): Buffer {
  const z = new AdmZip();
  for (const e of entries) {
    z.addFile(e.name, typeof e.content === "string" ? Buffer.from(e.content, "utf8") : e.content);
  }
  return z.toBuffer();
}

const FIELDS_OK: ZipUploadFields = {
  title: "Form Title",
  slug: "form-slug",
  domain: "skill",
};

describe("processZipUpload", () => {
  it("happy path with manifest.yaml: chapters ordered by manifest.chapters[]; manifest title/domain/description win over form fields", async () => {
    const buffer = buildZip([
      {
        name: "manifest.yaml",
        content: `title: Manifest Title
slug: manifest-slug
domain: qa
description: From manifest.
chapters:
  - slug: alpha
    file: chapters/alpha.md
  - slug: beta
    file: chapters/beta.md
`,
      },
      { name: "chapters/alpha.md", content: "# Alpha\nbody A" },
      { name: "chapters/beta.md", content: "# Beta\nbody B" },
    ]);

    const out = await processZipUpload(buffer, FIELDS_OK);
    if (out.kind !== "success") throw new Error(`expected success, got ${out.kind}: ${"error" in out ? out.error : ""}`);

    expect(out.title).toBe("Manifest Title"); // manifest wins
    expect(out.slug).toBe("manifest-slug");
    expect(out.domain).toBe("qa");
    expect(out.description).toBe("From manifest.");
    expect(out.chapters).toHaveLength(2);
    expect(out.chapters.map((c) => c.slug)).toEqual(["alpha", "beta"]);
    expect(out.chapters.map((c) => c.order)).toEqual([0, 1]);
    expect(out.chapters[0].content).toContain("body A");
    expect(out.manifestPresent).toBe(true);
    expect(out.draftHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("happy path no manifest: chapters derived from filename sort using OQ-1 (d) prefix-strip; metadata falls back to formFields", async () => {
    const buffer = buildZip([
      { name: "ch01-second.md", content: "second body" },
      { name: "ch00-first.md", content: "first body" },
      { name: "README.txt", content: "not a chapter" },
    ]);

    const out = await processZipUpload(buffer, FIELDS_OK);
    if (out.kind !== "success") throw new Error(`expected success, got ${out.kind}`);

    expect(out.title).toBe("Form Title"); // form fallback (no manifest)
    expect(out.slug).toBe("form-slug");
    expect(out.domain).toBe("skill");
    expect(out.manifestPresent).toBe(false);
    expect(out.chapters.map((c) => c.slug)).toEqual(["first", "second"]); // ch-prefix stripped + sorted
    expect(out.chapters[0].content).toBe("first body");
  });

  it("rejects SKILL.md at zip root with YAML 'name:' frontmatter (SKILL_DETECTED, status=400, suggests Stream L)", async () => {
    const buffer = buildZip([
      {
        name: "SKILL.md",
        content: `---
name: my-skill
description: A skill, not a book
---

# Skill body
`,
      },
      { name: "helper.py", content: "print('hi')" },
    ]);

    const out = await processZipUpload(buffer, FIELDS_OK);
    expect(out.kind).toBe("rejected");
    if (out.kind !== "rejected") return;
    expect(out.code).toBe("SKILL_DETECTED");
    expect(out.status).toBe(400);
    expect(out.error).toMatch(/\/api\/skills\/new/);
  });

  it("rejects entry names that survive adm-zip's own normalization but our isSafeZipEntryName catches (drive-letter prefix / control characters)", async () => {
    // adm-zip strips '../' from entry names on addFile (normalization), so a
    // pure '../../etc/passwd' attack doesn't make it past the parser anyway.
    // The exhaustive path-validation cases (../, /abs, /\, control chars,
    // drive letters) are covered directly in zip-validate.test.ts via
    // isSafeZipEntryName. Here we exercise an adm-zip-preserved unsafe shape
    // — a drive-letter prefix 'C:bad.md' — to confirm processZipUpload routes
    // it through the path validator and rejects with UNSAFE_ENTRY_PATH.
    const buffer = buildZip([
      { name: "C:bad.md", content: "evil" },
      { name: "chapters/intro.md", content: "ok" },
    ]);

    const out = await processZipUpload(buffer, FIELDS_OK);
    expect(out.kind).toBe("rejected");
    if (out.kind !== "rejected") return;
    expect(out.code).toBe("UNSAFE_ENTRY_PATH");
    expect(out.status).toBe(400);
  });

  it("rejects manifest declaring a chapter file that does not exist in the zip (CHAPTER_FILE_MISSING)", async () => {
    const buffer = buildZip([
      {
        name: "manifest.yaml",
        content: `chapters:
  - slug: alpha
    file: chapters/alpha.md
  - slug: ghost
    file: chapters/ghost.md
`,
      },
      { name: "chapters/alpha.md", content: "alpha body" },
      // chapters/ghost.md intentionally omitted
    ]);

    const out = await processZipUpload(buffer, FIELDS_OK);
    expect(out.kind).toBe("rejected");
    if (out.kind !== "rejected") return;
    expect(out.code).toBe("CHAPTER_FILE_MISSING");
    expect(out.error).toMatch(/ghost/);
  });

  it("rejects zip with no .md/.markdown entries and no manifest (NO_CHAPTERS_FOUND)", async () => {
    const buffer = buildZip([
      { name: "README.txt", content: "no chapters here" },
      { name: "cover.png", content: "fake png" },
    ]);

    const out = await processZipUpload(buffer, FIELDS_OK);
    expect(out.kind).toBe("rejected");
    if (out.kind !== "rejected") return;
    expect(out.code).toBe("NO_CHAPTERS_FOUND");
  });

  it("rejects manifest with empty chapters[] list (MANIFEST_INVALID via INVALID_CHAPTERS_SHAPE)", async () => {
    const buffer = buildZip([
      { name: "manifest.yaml", content: "chapters: []\n" },
    ]);

    const out = await processZipUpload(buffer, FIELDS_OK);
    expect(out.kind).toBe("rejected");
    if (out.kind !== "rejected") return;
    expect(out.code).toBe("MANIFEST_INVALID");
  });

  it("produces stable draftHash for identical input (idempotency primitive)", async () => {
    const make = () =>
      buildZip([
        { name: "ch00-a.md", content: "alpha" },
        { name: "ch01-b.md", content: "beta" },
      ]);

    const a = await processZipUpload(make(), FIELDS_OK);
    const b = await processZipUpload(make(), FIELDS_OK);
    if (a.kind !== "success" || b.kind !== "success") throw new Error("expected success");
    expect(a.draftHash).toBe(b.draftHash);
    // Sanity: a different chapter content yields a different hash
    const c = await processZipUpload(
      buildZip([
        { name: "ch00-a.md", content: "alpha" },
        { name: "ch01-b.md", content: "DIFFERENT" },
      ]),
      FIELDS_OK,
    );
    if (c.kind !== "success") throw new Error("expected success");
    expect(c.draftHash).not.toBe(a.draftHash);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Phase 6 Stream K.1 (D17.2) — virtual-root resolution, __MACOSX strip,
  // slug-derivation aggregate. Nine new tests.
  // ──────────────────────────────────────────────────────────────────────────

  it("K.1: wrapped zip — manifest at ${virtualRoot}/manifest.yaml resolves correctly; result.virtualRoot equals the wrapping prefix", async () => {
    const buffer = buildZip([
      {
        name: "nqa1-agent-qa-manual/manifest.yaml",
        content: `title: Wrapped Book
slug: wrapped-book
domain: qa
chapters:
  - slug: alpha
    file: chapters/alpha.md
  - slug: beta
    file: chapters/beta.md
`,
      },
      { name: "nqa1-agent-qa-manual/chapters/alpha.md", content: "alpha body" },
      { name: "nqa1-agent-qa-manual/chapters/beta.md", content: "beta body" },
    ]);

    const out = await processZipUpload(buffer, FIELDS_OK);
    if (out.kind !== "success") throw new Error(`expected success, got ${out.kind}`);
    expect(out.virtualRoot).toBe("nqa1-agent-qa-manual/");
    expect(out.title).toBe("Wrapped Book"); // manifest wins
    expect(out.chapters.map((c) => c.slug)).toEqual(["alpha", "beta"]);
    expect(out.chapters[0].content).toBe("alpha body");
    expect(out.manifestPresent).toBe(true);
    expect(out.slugDerivation).toBe("manifest_explicit");
  });

  it("K.1: wrapped zip, no manifest — filename-fallback only considers entries under the virtual root; chapter slugs use OQ-1 prefix-strip", async () => {
    const buffer = buildZip([
      { name: "book/ch00-intro.md", content: "intro body" },
      { name: "book/ch01-body.md", content: "body body" },
    ]);

    const out = await processZipUpload(buffer, FIELDS_OK);
    if (out.kind !== "success") throw new Error(`expected success, got ${out.kind}`);
    expect(out.virtualRoot).toBe("book/");
    expect(out.manifestPresent).toBe(false);
    expect(out.slugDerivation).toBe("filename_fallback");
    expect(out.chapters.map((c) => c.slug)).toEqual(["intro", "body"]);
  });

  it("K.1: wrapping 4 levels deep is rejected with WRAPPING_TOO_DEEP (status=400)", async () => {
    // a/b/c/d/manifest.yaml — single-directory chain 4 levels deep.
    const buffer = buildZip([
      { name: "a/b/c/d/manifest.yaml", content: "chapters:\n  - slug: x\n" },
      { name: "a/b/c/d/chapters/x.md", content: "x body" },
    ]);

    const out = await processZipUpload(buffer, FIELDS_OK);
    expect(out.kind).toBe("rejected");
    if (out.kind !== "rejected") return;
    expect(out.code).toBe("WRAPPING_TOO_DEEP");
    expect(out.status).toBe(400);
  });

  it("K.1: wrapping exactly 3 levels deep is accepted at the cap", async () => {
    // a/b/c/manifest.yaml — single-directory chain exactly 3 levels deep.
    const buffer = buildZip([
      { name: "a/b/c/manifest.yaml", content: "chapters:\n  - slug: x\n" },
      { name: "a/b/c/chapters/x.md", content: "x body" },
    ]);

    const out = await processZipUpload(buffer, FIELDS_OK);
    if (out.kind !== "success") throw new Error(`expected success, got ${out.kind}`);
    expect(out.virtualRoot).toBe("a/b/c/");
    expect(out.chapters).toHaveLength(1);
    expect(out.chapters[0].slug).toBe("x");
  });

  it("K.1: flat zip — result.virtualRoot is null (regression check; Stream K behavior preserved)", async () => {
    const buffer = buildZip([
      { name: "ch00-intro.md", content: "intro" },
      { name: "ch01-body.md", content: "body" },
    ]);

    const out = await processZipUpload(buffer, FIELDS_OK);
    if (out.kind !== "success") throw new Error(`expected success, got ${out.kind}`);
    expect(out.virtualRoot).toBeNull();
    expect(out.slugDerivation).toBe("filename_fallback");
    expect(out.chapters).toHaveLength(2);
  });

  it("K.1: wrapped zip with SKILL.md at the virtual root is rejected with SKILL_DETECTED (not /SKILL.md)", async () => {
    const buffer = buildZip([
      {
        name: "wrapped-skill/SKILL.md",
        content: `---\nname: my-skill\ndescription: skill not book\n---\n\n# Body\n`,
      },
      { name: "wrapped-skill/helper.py", content: "print('hi')" },
    ]);

    const out = await processZipUpload(buffer, FIELDS_OK);
    expect(out.kind).toBe("rejected");
    if (out.kind !== "rejected") return;
    expect(out.code).toBe("SKILL_DETECTED");
  });

  it("K.1: wrapped zip + __MACOSX/ siblings — __MACOSX stripped at the top so virtual-root detection still sees a single top-level dir", async () => {
    const buffer = buildZip([
      // macOS Finder-style resource-fork siblings at zip root
      { name: "__MACOSX/._nqa1-agent-qa-manual", content: "resource fork garbage" },
      { name: "__MACOSX/nqa1-agent-qa-manual/._manifest.yaml", content: "more garbage" },
      { name: "__MACOSX/nqa1-agent-qa-manual/._ch00-intro.md", content: "even more garbage" },
      // The real wrapped book
      { name: "nqa1-agent-qa-manual/manifest.yaml", content: "chapters:\n  - slug: intro\n" },
      { name: "nqa1-agent-qa-manual/chapters/intro.md", content: "intro body" },
    ]);

    const out = await processZipUpload(buffer, FIELDS_OK);
    if (out.kind !== "success") throw new Error(`expected success, got ${out.kind}`);
    expect(out.virtualRoot).toBe("nqa1-agent-qa-manual/");
    expect(out.chapters).toHaveLength(1);
    expect(out.chapters[0].slug).toBe("intro");
    expect(out.chapters[0].content).toBe("intro body");
  });

  it("K.1: flat zip + __MACOSX/._ resource-fork .md files — filename-fallback ignores all __MACOSX entries", async () => {
    const buffer = buildZip([
      { name: "__MACOSX/._ch00-intro.md", content: "resource fork pretending to be markdown" },
      { name: "__MACOSX/._ch01-body.md", content: "more resource fork garbage" },
      { name: "ch00-intro.md", content: "real intro body" },
      { name: "ch01-body.md", content: "real body body" },
    ]);

    const out = await processZipUpload(buffer, FIELDS_OK);
    if (out.kind !== "success") throw new Error(`expected success, got ${out.kind}`);
    expect(out.virtualRoot).toBeNull();
    expect(out.chapters).toHaveLength(2); // not 4 — the __MACOSX/._*.md are stripped
    expect(out.chapters.map((c) => c.content)).toEqual(["real intro body", "real body body"]);
  });

  it("K.1: mixed-mode manifest (one chapter file-only, one slug-only, one with both) is valid; slugDerivation='mixed'", async () => {
    const buffer = buildZip([
      {
        name: "manifest.yaml",
        content: `chapters:
  - file: chapters/file-only.md
  - slug: slug-only
  - file: chapters/explicit-both.md
    slug: explicit-both
`,
      },
      { name: "chapters/file-only.md", content: "file-only body" },
      { name: "chapters/slug-only.md", content: "slug-only body" },
      { name: "chapters/explicit-both.md", content: "explicit-both body" },
    ]);

    const out = await processZipUpload(buffer, FIELDS_OK);
    if (out.kind !== "success") throw new Error(`expected success, got ${out.kind}`);
    expect(out.slugDerivation).toBe("mixed");
    expect(out.chapters.map((c) => c.slug)).toEqual(["file-only", "slug-only", "explicit-both"]);
  });
});
