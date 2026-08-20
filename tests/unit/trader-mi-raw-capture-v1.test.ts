import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { TestOnlyRawCaptureMemoryAdapterV1 } from "@/lib/trader/mi/raw-capture-memory-adapter-v1";
import {
  attestRawSecretScanV1,
  buildRawCaptureReceiptAtDurableBoundaryV1,
  buildRawStorageBindingAtDurableBoundaryV1,
  buildRawValidationReceiptAtDurableBoundaryV1,
  defineRawCapturePolicyV1,
  digestRawBytesV1,
  isRawCaptureReceiptV1,
  isRawStorageBindingV1,
  isRawValidationReceiptV1,
  prepareRawCaptureV1,
  RawCaptureRejectedError,
  serializeRawCaptureReceiptV1,
  type RawCaptureCommandV1,
  type RawCaptureReceiptV1,
  type RawValidationReceiptV1,
} from "@/lib/trader/mi/raw-capture-v1";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";

const ORG = "00000000-0000-4000-8000-000000065601";
const SOURCE = "00000000-0000-4000-8000-000000065611";
const BODY = new TextEncoder().encode('{"price":"1.23"}');
const POLICY = defineRawCapturePolicyV1({ maxPayloadBytes: 64, retentionSeconds: 3_600 });

function scan(body = BODY, status: "PASS" | "FAIL" = "PASS") {
  return attestRawSecretScanV1({
    status,
    bodyBytes: body,
    scannerId: "test-scanner",
    scannerVersion: "test-v1",
    completedAt: new Date("2026-08-20T09:00:00.000Z"),
  });
}

function command(body = BODY): RawCaptureCommandV1 {
  return {
    organizationId: ORG,
    sourceId: SOURCE,
    bodyBytes: body,
    policy: POLICY,
    secretScanReceipt: scan(body),
  };
}

function canonicalDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJsonString(value), "utf8").digest("hex");
}

function reseal<T extends { id: string; contentDigest: string }>(value: T): T {
  const { id: _id, contentDigest: _digest, ...body } = value;
  void _id; void _digest;
  const contentDigest = canonicalDigest(body);
  return { ...body, id: contentDigest, contentDigest } as T;
}

