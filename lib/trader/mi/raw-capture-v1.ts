import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";

export const RAW_CAPTURE_POLICY_V1_SCHEMA_VERSION = "raw-capture-policy-v1" as const;
export const RAW_SECRET_SCAN_V1_SCHEMA_VERSION = "raw-secret-scan-receipt-v1" as const;
export const RAW_STORAGE_BINDING_V1_SCHEMA_VERSION = "raw-storage-binding-v1" as const;
export const RAW_CAPTURE_RECEIPT_V1_SCHEMA_VERSION = "raw-capture-receipt-v1" as const;
export const RAW_VALIDATION_RECEIPT_V1_SCHEMA_VERSION = "raw-validation-receipt-v1" as const;

const HEX_64 = /^[0-9a-f]{64}$/;
const REASON_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

export type RawCapturePolicyV1 = {
  schemaVersion: typeof RAW_CAPTURE_POLICY_V1_SCHEMA_VERSION;
  maxPayloadBytes: number;
  retentionSeconds: number;
  storageClass: "PRIVATE_ENCRYPTED_OBJECT";
  accessClass: "SERVER_ONLY";
  policyDigest: string;
};

export type RawSecretScanReceiptV1 = {
  schemaVersion: typeof RAW_SECRET_SCAN_V1_SCHEMA_VERSION;
  status: "PASS" | "FAIL";
  rawBytesDigest: string;
  scannerId: string;
  scannerVersion: string;
  completedAtUtc: string;
  contentDigest: string;
};

export type RawObjectReferenceV1 = {
  storageBackendId: string;
  objectKey: string;
  objectVersion: string;
  encryptionRequirement: "PRIVATE_ENCRYPTED";
  accessRequirement: "SERVER_ONLY";
};

export type RawStorageBindingV1 = {
  id: string;
  schemaVersion: typeof RAW_STORAGE_BINDING_V1_SCHEMA_VERSION;
  organizationId: string;
  sourceId: string;
  rawBytesDigest: string;
  objectReference: RawObjectReferenceV1;
  storedAtUtc: string;
  contentDigest: string;
};

export type RawCaptureReceiptV1 = {
  id: string;
  schemaVersion: typeof RAW_CAPTURE_RECEIPT_V1_SCHEMA_VERSION;
  organizationId: string;
  sourceId: string;
  rawBytesDigest: string;
  payloadBytes: number;
  policyDigest: string;
  secretScanReceiptDigest: string;
  storageBindingDigest: string;
  capturedAtUtc: string;
  retentionUntilUtc: string;
  authority: "RECORD_ONLY";
  contentDigest: string;
};

export type RawValidationReasonCodeV1 = string;

export type RawValidationOutcomeV1 =
  | { status: "VALID"; reasonCodes: [] }
  | { status: "REJECTED"; reasonCodes: RawValidationReasonCodeV1[] };

export type RawValidationReceiptV1 = {
  id: string;
  schemaVersion: typeof RAW_VALIDATION_RECEIPT_V1_SCHEMA_VERSION;
  organizationId: string;
  sourceId: string;
  captureReceiptDigest: string;
  validatorId: string;
  validatorVersion: string;
  status: RawValidationOutcomeV1["status"];
  reasonCodes: RawValidationReasonCodeV1[];
  knownAtUtc: string;
  authority: "RECORD_ONLY";
  observationAuthority: "NONE";
  measurementAuthority: "NONE";
  contentDigest: string;
};

export type RawCaptureCommandV1 = {
  organizationId: string;
  sourceId: string;
  bodyBytes: Uint8Array;
  policy: RawCapturePolicyV1;
  secretScanReceipt: RawSecretScanReceiptV1;
};

export type PreparedRawCaptureV1 = {
  organizationId: string;
  sourceId: string;
  bodyBytes: Uint8Array;
  rawBytesDigest: string;
  payloadBytes: number;
  policy: RawCapturePolicyV1;
  secretScanReceipt: RawSecretScanReceiptV1;
};

