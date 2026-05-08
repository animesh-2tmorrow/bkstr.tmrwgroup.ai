#!/usr/bin/env node
/**
 * Book import script.
 *
 * Usage:
 *   npm run import-book -- \
 *     --publisher "tmrwgroup" \
 *     --title "NotebookLM Skill" \
 *     --domain "skill" \
 *     --file ./seed-content/notebooklm-skill.md
 *
 *   Optional: --slug <custom> to override the auto-slugified title.
 *
 * Behavior (D7.1–D7.7):
 * - Upserts publisher by slug (auto-slugified from --publisher name; "TMRW Group"
 *   and "tmrwgroup" produce different rows — operator's responsibility per D7.4).
 * - Upserts book by (publisher_id, slug); slug auto-generated from title unless
 *   --slug is provided.
 * - Computes SHA-256 of file content vs latest version's content. If equal,
 *   no-op exit. Otherwise inserts a new book_version with version = max+1.
 * - book_versions.content_uri is set to "inline://<book_version_id>" — the
 *   UUID is generated client-side via crypto.randomUUID() so id and uri are
 *   set in a single insert (no two-phase create-then-update). See #45 for the
 *   content_uri/content schema-debt cleanup.
 *
 * Exit codes:
 *   0  success (new version OR unchanged no-op)
 *   1  usage error (missing/bad args, file missing, file empty)
 *   2  DB error (or any other unexpected failure)
 */
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { prisma } from "../src/lib/db";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function fail(message: string, code: 1 | 2 = 1): never {
  console.error(message);
  process.exit(code);
}

const USAGE = `Usage: npm run import-book -- \\
  --publisher <name> \\
  --title <title> \\
  --domain <domain> \\
  --file <path> \\
  [--slug <slug>]`;

async function main() {
  const { values } = parseArgs({
    options: {
      publisher: { type: "string" },
      title: { type: "string" },
      domain: { type: "string" },
      file: { type: "string" },
      slug: { type: "string" },
    },
    strict: true,
  });

  if (!values.publisher || !values.title || !values.domain || !values.file) {
    fail(USAGE);
  }

  const publisherName = values.publisher.trim();
  const title = values.title.trim();
  const domain = values.domain.trim();
  const filePath = values.file;

  const publisherSlug = slugify(publisherName);
  const bookSlug = values.slug ? slugify(values.slug) : slugify(title);

  if (!publisherSlug) fail("--publisher slugifies to empty; check the name", 1);
  if (!bookSlug) fail("--title (or --slug) slugifies to empty; provide --slug", 1);
  if (!title) fail("--title is empty after trim", 1);
  if (!domain) fail("--domain is empty after trim", 1);

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (err) {
    fail(`Failed to read file: ${filePath}\n${err instanceof Error ? err.message : err}`, 1);
  }
  if (content.length === 0) fail(`File is empty: ${filePath}`, 1);

  const newHash = createHash("sha256").update(content).digest("hex");
  const byteSize = Buffer.byteLength(content, "utf8");

  // Step 1: Publisher upsert by slug (slug is the unique key; name is not).
  const publisher = await prisma.publisher.upsert({
    where: { slug: publisherSlug },
    update: {},
    create: { slug: publisherSlug, name: publisherName },
  });

  // Step 2: Book upsert by (publisher_id, slug).
  const book = await prisma.book.upsert({
    where: { publisherId_slug: { publisherId: publisher.id, slug: bookSlug } },
    update: { title, domain },
    create: { publisherId: publisher.id, slug: bookSlug, title, domain },
  });

  // Step 3: Compare against latest version.
  const latestVersion = await prisma.bookVersion.findFirst({
    where: { bookId: book.id },
    orderBy: { version: "desc" },
    select: { id: true, version: true, content: true },
  });

  if (latestVersion?.content) {
    const existingHash = createHash("sha256").update(latestVersion.content).digest("hex");
    if (existingHash === newHash) {
      console.log(
        `unchanged: ${publisherSlug}/${bookSlug} v${latestVersion.version} (${byteSize} bytes). no-op.`,
      );
      return;
    }
  }

  // Step 4: Insert new version. UUID generated client-side so contentUri can
  // reference it in the same insert (no two-phase create-then-update).
  const versionId = randomUUID();
  const nextVersion = (latestVersion?.version ?? 0) + 1;
  const inserted = await prisma.bookVersion.create({
    data: {
      id: versionId,
      bookId: book.id,
      version: nextVersion,
      contentUri: `inline://${versionId}`,
      byteSize,
      content,
    },
    select: { id: true, version: true, byteSize: true },
  });

  console.log(
    `imported: ${publisherSlug}/${bookSlug} v${inserted.version} (${inserted.byteSize} bytes, id=${inserted.id})`,
  );
}

main()
  .catch((err) => {
    console.error("Import failed:", err instanceof Error ? err.message : err);
    process.exit(2);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
