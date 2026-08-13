/**
 * DEE-518 A3 — phased PostgreSQL storage-scale evidence (opt-in).
 */

import { execSync } from "node:child_process";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import {
  computeA3AggregateReceipt,
  assertA3AggregateThresholds,
} from "@/lib/trader/intelligence/forecast-v2/a3-storage-aggregate-v1";
import { evaluatePhase01MeasurementValidity } from "@/lib/trader/intelligence/forecast-v2/a3-storage-acceptance-v1";
import {
  A3_PHASE01_RECEIPT_VERSION,
  A3_PHASE02_RECEIPT_VERSION,
  A3_PHASE03_RECEIPT_VERSION,
  a3ReceiptPath,
  readA3ReceiptFile,
  validateA3Phase01Receipt,
  validateA3Phase02Receipt,
  validateA3Phase03Receipt,
  validateStoredPhase01ReceiptAgainstCurrentIdentity,
  validateStoredPhase02ReceiptAgainstCurrentIdentity,
  validateStoredPhase03ReceiptAgainstCurrentIdentity,
  writeA3ReceiptAtomic,
  type A3Phase01ReceiptV1,
  type A3Phase02ReceiptV1,
  type A3Phase03ReceiptV1,
} from "@/lib/trader/intelligence/forecast-v2/a3-storage-receipt-v1";
import { appendA3DiagnosticLog } from "@/lib/trader/intelligence/forecast-v2/a3-phase01-progress-diagnostics-v1";
import { FORECAST_V2_PACKAGE_REPLICA_PAYLOAD_BYTES } from "@/lib/trader/intelligence/forecast-v2/storage-scale-projection";
import { runForecastV2StorageScalePhase02 } from "@/lib/trader/intelligence/forecast-v2/storage-scale-phase02-postgres-v1";
import {
  A3_CANONICAL_N_BUNDLES,
  A3_PHASE3_N1_BUNDLES,
  assertForecastV2TablesEmpty,
  collectPostgresLockDiagnostics,
  measureA3Phase03CheckpointIndependence,
  runForecastV2StorageScalePhase01,
} from "@/lib/trader/intelligence/forecast-v2/storage-scale-postgres-v1";
import {
  A3_PHASE01_TIMEOUT_MS,
  A3_PHASE_LOCK_PATH,
  A3_REPO_ROOT,
  a3EvidenceDirForCurrentContract,
  buildA3RunProvenance,
  computeA3RelationInventoryDigestHex,
  loadA3PhaseIdentityLayers,
} from "./a3-storage-scale-helpers";
import { seedWp13User, WP13_PG_USER_A } from "./wp13-intelligence-test-helpers";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const a3RunId = process.env.A3_RUN_ID?.trim() || "A3-P01-UNSPECIFIED";
const a3LogPath = process.env.A3_LOG_PATH?.trim() || `/tmp/dee518-a3-${a3RunId.toLowerCase()}.log`;

function acquirePhaseLock(label: string): void {
  if (existsSync(A3_PHASE_LOCK_PATH)) {
    throw new Error(`[A3] concurrent phase blocked — lock exists (${A3_PHASE_LOCK_PATH})`);
  }
  writeFileSync(
    A3_PHASE_LOCK_PATH,
    `${process.pid}\n${label}\n${new Date().toISOString()}\n`,
    "utf8",
  );
}

function releasePhaseLock(): void {
  if (existsSync(A3_PHASE_LOCK_PATH)) {
    unlinkSync(A3_PHASE_LOCK_PATH);
  }
}

function recreateValidationPostgres(): void {
  execSync("pnpm db:postgres:down", { cwd: A3_REPO_ROOT, stdio: "inherit" });
  execSync("pnpm db:postgres:bootstrap", {
    cwd: A3_REPO_ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL_POSTGRES: url,
    },
  });
}