export type RawCaptureRejectionReasonV1 =
  | "INVALID_SCOPE"
  | "POLICY_REQUIRED"
  | "INVALID_POLICY"
  | "INVALID_BODY_BYTES"
  | "PAYLOAD_TOO_LARGE"
  | "SECRET_SCAN_REQUIRED"
  | "INVALID_SECRET_SCAN_RECEIPT"
  | "SECRET_SCAN_NOT_PASS"
  | "SECRET_SCAN_DIGEST_MISMATCH"
  | "INVALID_DURABLE_TIME"
  | "INVALID_STORAGE_BINDING"
  | "INVALID_VALIDATION_OUTCOME";

export class RawCaptureRejectedError extends Error {
  constructor(readonly reason: RawCaptureRejectionReasonV1) {
    super(`[trader] raw capture rejected: ${reason}`);
    this.name = "RawCaptureRejectedError";
  }
}

function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJsonString(value), "utf8").digest("hex");
}

export function digestRawBytesV1(bodyBytes: Uint8Array): string {
  return createHash("sha256").update(bodyBytes).digest("hex");
}

function requireNonEmpty(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RawCaptureRejectedError("INVALID_SCOPE");
  }
  return value;
}

function requireIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new RawCaptureRejectedError("INVALID_DURABLE_TIME");
  }
  return date.toISOString();
}

function hasCanonicalDigest(contentDigest: string, body: unknown): boolean {
  return HEX_64.test(contentDigest) && sha256Canonical(body) === contentDigest;
}

function isUint8Array(value: unknown): value is Uint8Array {
  return ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === "[object Uint8Array]";
}

export function defineRawCapturePolicyV1(input: {
  maxPayloadBytes: number;
  retentionSeconds: number;
}): RawCapturePolicyV1 {
  if (
    !Number.isSafeInteger(input.maxPayloadBytes) || input.maxPayloadBytes <= 0 ||
    !Number.isSafeInteger(input.retentionSeconds) || input.retentionSeconds <= 0
  ) {
    throw new RawCaptureRejectedError("INVALID_POLICY");
  }
  const body = {
    schemaVersion: RAW_CAPTURE_POLICY_V1_SCHEMA_VERSION,
    maxPayloadBytes: input.maxPayloadBytes,
    retentionSeconds: input.retentionSeconds,
    storageClass: "PRIVATE_ENCRYPTED_OBJECT" as const,
    accessClass: "SERVER_ONLY" as const,
  };
  return { ...body, policyDigest: sha256Canonical(body) };
}

export function isRawCapturePolicyV1(value: RawCapturePolicyV1): boolean {
  if (!value || value.schemaVersion !== RAW_CAPTURE_POLICY_V1_SCHEMA_VERSION) return false;
  if (!Number.isSafeInteger(value.maxPayloadBytes) || value.maxPayloadBytes <= 0) return false;
  if (!Number.isSafeInteger(value.retentionSeconds) || value.retentionSeconds <= 0) return false;
  if (value.storageClass !== "PRIVATE_ENCRYPTED_OBJECT" || value.accessClass !== "SERVER_ONLY") return false;
  const { policyDigest, ...body } = value;
  return HEX_64.test(policyDigest) && sha256Canonical(body) === policyDigest;
}

/**
 * Packages an external scanner verdict into a digest-bound receipt. This function is not a
 * scanner and grants no production/runtime authority; capture admission still rejects FAIL.
 */
export function attestRawSecretScanV1(input: {
  status: "PASS" | "FAIL";
  bodyBytes: Uint8Array;
  scannerId: string;
  scannerVersion: string;
  completedAt: Date;
}): RawSecretScanReceiptV1 {
  const body = {
    schemaVersion: RAW_SECRET_SCAN_V1_SCHEMA_VERSION,
    status: input.status,
    rawBytesDigest: digestRawBytesV1(input.bodyBytes),
    scannerId: requireNonEmpty(input.scannerId),
    scannerVersion: requireNonEmpty(input.scannerVersion),
    completedAtUtc: requireIso(input.completedAt),
  };
  return { ...body, contentDigest: sha256Canonical(body) };
}

