// Phase 6 Stream L (D18.1) — module body extracted to src/lib/zip/ per
// follow-up #116 (now closed). This file is a thin re-export shim so existing
// callers (zip-handler.ts, zip-upload.ts, zip-validate.test.ts) keep working
// unchanged. New code should import directly from @/lib/zip/* — see the
// canonical module layout in src/lib/zip/.

export {
  MAX_ZIP_BYTES,
  MAX_ENTRIES,
  MAX_PER_ENTRY_BYTES,
  MAX_TOTAL_UNCOMPRESSED_BYTES,
  ZIP_LIMITS,
} from "@/lib/zip/limits";

export {
  ZipValidationError,
  type ZipValidationErrorCode,
  isSafeZipEntryName,
  checkEntrySize,
  checkAggregateLimits,
} from "@/lib/zip/validate";
