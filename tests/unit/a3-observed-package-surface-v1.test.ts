import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  A3_CANONICAL_PACKAGE_CELL_COUNTS,
  computeObservedPackageSurfaceDigestHex,
  type A3ObservedPackageCellProofV1,
} from "@/lib/trader/intelligence/forecast-v2/a3-observed-package-surface-v1";
import { computeA3AggregateReceipt } from "@/lib/trader/intelligence/forecast-v2/a3-storage-aggregate-v1";
import { computeA3PhaseIdentityLayers } from "@/lib/trader/intelligence/forecast-v2/a3-storage-contract-v1";
import {
  A3_PHASE01_RECEIPT_VERSION,
  A3_PHASE02_RECEIPT_VERSION,
  A3_PHASE03_RECEIPT_VERSION,
  type A3Phase01ReceiptV1,
  type A3Phase02ReceiptV1,
  type A3Phase03ReceiptV1,
} from "@/lib/trader/intelligence/forecast-v2/a3-storage-receipt-v1";
import { FORECAST_V2_MAX_REPLICA_ARTIFACT_BYTES } from "@/lib/trader/intelligence/forecast-v2/storage-scale-projection";

const REPO_ROOT = process.cwd();
const identity = computeA3PhaseIdentityLayers({
  repoRoot: REPO_ROOT,
  localHeadCommit: "test-head",
  dirtyTreeDigestHex: "dirty-a",
});

function payloadHash(payload: Buffer): string {
  return createHash("sha256").update(payload).digest("hex");
}

function buildValidCell(symbol: string, horizonMinutes: number): A3ObservedPackageCellProofV1 {
  const payload = Buffer.alloc(FORECAST_V2_MAX_REPLICA_ARTIFACT_BYTES, 0xab);
  const hash = payloadHash(payload);
  const replicas = Array.from({ length: 50 }, (_, ordinal) => ({
    replicaOrdinal: ordinal,
    payloadLengthBytes: FORECAST_V2_MAX_REPLICA_ARTIFACT_BYTES,
    payloadSha256Hex: hash,
  }));
  return {
    symbol,
    horizonMinutes,
    predictivePackages: 1,
    targetDefinitions: 2,
    terminalBuckets: 7,
    executionOpportunityBuckets: 0,
    packageTargetBindings: 2,
    replicaArtifacts: 50,
    replicaPayloadBytesTotal: 50 * FORECAST_V2_MAX_REPLICA_ARTIFACT_BYTES,
    replicas,
    targetDefinitionsByRole: [
      { targetRoleId: "EXECUTION_OPPORTUNITY", representationKind: "SAMPLE_ENSEMBLE", count: 1 },
      { targetRoleId: "TERMINAL_RETURN", representationKind: "DISCRETE_SCENARIO", count: 1 },
    ],
  };
}

function buildValidProof(
  cells = [
    buildValidCell("BTCUSDT", 30),
    buildValidCell("BTCUSDT", 60),
    buildValidCell("ETHUSDT", 30),
    buildValidCell("ETHUSDT", 60),
  ],
) {
  const totals = {
    predictivePackages: cells.reduce((acc, cell) => acc + cell.predictivePackages, 0),
    targetDefinitions: cells.reduce((acc, cell) => acc + cell.targetDefinitions, 0),
    terminalBuckets: cells.reduce((acc, cell) => acc + cell.terminalBuckets, 0),
    executionOpportunityBuckets: cells.reduce(
      (acc, cell) => acc + cell.executionOpportunityBuckets,
      0,
    ),
    packageTargetBindings: cells.reduce((acc, cell) => acc + cell.packageTargetBindings, 0),
    replicaArtifacts: cells.reduce((acc, cell) => acc + cell.replicaArtifacts, 0),
    rawReplicaPayloadBytes: cells.reduce((acc, cell) => acc + cell.replicaPayloadBytesTotal, 0),
  };
  return {
    schemaVersion: "a3-observed-package-surface/v1" as const,
    expectedPackageSurfaceDigestHex: identity.packageSurfaceSemanticDigestHex,
    observedPackageSurfaceDigestHex: computeObservedPackageSurfaceDigestHex({ cells, totals }),
    observedPackageContractConforms: true,
    failureReasons: [],
    totals,
    cells,
  };
}