export function isRawSecretScanReceiptV1(value: RawSecretScanReceiptV1): boolean {
  if (!value || value.schemaVersion !== RAW_SECRET_SCAN_V1_SCHEMA_VERSION) return false;
  if (value.status !== "PASS" && value.status !== "FAIL") return false;
  if (!HEX_64.test(value.rawBytesDigest) || !value.scannerId || !value.scannerVersion) return false;
  try { requireIso(value.completedAtUtc); } catch { return false; }
  const { contentDigest, ...body } = value;
  return hasCanonicalDigest(contentDigest, body);
}

/** The command intentionally has no headers, cookies, authorization, query, URL, or time fields. */
export function prepareRawCaptureV1(command: RawCaptureCommandV1): PreparedRawCaptureV1 {
  if (!command || !command.policy) throw new RawCaptureRejectedError("POLICY_REQUIRED");
  if (!isRawCapturePolicyV1(command.policy)) throw new RawCaptureRejectedError("INVALID_POLICY");
  if (!isUint8Array(command.bodyBytes)) throw new RawCaptureRejectedError("INVALID_BODY_BYTES");
  if (command.bodyBytes.byteLength > command.policy.maxPayloadBytes) {
    throw new RawCaptureRejectedError("PAYLOAD_TOO_LARGE");
  }
  if (!command.secretScanReceipt) throw new RawCaptureRejectedError("SECRET_SCAN_REQUIRED");
  if (!isRawSecretScanReceiptV1(command.secretScanReceipt)) {
    throw new RawCaptureRejectedError("INVALID_SECRET_SCAN_RECEIPT");
  }
  if (command.secretScanReceipt.status !== "PASS") {
    throw new RawCaptureRejectedError("SECRET_SCAN_NOT_PASS");
  }
  const bodyBytes = Uint8Array.from(command.bodyBytes);
  const rawBytesDigest = digestRawBytesV1(bodyBytes);
  if (command.secretScanReceipt.rawBytesDigest !== rawBytesDigest) {
    throw new RawCaptureRejectedError("SECRET_SCAN_DIGEST_MISMATCH");
  }
  return {
    organizationId: requireNonEmpty(command.organizationId),
    sourceId: requireNonEmpty(command.sourceId),
    bodyBytes,
    rawBytesDigest,
    payloadBytes: bodyBytes.byteLength,
    policy: command.policy,
    secretScanReceipt: command.secretScanReceipt,
  };
}

export function buildRawStorageBindingAtDurableBoundaryV1(input: {
  organizationId: string;
  sourceId: string;
  rawBytesDigest: string;
  objectReference: RawObjectReferenceV1;
  storedAt: Date;
}): RawStorageBindingV1 {
  const ref = input.objectReference;
  if (
    !HEX_64.test(input.rawBytesDigest) || !ref ||
    !ref.storageBackendId || !ref.objectKey || !ref.objectVersion ||
    ref.encryptionRequirement !== "PRIVATE_ENCRYPTED" || ref.accessRequirement !== "SERVER_ONLY"
  ) throw new RawCaptureRejectedError("INVALID_STORAGE_BINDING");
  const body = {
    schemaVersion: RAW_STORAGE_BINDING_V1_SCHEMA_VERSION,
    organizationId: requireNonEmpty(input.organizationId),
    sourceId: requireNonEmpty(input.sourceId),
    rawBytesDigest: input.rawBytesDigest,
    objectReference: { ...ref },
    storedAtUtc: requireIso(input.storedAt),
  };
  const contentDigest = sha256Canonical(body);
  return { id: contentDigest, ...body, contentDigest };
}

