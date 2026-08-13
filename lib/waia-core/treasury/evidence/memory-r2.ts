import {
  sha256HexFromBytes,
  sha256HexToArrayBuffer,
} from "@/lib/waia-core/treasury/evidence/sha256";
import type { TreasuryEvidenceR2LikeBucket } from "@/lib/waia-core/treasury/evidence/types";

function copyBytes(value: ArrayBuffer | ArrayBufferView | string): Uint8Array {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
}

type MemoryR2Object = {
  body: Uint8Array;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
  sha256Hex: string;
};

export type MemoryTreasuryEvidenceR2Bucket = TreasuryEvidenceR2LikeBucket & {
  lastPutOptions: {
    key: string;
    sha256?: ArrayBuffer | string;
    onlyIf?: { etagDoesNotMatch?: string };
    customMetadata?: Record<string, string>;
    httpMetadata?: { contentType?: string };
  } | null;
  has(key: string): boolean;
  objectCount(): number;
};

/**
 * Deterministic in-memory R2-like bucket. No network. No Cloudflare account.
 */
export function createMemoryTreasuryEvidenceR2Bucket(): MemoryTreasuryEvidenceR2Bucket {
  const objects = new Map<string, MemoryR2Object>();
  const bucket: MemoryTreasuryEvidenceR2Bucket = {
    lastPutOptions: null,
    has(key) {
      return objects.has(key);
    },
    objectCount() {
      return objects.size;
    },
    async put(key, value, options) {
      bucket.lastPutOptions = {
        key,
        sha256: options?.sha256,
        onlyIf: options?.onlyIf,
        customMetadata: options?.customMetadata,
        httpMetadata: options?.httpMetadata,
      };
      if (options?.onlyIf?.etagDoesNotMatch === "*" && objects.has(key)) {
        return null;
      }
      const body = copyBytes(value);
      const computed = sha256HexFromBytes(body);
      if (options?.sha256 !== undefined) {
        const provided =
          typeof options.sha256 === "string"
            ? options.sha256.trim().toLowerCase()
            : Buffer.from(options.sha256).toString("hex");
        if (provided !== computed) {
          throw new Error("R2 sha256 integrity option does not match object bytes");
        }
      }
      objects.set(key, {
        body,
        httpMetadata: options?.httpMetadata,
        customMetadata: options?.customMetadata ? { ...options.customMetadata } : undefined,
        sha256Hex: computed,
      });
      return {
        etag: computed.slice(0, 16),
        size: body.byteLength,
        checksums: { sha256: sha256HexToArrayBuffer(computed) },
        httpMetadata: options?.httpMetadata,
        customMetadata: options?.customMetadata ? { ...options.customMetadata } : undefined,
      };
    },
    async get(key) {
      const stored = objects.get(key);
      if (!stored) return null;
      const body = new Uint8Array(stored.body);
      return {
        size: body.byteLength,
        arrayBuffer: async () =>
          body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        httpMetadata: stored.httpMetadata,
        customMetadata: stored.customMetadata ? { ...stored.customMetadata } : undefined,
        checksums: { sha256: sha256HexToArrayBuffer(stored.sha256Hex) },
      };
    },
    async head(key) {
      const stored = objects.get(key);
      if (!stored) return null;
      return {
        size: stored.body.byteLength,
        httpMetadata: stored.httpMetadata,
        customMetadata: stored.customMetadata ? { ...stored.customMetadata } : undefined,
        checksums: { sha256: sha256HexToArrayBuffer(stored.sha256Hex) },
      };
    },
    async delete(key) {
      objects.delete(key);
    },
  };
  return bucket;
}
