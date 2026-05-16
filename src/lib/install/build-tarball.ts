// Move 1 — in-memory gzipped-tarball builder for the install endpoint.
//
// PACKAGE NOTE: the Phase 2a dispatch named the `tar` npm package. `tar`
// is filesystem-oriented — `tar.c()` archives files that already exist on
// disk; it has no in-memory buffer-entry API. File 4's own instruction
// ("in-memory via PassThrough → collect to Buffer") cannot be satisfied
// by `tar` without staging the bundle through a temp directory. This
// implementation uses `tar-stream` (purpose-built for in-memory tar entry
// packing) piped through Node's built-in `zlib` gzip — exactly the
// requested in-memory shape, no temp files. The output is a standard
// gzipped POSIX tar, so the consumer one-liner (`tar xz`) is unaffected
// by the package choice.
//
// LAYOUT: every entry is prefixed with `<slug>/` so the consumer's
//   curl -sL .../api/install/<slug> | tar xz -C ~/.claude/skills/
// lands the bundle at ~/.claude/skills/<slug>/ — each install isolated,
// no file collisions between bundles sharing the skills directory.

import { createGzip } from "node:zlib";
import * as tar from "tar-stream";

export type TarballFile = { path: string; content: string };

export type BuildTarballInput = {
  slug: string;
  files: TarballFile[];
  /** One-line JSON forensic watermark; written to <slug>/.bkstr-install. */
  watermark: string;
};

// Promisified single-entry write. tar-stream's entry() with a content
// buffer + callback is the race-free way to append entries in sequence.
function addEntry(pack: tar.Pack, name: string, content: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const body = Buffer.from(content, "utf8");
    pack.entry({ name, size: body.length }, body, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Build the gzipped tar for an install bundle, entirely in memory.
 * Payloads are tens of KB (per the pre-gather), so collecting the gzip
 * output into a single Buffer is fine; switch to a streamed Response only
 * if bundles ever grow into the multi-MB range.
 */
export async function buildTarball(input: BuildTarballInput): Promise<Buffer> {
  const { slug, files, watermark } = input;
  const pack = tar.pack();
  const gzip = createGzip();
  const chunks: Buffer[] = [];

  const collected = new Promise<Buffer>((resolve, reject) => {
    gzip.on("data", (c: Buffer) => chunks.push(c));
    gzip.on("end", () => resolve(Buffer.concat(chunks)));
    gzip.on("error", reject);
    pack.on("error", reject);
  });
  pack.pipe(gzip);

  // Watermark first, then every bundle file under the <slug>/ namespace.
  await addEntry(pack, `${slug}/.bkstr-install`, watermark + "\n");
  for (const f of files) {
    // Strip any leading "./" or "/" so the <slug>/ prefix joins cleanly.
    const rel = f.path.replace(/^\.?\/+/, "");
    await addEntry(pack, `${slug}/${rel}`, f.content);
  }
  pack.finalize();

  return collected;
}
