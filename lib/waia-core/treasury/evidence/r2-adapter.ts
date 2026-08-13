import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import {
  arrayBufferToSha256Hex,
  normalizeSha256Hex,
} from "@/lib/waia-core/treasury/evidence/sha256";
import {
  assertAllowedCustomMetadata,
  type TreasuryEvidencePutImmutableInput,
  type TreasuryEvidenceR2LikeBucket,
  type TreasuryEvidenceStorage,
  type TreasuryEvidenceStoredObject,
} from "@/lib/waia-core/treasury/evidence/types";

function checksumHex(checksums: { sha256?: ArrayBuffer } | undefined): string | undefined {
  if (!checksums?.sha256) return undefined;
  return arrayBufferToSha256Hex(checksums.sha256);
}

async function assertStoredDigestMatches(
  bucket: TreasuryEvidenceR2LikeBucket,
  key: string,
  expectedSha256Hex: string,
  putResult: {
    checksums?: { sha256?: ArrayBuffer };
    customMetadata?: Record<string, string>;
  },
): Promise<void> {
  const fromPut = checksumHex(putResult.checksums) ?? putResult.customMetadata?.sha256;
  if (fromPut) {
    if (normalizeSha256Hex(fromPut, "stored sha256") !== expectedSha256Hex) {
      throw new TreasuryValidationError(
        "EVIDENCE_INTEGRITY_MISMATCH",
        "Stored object checksum does not match the application digest",
      );
    }
    return;
  }
  const head = await bucket.head(key);
  const fromHead = checksumHex(head?.checksums) ?? head?.customMetadata?.sha256;
  if (!fromHead || normalizeSha256Hex(fromHead, "stored sha256") !== expectedSha256Hex) {
    throw new TreasuryValidationError(
      "EVIDENCE_INTEGRITY_MISMATCH",
      "Stored object checksum does not match the application digest",
    );
  }
}

function toStored(
  key: string,
  body: Uint8Array | undefined,
  meta: {
    size?: number;
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
    checksums?: { sha256?: ArrayBuffer };
  },
): TreasuryEvidenceStoredObject {
  const customMetadata = { ...(meta.customMetadata ?? {}) };
  return {
    key,
    body: body ? new Uint8Array(body) : new Uint8Array(0),
    contentType: meta.httpMetadata?.contentType,
    byteSize: body?.byteLength ?? meta.size ?? 0,
    sha256Hex: checksumHex(meta.checksums) ?? customMetadata.sha256,
    customMetadata,
  };
}

/**
 * Worker-binding R2 adapter. No S3 credentials, presigned URLs, r2.dev, or public URLs.
 */
export function createR2TreasuryEvidenceStorage(
  bucket: TreasuryEvidenceR2LikeBucket,
): TreasuryEvidenceStorage {
  return {
    async putImmutable(input: TreasuryEvidencePutImmutableInput): Promise<void> {
      const sha256Hex = normalizeSha256Hex(input.sha256Hex);
      const customMetadata = assertAllowedCustomMetadata({
        schemaVersion: input.customMetadata.schemaVersion,
        organizationId: input.customMetadata.organizationId,
        evidenceObjectId: input.customMetadata.evidenceObjectId,
        sha256: normalizeSha256Hex(input.customMetadata.sha256),
      });
      if (customMetadata.sha256 !== sha256Hex) {
        throw new TreasuryValidationError(
          "EVIDENCE_INTEGRITY_MISMATCH",
          "Custom metadata sha256 must match the application digest",
        );
      }

      let putResult: Awaited<ReturnType<TreasuryEvidenceR2LikeBucket["put"]>>;
      try {
        putResult = await bucket.put(input.key, input.body, {
          httpMetadata: { contentType: input.contentType },
          customMetadata,
          sha256: sha256Hex,
          onlyIf: { etagDoesNotMatch: "*" },
        });
      } catch (err) {
        if (err instanceof TreasuryValidationError) throw err;
        throw new TreasuryValidationError(
          "EVIDENCE_STORAGE_PUT_FAILED",
          "Evidence object could not be stored",
        );
      }

      if (putResult === null) {
        throw new TreasuryValidationError(
          "EVIDENCE_OBJECT_EXISTS",
          "Evidence object key already exists and cannot be overwritten",
        );
      }

      await assertStoredDigestMatches(bucket, input.key, sha256Hex, putResult);
    },

    async get(key: string) {
      const object = await bucket.get(key);
      if (!object) return null;
      const body = new Uint8Array(await object.arrayBuffer());
      return toStored(key, body, object);
    },

    async head(key: string) {
      const object = await bucket.head(key);
      if (!object) return null;
      const stored = toStored(key, undefined, object);
      return {
        key: stored.key,
        contentType: stored.contentType,
        byteSize: object.size,
        sha256Hex: stored.sha256Hex,
        customMetadata: stored.customMetadata,
      };
    },

    async compensateUncommittedPut(key: string) {
      await bucket.delete(key);
    },
  };
}
