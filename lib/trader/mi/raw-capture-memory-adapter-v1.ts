import {
  buildRawCaptureReceiptAtDurableBoundaryV1,
  buildRawStorageBindingAtDurableBoundaryV1,
  buildRawValidationReceiptAtDurableBoundaryV1,
  prepareRawCaptureV1,
  type RawCaptureCommandV1,
  type RawCaptureReceiptV1,
  type RawStorageBindingV1,
  type RawValidationOutcomeV1,
  type RawValidationReceiptV1,
} from "@/lib/trader/mi/raw-capture-v1";

/** Test double only. It is not encrypted storage and must never be runtime-wired. */
export class TestOnlyRawCaptureMemoryAdapterV1 {
  private readonly objects = new Map<string, Uint8Array>();
  private readonly captures = new Map<string, RawCaptureReceiptV1>();
  private readonly bindings = new Map<string, RawStorageBindingV1>();
  private readonly validations = new Map<string, RawValidationReceiptV1>();
  private sequence = 0;

  constructor(private readonly now: () => Date) {}

  capture(command: RawCaptureCommandV1): {
    captureReceipt: RawCaptureReceiptV1;
    storageBinding: RawStorageBindingV1;
  } {
    const prepared = prepareRawCaptureV1(command);
    const capturedAt = this.requireNow();
    this.sequence += 1;
    const objectKey = [
      "test-only",
      prepared.organizationId,
      prepared.sourceId,
      prepared.rawBytesDigest,
      String(this.sequence),
    ].join("/");
    const storageBinding = buildRawStorageBindingAtDurableBoundaryV1({
      organizationId: prepared.organizationId,
      sourceId: prepared.sourceId,
      rawBytesDigest: prepared.rawBytesDigest,
      objectReference: {
        storageBackendId: "test-memory-adapter-v1",
        objectKey,
        objectVersion: "1",
        encryptionRequirement: "PRIVATE_ENCRYPTED",
        accessRequirement: "SERVER_ONLY",
      },
      storedAt: capturedAt,
    });
    const captureReceipt = buildRawCaptureReceiptAtDurableBoundaryV1({
      prepared,
      storageBinding,
      capturedAt,
    });
    this.objects.set(objectKey, Uint8Array.from(prepared.bodyBytes));
    this.bindings.set(storageBinding.contentDigest, storageBinding);
    this.captures.set(captureReceipt.contentDigest, captureReceipt);
    return { captureReceipt, storageBinding };
  }

  recordValidation(input: {
    captureReceiptDigest: string;
    validatorId: string;
    validatorVersion: string;
    outcome: RawValidationOutcomeV1;
  }): RawValidationReceiptV1 {
    const captureReceipt = this.captures.get(input.captureReceiptDigest);
    if (!captureReceipt) throw new Error("[trader] test raw capture receipt not found");
    const receipt = buildRawValidationReceiptAtDurableBoundaryV1({
      captureReceipt,
      validatorId: input.validatorId,
      validatorVersion: input.validatorVersion,
      outcome: input.outcome,
      knownAt: this.requireNow(),
    });
    this.validations.set(receipt.contentDigest, receipt);
    return receipt;
  }

  readBody(storageBindingDigest: string): Uint8Array | null {
    const binding = this.bindings.get(storageBindingDigest);
    if (!binding) return null;
    const stored = this.objects.get(binding.objectReference.objectKey);
    return stored ? Uint8Array.from(stored) : null;
  }

  readCapture(contentDigest: string): RawCaptureReceiptV1 | null {
    return this.captures.get(contentDigest) ?? null;
  }

  readValidation(contentDigest: string): RawValidationReceiptV1 | null {
    return this.validations.get(contentDigest) ?? null;
  }

  private requireNow(): Date {
    const value = this.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new Error("[trader] test raw capture adapter clock is invalid");
    }
    return new Date(value.getTime());
  }
}
