import { createR2TreasuryEvidenceStorage } from "@/lib/waia-core/treasury/evidence/r2-adapter";
import type {
  TreasuryEvidenceR2LikeBucket,
  TreasuryEvidenceStorage,
} from "@/lib/waia-core/treasury/evidence/types";

/**
 * Production today has no R2 binding. Missing capability resolves to unavailable
 * and must never throw during ordinary route or app initialization.
 */
export function resolveTreasuryEvidenceStorage(options?: {
  storage?: TreasuryEvidenceStorage | null;
  bucket?: TreasuryEvidenceR2LikeBucket | null;
}): TreasuryEvidenceStorage | null {
  if (options?.storage) return options.storage;
  if (options?.bucket) return createR2TreasuryEvidenceStorage(options.bucket);
  return null;
}
