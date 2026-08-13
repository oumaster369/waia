import type { A3PhaseIdentityLayersV1 } from "./a3-storage-contract-v1";
import { assertAggregateReceiptInputsCompatible } from "./a3-storage-invalidation-manifest-v1";
import { DEE_518_BLOCKED_PACKAGE_FIXED_BYTE_IDENTITY_RECONCILIATION_REQUIRED } from "./storage-scale-postgres-v1";
import {
  A3_AGGREGATE_RECEIPT_VERSION,
  type A3AggregateReceiptV1,
  type A3Phase01ReceiptV1,
  type A3Phase02ReceiptV1,
  type A3Phase03ReceiptV1,
  type A3ReceiptProvenanceV1,
  attachReceiptDigest,
} from "./a3-storage-receipt-v1";
import {
  assertA3ExactRationalAggregateMath,
  evaluateA3ExactRationalAggregateMath,
} from "./a3-storage-rational-arithmetic-aggregate-v1";

export function computeA3AggregateReceipt(input: {
  identity: A3PhaseIdentityLayersV1;
  provenance: A3ReceiptProvenanceV1;
  phase01: A3Phase01ReceiptV1;
  phase02: A3Phase02ReceiptV1;
  phase03: A3Phase03ReceiptV1;
}): A3AggregateReceiptV1 {
  const failureReasons: string[] = [];

  try {
    assertAggregateReceiptInputsCompatible({
      current: input.identity,
      phase01: input.phase01,
      phase02: input.phase02,
      phase03: input.phase03,
    });
  } catch (error) {
    failureReasons.push(error instanceof Error ? error.message : String(error));
  }

  if (
    input.phase01.expectedPackageSurfaceDigestHex !== input.phase02.expectedPackageSurfaceDigestHex
  ) {
    failureReasons.push("expected package surface digest mismatch across phases");
  }

  if (
    input.phase01.observedPackageSurfaceDigestHex !== input.phase02.observedPackageSurfaceDigestHex
  ) {
    failureReasons.push("observed package surface digest mismatch across phases");
  }

  if (
    input.phase01.postgresMeasurementEnvironment.postgresMeasurementEnvironmentDigest !==
    input.phase02.postgresMeasurementEnvironment.postgresMeasurementEnvironmentDigest
  ) {
    failureReasons.push("postgres measurement environment mismatch across phases");
  }

  if (
    input.phase01.phase01PackageFixedBytes !== input.phase02.phase2PackageFixedContributionBytes
  ) {
    failureReasons.push(DEE_518_BLOCKED_PACKAGE_FIXED_BYTE_IDENTITY_RECONCILIATION_REQUIRED);
  }

  const exactRationalMath = evaluateA3ExactRationalAggregateMath({
    b0Bytes: input.phase01.b0Bytes,
    b1Bytes: input.phase01.b1Bytes,
    packageFixedContributionBytes: input.phase02.phase2PackageFixedContributionBytes,
    enumeratedFixedV2OtherBytes: input.phase02.enumeratedFixedV2OtherBytes,
    nBundles: input.phase01.nBundles,
  });
  failureReasons.push(...exactRationalMath.failureReasons);

  if (!input.phase03.pass || !input.phase03.bounded) {
    failureReasons.push("phase-03 boundedness proof failed");
  }

  const pass = failureReasons.length === 0;

  return attachReceiptDigest({
    schemaVersion: A3_AGGREGATE_RECEIPT_VERSION,
    a3CanonicalContractDigest: input.identity.a3CanonicalContractDigest,
    storageSurfaceDigest: input.identity.storageSurfaceDigest,
    aggregateImplementationDigest: input.identity.phaseImplementationDigests.aggregate,
    worktreeProvenanceDigest: input.provenance.worktreeProvenanceDigest,
    provenance: input.provenance,
    measuredAt: new Date().toISOString(),
    expectedPackageSurfaceDigestHex: input.phase01.expectedPackageSurfaceDigestHex,
    observedPackageSurfaceDigestHex: input.phase01.observedPackageSurfaceDigestHex,
    postgresMeasurementEnvironmentDigest:
      input.phase01.postgresMeasurementEnvironment.postgresMeasurementEnvironmentDigest,
    phase01PackageFixedBytes: input.phase01.phase01PackageFixedBytes,
    phase02PackageFixedContributionBytes: input.phase02.phase2PackageFixedContributionBytes,
    exactRationalMath,
    enumeratedFixedV2OtherBytes: input.phase02.enumeratedFixedV2OtherBytes,
    b0Bytes: input.phase01.b0Bytes,
    b1Bytes: input.phase01.b1Bytes,
    grossDeltaBytes: input.phase01.grossDeltaBytes,
    nBundles: input.phase01.nBundles,
    phaseReceiptDigests: {
      phase01: input.phase01.receiptContentDigestHex,
      phase02: input.phase02.receiptContentDigestHex,
      phase03: input.phase03.receiptContentDigestHex,
    },
    phaseImplementationDigests: {
      phase01: input.phase01.phaseImplementationDigest,
      phase02: input.phase02.phaseImplementationDigest,
      phase03: input.phase03.phaseImplementationDigest,
    },
    verdict: pass ? "A3_STORAGE_SCALE_PASS" : "A3_STORAGE_SCALE_FAIL",
    pass,
    failureReasons,
  });
}

export function assertA3AggregateThresholds(receipt: A3AggregateReceiptV1): void {
  assertA3ExactRationalAggregateMath(receipt.exactRationalMath);
  if (receipt.verdict !== "A3_STORAGE_SCALE_PASS" || !receipt.pass) {
    throw new Error(`[a3-aggregate] verdict failed: ${receipt.failureReasons.join("; ")}`);
  }
}
