import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import {
  FHV_T4_CONTINUITY_VERIFICATION_PASS,
  FHV_T4_CONTINUITY_VERIFICATION_PROOF_SCHEMA_VERSION,
  FhvT4ContinuityCaptureError,
  parseFhvT4ContinuityVerificationProof,
} from "@/lib/trader/observability/fhv-t4-continuity-capture";
import { FHV_T4_EVIDENCE_SEAL_VERIFICATION_PASS } from "@/lib/trader/observability/fhv-t4-evidence-seal";
import {
  FhvT4aPhaseReceiptError,
  readFhvT4aPostFinalizeReceipt,
  writeFhvT4aPostFinalizeReceipt,
} from "@/lib/trader/observability/fhv-t4a-phase-receipts";

const TARGET_SHA = "dddddddddddddddddddddddddddddddddddddddd";
const RUN_ID = "fhv-t4a-final-receipt";
const ORG_ID = "00000000-0000-4000-8000-000000000436";

function validVerificationProof(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const withoutDigest = {
    schemaVersion: FHV_T4_CONTINUITY_VERIFICATION_PROOF_SCHEMA_VERSION,
    runId: RUN_ID,
    organizationId: ORG_ID,
    targetSha: TARGET_SHA,
    beforeDigest: "1".repeat(64),
    afterDigest: "2".repeat(64),
    classification: FHV_T4_CONTINUITY_VERIFICATION_PASS,
    capturedAtUtc: new Date().toISOString(),
    ...overrides,
  };
  return {
    ...withoutDigest,
    contentDigest: computePayloadDigest(withoutDigest),
  };
}

function validFinalizeReceiptInput() {
  return {
    targetSha: TARGET_SHA,
    releaseTag: "local-dev",
    runId: RUN_ID,
    organizationId: ORG_ID,
    bindingDigest: "b".repeat(64),
    postBeforeReceiptDigest: "c".repeat(64),
    continuityAfterPath: "/remote/continuity-after.json",
    continuityAfterDigest: "d".repeat(64),
    continuityVerificationProofPath: "/remote/continuity-proof.json",
    continuityVerificationProofDigest: "e".repeat(64),
    evidenceSealRootDigest: "f".repeat(64),
    evidenceSealManifestDigest: "a".repeat(64),
    evidenceSealVerifyClassification: FHV_T4_EVIDENCE_SEAL_VERIFICATION_PASS,
    ceremonyClassifications: { T4A_RESULT: "PASS" },
    stepProofDigests: {},
    proofDigestBundle: {},
  };
}

describe("fhv-t4 continuity final receipt (DEE-436 F-10)", () => {
  let root = "";

  afterEach(() => {
    if (root) {
      rmSync(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("readFhvT4aPostFinalizeReceipt requires continuity verification proof binding", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-final-receipt-"));
    writeFhvT4aPostFinalizeReceipt(root, validFinalizeReceiptInput());
    const receipt = readFhvT4aPostFinalizeReceipt(root);
    expect(receipt.continuityVerificationProofPath).toContain("continuity-proof.json");
    expect(receipt.continuityVerificationProofDigest).toBe("e".repeat(64));
  });

  it("rejects finalize receipt missing continuityVerificationProofPath/Digest", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-final-receipt-missing-"));
    const withoutDigest = {
      schemaVersion: "fhv-t4a-post-finalize-receipt/v1" as const,
      ...validFinalizeReceiptInput(),
      continuityVerificationProofPath: "",
      continuityVerificationProofDigest: "",
      completedAtUtc: new Date().toISOString(),
    };
    writeFileSync(
      join(root, "fhv-t4a-post-finalize-receipt.v1.json"),
      `${JSON.stringify({
        ...withoutDigest,
        contentDigest: computePayloadDigest(withoutDigest),
      })}\n`,
    );

    try {
      readFhvT4aPostFinalizeReceipt(root);
      expect.unreachable("missing continuity proof binding should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(FhvT4aPhaseReceiptError);
      expect((error as FhvT4aPhaseReceiptError).code).toBe(
        "FINAL_RECEIPT_CONTINUITY_VERIFICATION_PROOF_MISSING",
      );
    }
  });

  it("parseFhvT4ContinuityVerificationProof rejects invalid payloads", () => {
    expect(() => parseFhvT4ContinuityVerificationProof(null)).toThrow(FhvT4ContinuityCaptureError);

    try {
      parseFhvT4ContinuityVerificationProof(
        validVerificationProof({ schemaVersion: "fhv-t4-continuity-verification-proof/v0" }),
      );
      expect.unreachable("schema mismatch should fail");
    } catch (error) {
      expect((error as FhvT4ContinuityCaptureError).code).toBe(
        "FHV_T4_CONTINUITY_VERIFICATION_PROOF_SCHEMA_MISMATCH",
      );
    }

    try {
      parseFhvT4ContinuityVerificationProof(validVerificationProof({ runId: "" }));
      expect.unreachable("missing runId should fail");
    } catch (error) {
      expect((error as FhvT4ContinuityCaptureError).code).toBe(
        "FHV_T4_CONTINUITY_VERIFICATION_PROOF_FIELD_MISSING",
      );
    }

    try {
      parseFhvT4ContinuityVerificationProof(validVerificationProof({ classification: "FAIL" }));
      expect.unreachable("invalid classification should fail");
    } catch (error) {
      expect((error as FhvT4ContinuityCaptureError).code).toBe(
        "FHV_T4_CONTINUITY_VERIFICATION_PROOF_CLASSIFICATION_INVALID",
      );
    }

    try {
      parseFhvT4ContinuityVerificationProof(validVerificationProof({ contentDigest: "deadbeef" }));
      expect.unreachable("digest mismatch should fail");
    } catch (error) {
      expect((error as FhvT4ContinuityCaptureError).code).toBe(
        "FHV_T4_CONTINUITY_VERIFICATION_PROOF_DIGEST_MISMATCH",
      );
    }
  });
});
