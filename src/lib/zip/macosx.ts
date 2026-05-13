// Phase 6 Stream L (D18.1) — shared `__MACOSX/` resource-fork filter.
//
// Extracted from the inline `.filter((e) => !e.entryName.startsWith("__MACOSX/"))`
// in src/lib/books/zip-upload.ts. macOS Finder zips carry resource-fork
// siblings under this prefix; skill pipeline needs the same strip (Stream L
// commit 3), and centralizing the prefix avoids drift if it ever needs
// extending (e.g., AppleDouble `._` prefixes too).

export const MACOSX_PREFIX = "__MACOSX/";

export function isMacOsxEntry(name: string): boolean {
  return name.startsWith(MACOSX_PREFIX);
}