export function isRawStorageBindingV1(value: RawStorageBindingV1): boolean {
  if (!value || value.schemaVersion !== RAW_STORAGE_BINDING_V1_SCHEMA_VERSION) return false;
  if (!HEX_64.test(value.rawBytesDigest)) return false;
  if (
    !value.organizationId || !value.sourceId || !value.objectReference?.storageBackendId ||
    !value.objectReference.objectKey || !value.objectReference.objectVersion ||
    value.objectReference.encryptionRequirement !== "PRIVATE_ENCRYPTED" ||
    value.objectReference.accessRequirement !== "SERVER_ONLY"
  ) return false;
  try { requireIso(value.storedAtUtc); } catch { return false; }
  const { id, contentDigest, ...body } = value;
  return id === contentDigest && hasCanonicalDigest(contentDigest, body);
}

export function buildRawCaptureReceiptAtDurableBoundaryV1(input: {
  prepared: PreparedRawCaptureV1;
  storageBinding: RawStorageBindingV1;
  capturedAt: Date;
}): RawCaptureReceiptV1 {
  const { prepared, storageBinding } = input;
  if (
    !isRawStorageBindingV1(storageBinding) ||
    storageBinding.organizationId !== prepared.organizationId ||
    storageBinding.sourceId !== prepared.sourceId ||
    storageBinding.rawBytesDigest !== prepared.rawBytesDigest
  ) throw new RawCaptureRejectedError("INVALID_STORAGE_BINDING");
  const capturedAtUtc = requireIso(input.capturedAt);
  if (
    new Date(storageBinding.storedAtUtc).getTime() > new Date(capturedAtUtc).getTime() ||
    new Date(prepared.secretScanReceipt.completedAtUtc).getTime() > new Date(capturedAtUtc).getTime()
  ) throw new RawCaptureRejectedError("INVALID_DURABLE_TIME");
  const retentionUntil = new Date(
    new Date(capturedAtUtc).getTime() + prepared.policy.retentionSeconds * 1_000,
  );
  if (!Number.isFinite(retentionUntil.getTime())) {
    throw new RawCaptureRejectedError("INVALID_DURABLE_TIME");
  }
  const body = {
    schemaVersion: RAW_CAPTURE_RECEIPT_V1_SCHEMA_VERSION,
    organizationId: prepared.organizationId,
    sourceId: prepared.sourceId,
    rawBytesDigest: prepared.rawBytesDigest,
    payloadBytes: prepared.payloadBytes,
    policyDigest: prepared.policy.policyDigest,
    secretScanReceiptDigest: prepared.secretScanReceipt.contentDigest,
    storageBindingDigest: storageBinding.contentDigest,
    capturedAtUtc,
    retentionUntilUtc: retentionUntil.toISOString(),
    authority: "RECORD_ONLY" as const,
  };
  const contentDigest = sha256Canonical(body);
  return { id: contentDigest, ...body, contentDigest };
}

export function isRawCaptureReceiptV1(value: RawCaptureReceiptV1): boolean {
  if (!value || value.schemaVersion !== RAW_CAPTURE_RECEIPT_V1_SCHEMA_VERSION) return false;
  if (
    !value.organizationId || !value.sourceId || !Number.isSafeInteger(value.payloadBytes) ||
    value.payloadBytes < 0 ||
    ![value.rawBytesDigest, value.policyDigest, value.secretScanReceiptDigest, value.storageBindingDigest]
      .every((digest) => HEX_64.test(digest))
  ) return false;
  const capturedAt = new Date(value.capturedAtUtc);
  const retentionUntil = new Date(value.retentionUntilUtc);
  if (
    !Number.isFinite(capturedAt.getTime()) || !Number.isFinite(retentionUntil.getTime()) ||
    retentionUntil.getTime() <= capturedAt.getTime()
  ) return false;
  const { id, contentDigest, ...body } = value;
  return id === contentDigest && value.authority === "RECORD_ONLY" && hasCanonicalDigest(contentDigest, body);
}

