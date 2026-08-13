import { createHash } from "node:crypto";

import {
  computeObservedPackageSurfaceDigestHex,
  type A3ObservedPackageSurfaceProofV1,
} from "@/lib/trader/intelligence/forecast-v2/a3-observed-package-surface-v1";
import {
  computeA3PackageSurfaceSemanticDigestHex,
  computeA3PhaseIdentityLayers,
  computeA3RelationInventoryDigestHex,
} from "@/lib/trader/intelligence/forecast-v2/a3-storage-contract-v1";
import type {
  A3Phase01ReceiptV1,
  A3Phase02ReceiptV1,
  A3Phase03ReceiptV1,
  A3ReceiptProvenanceV1,
} from "@/lib/trader/intelligence/forecast-v2/a3-storage-receipt-v1";
import {
  A3_PHASE01_RECEIPT_VERSION,
  A3_PHASE02_RECEIPT_VERSION,
  A3_PHASE03_RECEIPT_VERSION,
} from "@/lib/trader/intelligence/forecast-v2/a3-storage-receipt-v1";
import { FORECAST_V2_MAX_REPLICA_ARTIFACT_BYTES } from "@/lib/trader/intelligence/forecast-v2/storage-scale-projection";

export const A3_TEST_REPO_ROOT = process.cwd();

export const a3TestIdentity = computeA3PhaseIdentityLayers({
  repoRoot: A3_TEST_REPO_ROOT,
  localHeadCommit: "test-head",
  dirtyTreeDigestHex: "test-dirty",
});

function payloadHash(payload: Buffer): string {
  return createHash("sha256").update(payload).digest("hex");
}

export function buildValidObservedPackageProof(): A3ObservedPackageSurfaceProofV1 {
  const payload = Buffer.alloc(FORECAST_V2_MAX_REPLICA_ARTIFACT_BYTES, 0xab);
  const hash = payloadHash(payload);
  const cells = ["BTCUSDT/30", "BTCUSDT/60", "ETHUSDT/30", "ETHUSDT/60"].map((key) => {
    const [symbol, horizon] = key.split("/");
    return {
      symbol: symbol!,
      horizonMinutes: Number(horizon),
      predictivePackages: 1,
      targetDefinitions: 2,
      terminalBuckets: 7,
      executionOpportunityBuckets: 0,
      packageTargetBindings: 2,
      replicaArtifacts: 50,
      replicaPayloadBytesTotal: 50 * FORECAST_V2_MAX_REPLICA_ARTIFACT_BYTES,
      replicas: Array.from({ length: 50 }, (_, ordinal) => ({
        replicaOrdinal: ordinal,
        payloadLengthBytes: FORECAST_V2_MAX_REPLICA_ARTIFACT_BYTES,
        payloadSha256Hex: hash,
      })),
      targetDefinitionsByRole: [
        { targetRoleId: "EXECUTION_OPPORTUNITY", representationKind: "SAMPLE_ENSEMBLE", count: 1 },
        { targetRoleId: "TERMINAL_RETURN", representationKind: "DISCRETE_SCENARIO", count: 1 },
      ],
    };
  });
  const totals = {
    predictivePackages: 4,
    targetDefinitions: 8,
    terminalBuckets: 28,
    executionOpportunityBuckets: 0,
    packageTargetBindings: 8,
    replicaArtifacts: 200,
    rawReplicaPayloadBytes: 200 * FORECAST_V2_MAX_REPLICA_ARTIFACT_BYTES,
  };
  return {
    schemaVersion: "a3-observed-package-surface/v1",
    expectedPackageSurfaceDigestHex: computeA3PackageSurfaceSemanticDigestHex(),
    observedPackageSurfaceDigestHex: computeObservedPackageSurfaceDigestHex({ cells, totals }),
    observedPackageContractConforms: true,
    failureReasons: [],
    totals,
    cells,
  };
}

export function sampleA3Provenance(
  overrides: Partial<A3ReceiptProvenanceV1> = {},
): A3ReceiptProvenanceV1 {
  return {
    localHead: a3TestIdentity.localHeadCommit,
    worktreeProvenanceDigest: a3TestIdentity.worktreeProvenanceDigest,
    runId: "A3-TEST",
    startedAt: "2026-08-11T00:00:00.000Z",
    completedAt: "2026-08-11T00:01:00.000Z",
    logPath: "/tmp/dee518-a3-test.log",
    pid: 1,
    ...overrides,
  };
}

