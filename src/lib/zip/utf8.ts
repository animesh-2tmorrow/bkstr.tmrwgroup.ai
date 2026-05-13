// Phase 6 Stream L (D18.1) — strict UTF-8 decoding helper.
//
// adm-zip's `readAsText(entry, "utf8")` silently replaces invalid UTF-8 bytes
// with U+FFFD. For book chapters that's fine (publisher-written markdown,
// corruption surface is low). For skill files — `.py` or `.json` accidentally
// saved as cp1252 would silently corrupt at upload time — we want a hard
// reject instead.
//
// Skill upload pipeline (Stream L commit 3) replaces `entry.getData()` →
// `decodeStrictUtf8(buffer)` with the failure surfacing as INVALID_UTF8.
// Books continue to use the lenient `readAsText` path.

const STRICT_DECODER = new TextDecoder("utf-8", { fatal: true });

/** Decode a Buffer as strict UTF-8. Throws TypeError on any invalid sequence
 *  (no U+FFFD replacement). Caller translates to ZipUploadResult kind="rejected"
 *  with code INVALID_UTF8 at the route boundary. */
export function decodeStrictUtf8(buffer: Buffer): string {
  return STRICT_DECODER.decode(buffer);
}