async function waitForIdleDatabase(sql: postgres.Sql, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const diagnostics = await collectPostgresLockDiagnostics(sql, 5_000);
    if (diagnostics.length === 0) {
      return;
    }
    if (Date.now() - started > 30_000) {
      throw new Error(`[A3] lock wait exceeded: ${diagnostics.join(" | ")}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

describe.skipIf(!integrationEnabled || !url)("DEE-518 A3 phased storage-scale evidence", () => {
  const identity = loadA3PhaseIdentityLayers();
  const evidenceDir = a3EvidenceDirForCurrentContract();

  beforeAll(() => {
    console.log("[A3 identity]", JSON.stringify(identity, null, 2));
  });

  afterAll(() => {
    releasePhaseLock();
  });

  it(
    "A3 PHASE 0-1 complete-bundle measured receipt PASS",
    async () => {
      const startedAt = new Date().toISOString();
      acquirePhaseLock(a3RunId);
      recreateValidationPostgres();

      const sql = postgres(url!, { max: 4, idle_timeout: 30 });
      try {
        await waitForIdleDatabase(sql, 120_000);
        const orgId = await seedWp13User(url!, WP13_PG_USER_A, "A3 PHASE-01");
        await assertForecastV2TablesEmpty(sql);

        const measured = await runForecastV2StorageScalePhase01(
          sql,
          orgId,
          A3_CANONICAL_N_BUNDLES,
          A3_REPO_ROOT,
        );

        const perSampleTableExists = (
          await sql<{ exists: boolean }[]>`
            SELECT EXISTS (
              SELECT 1
              FROM information_schema.tables
              WHERE table_schema = 'public'
                AND table_name = 'trader_forecast_sample_v2'
            ) AS exists
          `
        )[0]?.exists;

        const measurement = evaluatePhase01MeasurementValidity({
          nBundles: A3_CANONICAL_N_BUNDLES,
          rowCounts: measured.rowCounts,
          observedPackageContractConforms:
            measured.observedPackageSurface.observedPackageContractConforms,
          phase01PackageFixedBytes: measured.phase01PackageFixedBytes,
          perSampleTableExists: Boolean(perSampleTableExists),
          environment: measured.postgresMeasurementEnvironment,
        });
        const failureReasons = [
          ...measurement.failureReasons,
          ...(measured.observedPackageSurface.observedPackageContractConforms
            ? []
            : measured.observedPackageSurface.failureReasons),
        ];
        const measurementValid =
          measurement.measurementValid &&
          measured.observedPackageSurface.observedPackageContractConforms;

        const provenance = buildA3RunProvenance({
          runId: a3RunId,
          logPath: a3LogPath,
          startedAt,
        });

        appendA3DiagnosticLog("[WRITING_RECEIPT] start", a3LogPath);
        const receipt = writeA3ReceiptAtomic(evidenceDir, "phase-01.json", {
          schemaVersion: A3_PHASE01_RECEIPT_VERSION,
          a3CanonicalContractDigest: identity.a3CanonicalContractDigest,
          storageSurfaceDigest: identity.storageSurfaceDigest,
          phaseImplementationDigest: identity.phaseImplementationDigests.phase01,
          worktreeProvenanceDigest: identity.worktreeProvenanceDigest,
          provenance,
          measuredAt: new Date().toISOString(),
          postgresServerVersion: measured.postgresServerVersion,
          postgresMeasurementEnvironment: measured.postgresMeasurementEnvironment,
          appliedMigrationRange: measured.appliedMigrationRange,
          relationInventoryDigestHex: computeA3RelationInventoryDigestHex(),
          expectedPackageSurfaceDigestHex: measured.expectedPackageSurfaceDigestHex,
          observedPackageSurfaceDigestHex:
            measured.observedPackageSurface.observedPackageSurfaceDigestHex,
          observedPackageContractConforms:
            measured.observedPackageSurface.observedPackageContractConforms,
          observedPackageSurface: measured.observedPackageSurface,
          b0Bytes: measured.b0Bytes,
          phase01PackageFixedBytes: measured.phase01PackageFixedBytes,
          packageFixedRelationBreakdown: measured.packageFixedRelationBreakdown,
          b1Bytes: measured.b1Bytes,
          grossDeltaBytes: measured.b1Bytes - measured.b0Bytes,
          nBundles: A3_CANONICAL_N_BUNDLES,
          rowCounts: measured.rowCounts,
          b0RelationBreakdown: measured.b0RelationBreakdown,
          b1RelationBreakdown: measured.b1RelationBreakdown,
          // Structural measurement validity only — NEVER final STORAGE_ACCEPTANCE_PASS.
          pass: measurementValid,
          phase01Status: measurementValid
            ? "PHASE01_MEASUREMENT_COMPLETE"
            : "PHASE01_MEASUREMENT_INVALID",
          finalStorageAcceptancePass: false as const,
          storageAcceptance: "AWAITING_PHASE02_FIXED_CONTRIBUTION" as const,
          failureReasons,
        });

        validateA3Phase01Receipt(receipt as A3Phase01ReceiptV1, identity);
        expect(receipt.finalStorageAcceptancePass).toBe(false);
        expect(receipt.storageAcceptance).toBe("AWAITING_PHASE02_FIXED_CONTRIBUTION");
        appendA3DiagnosticLog(
          `[WRITING_RECEIPT] complete measurementValid=${receipt.pass} finalStorageAcceptancePass=false path=${a3ReceiptPath(evidenceDir, "phase-01.json")}`,
          a3LogPath,
        );
        appendA3DiagnosticLog(
          `[PHASE01] TERMINAL MEASUREMENT_${receipt.pass ? "COMPLETE" : "INVALID"} (not STORAGE_ACCEPTANCE_PASS)`,
          a3LogPath,
        );
        expect(receipt.rowCounts.trader_forecast_bundle_v2).toBe(200_000);
        expect(receipt.rowCounts.trader_forecast_scenario_v2).toBe(1_400_000);
        expect(receipt.observedPackageSurface.totals.rawReplicaPayloadBytes).toBe(13_107_200);
        console.log(`[${a3RunId} receipt]`, JSON.stringify(receipt));
      } finally {
        await sql.end({ timeout: 30 });
        releasePhaseLock();
      }
    },
    A3_PHASE01_TIMEOUT_MS,
  );

  it("A3 PHASE 2 package-fixed fresh-db measured receipt PASS", async () => {
    const startedAt = new Date().toISOString();
    acquirePhaseLock("A3-PHASE-02");
    const phase01 = readA3ReceiptFile<A3Phase01ReceiptV1>(
      a3ReceiptPath(evidenceDir, "phase-01.json"),
    );
    validateStoredPhase01ReceiptAgainstCurrentIdentity(phase01, identity);

    recreateValidationPostgres();
    const sql = postgres(url!, { max: 4, idle_timeout: 30 });
    try {
      await waitForIdleDatabase(sql, 120_000);
      const orgId = await seedWp13User(url!, WP13_PG_USER_A, "A3 PHASE-02");
      const measured = await runForecastV2StorageScalePhase02(sql, orgId, A3_REPO_ROOT);

      const receipt = writeA3ReceiptAtomic(evidenceDir, "phase-02.json", {
        schemaVersion: A3_PHASE02_RECEIPT_VERSION,
        a3CanonicalContractDigest: identity.a3CanonicalContractDigest,
        storageSurfaceDigest: identity.storageSurfaceDigest,
        phaseImplementationDigest: identity.phaseImplementationDigests.phase02,
        worktreeProvenanceDigest: identity.worktreeProvenanceDigest,
        provenance: buildA3RunProvenance({
          runId: process.env.A3_RUN_ID?.trim() || "A3-PHASE-02",
          logPath: process.env.A3_LOG_PATH?.trim() || "/tmp/dee518-a3-phase-02.log",
          startedAt,
        }),
        measuredAt: new Date().toISOString(),
        postgresServerVersion: measured.postgresMeasurementEnvironment.serverVersion,
        postgresMeasurementEnvironment: measured.postgresMeasurementEnvironment,
        phase2FreshDatabaseLiteral: true as const,
        expectedPackageSurfaceDigestHex: measured.expectedPackageSurfaceDigestHex,
        observedPackageSurfaceDigestHex:
          measured.observedPackageSurface.observedPackageSurfaceDigestHex,
        observedPackageContractConforms:
          measured.observedPackageSurface.observedPackageContractConforms,
        observedPackageSurface: measured.observedPackageSurface,
        phase2EmptyBytes: measured.phase2EmptyBytes,
        phase2FullBytes: measured.phase2FullBytes,
        phase2PackageFixedContributionBytes: measured.packageFixedContributionBytes,
        packageFixedRelationBreakdown: measured.packageFixedRelationBreakdown,
        packageRawReplicaPayloadBytes: FORECAST_V2_PACKAGE_REPLICA_PAYLOAD_BYTES * 4,
        phase2RelationBreakdown: measured.phase2RelationBreakdown,
        enumeratedFixedV2OtherItems: measured.enumeratedFixedV2OtherItems,
        enumeratedFixedV2OtherBytes: measured.enumeratedFixedV2OtherBytes,
        pass: true,
        failureReasons: [],
      });

      validateA3Phase02Receipt(receipt as A3Phase02ReceiptV1, identity);
      expect(receipt.observedPackageSurfaceDigestHex).toBe(phase01.observedPackageSurfaceDigestHex);
      expect(receipt.postgresMeasurementEnvironment.postgresMeasurementEnvironmentDigest).toBe(
        phase01.postgresMeasurementEnvironment.postgresMeasurementEnvironmentDigest,
      );
      console.log("[A3-PHASE-02 receipt]", JSON.stringify(receipt));
    } finally {
      await sql.end({ timeout: 30 });
      releasePhaseLock();
    }
  }, 900_000);

  it("A3 PHASE 3 FHV checkpoint boundedness receipt PASS", () => {
    const startedAt = new Date().toISOString();
    acquirePhaseLock("A3-PHASE-03");
    try {
      const proof = measureA3Phase03CheckpointIndependence({
        n1Bundles: A3_PHASE3_N1_BUNDLES,
        n2Bundles: A3_CANONICAL_N_BUNDLES,
      });

      const failureReasons: string[] = [];
      if (!proof.bounded) {
        failureReasons.push("phase-03 checkpoint boundedness failed");
      }

      const receipt = writeA3ReceiptAtomic(evidenceDir, "phase-03.json", {
        schemaVersion: A3_PHASE03_RECEIPT_VERSION,
        a3CanonicalContractDigest: identity.a3CanonicalContractDigest,
        phaseImplementationDigest: identity.phaseImplementationDigests.phase03,
        worktreeProvenanceDigest: identity.worktreeProvenanceDigest,
        provenance: buildA3RunProvenance({
          runId: process.env.A3_RUN_ID?.trim() || "A3-PHASE-03",
          logPath: process.env.A3_LOG_PATH?.trim() || "/tmp/dee518-a3-phase-03.log",
          startedAt,
        }),
        measuredAt: new Date().toISOString(),
        n1Bundles: proof.n1Bundles,
        n2Bundles: proof.n2Bundles,
        checkpointBytesAtN1: proof.checkpointBytesAtN1,
        checkpointBytesAtN2: proof.checkpointBytesAtN2,
        checkpointSessionBytes: proof.checkpointSessionBytes,
        maxGrowthBytesPerCycle: proof.maxGrowthBytesPerCycle,
        supportedCheckpointEnvelopeBytes: proof.supportedCheckpointEnvelopeBytes,
        bundleHistoryInFhvHotCheckpointPath: false as const,
        bounded: proof.bounded,
        evidence: proof.evidence,
        pass: failureReasons.length === 0,
        failureReasons,
      });

      validateA3Phase03Receipt(receipt as A3Phase03ReceiptV1, identity);
      expect(receipt.checkpointBytesAtN1).toBe(receipt.checkpointBytesAtN2);
      console.log("[A3-PHASE-03 receipt]", JSON.stringify(receipt));
    } finally {
      releasePhaseLock();
    }
  });

  it("A3 aggregate projection receipt PASS", () => {
    acquirePhaseLock("A3-AGGREGATE");
    try {
      const phase01 = readA3ReceiptFile<A3Phase01ReceiptV1>(
        a3ReceiptPath(evidenceDir, "phase-01.json"),
      );
      const phase02 = readA3ReceiptFile<A3Phase02ReceiptV1>(
        a3ReceiptPath(evidenceDir, "phase-02.json"),
      );
      const phase03 = readA3ReceiptFile<A3Phase03ReceiptV1>(
        a3ReceiptPath(evidenceDir, "phase-03.json"),
      );

      validateStoredPhase01ReceiptAgainstCurrentIdentity(phase01, identity);
      validateStoredPhase02ReceiptAgainstCurrentIdentity(phase02, identity);
      validateStoredPhase03ReceiptAgainstCurrentIdentity(phase03, identity);

      const aggregate = computeA3AggregateReceipt({
        identity,
        provenance: buildA3RunProvenance({
          runId: process.env.A3_RUN_ID?.trim() || "A3-AGGREGATE",
          logPath: process.env.A3_LOG_PATH?.trim() || "/tmp/dee518-a3-aggregate.log",
          startedAt: new Date().toISOString(),
        }),
        phase01,
        phase02,
        phase03,
      });

      writeA3ReceiptAtomic(evidenceDir, "aggregate.json", aggregate);
      assertA3AggregateThresholds(aggregate);
      console.log("[A3-AGGREGATE receipt]", JSON.stringify(aggregate));
    } finally {
      releasePhaseLock();
    }
  });
});