export function sampleA3Phase01(overrides: Partial<A3Phase01ReceiptV1> = {}): A3Phase01ReceiptV1 {
  const observed = buildValidObservedPackageProof();
  return {
    schemaVersion: A3_PHASE01_RECEIPT_VERSION,
    a3CanonicalContractDigest: a3TestIdentity.a3CanonicalContractDigest,
    storageSurfaceDigest: a3TestIdentity.storageSurfaceDigest,
    phaseImplementationDigest: a3TestIdentity.phaseImplementationDigests.phase01,
    worktreeProvenanceDigest: a3TestIdentity.worktreeProvenanceDigest,
    provenance: sampleA3Provenance(),
    receiptContentDigestHex: "placeholder",
    measuredAt: "2026-08-11T00:00:00.000Z",
    postgresServerVersion: "16.14",
    postgresMeasurementEnvironment: {
      schemaVersion: "a3-postgres-measurement-environment/v1",
      serverVersion: "16.14",
      serverVersionNum: "160014",
      blockSize: "8192",
      dataChecksums: "off",
      serverEncoding: "UTF8",
      databaseCollate: "C",
      databaseCtype: "C",
      defaultTableAccessMethod: "heap",
      validationComposeDigestHex: "compose",
      dockerImageReference: "postgres:16-alpine",
      dockerImageId: "sha256:test",
      relationStorageOptions: [],
      operationalSettings: { synchronousCommit: "off", workMem: "4MB" },
      postgresMeasurementEnvironmentDigest: "env-test",
    },
    appliedMigrationRange: { min: 110, max: 145, count: 36 },
    relationInventoryDigestHex: computeA3RelationInventoryDigestHex(),
    expectedPackageSurfaceDigestHex: observed.expectedPackageSurfaceDigestHex,
    observedPackageSurfaceDigestHex: observed.observedPackageSurfaceDigestHex,
    observedPackageContractConforms: true,
    observedPackageSurface: observed,
    b0Bytes: 1_000_000,
    phase01PackageFixedBytes: 50_000_000,
    packageFixedRelationBreakdown: [],
    b1Bytes: 900_000_000,
    grossDeltaBytes: 899_000_000,
    nBundles: 200_000,
    rowCounts: {
      trader_forecast_bundle_v2: 200_000,
      trader_forecast_v2: 400_000,
      trader_forecast_outcome_v2: 400_000,
      trader_forecast_calibration_observation_v2: 400_000,
      trader_forecast_scenario_v2: 1_400_000,
    },
    b0RelationBreakdown: [],
    b1RelationBreakdown: [],
    pass: true,
    phase01Status: "PHASE01_MEASUREMENT_COMPLETE",
    finalStorageAcceptancePass: false,
    storageAcceptance: "AWAITING_PHASE02_FIXED_CONTRIBUTION",
    failureReasons: [],
    ...overrides,
  };
}

export function sampleA3Phase02(overrides: Partial<A3Phase02ReceiptV1> = {}): A3Phase02ReceiptV1 {
  const phase01 = sampleA3Phase01();
  return {
    schemaVersion: A3_PHASE02_RECEIPT_VERSION,
    a3CanonicalContractDigest: a3TestIdentity.a3CanonicalContractDigest,
    storageSurfaceDigest: a3TestIdentity.storageSurfaceDigest,
    phaseImplementationDigest: a3TestIdentity.phaseImplementationDigests.phase02,
    worktreeProvenanceDigest: a3TestIdentity.worktreeProvenanceDigest,
    provenance: sampleA3Provenance(),
    receiptContentDigestHex: "placeholder",
    measuredAt: "2026-08-11T00:00:00.000Z",
    postgresServerVersion: "16.14",
    postgresMeasurementEnvironment: phase01.postgresMeasurementEnvironment,
    phase2FreshDatabaseLiteral: true,
    expectedPackageSurfaceDigestHex: phase01.expectedPackageSurfaceDigestHex,
    observedPackageSurfaceDigestHex: phase01.observedPackageSurfaceDigestHex,
    observedPackageContractConforms: true,
    observedPackageSurface: phase01.observedPackageSurface,
    phase2EmptyBytes: 1_000_000,
    phase2FullBytes: 51_000_000,
    phase2PackageFixedContributionBytes: phase01.phase01PackageFixedBytes,
    packageFixedRelationBreakdown: [],
    packageRawReplicaPayloadBytes: 13_107_200,
    phase2RelationBreakdown: [],
    enumeratedFixedV2OtherItems: [],
    enumeratedFixedV2OtherBytes: 0,
    pass: true,
    failureReasons: [],
    ...overrides,
  };
}

export function sampleA3Phase03(overrides: Partial<A3Phase03ReceiptV1> = {}): A3Phase03ReceiptV1 {
  return {
    schemaVersion: A3_PHASE03_RECEIPT_VERSION,
    a3CanonicalContractDigest: a3TestIdentity.a3CanonicalContractDigest,
    phaseImplementationDigest: a3TestIdentity.phaseImplementationDigests.phase03,
    worktreeProvenanceDigest: a3TestIdentity.worktreeProvenanceDigest,
    provenance: sampleA3Provenance(),
    receiptContentDigestHex: "placeholder",
    measuredAt: "2026-08-11T00:00:00.000Z",
    n1Bundles: 1_000,
    n2Bundles: 200_000,
    checkpointBytesAtN1: 8_000_000,
    checkpointBytesAtN2: 8_000_000,
    checkpointSessionBytes: 8_000_000,
    maxGrowthBytesPerCycle: 54,
    supportedCheckpointEnvelopeBytes: 536_870_912,
    bundleHistoryInFhvHotCheckpointPath: false,
    bounded: true,
    evidence: "test",
    pass: true,
    failureReasons: [],
    ...overrides,
  };
}
