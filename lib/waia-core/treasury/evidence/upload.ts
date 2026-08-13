import type { TreasuryEvidenceObjectRecord } from "@/lib/waia-core/treasury/admin/catalog-types";
import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import { treasuryEvidenceObjectKey } from "@/lib/waia-core/treasury/evidence/object-key";
import { normalizeSha256Hex, sha256HexFromBytes } from "@/lib/waia-core/treasury/evidence/sha256";
import {
  TREASURY_EVIDENCE_MAX_UPLOAD_BYTES,
  TREASURY_EVIDENCE_SCHEMA_VERSION,
  TREASURY_EVIDENCE_STORAGE_BACKEND,
  type TreasuryEvidenceStorage,
} from "@/lib/waia-core/treasury/evidence/types";

export type TreasuryEvidenceUploadInput = {
  organizationId: string;
  bytes: Uint8Array;
  mediaType: string;
  kind: TreasuryEvidenceObjectRecord["kind"];
  visibility: TreasuryEvidenceObjectRecord["visibility"];
  source: string;
  observedAt: Date;
  uploadedByUserId: string;
  expectedSha256Hex?: string;
};

export async function uploadTreasuryEvidenceObject(input: {
  storage: TreasuryEvidenceStorage | null;
  register: (record: TreasuryEvidenceObjectRecord) => Promise<void>;
  lookup: (evidenceObjectId: string) => Promise<TreasuryEvidenceObjectRecord | null>;
  payload: TreasuryEvidenceUploadInput;
  now?: () => Date;
  newId?: () => string;
}): Promise<TreasuryEvidenceObjectRecord> {
  if (!input.storage) {
    throw new TreasuryValidationError(
      "EVIDENCE_STORAGE_NOT_CONFIGURED",
      "Evidence object storage is not configured",
    );
  }
  if (input.payload.bytes.byteLength > TREASURY_EVIDENCE_MAX_UPLOAD_BYTES) {
    throw new TreasuryValidationError(
      "EVIDENCE_TOO_LARGE",
      "Evidence upload exceeds the WP-5 safety size limit",
    );
  }

  const evidenceObjectId = (input.newId ?? (() => crypto.randomUUID()))();
  const objectKey = treasuryEvidenceObjectKey(input.payload.organizationId, evidenceObjectId);
  const sha256Hex = sha256HexFromBytes(input.payload.bytes);
  if (input.payload.expectedSha256Hex) {
    const expected = normalizeSha256Hex(input.payload.expectedSha256Hex, "expected sha256");
    if (expected !== sha256Hex) {
      throw new TreasuryValidationError(
        "EVIDENCE_DIGEST_MISMATCH",
        "Client digest does not match the uploaded bytes",
      );
    }
  }

  const record: TreasuryEvidenceObjectRecord = {
    id: evidenceObjectId,
    organizationId: input.payload.organizationId,
    storageBackend: TREASURY_EVIDENCE_STORAGE_BACKEND,
    objectKey,
    mediaType: input.payload.mediaType,
    byteSize: BigInt(input.payload.bytes.byteLength),
    sha256: sha256Hex,
    kind: input.payload.kind,
    visibility: input.payload.visibility,
    source: input.payload.source,
    uploadedByUserId: input.payload.uploadedByUserId,
    observedAt: input.payload.observedAt,
    createdAt: (input.now ?? (() => new Date()))(),
  };

  await input.storage.putImmutable({
    key: objectKey,
    body: input.payload.bytes,
    contentType: input.payload.mediaType,
    sha256Hex,
    customMetadata: {
      schemaVersion: TREASURY_EVIDENCE_SCHEMA_VERSION,
      organizationId: input.payload.organizationId,
      evidenceObjectId,
      sha256: sha256Hex,
    },
  });

  try {
    await input.register(record);
  } catch (err) {
    const committed = await input.lookup(record.id);
    if (!committed) {
      try {
        await input.storage.compensateUncommittedPut(objectKey);
      } catch {
        // Preserve the registration failure. Never report success.
      }
    }
    throw err;
  }

  return record;
}