function sampleProvenance() {
  return {
    localHead: identity.localHeadCommit,
    worktreeProvenanceDigest: identity.worktreeProvenanceDigest,
    runId: "TEST",
    startedAt: "2026-08-11T00:00:00.000Z",
    completedAt: "2026-08-11T00:01:00.000Z",
    logPath: "/tmp/test.log",
    pid: 1,
  };
}

function samplePhase01(
  observed: ReturnType<typeof buildValidProof>,
  overrides: Partial<A3Phase01ReceiptV1> = {},
): A3Phase01ReceiptV1 {
  return {
    schemaVersion: A3_PHASE01_RECEIPT_VERSION,
    a3CanonicalContractDigest: identity.a3CanonicalContractDigest,
    storageSurfaceDigest: identity.storageSurfaceDigest,
    phaseImplementationDigest: identity.phaseImplementationDigests.phase01,
    worktreeProvenanceDigest: identity.worktreeProvenanceDigest,
    provenance: sampleProvenance(),
    receiptContentDigestHex: "x",
    measuredAt: "2026-08-11T00:00:00.000Z",
    postgresServerVersion: "16",
    postgresMeasurementEnvironment: {
      schemaVersion: "a3-postgres-measurement-environment/v1",
      serverVersion: "16",
      serverVersionNum: "160014",
      blockSize: "8192",
      dataChecksums: "off",
      serverEncoding: "UTF8",
      databaseCollate: "C",
      databaseCtype: "C",
      defaultTableAccessMethod: "heap",
      validationComposeDigestHex: "abc",
      dockerImageReference: "postgres:16-alpine",
      dockerImageId: "sha256:test",
      relationStorageOptions: [],
      operationalSettings: { synchronousCommit: "off", workMem: "4MB" },
      postgresMeasurementEnvironmentDigest: "env-a",
    },
    appliedMigrationRange: { min: 110, max: 145, count: 36 },
    relationInventoryDigestHex: identity.relationInventoryDigestHex,
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
    rowCounts: {},
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

function samplePhase02(
  observed: ReturnType<typeof buildValidProof>,
  phase01: A3Phase01ReceiptV1,
  overrides: Partial<A3Phase02ReceiptV1> = {},
): A3Phase02ReceiptV1 {
  return {
    schemaVersion: A3_PHASE02_RECEIPT_VERSION,
    a3CanonicalContractDigest: identity.a3CanonicalContractDigest,
    storageSurfaceDigest: identity.storageSurfaceDigest,
    phaseImplementationDigest: identity.phaseImplementationDigests.phase02,
    worktreeProvenanceDigest: identity.worktreeProvenanceDigest,
    provenance: sampleProvenance(),
    receiptContentDigestHex: "x",
    measuredAt: "2026-08-11T00:00:00.000Z",
    postgresServerVersion: "16",
    postgresMeasurementEnvironment: phase01.postgresMeasurementEnvironment,
    phase2FreshDatabaseLiteral: true,
    expectedPackageSurfaceDigestHex: observed.expectedPackageSurfaceDigestHex,
    observedPackageSurfaceDigestHex: observed.observedPackageSurfaceDigestHex,
    observedPackageContractConforms: true,
    observedPackageSurface: observed,
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

describe("A3 observed package surface and aggregate compatibility", () => {
  it("changes observed digest when payload content changes at same length", () => {
    const base = buildValidProof();
    const changedCells = base.cells.map((cell) => ({
      ...cell,
      replicas: cell.replicas.map((replica, index) =>
        index === 0
          ? {
              ...replica,
              payloadSha256Hex: payloadHash(
                Buffer.alloc(FORECAST_V2_MAX_REPLICA_ARTIFACT_BYTES, 0xcd),
              ),
            }
          : replica,
      ),
    }));
    const changedDigest = computeObservedPackageSurfaceDigestHex({
      cells: changedCells,
      totals: base.totals,
    });
    expect(changedDigest).not.toBe(base.observedPackageSurfaceDigestHex);
  });

  it("aggregate fails on observed population mismatch", () => {
    const phase01Observed = buildValidProof();
    const phase02Observed = buildValidProof([
      buildValidCell("BTCUSDT", 30),
      buildValidCell("BTCUSDT", 60),
      buildValidCell("ETHUSDT", 30),
      {
        ...buildValidCell("ETHUSDT", 60),
        replicas: buildValidCell("ETHUSDT", 60).replicas.map((replica, index) =>
          index === 0
            ? {
                ...replica,
                payloadSha256Hex: payloadHash(
                  Buffer.alloc(FORECAST_V2_MAX_REPLICA_ARTIFACT_BYTES, 0x99),
                ),
              }
            : replica,
        ),
      },
    ]);
    phase02Observed.observedPackageSurfaceDigestHex = computeObservedPackageSurfaceDigestHex({
      cells: phase02Observed.cells,
      totals: phase02Observed.totals,
    });
    const phase01 = samplePhase01(phase01Observed);
    const phase02 = samplePhase02(phase02Observed, phase01);
    const aggregate = computeA3AggregateReceipt({
      identity,
      provenance: sampleProvenance(),
      phase01,
      phase02,
      phase03: {
        schemaVersion: A3_PHASE03_RECEIPT_VERSION,
        a3CanonicalContractDigest: identity.a3CanonicalContractDigest,
        phaseImplementationDigest: identity.phaseImplementationDigests.phase03,
        worktreeProvenanceDigest: identity.worktreeProvenanceDigest,
        provenance: sampleProvenance(),
        receiptContentDigestHex: "x",
        measuredAt: "2026-08-11T00:00:00.000Z",
        n1Bundles: 1000,
        n2Bundles: 200_000,
        checkpointBytesAtN1: 1,
        checkpointBytesAtN2: 1,
        checkpointSessionBytes: 1,
        maxGrowthBytesPerCycle: 54,
        supportedCheckpointEnvelopeBytes: 1,
        bundleHistoryInFhvHotCheckpointPath: false,
        bounded: true,
        evidence: "test",
        pass: true,
        failureReasons: [],
      },
    });
    expect(aggregate.pass).toBe(false);
  });

  it("aggregate fails on package byte mismatch", () => {
    const observed = buildValidProof();
    const phase01 = samplePhase01(observed);
    const phase02 = samplePhase02(observed, phase01, {
      phase2PackageFixedContributionBytes: phase01.phase01PackageFixedBytes + 1,
    });
    const aggregate = computeA3AggregateReceipt({
      identity,
      provenance: sampleProvenance(),
      phase01,
      phase02,
      phase03: {
        schemaVersion: A3_PHASE03_RECEIPT_VERSION,
        a3CanonicalContractDigest: identity.a3CanonicalContractDigest,
        phaseImplementationDigest: identity.phaseImplementationDigests.phase03,
        worktreeProvenanceDigest: identity.worktreeProvenanceDigest,
        provenance: sampleProvenance(),
        receiptContentDigestHex: "x",
        measuredAt: "2026-08-11T00:00:00.000Z",
        n1Bundles: 1000,
        n2Bundles: 200_000,
        checkpointBytesAtN1: 1,
        checkpointBytesAtN2: 1,
        checkpointSessionBytes: 1,
        maxGrowthBytesPerCycle: 54,
        supportedCheckpointEnvelopeBytes: 1,
        bundleHistoryInFhvHotCheckpointPath: false,
        bounded: true,
        evidence: "test",
        pass: true,
        failureReasons: [],
      },
    });
    expect(aggregate.pass).toBe(false);
  });

  it("canonical per-cell counts remain exact", () => {
    expect(A3_CANONICAL_PACKAGE_CELL_COUNTS.replicaArtifacts).toBe(50);
    expect(A3_CANONICAL_PACKAGE_CELL_COUNTS.terminalBuckets).toBe(7);
  });
});
