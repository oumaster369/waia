import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";

/** Intended future Worker binding. Not registered in wrangler.jsonc by WP-5. */
export const TREASURY_EVIDENCE_R2_BINDING_NAME = "TREASURY_EVIDENCE_R2" as const;

export const TREASURY_EVIDENCE_STORAGE_BACKEND = "cloudflare-r2" as const;

export const TREASURY_EVIDENCE_SCHEMA_VERSION = "treasury-evidence/v1" as const;

export const TREASURY_EVIDENCE_OBJECT_KEY_PREFIX = "treasury-evidence/v1" as const;

/** Named WP-5 technical safety limit. Not a financial or product doctrine. */
export const TREASURY_EVIDENCE_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const TREASURY_EVIDENCE_DEFAULT_SOURCE = "admin-upload" as const;

export const TREASURY_EVIDENCE_ALLOWED_CUSTOM_METADATA_KEYS = [
  "schemaVersion",
  "organizationId",
  "evidenceObjectId",
  "sha256",
] as const;

export type TreasuryEvidenceCustomMetadata = {
  schemaVersion: typeof TREASURY_EVIDENCE_SCHEMA_VERSION;
  organizationId: string;
  evidenceObjectId: string;
  sha256: string;
};

export type TreasuryEvidencePutImmutableInput = {
  key: string;
  body: Uint8Array;
  contentType: string;
  sha256Hex: string;
  customMetadata: TreasuryEvidenceCustomMetadata;
};

export type TreasuryEvidenceStoredObject = {
  key: string;
  body: Uint8Array;
  contentType: string | undefined;
  byteSize: number;
  sha256Hex: string | undefined;
  customMetadata: Record<string, string>;
};

export type TreasuryEvidenceObjectHead = Omit<TreasuryEvidenceStoredObject, "body">;

/**
 * Narrow Treasury Evidence storage port.
 * Does not expose list, committed delete, copy, or raw R2Bucket.
 */
export type TreasuryEvidenceStorage = {
  putImmutable(input: TreasuryEvidencePutImmutableInput): Promise<void>;
  get(key: string): Promise<TreasuryEvidenceStoredObject | null>;
  head(key: string): Promise<TreasuryEvidenceObjectHead | null>;
  /**
   * Compensation delete for the exact object written by a failed upload
   * before successful evidence metadata registration. Never a general delete API.
   */
  compensateUncommittedPut(key: string): Promise<void>;
};

/**
 * Minimal Worker R2 binding shape. Structural so tests need no Cloudflare account.
 * Semantics: `put` with `onlyIf.etagDoesNotMatch: "*"` must not overwrite.
 */
export type TreasuryEvidenceR2LikeBucket = {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
      sha256?: ArrayBuffer | string;
      onlyIf?: { etagDoesNotMatch?: string };
    },
  ): Promise<{
    etag?: string;
    size?: number;
    checksums?: { sha256?: ArrayBuffer };
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
  } | null>;
  get(key: string): Promise<{
    size?: number;
    arrayBuffer(): Promise<ArrayBuffer>;
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
    checksums?: { sha256?: ArrayBuffer };
  } | null>;
  head(key: string): Promise<{
    size: number;
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
    checksums?: { sha256?: ArrayBuffer };
  } | null>;
  delete(key: string): Promise<void>;
};

export function assertAllowedCustomMetadata(
  metadata: Record<string, string>,
): TreasuryEvidenceCustomMetadata {
  const keys = Object.keys(metadata);
  for (const key of keys) {
    if (
      !TREASURY_EVIDENCE_ALLOWED_CUSTOM_METADATA_KEYS.includes(
        key as (typeof TREASURY_EVIDENCE_ALLOWED_CUSTOM_METADATA_KEYS)[number],
      )
    ) {
      throw new TreasuryValidationError(
        "EVIDENCE_METADATA_FORBIDDEN",
        `${key} is not permitted in R2 custom metadata`,
      );
    }
  }
  for (const required of TREASURY_EVIDENCE_ALLOWED_CUSTOM_METADATA_KEYS) {
    if (typeof metadata[required] !== "string" || metadata[required].length === 0) {
      throw new TreasuryValidationError(
        "EVIDENCE_METADATA_FORBIDDEN",
        `${required} is required in R2 custom metadata`,
      );
    }
  }
  return metadata as TreasuryEvidenceCustomMetadata;
}
