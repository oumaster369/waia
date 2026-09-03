/**
 * Opt-in DEE-919 full first-cycle integration.
 *
 * Requires a freshly migrated, disposable local waia_it/waia_validate database:
 * WAIA_PG_INTEGRATION=1 DATABASE_URL_POSTGRES_SESSION=postgresql://... vitest run ...
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as pgSchema from "@/db/schema.postgres";
import {
  createCanonicalDecisionVerificationReceiptServiceV2,
  historicalDatasetAuthorityRunLockKeyV2,
} from
  "@/lib/trader/historical-simulation-v2/canonical-verification-receipt-postgres-v2";
import {
  TEST_ONLY_prepareHistoricalProductionFirstCycleWithHeldPostgresV2,
  type HistoricalProductionFirstCycleBootstrapInputV2,
  type HistoricalProductionFirstCycleStepV2,
} from
  "@/lib/trader/historical-simulation-v2/production-first-cycle-bootstrap-v2";
import { computePayloadDigest } from
  "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import { barToFhvBarsV2Record, serializeFhvBarsV2Record } from
  "@/lib/trader/market-data/fhv-bars-v2-ndjson";
import { streamingBarSemanticDigestOf } from
  "@/lib/trader/market-data/fhv-streaming-bar-digest";
import type { FhvPreHoldoutQualificationReceiptV1 } from
  "@/lib/trader/market-data/fhv-pre-holdout-qualification";
import { assertFhvPreHoldoutQualificationPass } from
  "@/lib/trader/market-data/fhv-pre-holdout-qualification";
import {
  FHV_PRE_HOLDOUT_RUNTIME_REQUALIFICATION_SCHEMA,
  type FhvPreHoldoutRuntimeRequalificationV1,
} from "@/lib/trader/market-data/fhv-pre-holdout-runtime-requalification";
import {
  qualifyHtxKlineVolumeAuthority,
  type HtxVolumeQualificationReceiptV1,
} from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import { persistHtxVolumeQualificationReceipt } from
  "@/lib/trader/market-data/volume-qualification/htx-volume-qualification-receipt-service";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import {
  TEST_ONLY_assertKmFourSurfaceProductionRunUnusedV2,
  TEST_ONLY_prepareKmFourSurfaceProductionAuthorityV2,
  type KmFourSurfaceProductionPreflightInputV2,
} from
  "@/lib/trader/research/execopp-qualification/km-four-surface-production-preflight-v2";
import {
  buildExecutableForecastReplayEvidenceV2,
  TEST_ONLY_buildKmFourSurfaceProductionAuthorityV2,
  TEST_ONLY_loadKmFourSurfaceDurableDatasetAuthorityV2,
} from
  "@/lib/trader/research/execopp-qualification/km-four-surface-production-bootstrap-v2";
import { INTERNAL_persistScientificAdmissionFourSurfaceV2 } from
  "@/lib/trader/research/execopp-qualification/scientific-admission-four-surface-repository-postgres-v2";
import {
  HISTORICAL_FOUR_SURFACE_HUMAN_DECISION_V2,
  requireHistoricalFourSurfaceRatifiedAdmissionV2,
  TEST_ONLY_ratifyHistoricalFourSurfaceAdmissionWithHeldPostgresV2,
  type HistoricalFourSurfaceRatifiedAdmissionV2,
} from
  "@/lib/trader/research/execopp-qualification/historical-four-surface-ratified-admission-v2";
import { createPostgresMiSourceProvenanceService } from
  "@/lib/trader/mi/source-provenance-service";
import { loadHistoricalSimulationBootstrapSourceCyclesV2 } from
  "@/lib/trader/historical-simulation-v2/bootstrap-source-loader-v2";
import { loadHistoricalDevelopmentSourceCorpusSnapshotFromDatasetV2 } from
  "@/lib/trader/historical-simulation-v2/development-source-corpus-v2";
import { loadHistoricalWalkForwardPredictiveSourceCorpusSnapshotFromDatasetV2 } from
  "@/lib/trader/historical-simulation-v2/development-source-corpus-v2";
import { bindPostgresReservedSession } from "@/db/postgres-session-transaction";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES_SESSION?.trim() ?? "";
const parsed = (() => {
  try { return url ? new URL(url) : null; } catch { return null; }
})();
const database = parsed?.pathname.replace(/^\//, "") ?? "";
const disposable = Boolean(
  parsed && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) &&
  ["waia_it", "waia_validate"].includes(database) && parsed.port !== "6543",
);

if (enabled && url && !disposable) {
  throw new Error("DEE919_PG_INTEGRATION_REFUSED:LOCAL_DISPOSABLE_SESSION_DATABASE_REQUIRED");
}

const RELEASE_SHA = "d".repeat(40);
const BAR_COUNT = 4_240;
const WF_PREDICTIVE_BAR_COUNT = 1_000;
const WF_ECONOMIC_BAR_COUNT = 200;
const WF_BAR_COUNT = WF_PREDICTIVE_BAR_COUNT + WF_ECONOMIC_BAR_COUNT;
const INITIAL_RECORD_INDEX = 239;
const QUALIFIED_AT = "2026-08-01T00:00:00.000Z";
const SYMBOLS = ["BTCUSDT", "ETHUSDT"] as const;

type Fixture = Readonly<{
  root: string;
  qualificationPath: string;
  volumePaths: Readonly<Record<(typeof SYMBOLS)[number], string>>;
  volumeReceipts: Readonly<Record<(typeof SYMBOLS)[number], HtxVolumeQualificationReceiptV1>>;
  qualificationReceipt: FhvPreHoldoutQualificationReceiptV1;
}>;

function hex(label: string): string {
  return createHash("sha256").update(label).digest("hex");
}

function runtimeRequalificationReceipt(
  receipt: FhvPreHoldoutQualificationReceiptV1,
): FhvPreHoldoutRuntimeRequalificationV1 {
  const body = {
    schemaVersion: FHV_PRE_HOLDOUT_RUNTIME_REQUALIFICATION_SCHEMA,
    classification: "RUNTIME_REQUALIFICATION=PASS" as const,
    sourceQualificationReceiptDigest: receipt.qualificationReceiptDigest,
    sourceReleaseSha: receipt.releaseSha,
    targetReleaseSha: RELEASE_SHA,
    datasetContentDigest: receipt.developmentWalkForwardContentDigest,
    organizationId: receipt.organizationId,
    operatorId: receipt.operatorId,
    verifiedAtUtc: QUALIFIED_AT,
  };
  return Object.freeze({
    ...body,
    requalificationReceiptDigest: computePayloadDigest(body),
  });
}

function buildDatasetFixture(organizationId: string): Fixture {
  const root = mkdtempSync(join(tmpdir(), "dee-919-first-cycle-"));
  const volumePaths = {} as Record<(typeof SYMBOLS)[number], string>;
  const volumeReceipts = {} as Record<(typeof SYMBOLS)[number], HtxVolumeQualificationReceiptV1>;
  const partitions: FhvPreHoldoutQualificationReceiptV1["partitions"][number][] = [];
  const scientificSubpartitions:
    FhvPreHoldoutQualificationReceiptV1["scientificSubpartitions"][number][] = [];

  for (const [symbolIndex, symbol] of SYMBOLS.entries()) {
    const instrument = symbol === "BTCUSDT" ? "BTC/USDT" as const : "ETH/USDT" as const;
    const start = Date.UTC(2025, 0, 1);
    const records = Array.from({ length: BAR_COUNT }, (_, index) => {
      const center = 30_000 + symbolIndex * 1_500 + index * 0.07 +
        Math.sin(index / 11) * 35 + Math.cos(index / 37) * 17;
      const open = center - Math.sin(index / 5) * 2;
      const close = center + Math.cos(index / 7) * 2;
      const bar = {
        symbol: instrument,
        interval: "1m" as const,
        open: open.toFixed(8),
        high: (Math.max(open, close) + 5).toFixed(8),
        low: (Math.min(open, close) - 5).toFixed(8),
        close: close.toFixed(8),
        volume: (100 + index % 19).toFixed(8),
        barOpenTime: new Date(start + index * 60_000).toISOString(),
        barCloseTime: new Date(start + (index + 1) * 60_000).toISOString(),
      };
      return serializeFhvBarsV2Record(barToFhvBarsV2Record(bar));
    });
    const raw = records.join("");
    const directory = join(root, "partitions", "development", symbol);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "bars.v2.ndjson"), raw);
    partitions.push({
      partition: "development",
      symbol,
      acquisitionReceiptDigest: hex(`acquisition:${symbol}`),
      rawSha256: createHash("sha256").update(raw).digest("hex"),
      semanticContentDigest: hex(`semantic:${symbol}`),
      barCount: BAR_COUNT,
      expectedBarCount: BAR_COUNT,
      firstBarOpen: new Date(start).toISOString(),
      lastBarClose: new Date(start + BAR_COUNT * 60_000).toISOString(),
      gapDuplicateIntegrity: "PASS",
      normalizationIdentity: "fhv-bars-v2-dee-919-integration",
      pageCount: 1,
      retryCount: 0,
    });
    const wfStart = Date.UTC(2026, 0, 1);
    const wfBars = Array.from({ length: WF_BAR_COUNT }, (_, localIndex) => {
      const index = BAR_COUNT + localIndex;
      const center = 30_000 + symbolIndex * 1_500 + index * 0.07 +
        Math.sin(index / 11) * 35 + Math.cos(index / 37) * 17;
      const open = center - Math.sin(index / 5) * 2;
      const close = center + Math.cos(index / 7) * 2;
      return {
        symbol: instrument,
        interval: "1m" as const,
        open: open.toFixed(8),
        high: (Math.max(open, close) + 5).toFixed(8),
        low: (Math.min(open, close) - 5).toFixed(8),
        close: close.toFixed(8),
        volume: (100 + index % 19).toFixed(8),
        barOpenTime: new Date(wfStart + localIndex * 60_000).toISOString(),
        barCloseTime: new Date(wfStart + (localIndex + 1) * 60_000).toISOString(),
      };
    });
    const wfRecords = wfBars.map((bar) =>
      serializeFhvBarsV2Record(barToFhvBarsV2Record(bar)));
    const wfRaw = wfRecords.join("");
    const wfDirectory = join(root, "partitions", "walk-forward", symbol);
    mkdirSync(wfDirectory, { recursive: true });
    writeFileSync(join(wfDirectory, "bars.v2.ndjson"), wfRaw);
    const wfSemanticDigest = streamingBarSemanticDigestOf(wfBars);
    const wfPredictiveBars = wfBars.slice(0, WF_PREDICTIVE_BAR_COUNT);
    const wfEconomicBars = wfBars.slice(WF_PREDICTIVE_BAR_COUNT);
    const wfPredictiveSemanticDigest = streamingBarSemanticDigestOf(wfPredictiveBars);
    const wfEconomicSemanticDigest = streamingBarSemanticDigestOf(wfEconomicBars);
    partitions.push({
      partition: "walk-forward",
      symbol,
      acquisitionReceiptDigest: hex(`wf-acquisition:${symbol}`),
      rawSha256: createHash("sha256").update(wfRaw).digest("hex"),
      semanticContentDigest: wfSemanticDigest,
      barCount: WF_BAR_COUNT,
      expectedBarCount: WF_BAR_COUNT,
      firstBarOpen: new Date(wfStart).toISOString(),
      lastBarClose: new Date(wfStart + WF_BAR_COUNT * 60_000).toISOString(),
      gapDuplicateIntegrity: "PASS",
      normalizationIdentity: "fhv-bars-v2-dee-919-integration",
      pageCount: 1,
      retryCount: 0,
    });
    scientificSubpartitions.push({
      scientificPartition: "WF_PREDICTIVE",
      symbol,
      startUtc: new Date(wfStart).toISOString(),
      endUtc: new Date(wfStart + WF_PREDICTIVE_BAR_COUNT * 60_000).toISOString(),
      barCount: WF_PREDICTIVE_BAR_COUNT,
      expectedBarCount: WF_PREDICTIVE_BAR_COUNT,
      firstBarOpen: new Date(wfStart).toISOString(),
      lastBarClose: new Date(wfStart + WF_PREDICTIVE_BAR_COUNT * 60_000).toISOString(),
      semanticContentDigest: wfPredictiveSemanticDigest,
      gapDuplicateIntegrity: "PASS",
    });
    scientificSubpartitions.push({
      scientificPartition: "WF_ECONOMIC",
      symbol,
      startUtc: new Date(wfStart + WF_PREDICTIVE_BAR_COUNT * 60_000).toISOString(),
      endUtc: new Date(wfStart + WF_BAR_COUNT * 60_000).toISOString(),
      barCount: WF_ECONOMIC_BAR_COUNT,
      expectedBarCount: WF_ECONOMIC_BAR_COUNT,
      firstBarOpen: new Date(wfStart + WF_PREDICTIVE_BAR_COUNT * 60_000).toISOString(),
      lastBarClose: new Date(wfStart + WF_BAR_COUNT * 60_000).toISOString(),
      semanticContentDigest: wfEconomicSemanticDigest,
      gapDuplicateIntegrity: "PASS",
    });
    const volume = qualifyHtxKlineVolumeAuthority({
      symbol,
      qualifiedAtUtc: QUALIFIED_AT,
      rows: [{
        id: 1,
        open: 30_000,
        high: 30_005,
        low: 29_995,
        close: 30_001,
        amount: 100,
        vol: 3_000_100,
        count: 100,
      }],
    });
    const volumePath = join(root, `${symbol}.volume.json`);
    writeFileSync(volumePath, JSON.stringify(volume));
    volumePaths[symbol] = volumePath;
    volumeReceipts[symbol] = volume;
  }

  const body: Omit<FhvPreHoldoutQualificationReceiptV1,
    "qualificationReceiptDigest"> = {
    schemaVersion: "fhv-pre-holdout-qualification-receipt/v1",
    qualificationMode: "OFFICIAL_PRE_HOLDOUT_REAL_DATA",
    classification: "PRE_HOLDOUT_QUALIFICATION=PASS",
    releaseSha: RELEASE_SHA,
    organizationId,
    operatorId: "dee-919-fresh-pg-integration",
    sourceCapabilityEvidenceDigest: hex("source-capability"),
    canonicalBoundaries: {
      development: {
        startUtc: partitions[0]!.firstBarOpen,
        endUtc: partitions[0]!.lastBarClose,
      },
      walkForward: {
        startUtc: "2026-01-01T00:00:00.000Z",
        endUtc: new Date(Date.UTC(2026, 0, 1) + WF_BAR_COUNT * 60_000).toISOString(),
      },
      wfPredictive: {
        startUtc: "2026-01-01T00:00:00.000Z",
        endUtc: new Date(Date.UTC(2026, 0, 1) +
          WF_PREDICTIVE_BAR_COUNT * 60_000).toISOString(),
      },
      wfEconomic: {
        startUtc: new Date(Date.UTC(2026, 0, 1) +
          WF_PREDICTIVE_BAR_COUNT * 60_000).toISOString(),
        endUtc: new Date(Date.UTC(2026, 0, 1) + WF_BAR_COUNT * 60_000).toISOString(),
      },
    },
    interval: "1m",
    symbols: [...SYMBOLS],
    acquisitionReceiptDigests: partitions.map((value) => value.acquisitionReceiptDigest),
    partitions,
    scientificSubpartitions,
    developmentContentDigest: hex("development-content"),
    wfPredictiveContentDigest: computeStableJsonDigest(scientificSubpartitions
      .filter((entry) => entry.scientificPartition === "WF_PREDICTIVE")
      .map((entry) => ({ scientificPartition: entry.scientificPartition,
        symbol: entry.symbol, semanticContentDigest: entry.semanticContentDigest }))),
    wfEconomicContentDigest: computeStableJsonDigest(scientificSubpartitions
      .filter((entry) => entry.scientificPartition === "WF_ECONOMIC")
      .map((entry) => ({ scientificPartition: entry.scientificPartition,
        symbol: entry.symbol, semanticContentDigest: entry.semanticContentDigest }))),
    developmentWalkForwardContentDigest: hex("development-walk-forward"),
    walkForwardUnionCompatibilityDigest: hex("walk-forward-union"),
    holdout: {
      canonicalBoundary: {
        startUtc: "2027-01-01T00:00:00.000Z",
        endUtc: "2027-02-01T00:00:00.000Z",
      },
      status: "PRE_HOLDOUT_ONLY_NOT_PRESENT_NOT_ACCESSED",
      sourceCapabilityEvidenceDigest: hex("source-capability"),
    },
    revisionRiskEvidence: [],
    revisionRiskDisposition: "SAME",
    qualifiedAtUtc: QUALIFIED_AT,
  };
  const receipt: FhvPreHoldoutQualificationReceiptV1 = {
    ...body,
    qualificationReceiptDigest: computeStableJsonDigest(body),
  };
  const qualificationPath = join(root, "qualification.json");
  writeFileSync(qualificationPath, JSON.stringify(receipt));
  return Object.freeze({
    root,
    qualificationPath,
    volumePaths: Object.freeze(volumePaths),
    volumeReceipts: Object.freeze(volumeReceipts),
    qualificationReceipt: receipt,
  });
}

const policyConfig = Object.freeze({
  policyInstanceId: "dee-919-production-first-cycle",
  interimPositionPolicyId:
    "fixed-horizon-qualification/unrepresentable-normal-exits-disabled/v1" as const,
  sliceAllocationPolicy: "explicit-weights-last-slice-remainder-no-top-up/v1" as const,
  roundingPolicy: "scale8-floor-step-truncate-half-up/v1" as const,
  entrySliceOffsets: [1, 2, 3] as const,
  entrySliceWeights: ["0.4", "0.3", "0.3"] as const,
  exitSliceOffsetsAfterHorizon: [1, 2, 3] as const,
  exitSliceWeights: ["0.4", "0.3", "0.3"] as const,
  participationCapFraction: "0.1",
  quantityStep: "0.0001",
  minimumQuantity: "0.0001",
  minimumNotionalUsdt: "1",
  entryCosts: Object.freeze({
    feeBps: "0", spreadBps: "0", impactBps: "0", slippageBps: "0",
    conservativeStressBps: "0",
  }),
  exitCosts: Object.freeze({
    feeBps: "0", spreadBps: "0", impactBps: "0", slippageBps: "0",
    conservativeStressBps: "0",
  }),
  partialFillPolicy: "EXPLICIT_CAPACITY_BOUNDED_NO_TOP_UP" as const,
  unfilledEntryPolicy: "RETAIN_AS_CASH" as const,
  postExitResidualPolicy: "SIZE_ECONOMICALLY_INADMISSIBLE" as const,
});

describe.skipIf(!enabled || !url || !disposable)(
  "DEE-919 full production first-cycle PostgreSQL integration",
  () => {
    const pool = postgres(url, { max: 3 });
    const priorReleaseSha = process.env.WAIA_RELEASE_SHA;
    const organizationId = randomUUID();
    const userId = randomUUID();
    const runId = `dee-919-${randomUUID()}`;
    let fixture: Fixture;
    let preflight: KmFourSurfaceProductionPreflightInputV2;
    let productionInput: HistoricalProductionFirstCycleBootstrapInputV2;
    let reserved: postgres.ReservedSql;
    let heldSql: postgres.Sql;
    let lockKey: string;
    let ratified: HistoricalFourSurfaceRatifiedAdmissionV2;
    let ratifiedAuthorityId: string;

    beforeAll(async () => {
      process.env.WAIA_RELEASE_SHA = RELEASE_SHA;
      const migrated = await pool<Array<Readonly<{ relation: string | null }>>>`
        SELECT to_regclass(
          'public.trader_historical_four_surface_ratified_admission_v2'
        )::text AS relation
      `;
      expect(migrated[0]?.relation).toBe(
        "trader_historical_four_surface_ratified_admission_v2",
      );
      await pool`INSERT INTO auth.users (id) VALUES (${userId}::uuid)`;
      await pool`INSERT INTO users (id, identity_label, email)
        VALUES (${userId}::uuid, 'DEE-919 PostgreSQL integration',
          ${`dee-919-${userId}@invalid.local`})`;
      await pool`INSERT INTO organizations (id, owner_user_id, kind, name)
        VALUES (${organizationId}::uuid, ${userId}::uuid, 'personal',
          'DEE-919 PostgreSQL integration')`;
      await pool`INSERT INTO organization_members (
        id, organization_id, user_id, member_role
      ) VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${userId}::uuid, 'owner')`;
      fixture = buildDatasetFixture(organizationId);
      for (const symbol of SYMBOLS) {
        await persistHtxVolumeQualificationReceipt(pool, {
          organizationId,
          receipt: fixture.volumeReceipts[symbol],
        });
      }
      preflight = {
        runId,
        datasetRoot: fixture.root,
        qualificationReceiptPath: fixture.qualificationPath,
        runtimeRequalificationReceiptPath: join(fixture.root, "unused-runtime.json"),
        releaseSha: RELEASE_SHA,
        organizationId,
        economics: {
          notionalUsdt: 1_000,
          costRate: 0.001,
          slippageBufferUsdt: 0.05,
          nRefUsdt: 1_000,
        },
        htxVolumeQualificationReceiptPaths: fixture.volumePaths,
        initialDevelopmentRecordIndex: INITIAL_RECORD_INDEX,
        developmentCycleCount: 1,
      };
      reserved = await pool.reserve();
      const rawBackend = await reserved<Array<Readonly<{ pid: number }>>>
        `SELECT pg_backend_pid()::int AS pid`;
      const sql = bindPostgresReservedSession(pool, reserved);
      heldSql = sql;
      const boundBackend = await sql<Array<Readonly<{ pid: number }>>>
        `SELECT pg_backend_pid()::int AS pid`;
      expect(boundBackend[0]?.pid).toBe(rawBackend[0]?.pid);
      lockKey = historicalDatasetAuthorityRunLockKeyV2({ organizationId, runId });
      await sql`SELECT pg_advisory_lock(hashtextextended(${lockKey},0))`;
      const heldLock = await sql<Array<Readonly<{ held: boolean }>>>
        `SELECT EXISTS (
          SELECT 1 FROM pg_locks
          WHERE locktype='advisory' AND pid=pg_backend_pid() AND granted
        ) AS held`;
      expect(heldLock[0]?.held).toBe(true);
      const ratification = await TEST_ONLY_ratifyHistoricalFourSurfaceAdmissionWithHeldPostgresV2(
        sql,
        {
          preflight,
          humanDecision: HISTORICAL_FOUR_SURFACE_HUMAN_DECISION_V2,
        },
        userId,
        {
          prepare: async (transaction, preparedPreflight) => {
            const authority = await TEST_ONLY_prepareKmFourSurfaceProductionAuthorityV2(
              preparedPreflight,
              {
                loadCycles: loadHistoricalSimulationBootstrapSourceCyclesV2,
                assertRunUnused: (scope) =>
                  TEST_ONLY_assertKmFourSurfaceProductionRunUnusedV2(transaction, scope),
                registerAuthorities: async (registration) => {
                  const service = createCanonicalDecisionVerificationReceiptServiceV2(transaction);
                  for (const symbol of SYMBOLS) {
                    await service.registerPreHoldoutDatasetAuthorityFromSource({
                      datasetRoot: registration.datasetRoot,
                      qualificationReceiptPath: registration.qualificationReceiptPath,
                      runtimeRequalificationReceiptPath:
                        registration.runtimeRequalificationReceiptPath,
                      htxVolumeQualificationReceiptPath:
                        registration.htxVolumeQualificationReceiptPaths[symbol],
                      releaseSha: registration.releaseSha,
                      organizationId: registration.organizationId,
                      runId: registration.runId,
                      partition: "DEVELOPMENT",
                      symbol,
                      initialRecordIndex: registration.initialDevelopmentRecordIndex,
                      cycleCount: registration.developmentCycleCount,
                    });
                  }
                },
                buildAuthority: (bootstrap) =>
                  TEST_ONLY_buildKmFourSurfaceProductionAuthorityV2(bootstrap, {
                    loadDurableAuthority: (scope) =>
                      TEST_ONLY_loadKmFourSurfaceDurableDatasetAuthorityV2(transaction, scope),
                    readQualification: () => fixture.qualificationReceipt,
                    assertQualification: assertFhvPreHoldoutQualificationPass,
                    assertFiles: () => undefined,
                    readRuntimeRequalification: () =>
                      runtimeRequalificationReceipt(fixture.qualificationReceipt),
                    loadCorpusSnapshot:
                      loadHistoricalDevelopmentSourceCorpusSnapshotFromDatasetV2,
                    evaluate: buildExecutableForecastReplayEvidenceV2,
                  }),
              },
            );
            const admission = await INTERNAL_persistScientificAdmissionFourSurfaceV2(
              transaction, authority,
            );
            return Object.freeze({ authority, admission });
          },
          readQualification: () => fixture.qualificationReceipt,
          assertQualification: assertFhvPreHoldoutQualificationPass,
          assertFiles: () => undefined,
          loadDevelopment: loadHistoricalDevelopmentSourceCorpusSnapshotFromDatasetV2,
          loadWalkForward:
            loadHistoricalWalkForwardPredictiveSourceCorpusSnapshotFromDatasetV2,
          readVolume: (path) => {
            const symbol = SYMBOLS.find((candidate) => fixture.volumePaths[candidate] === path);
            if (!symbol) throw new Error("DEE919_TEST_VOLUME_PATH");
            return fixture.volumeReceipts[symbol];
          },
        },
      );
      ratified = ratification.authority;
      ratifiedAuthorityId = ratification.id;
      productionInput = {
        preflight,
        ratifiedAuthorityId,
        accountId: "dee-919-modeled-account",
        symbol: "BTCUSDT",
        primaryHorizonMinutes: 30,
        startingCashUsdt: "100000",
        defaultQuantity: "0.01",
        policyConfig,
      };
    // Four real 4,096-anchor × 15-cell DEE-917 replays take ~14 minutes on the
    // reference local runner; keep the integration deadline above measured work.
    }, 1_800_000);

    afterAll(async () => {
      if (reserved) {
        const sql = heldSql;
        if (lockKey) await sql`SELECT pg_advisory_unlock(hashtextextended(${lockKey},0))`;
        reserved.release();
      }
      if (fixture?.root) rmSync(fixture.root, { recursive: true, force: true });
      await pool.end({ timeout: 5 });
      if (priorReleaseSha === undefined) delete process.env.WAIA_RELEASE_SHA;
      else process.env.WAIA_RELEASE_SHA = priorReleaseSha;
    });

    it("recovers exactly after every durable boundary and refuses a conflicting partial retry", async () => {
      const sql = heldSql;
      const steps: readonly HistoricalProductionFirstCycleStepV2[] = [
        "RATIFICATION_READY",
        "PACKAGE_READY",
        "FORECAST_PERSISTED",
        "ACCOUNTING_PERSISTED",
        "PREREGISTERED",
        "RUN_STARTED",
        "VERIFICATIONS_PERSISTED",
        "PIT_PERSISTED",
      ];
      for (const failAt of steps) {
        await expect(TEST_ONLY_prepareHistoricalProductionFirstCycleWithHeldPostgresV2(
          sql,
          productionInput,
          userId,
          (step) => {
            if (step === failAt) throw new Error(`DEE919_INJECTED_FAILURE:${step}`);
          },
        )).rejects.toThrow(`DEE919_INJECTED_FAILURE:${failAt}`);

        const invisible = await pool<Array<Readonly<{
          starts: string;
          forecasts: string;
          accounting: string;
          preregistrations: string;
          pits: string;
          intelligenceCycles: string;
        }>>>`
          SELECT
            (SELECT count(*)::text FROM trader_historical_simulation_run_start_v2
             WHERE organization_id=${organizationId}::uuid AND run_id=${runId}) AS starts,
            (SELECT count(*)::text
               FROM trader_forecast_v2 forecast
               JOIN trader_forecast_bundle_v2 bundle
                 ON bundle.id = forecast.bundle_id
                AND bundle.organization_id = forecast.organization_id
              WHERE forecast.organization_id=${organizationId}::uuid
                AND bundle.run_id=${runId}) AS forecasts,
            (SELECT count(*)::text FROM trader_accounting_frontier
             WHERE organization_id=${organizationId}::uuid AND run_id=${runId}) AS accounting,
            (SELECT count(*)::text FROM trader_dee659_authority_preregistration_v2
             WHERE organization_id=${organizationId}::uuid AND run_id=${runId}) AS preregistrations,
            (SELECT count(*)::text FROM trader_historical_forecast_input_pit_v2
             WHERE organization_id=${organizationId}::uuid AND run_id=${runId}) AS pits,
            (SELECT count(*)::text FROM trader_intelligence_cycle_envelope
             WHERE organization_id=${organizationId}::uuid AND run_id=${runId}) AS "intelligenceCycles"
        `;
        expect(invisible[0]).toEqual({
          starts: "0",
          forecasts: "0",
          accounting: "0",
          preregistrations: "0",
          pits: "0",
          intelligenceCycles: "0",
        });
      }

      const completed = await TEST_ONLY_prepareHistoricalProductionFirstCycleWithHeldPostgresV2(
        sql,
        productionInput,
        userId,
      );
      const replay = await TEST_ONLY_prepareHistoricalProductionFirstCycleWithHeldPostgresV2(
        sql,
        productionInput,
        userId,
      );
      expect(replay).toEqual(completed);
      expect(completed.partition).toBe("WALK_FORWARD");
      expect(completed.authorityBoundary).toEqual({
        capitalAuthority: "NONE",
        liveTradingAuthority: "NONE",
        blindHoldoutAuthority: "FORBIDDEN_NOT_PRESENT_NOT_ACCESSED",
      });

      await expect(TEST_ONLY_prepareHistoricalProductionFirstCycleWithHeldPostgresV2(
        sql,
        { ...productionInput, startingCashUsdt: "99999" },
        userId,
      )).rejects.toThrow("HISTORICAL_ACCOUNTING_INCEPTION_REFUSED:CONFLICT");

      const rows = await sql<Array<Readonly<{
        starts: string;
        forecasts: string;
        accounting: string;
        pits: string;
        intelligenceCycles: string;
      }>>>`
        SELECT
          (SELECT count(*)::text FROM trader_historical_simulation_run_start_v2
           WHERE organization_id=${organizationId}::uuid AND run_id=${runId}) AS starts,
          (SELECT count(*)::text
             FROM trader_forecast_v2 forecast
             JOIN trader_forecast_bundle_v2 bundle
               ON bundle.id = forecast.bundle_id
              AND bundle.organization_id = forecast.organization_id
            WHERE forecast.organization_id=${organizationId}::uuid
              AND bundle.run_id=${runId}) AS forecasts,
          (SELECT count(*)::text FROM trader_accounting_frontier
           WHERE organization_id=${organizationId}::uuid AND run_id=${runId}
             AND accounting_sequence=1) AS accounting,
          (SELECT count(*)::text FROM trader_historical_forecast_input_pit_v2
           WHERE organization_id=${organizationId}::uuid AND run_id=${runId}) AS pits,
          (SELECT count(*)::text FROM trader_intelligence_cycle_envelope
           WHERE organization_id=${organizationId}::uuid AND run_id=${runId}) AS "intelligenceCycles"
      `;
      expect(rows[0]).toEqual({
        starts: "1",
        forecasts: "2",
        accounting: "1",
        pits: "1",
        intelligenceCycles: "1",
      });
    }, 600_000);

    it("persists valid historical evidence and rejects a rehashed receipt with tampered authority", async () => {
      const receiptRows = await heldSql<Array<Readonly<{
        profile_id: string;
        profile_content_digest: string;
        account_id: string | null;
        purpose: string;
        status: string;
        pit_anchor: Date;
        receipt_json: Record<string, unknown>;
        schema_version: string;
        authority: string;
      }>>>`
        SELECT profile_id, profile_content_digest, account_id, purpose, status, pit_anchor,
               receipt_json, schema_version, authority
        FROM trader_information_sufficiency_receipt_v2
        WHERE organization_id=${organizationId}::uuid
        ORDER BY created_at DESC LIMIT 1
      `;
      const source = structuredClone(receiptRows[0]!.receipt_json) as {
        id: string;
        contentDigest: string;
        evidenceInventory: Array<{
          trustScore: number;
          historicalDatasetTrustAuthority: { trustScore: number };
        }>;
        [key: string]: unknown;
      };
      source.evidenceInventory[0]!.trustScore = 0.5;
      source.evidenceInventory[0]!.historicalDatasetTrustAuthority.trustScore = 0.5;
      const { id: _id, contentDigest: _contentDigest, ...body } = source;
      void _id;
      void _contentDigest;
      const digestRows = await heldSql<Array<Readonly<{ digest: string }>>>`
        SELECT encode(sha256(convert_to(
          public.waia_canonical_jsonb_v1(${heldSql.json(body as never)}::jsonb), 'UTF8'
        )), 'hex') AS digest
      `;
      const digest = digestRows[0]!.digest;
      const forged = { ...body, id: digest, contentDigest: digest };
      const row = receiptRows[0]!;
      await expect(heldSql`
        INSERT INTO trader_information_sufficiency_receipt_v2 (
          id, organization_id, account_id, profile_id, profile_content_digest,
          purpose, status, pit_anchor, receipt_json, content_digest, schema_version, authority
        ) VALUES (
          ${digest}, ${organizationId}::uuid, ${row.account_id}, ${row.profile_id},
          ${row.profile_content_digest}, ${row.purpose}, ${row.status}, ${row.pit_anchor},
          ${heldSql.json(forged as never)}, ${digest}, ${row.schema_version}, ${row.authority}
        )
      `).rejects.toMatchObject({ code: "23514" });
    });

    it("replays sealed historical evidence after its mutable source is deprecated", async () => {
      const executor = drizzle(heldSql, { schema: pgSchema });
      const sourceService = createPostgresMiSourceProvenanceService(executor, {
        actorType: "admin",
        actorId: userId,
      });
      for (const evidence of ratified.marketEvidence) {
        await sourceService.setSourceStatus(
          { organizationId }, evidence.sourceId, { status: "deprecated" },
        );
      }

      const replayed = await requireHistoricalFourSurfaceRatifiedAdmissionV2(heldSql, {
        organizationId,
        runId,
        releaseSha: RELEASE_SHA,
        aggregateAdmissionReceiptId: ratified.aggregateAdmissionReceiptId,
        authorityContentDigestHex: ratified.contentDigestHex,
      });
      expect(replayed).toEqual(ratified);
    });
  },
);
