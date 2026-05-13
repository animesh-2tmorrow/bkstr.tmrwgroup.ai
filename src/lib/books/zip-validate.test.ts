import { describe, it, expect } from "vitest";
import {
  isSafeZipEntryName,
  checkEntrySize,
  checkAggregateLimits,
  ZipValidationError,
  MAX_PER_ENTRY_BYTES,
  MAX_ENTRIES,
  MAX_TOTAL_UNCOMPRESSED_BYTES,
} from "./zip-validate";

describe("zip-validate", () => {
  it("isSafeZipEntryName — rejects '..' segments, absolute paths, drive letters, and control characters", () => {
    expect(isSafeZipEntryName("../escape.md")).toBe(false);
    expect(isSafeZipEntryName("a/../b.md")).toBe(false);
    expect(isSafeZipEntryName("/abs/path.md")).toBe(false);
    expect(isSafeZipEntryName("\\abs\\windows.md")).toBe(false);
    expect(isSafeZipEntryName("C:foo.md")).toBe(false);
    expect(isSafeZipEntryName("ok\x00bad.md")).toBe(false);
    expect(isSafeZipEntryName("")).toBe(false);
  });

  it("isSafeZipEntryName — accepts ordinary relative paths", () => {
    expect(isSafeZipEntryName("chapters/intro.md")).toBe(true);
    expect(isSafeZipEntryName("nested/deep/file.md")).toBe(true);
    expect(isSafeZipEntryName("overview.md")).toBe(true);
    expect(isSafeZipEntryName("chapters/ch00-core.md")).toBe(true);
  });

  it("checkEntrySize — throws ZipValidationError(ENTRY_TOO_LARGE) for sizes above MAX_PER_ENTRY_BYTES", () => {
    expect(() => checkEntrySize({ name: "ok.md", size: MAX_PER_ENTRY_BYTES })).not.toThrow();
    expect(() => checkEntrySize({ name: "huge.md", size: MAX_PER_ENTRY_BYTES + 1 }))
      .toThrowError(ZipValidationError);
    try {
      checkEntrySize({ name: "huge.md", size: MAX_PER_ENTRY_BYTES + 1 });
    } catch (err) {
      expect((err as ZipValidationError).code).toBe("ENTRY_TOO_LARGE");
      expect((err as Error).message).toMatch(/huge\.md/);
    }
  });

  it("checkAggregateLimits — throws TOO_MANY_ENTRIES when entry count exceeds MAX_ENTRIES", () => {
    const entries = Array.from({ length: MAX_ENTRIES + 1 }, () => ({ size: 1 }));
    expect(() => checkAggregateLimits(entries)).toThrowError(ZipValidationError);
    try {
      checkAggregateLimits(entries);
    } catch (err) {
      expect((err as ZipValidationError).code).toBe("TOO_MANY_ENTRIES");
    }
  });

  it("checkAggregateLimits — throws TOO_LARGE_UNCOMPRESSED when total exceeds MAX_TOTAL_UNCOMPRESSED_BYTES", () => {
    // 21 entries of 1 MB each = 21 MB > 20 MB cap; 21 < 500 so the count cap doesn't fire first.
    const entries = Array.from({ length: 21 }, () => ({ size: 1024 * 1024 }));
    expect(() => checkAggregateLimits(entries)).toThrowError(ZipValidationError);
    try {
      checkAggregateLimits(entries);
    } catch (err) {
      expect((err as ZipValidationError).code).toBe("TOO_LARGE_UNCOMPRESSED");
      // Sanity: the cap constants are imported, not magic numbers
      expect(MAX_TOTAL_UNCOMPRESSED_BYTES).toBe(20 * 1024 * 1024);
    }
  });
});
