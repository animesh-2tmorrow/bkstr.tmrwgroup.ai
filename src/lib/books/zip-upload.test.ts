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
    expect(out.error).toMatch(/Stream L/);
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
});