function normalizeOutcome(outcome: RawValidationOutcomeV1): RawValidationOutcomeV1 {
  if (!outcome || (outcome.status !== "VALID" && outcome.status !== "REJECTED")) {
    throw new RawCaptureRejectedError("INVALID_VALIDATION_OUTCOME");
  }
  const reasonCodes = [...outcome.reasonCodes];
  if (reasonCodes.some((reason) => typeof reason !== "string" || !REASON_CODE.test(reason))) {
    throw new RawCaptureRejectedError("INVALID_VALIDATION_OUTCOME");
  }
  const normalized = [...new Set(reasonCodes)].sort();
  if (outcome.status === "VALID" && normalized.length !== 0) {
    throw new RawCaptureRejectedError("INVALID_VALIDATION_OUTCOME");
  }
  if (outcome.status === "REJECTED" && normalized.length === 0) {
    throw new RawCaptureRejectedError("INVALID_VALIDATION_OUTCOME");
  }
  return outcome.status === "VALID"
    ? { status: "VALID", reasonCodes: [] }
    : { status: "REJECTED", reasonCodes: normalized };
}

export function buildRawValidationReceiptAtDurableBoundaryV1(input: {
  captureReceipt: RawCaptureReceiptV1;
  validatorId: string;
  validatorVersion: string;
  outcome: RawValidationOutcomeV1;
  knownAt: Date;
}): RawValidationReceiptV1 {
  if (!isRawCaptureReceiptV1(input.captureReceipt)) {
    throw new RawCaptureRejectedError("INVALID_STORAGE_BINDING");
  }
  const knownAtUtc = requireIso(input.knownAt);
  if (new Date(knownAtUtc).getTime() < new Date(input.captureReceipt.capturedAtUtc).getTime()) {
    throw new RawCaptureRejectedError("INVALID_DURABLE_TIME");
  }
  const outcome = normalizeOutcome(input.outcome);
  const body = {
    schemaVersion: RAW_VALIDATION_RECEIPT_V1_SCHEMA_VERSION,
    organizationId: input.captureReceipt.organizationId,
    sourceId: input.captureReceipt.sourceId,
    captureReceiptDigest: input.captureReceipt.contentDigest,
    validatorId: requireNonEmpty(input.validatorId),
    validatorVersion: requireNonEmpty(input.validatorVersion),
    status: outcome.status,
    reasonCodes: outcome.reasonCodes,
    knownAtUtc,
    authority: "RECORD_ONLY" as const,
    observationAuthority: "NONE" as const,
    measurementAuthority: "NONE" as const,
  };
  const contentDigest = sha256Canonical(body);
  return { id: contentDigest, ...body, contentDigest };
}

export function isRawValidationReceiptV1(value: RawValidationReceiptV1): boolean {
  if (!value || value.schemaVersion !== RAW_VALIDATION_RECEIPT_V1_SCHEMA_VERSION) return false;
  if (!value.organizationId || !value.sourceId || !HEX_64.test(value.captureReceiptDigest)) return false;
  try {
    requireIso(value.knownAtUtc);
    normalizeOutcome({ status: value.status, reasonCodes: value.reasonCodes } as RawValidationOutcomeV1);
  } catch { return false; }
  const { id, contentDigest, ...body } = value;
  return (
    id === contentDigest && value.authority === "RECORD_ONLY" &&
    value.observationAuthority === "NONE" && value.measurementAuthority === "NONE" &&
    hasCanonicalDigest(contentDigest, body)
  );
}

export function serializeRawCaptureReceiptV1(receipt: RawCaptureReceiptV1): string {
  return canonicalJsonString(receipt);
}

export function serializeRawStorageBindingV1(binding: RawStorageBindingV1): string {
  return canonicalJsonString(binding);
}

export function serializeRawValidationReceiptV1(receipt: RawValidationReceiptV1): string {
  return canonicalJsonString(receipt);
}
