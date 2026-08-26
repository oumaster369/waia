import { getCloudflareContext } from "@opennextjs/cloudflare";

import { createR2TreasuryEvidenceStorage } from "@/lib/waia-core/treasury/evidence/r2-adapter";
import {
  TREASURY_EVIDENCE_R2_BINDING_NAME,
  type TreasuryEvidenceR2LikeBucket,
  type TreasuryEvidenceStorage,
} from "@/lib/waia-core/treasury/evidence/types";

type CloudflareContextReader = () => unknown;

function hasFunction(value: object, key: string): boolean {
  return typeof Reflect.get(value, key) === "function";
}

function isTreasuryEvidenceR2LikeBucket(
  value: unknown,
): value is TreasuryEvidenceR2LikeBucket {
  return (
    typeof value === "object" &&
    value !== null &&
    hasFunction(value, "put") &&
    hasFunction(value, "get") &&
    hasFunction(value, "head") &&
    hasFunction(value, "delete")
  );
}

function resolveCloudflareBucket(
  readCloudflareContext: CloudflareContextReader,
): TreasuryEvidenceR2LikeBucket | null {
  try {
    const context = readCloudflareContext();
    if (typeof context !== "object" || context === null) return null;
    const env = Reflect.get(context, "env");
    if (typeof env !== "object" || env === null) return null;
    const bucket = Reflect.get(env, TREASURY_EVIDENCE_R2_BINDING_NAME);
    return isTreasuryEvidenceR2LikeBucket(bucket) ? bucket : null;
  } catch {
    return null;
  }
}

export type ResolveTreasuryEvidenceStorageOptions = {
  storage?: TreasuryEvidenceStorage | null;
  bucket?: TreasuryEvidenceR2LikeBucket | null;
  readCloudflareContext?: CloudflareContextReader;
};

/**
 * Resolves an explicit test adapter first, then the private Cloudflare R2 binding.
 * Missing or malformed runtime capability fails closed and must never break an
 * ordinary route or app initialization outside workerd.
 */
export function resolveTreasuryEvidenceStorage(
  options?: ResolveTreasuryEvidenceStorageOptions,
): TreasuryEvidenceStorage | null {
  if (options?.storage) return options.storage;
  if (options?.bucket) return createR2TreasuryEvidenceStorage(options.bucket);
  const bucket = resolveCloudflareBucket(
    options?.readCloudflareContext ?? getCloudflareContext,
  );
  return bucket ? createR2TreasuryEvidenceStorage(bucket) : null;
}