describe("Raw Capture V1 contracts (DEE-657)", () => {
  it("requires explicit policy and exact-byte PASS scan proof", () => {
    expect(() => prepareRawCaptureV1({ ...command(), policy: undefined } as unknown as RawCaptureCommandV1))
      .toThrowError(new RawCaptureRejectedError("POLICY_REQUIRED"));
    expect(() => prepareRawCaptureV1({ ...command(), secretScanReceipt: scan(BODY, "FAIL") }))
      .toThrowError(new RawCaptureRejectedError("SECRET_SCAN_NOT_PASS"));
    expect(() => prepareRawCaptureV1({ ...command(), bodyBytes: new TextEncoder().encode("changed") }))
      .toThrowError(new RawCaptureRejectedError("SECRET_SCAN_DIGEST_MISMATCH"));
    expect(() => prepareRawCaptureV1(command(new Uint8Array(65))))
      .toThrowError(new RawCaptureRejectedError("PAYLOAD_TOO_LARGE"));
  });

  it("copies exact bytes and ignores unadmitted transport-envelope properties", () => {
    const supplied = Uint8Array.from(BODY);
    const withForbiddenEnvelope = {
      ...command(supplied),
      headers: { authorization: "must-not-enter" },
      cookies: "must-not-enter",
      query: "token=must-not-enter",
    } as RawCaptureCommandV1 & Record<string, unknown>;
    const prepared = prepareRawCaptureV1(withForbiddenEnvelope);
    supplied.fill(0);
    expect(Array.from(prepared.bodyBytes)).toEqual(Array.from(BODY));
    expect(prepared.rawBytesDigest).toBe(digestRawBytesV1(BODY));
    expect(JSON.stringify(prepared)).not.toContain("must-not-enter");
    expect(Object.keys(prepared)).toEqual([
      "organizationId", "sourceId", "bodyBytes", "rawBytesDigest", "payloadBytes", "policy", "secretScanReceipt",
    ]);
  });

  it("separates raw, storage-binding, and capture receipt identities deterministically", () => {
    const times = [
      new Date("2026-08-20T09:05:00.000Z"),
      new Date("2026-08-20T09:06:00.000Z"),
    ];
    const adapter = new TestOnlyRawCaptureMemoryAdapterV1(() => times.shift()!);
    const first = adapter.capture(command());
    const validation = adapter.recordValidation({
      captureReceiptDigest: first.captureReceipt.contentDigest,
      validatorId: "generic-record-only",
      validatorVersion: "v1",
      outcome: { status: "REJECTED", reasonCodes: ["PAYLOAD_SCHEMA_UNKNOWN"] },
    });
    expect(first.captureReceipt.rawBytesDigest).not.toBe(first.storageBinding.contentDigest);
    expect(first.captureReceipt.contentDigest).not.toBe(first.storageBinding.contentDigest);
    expect(isRawStorageBindingV1(first.storageBinding)).toBe(true);
    expect(isRawCaptureReceiptV1(first.captureReceipt)).toBe(true);
    expect(isRawValidationReceiptV1(validation)).toBe(true);
    expect(Array.from(adapter.readBody(first.storageBinding.contentDigest)!)).toEqual(Array.from(BODY));
    expect(first.captureReceipt).toMatchObject({
      payloadBytes: BODY.byteLength,
      policy: { maxPayloadBytes: 64, retentionSeconds: 3_600 },
      secretScanReceipt: { status: "PASS", scannerVersion: "test-v1" },
      authority: "RECORD_ONLY",
      capturedAtUtc: "2026-08-20T09:05:00.000Z",
      retentionUntilUtc: "2026-08-20T10:05:00.000Z",
    });
    expect(validation).toMatchObject({
      status: "REJECTED",
      reasonCodes: ["PAYLOAD_SCHEMA_UNKNOWN"],
      knownAtUtc: "2026-08-20T09:06:00.000Z",
      authority: "RECORD_ONLY",
      observationAuthority: "NONE",
      measurementAuthority: "NONE",
    });
    expect(serializeRawCaptureReceiptV1(first.captureReceipt)).not.toContain("price");
  });

  it("changes only the binding identity when the object locator changes", () => {
    const prepared = prepareRawCaptureV1(command());
    const base = {
      organizationId: ORG,
      sourceId: SOURCE,
      rawBytesDigest: prepared.rawBytesDigest,
      storedAt: new Date("2026-08-20T09:05:00.000Z"),
    };
    const a = buildRawStorageBindingAtDurableBoundaryV1({
      ...base,
      objectReference: {
        storageBackendId: "test",
        objectKey: "a",
        objectVersion: "1",
        encryptionRequirement: "PRIVATE_ENCRYPTED",
        accessRequirement: "SERVER_ONLY",
      },
    });
    const b = buildRawStorageBindingAtDurableBoundaryV1({
      ...base,
      objectReference: { ...a.objectReference, objectKey: "b" },
    });
    const aAgain = buildRawStorageBindingAtDurableBoundaryV1({
      ...base,
      objectReference: { ...a.objectReference },
    });
    expect(a.rawBytesDigest).toBe(b.rawBytesDigest);
    expect(a.contentDigest).not.toBe(b.contentDigest);
    expect(aAgain).toEqual(a);
  });

  it("rejects backdated durable validation time and invalid outcome shapes", () => {
    const adapter = new TestOnlyRawCaptureMemoryAdapterV1(
      () => new Date("2026-08-20T09:05:00.000Z"),
    );
    const { captureReceipt } = adapter.capture(command());
    expect(() => buildRawValidationReceiptAtDurableBoundaryV1({
      captureReceipt,
      validatorId: "generic-record-only",
      validatorVersion: "v1",
      outcome: { status: "VALID", reasonCodes: [] },
      knownAt: new Date("2026-08-20T09:04:59.999Z"),
    })).toThrowError(new RawCaptureRejectedError("INVALID_DURABLE_TIME"));
    expect(() => buildRawValidationReceiptAtDurableBoundaryV1({
      captureReceipt,
      validatorId: "generic-record-only",
      validatorVersion: "v1",
      outcome: { status: "REJECTED", reasonCodes: [] },
      knownAt: new Date("2026-08-20T09:05:00.000Z"),
    })).toThrowError(new RawCaptureRejectedError("INVALID_VALIDATION_OUTCOME"));
  });

  it("revalidates exact prepared bytes at every durable receipt boundary", () => {
    const prepared = prepareRawCaptureV1(command());
    const storageBinding = buildRawStorageBindingAtDurableBoundaryV1({
      organizationId: ORG,
      sourceId: SOURCE,
      rawBytesDigest: prepared.rawBytesDigest,
      objectReference: {
        storageBackendId: "test", objectKey: "immutable", objectVersion: "1",
        encryptionRequirement: "PRIVATE_ENCRYPTED", accessRequirement: "SERVER_ONLY",
      },
      storedAt: new Date("2026-08-20T09:05:00.000Z"),
    });
    prepared.bodyBytes[0] ^= 0xff;
    expect(() => new TestOnlyRawCaptureMemoryAdapterV1(
      () => new Date("2026-08-20T09:06:00.000Z"),
    ).capture(command())).not.toThrow();
    expect(() => buildRawCaptureReceiptAtDurableBoundaryV1({
      prepared,
      storageBinding,
      capturedAt: new Date("2026-08-20T09:06:00.000Z"),
    })).toThrowError(new RawCaptureRejectedError("SECRET_SCAN_DIGEST_MISMATCH"));

    const forged = {
      ...prepareRawCaptureV1(command()),
      bodyBytes: new TextEncoder().encode("forged"),
    };
    expect(() => buildRawCaptureReceiptAtDurableBoundaryV1({
      prepared: forged,
      storageBinding,
      capturedAt: new Date("2026-08-20T09:06:00.000Z"),
    })).toThrowError(new RawCaptureRejectedError("SECRET_SCAN_DIGEST_MISMATCH"));
  });

  it("rejects nested smuggling and non-canonical receipt shapes", () => {
    const prepared = prepareRawCaptureV1(command());
    expect(() => buildRawStorageBindingAtDurableBoundaryV1({
      organizationId: ORG,
      sourceId: SOURCE,
      rawBytesDigest: prepared.rawBytesDigest,
      objectReference: {
        storageBackendId: "test", objectKey: "smuggle", objectVersion: "1",
        encryptionRequirement: "PRIVATE_ENCRYPTED", accessRequirement: "SERVER_ONLY",
        authorization: "Bearer forbidden",
        cookie: "forbidden",
        signedUrl: "https://forbidden.invalid",
        rawBytes: BODY,
      } as never,
      storedAt: new Date("2026-08-20T09:05:00.000Z"),
    })).toThrowError(new RawCaptureRejectedError("INVALID_STORAGE_BINDING"));

    const policyBody = { ...POLICY, authorization: "forbidden" };
    const { policyDigest: _policyDigest, ...policyWithoutDigest } = policyBody;
    void _policyDigest;
    const smuggledPolicy = {
      ...policyWithoutDigest,
      policyDigest: canonicalDigest(policyWithoutDigest),
    };
    expect(() => prepareRawCaptureV1({ ...command(), policy: smuggledPolicy as never }))
      .toThrowError(new RawCaptureRejectedError("INVALID_POLICY"));

    const baseScan = scan();
    const { contentDigest: _scanDigest, ...scanBody } = baseScan;
    void _scanDigest;
    const smuggledScan = { ...scanBody, cookie: "forbidden", contentDigest: "" };
    smuggledScan.contentDigest = canonicalDigest({ ...scanBody, cookie: "forbidden" });
    expect(() => prepareRawCaptureV1({ ...command(), secretScanReceipt: smuggledScan as never }))
      .toThrowError(new RawCaptureRejectedError("INVALID_SECRET_SCAN_RECEIPT"));
  });

  it("rejects tampered retention and non-canonical validation reasons", () => {
    const times = [
      new Date("2026-08-20T09:05:00.000Z"),
      new Date("2026-08-20T09:06:00.000Z"),
    ];
    const adapter = new TestOnlyRawCaptureMemoryAdapterV1(() => times.shift()!);
    const { captureReceipt } = adapter.capture(command());
    const tampered = reseal({
      ...captureReceipt,
      retentionUntilUtc: "2026-08-20T11:05:00.000Z",
    } as RawCaptureReceiptV1);
    expect(isRawCaptureReceiptV1(tampered)).toBe(false);

    const validation = adapter.recordValidation({
      captureReceiptDigest: captureReceipt.id,
      validatorId: "canonical-validator",
      validatorVersion: "v1",
      outcome: { status: "REJECTED", reasonCodes: ["Z_REASON", "A_REASON", "A_REASON"] },
    });
    expect(validation.reasonCodes).toEqual(["A_REASON", "Z_REASON"]);
    const nonCanonical = reseal({
      ...validation,
      reasonCodes: ["Z_REASON", "A_REASON", "A_REASON"],
    } as RawValidationReceiptV1);
    expect(isRawValidationReceiptV1(nonCanonical)).toBe(false);
    const emptyValidator = reseal({ ...validation, validatorId: " " } as RawValidationReceiptV1);
    expect(isRawValidationReceiptV1(emptyValidator)).toBe(false);
  });

  it("keeps test-adapter evidence immutable across returned references", () => {
    const times = [
      new Date("2026-08-20T09:05:00.000Z"),
      new Date("2026-08-20T09:06:00.000Z"),
    ];
    const adapter = new TestOnlyRawCaptureMemoryAdapterV1(() => times.shift()!);
    const { captureReceipt } = adapter.capture(command());
    const originalRetention = captureReceipt.policy.retentionSeconds;
    captureReceipt.policy.retentionSeconds = 1;
    expect(adapter.readCapture(captureReceipt.id)?.policy.retentionSeconds).toBe(originalRetention);

    const validation = adapter.recordValidation({
      captureReceiptDigest: captureReceipt.id,
      validatorId: "immutable-validator",
      validatorVersion: "v1",
      outcome: { status: "REJECTED", reasonCodes: ["IMMUTABLE_REASON"] },
    });
    validation.reasonCodes.push("MUTATED_REASON");
    expect(adapter.readValidation(validation.id)?.reasonCodes).toEqual(["IMMUTABLE_REASON"]);
  });
});
