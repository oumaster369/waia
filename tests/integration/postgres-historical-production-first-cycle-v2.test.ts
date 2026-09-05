/**
 * Opt-in DEE-919 full first-cycle integration.
 *
 * Requires a freshly migrated, explicitly named disposable local database:
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
import { bindPostgresReservedSession } from "@/db/postgres-session-transaction";
import {
  createCanonicalDecisionVerificationReceiptServiceV2,
  historicalDatasetAuthorityRunLockKeyV2,
} from "@/lib/trader/historical-simulation-v2/canonical-verification-receipt-postgres-v2";
import {
  assumeHistoricalSimulationRunnerRoleV2,
  resetHistoricalSimulationRunnerRoleV2,
  runHistoricalSimulationLaunchConsumerCliV2,
} from "@/lib/trader/historical-simulation-v2/launch-consumer-cli-v2";
import { executeQueuedHistoricalSimulationLaunchV2 } from "@/lib/trader/historical-simulation-v2/launch-orchestrator-v2";
import {
  createHistoricalSimulationRunLifecyclePostgresV2,
  releaseHistoricalSimulationConsumerLeasePostgresV2,
} from "@/lib/trader/historical-simulation-v2/run-lifecycle-postgres-v2";
import { bootstrapAndQueueHistoricalSimulationOnExecutionServerV2 } from "@/lib/trader/historical-simulation-v2/execution-server-bootstrap-v2";
import {
  TEST_ONLY_prepareHistoricalProductionFirstCycleWithHeldPostgresV2,
  type HistoricalProductionFirstCycleBootstrapInputV2,
  type HistoricalProductionFirstCycleStepV2,
} from "@/lib/trader/historical-simulation-v2/production-first-cycle-bootstrap-v2";
import { runHistoricalSimulationNextCyclePostgresV2 } from "@/lib/trader/historical-simulation-v2/atomic-cycle-repository-postgres-v2";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import {
  barToFhvBarsV2Record,
  serializeFhvBarsV2Record,
} from "@/lib/trader/market-data/fhv-bars-v2-ndjson";
import { streamingBarSemanticDigestOf } from "@/lib/trader/market-data/fhv-streaming-bar-digest";
import type { FhvPreHoldoutQualificationReceiptV1 } from "@/lib/trader/market-data/fhv-pre-holdout-qualification";
import { assertFhvPreHoldoutQualificationPass } from "@/lib/trader/market-data/fhv-pre-holdout-qualification";
import {
  FHV_PRE_HOLDOUT_RUNTIME_REQUALIFICATION_SCHEMA,
  type FhvPreHoldoutRuntimeRequalificationV1,
} from "@/lib/trader/market-data/fhv-pre-holdout-runtime-requalification";
import {
  qualifyHtxKlineVolumeAuthority,
  type HtxVolumeQualificationReceiptV1,
} from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import { persistHtxVolumeQualificationReceipt } from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification-receipt-service";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import {
  TEST_ONLY_assertKmFourSurfaceProductionRunUnusedV2,
  TEST_ONLY_prepareKmFourSurfaceProductionAuthorityV2,
  type KmFourSurfaceProductionPreflightInputV2,
} from "@/lib/trader/research/execopp-qualification/km-four-surface-production-preflight-v2";
import {
  TEST_ONLY_buildKmFourSurfaceProductionAuthorityV2,
  TEST_ONLY_loadKmFourSurfaceDurableDatasetAuthorityV2,
} from "@/lib/trader/research/execopp-qualification/km-four-surface-production-bootstrap-v2";
import type { KmAnchorReplayEvidenceV2 } from "@/lib/trader/research/execopp-qualification/km-four-surface-contract-v2";
import { INTERNAL_persistScientificAdmissionFourSurfaceV2 } from "@/lib/trader/research/execopp-qualification/scientific-admission-four-surface-repository-postgres-v2";
import {
  HISTORICAL_FOUR_SURFACE_HUMAN_DECISION_V2,
  requireHistoricalFourSurfaceRatifiedAdmissionV2,
  TEST_ONLY_materializeApprovedHistoricalFourSurfaceCandidateV2,
  TEST_ONLY_prepareHistoricalFourSurfaceTechnicalAuthorityCandidateV2,
  type HistoricalFourSurfaceRatifiedAdmissionV2,
} from "@/lib/trader/research/execopp-qualification/historical-four-surface-ratified-admission-v2";
import {
  createHistoricalRatificationRequestV2,
  ratifyHistoricalTechnicalProposalV2,
  TEST_ONLY_finalizeApprovedHistoricalProposalOnExecutionServerV2,
  TEST_ONLY_prepareHistoricalTechnicalProposalOnExecutionServerV2,
} from "@/lib/trader/historical-simulation-v2/ratification-split-v2";
import { createPostgresMiSourceProvenanceService } from "@/lib/trader/mi/source-provenance-service";
import { loadHistoricalSimulationBootstrapSourceCyclesV2 } from "@/lib/trader/historical-simulation-v2/bootstrap-source-loader-v2";
import { loadHistoricalDevelopmentSourceCorpusSnapshotFromDatasetV2 } from "@/lib/trader/historical-simulation-v2/development-source-corpus-v2";
import { loadHistoricalWalkForwardPredictiveSourceCorpusSnapshotFromDatasetV2 } from "@/lib/trader/historical-simulation-v2/development-source-corpus-v2";
import {
  buildHistoricalForecastKnowledgeBootstrapV2,
  persistHistoricalForecastKnowledgeBootstrapWithinTransactionV2,
} from "@/lib/trader/historical-simulation-v2/forecast-knowledge-bootstrap-v2";
import type { Bar } from "@/lib/trader/intelligence/types";
import { computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES_SESSION?.trim() ?? "";
const parsed = (() => {
  try {
    return url ? new URL(url) : null;
  } catch {
    return null;
  }
})();
const database = parsed?.pathname.replace(/^\//, "") ?? "";
const disposable = Boolean(
  parsed &&
  ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) &&
  (["waia_it", "waia_validate"].includes(database) ||
    /^waia_hsv2_it(?:_[a-z0-9]+)*$/.test(database)) &&
  parsed.port !== "6543",
);

if (enabled && url && !disposable) {
  throw new Error("DEE919_PG_INTEGRATION_REFUSED:LOCAL_DISPOSABLE_SESSION_DATABASE_REQUIRED");
}

const RELEASE_SHA = "d".repeat(40);
const HISTORICAL_RUNNER_ROLE = "waia_historical_runner";
const HISTORICAL_RUNNER_ORGANIZATION_ID = "3c50b4e9-1138-43a5-a29f-e65088124cfc";
const BAR_COUNT = 4_240;
const WF_PREDICTIVE_BAR_COUNT = 1_000;
const WF_ECONOMIC_BAR_COUNT = 200;
const WF_BAR_COUNT = WF_PREDICTIVE_BAR_COUNT + WF_ECONOMIC_BAR_COUNT;
const INITIAL_DEVELOPMENT_RECORD_INDEX = 239;
const INITIAL_RECORD_INDEX = WF_PREDICTIVE_BAR_COUNT;
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

function semanticBody(value: Record<string, unknown>, digestKey: string): Record<string, unknown> {
  const body = { ...value };
  delete body[digestKey];
  return body;
}

function buildQualifiedReplayEvidenceFixtureV2(
  selectedAnchors: readonly { anchorEpochMin: number }[],
): readonly KmAnchorReplayEvidenceV2[] {
  return Object.freeze(
    selectedAnchors.map((anchor, anchorIndex) => {
      const reference = Object.freeze({
        evLower: 0.01 + (anchorIndex % 17) / 100_000,
        evBase: 0.02 + (anchorIndex % 19) / 100_000,
        evUpper: 0.03 + (anchorIndex % 23) / 100_000,
        mcEs: 0.1 + (anchorIndex % 29) / 10_000,
      });
      return Object.freeze({
        anchorEpochMin: anchor.anchorEpochMin,
        reference,
        cells: Object.freeze(
          [10, 20, 30, 40, 50].flatMap((kConfig) =>
            [20, 40, 80].map((mConfig) => {
              const error = 0.0005 + (kConfig / 50 + mConfig / 80 + (anchorIndex % 7)) / 100_000;
              return Object.freeze({
                kConfig,
                mConfig,
                candidate: Object.freeze({
                  evLower: reference.evLower * (1 + error),
                  evBase: reference.evBase * (1 - error),
                  evUpper: reference.evUpper * (1 + error / 2),
                  mcEs: reference.mcEs * (1 - error / 2),
                }),
              });
            }),
          ),
        ),
      });
    }),
  );
}

function buildPredictableRegimeBars(
  input: Readonly<{
    symbol: "BTC/USDT" | "ETH/USDT";
    startUtcMs: number;
    count: number;
    globalStartIndex: number;
    initialPrice: number;
  }>,
): readonly Bar[] {
  const bars: Bar[] = [];
  let priorClose = input.initialPrice;
  const regimes = [
    { drift: -0.00035, noise: 0.00005 },
    { drift: 0, noise: 0.0005 },
    // This is an execution-path qualification fixture, not a profitability
    // claim. Its positive regime must be strong enough for the production
    // conservative Q10 payoff to remain above zero so the test exercises the
    // real Decision -> Risk -> modeled Execution/Reality path without
    // weakening any production admission threshold.
    { drift: 0.003, noise: 0.0015 },
  ] as const;
  for (let localIndex = 0; localIndex < input.count; localIndex += 1) {
    const index = input.globalStartIndex + localIndex;
    const regime = regimes[Math.floor(index / 180) % regimes.length]!;
    const noiseSign = index % 2 === 0 ? 1 : -1;
    // Keep realized-volatility ranks strictly non-degenerate even inside a
    // regime. The production epistemic bootstrap requires real q1 < q2
    // tertile edges; a three-valued volatility fixture can collapse them in a
    // deterministic stationary-bootstrap replica and is therefore invalid.
    const noiseScale = 0.7 + (((index * 37) % 101) / 100) * 0.6;
    const open = priorClose;
    const close = open * Math.exp(regime.drift + noiseSign * regime.noise * noiseScale);
    const boundary = Math.max(open, close) * 0.0002;
    bars.push({
      symbol: input.symbol,
      interval: "1m",
      open: open.toFixed(8),
      high: (Math.max(open, close) + boundary).toFixed(8),
      low: (Math.min(open, close) - boundary).toFixed(8),
      close: close.toFixed(8),
      volume: (100 + (index % 19)).toFixed(8),
      barOpenTime: new Date(input.startUtcMs + localIndex * 60_000).toISOString(),
      barCloseTime: new Date(input.startUtcMs + (localIndex + 1) * 60_000).toISOString(),
    });
    priorClose = close;
  }
  return Object.freeze(bars);
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
  const scientificSubpartitions: FhvPreHoldoutQualificationReceiptV1["scientificSubpartitions"][number][] =
    [];

  for (const [symbolIndex, symbol] of SYMBOLS.entries()) {
    const instrument = symbol === "BTCUSDT" ? ("BTC/USDT" as const) : ("ETH/USDT" as const);
    const start = Date.UTC(2025, 0, 1);
    const developmentBars = buildPredictableRegimeBars({
      symbol: instrument,
      startUtcMs: start,
      count: BAR_COUNT,
      globalStartIndex: 0,
      initialPrice: 30_000 + symbolIndex * 1_500,
    });
    const records = developmentBars.map((bar) =>
      serializeFhvBarsV2Record(barToFhvBarsV2Record(bar)),
    );
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
    const wfBars = buildPredictableRegimeBars({
      symbol: instrument,
      startUtcMs: wfStart,
      count: WF_BAR_COUNT,
      globalStartIndex: BAR_COUNT,
      initialPrice: 30_000 + symbolIndex * 1_500,
    });
    const wfRecords = wfBars.map((bar) => serializeFhvBarsV2Record(barToFhvBarsV2Record(bar)));
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
      rows: [
        {
          id: 1,
          open: 30_000,
          high: 30_005,
          low: 29_995,
          close: 30_001,
          amount: 100,
          vol: 3_000_100,
          count: 100,
        },
      ],
    });
    const volumePath = join(root, `${symbol}.volume.json`);
    writeFileSync(volumePath, JSON.stringify(volume));
    volumePaths[symbol] = volumePath;
    volumeReceipts[symbol] = volume;
  }

  const body: Omit<FhvPreHoldoutQualificationReceiptV1, "qualificationReceiptDigest"> = {
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
        endUtc: new Date(Date.UTC(2026, 0, 1) + WF_PREDICTIVE_BAR_COUNT * 60_000).toISOString(),
      },
      wfEconomic: {
        startUtc: new Date(Date.UTC(2026, 0, 1) + WF_PREDICTIVE_BAR_COUNT * 60_000).toISOString(),
        endUtc: new Date(Date.UTC(2026, 0, 1) + WF_BAR_COUNT * 60_000).toISOString(),
      },
    },
    interval: "1m",
    symbols: [...SYMBOLS],
    acquisitionReceiptDigests: partitions.map((value) => value.acquisitionReceiptDigest),
    partitions,
    scientificSubpartitions,
    developmentContentDigest: hex("development-content"),
    wfPredictiveContentDigest: computeStableJsonDigest(
      scientificSubpartitions
        .filter((entry) => entry.scientificPartition === "WF_PREDICTIVE")
        .map((entry) => ({
          scientificPartition: entry.scientificPartition,
          symbol: entry.symbol,
          semanticContentDigest: entry.semanticContentDigest,
        })),
    ),
    wfEconomicContentDigest: computeStableJsonDigest(
      scientificSubpartitions
        .filter((entry) => entry.scientificPartition === "WF_ECONOMIC")
        .map((entry) => ({
          scientificPartition: entry.scientificPartition,
          symbol: entry.symbol,
          semanticContentDigest: entry.semanticContentDigest,
        })),
    ),
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
    feeBps: "0",
    spreadBps: "0",
    impactBps: "0",
    slippageBps: "0",
    conservativeStressBps: "0",
  }),
  exitCosts: Object.freeze({
    feeBps: "0",
    spreadBps: "0",
    impactBps: "0",
    slippageBps: "0",
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
    const organizationId = HISTORICAL_RUNNER_ORGANIZATION_ID;
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
    let neutralKnowledgeEdge: ReturnType<typeof buildHistoricalForecastKnowledgeBootstrapV2>;

    beforeAll(async () => {
      process.env.WAIA_RELEASE_SHA = RELEASE_SHA;
      const migrated = await pool<Array<Readonly<{ relation: string | null }>>>`
        SELECT to_regclass(
          'public.trader_historical_four_surface_ratified_admission_v2'
        )::text AS relation
      `;
      expect(migrated[0]?.relation).toBe("trader_historical_four_surface_ratified_admission_v2");
      await pool`INSERT INTO auth.users (id) VALUES (${userId}::uuid)`;
      await pool`INSERT INTO users (id, identity_label, email)
        VALUES (${userId}::uuid, 'DEE-919 PostgreSQL integration',
          ${`dee-919-${userId}@invalid.local`})`;
      await pool`INSERT INTO organizations (id, owner_user_id, kind, name)
        VALUES (${organizationId}::uuid, ${userId}::uuid, 'personal',
          'DEE-919 PostgreSQL integration')
        ON CONFLICT (id) DO NOTHING`;
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
        initialDevelopmentRecordIndex: INITIAL_DEVELOPMENT_RECORD_INDEX,
        developmentCycleCount: 1,
      };
      const testDependencies: Parameters<
        typeof TEST_ONLY_prepareHistoricalFourSurfaceTechnicalAuthorityCandidateV2
      >[2] = {
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
                    loadCorpusSnapshot: loadHistoricalDevelopmentSourceCorpusSnapshotFromDatasetV2,
                    // DEE-917 separately verifies the frozen executable evaluator against
                    // the complete 4,096-anchor × 15-cell canon. This PostgreSQL scenario
                    // reuses deterministic qualified evidence so its budget measures the
                    // production persistence/cycle path rather than recomputing DEE-917.
                    evaluate: ({ selectedAnchors }) =>
                      buildQualifiedReplayEvidenceFixtureV2(selectedAnchors),
                  }),
              },
            );
            const admission = await INTERNAL_persistScientificAdmissionFourSurfaceV2(
              transaction,
              authority,
            );
            return Object.freeze({ authority, admission });
          },
          readQualification: () => fixture.qualificationReceipt,
          assertQualification: assertFhvPreHoldoutQualificationPass,
          assertFiles: () => undefined,
          loadDevelopment: loadHistoricalDevelopmentSourceCorpusSnapshotFromDatasetV2,
          loadWalkForward: loadHistoricalWalkForwardPredictiveSourceCorpusSnapshotFromDatasetV2,
          readVolume: (path) => {
            const symbol = SYMBOLS.find((candidate) => fixture.volumePaths[candidate] === path);
            if (!symbol) throw new Error("DEE919_TEST_VOLUME_PATH");
            return fixture.volumeReceipts[symbol];
          },
        };
      const launchPlan = Object.freeze({
        accountId: "dee-919-modeled-account",
        symbol: "BTCUSDT" as const,
        primaryHorizonMinutes: 30 as const,
        startingCashUsdt: "100000",
        defaultQuantity: "0.01",
        initialRecordIndex: WF_PREDICTIVE_BAR_COUNT,
        cycleCount: 35,
      });
      await createHistoricalRatificationRequestV2(pool, {
        organizationId,
        runId,
        releaseSha: RELEASE_SHA,
        authenticatedOperatorUserId: userId,
        initialRecordIndex: launchPlan.initialRecordIndex,
        cycleCount: launchPlan.cycleCount,
      });
      const proposal = await TEST_ONLY_prepareHistoricalTechnicalProposalOnExecutionServerV2(
        pool,
        { preflight, launchPlan },
        (sql) => TEST_ONLY_prepareHistoricalFourSurfaceTechnicalAuthorityCandidateV2(
          sql,
          {
            preflight,
            humanDecision: HISTORICAL_FOUR_SURFACE_HUMAN_DECISION_V2,
            executionExtent: launchPlan,
          },
          testDependencies,
        ),
      );
      const btc30 = proposal.proposal.technicalCandidate.surfaces.find(
        (surface) => surface.symbol === "BTCUSDT" && surface.primaryHorizonMinutes === 30,
      );
      if (!btc30) throw new Error("DEE919_NEUTRAL_KNOWLEDGE_SURFACE_MISSING");
      neutralKnowledgeEdge = buildHistoricalForecastKnowledgeBootstrapV2({
        organizationId,
        symbol: btc30.symbol,
        horizonMinutes: btc30.executionHorizonMinutes,
        predictivePackageContentDigestHex: btc30.predictivePackageContentDigestHex,
      });
      let preapprovalKnowledgeCode: string | undefined;
      try {
        await pool.begin(async (transaction) => {
          await transaction.unsafe(`SET LOCAL ROLE ${HISTORICAL_RUNNER_ROLE}`);
          await persistHistoricalForecastKnowledgeBootstrapWithinTransactionV2(
            transaction as unknown as postgres.Sql,
            neutralKnowledgeEdge,
          );
        });
      } catch (error) {
        preapprovalKnowledgeCode = (error as { code?: string }).code;
      }
      expect(preapprovalKnowledgeCode).toBe("42501");
      const beforeApproval = await pool<Array<Readonly<{
        authorities: string;
        validated: string;
      }>>>`
        SELECT
          (SELECT count(*)::text
             FROM trader_historical_four_surface_ratified_admission_v2
            WHERE organization_id=${organizationId}::uuid AND run_id=${runId}) AS authorities,
          (SELECT count(*)::text
             FROM trader_mi_hypothesis_lifecycle lifecycle
             JOIN trader_mi_hypothesis hypothesis
               ON hypothesis.id=lifecycle.hypothesis_id
              AND hypothesis.organization_id=lifecycle.organization_id
            WHERE lifecycle.organization_id=${organizationId}::uuid
              AND hypothesis.name LIKE ${`waia.trader.historical_prerun_knowledge_bootstrap.v2:${runId}:%`}
              AND lifecycle.lifecycle_state='VALIDATED') AS validated
      `;
      expect(beforeApproval[0]).toEqual({ authorities: "0", validated: "0" });
      await ratifyHistoricalTechnicalProposalV2(pool, {
        organizationId,
        runId,
        releaseSha: RELEASE_SHA,
        proposalId: proposal.id,
        proposalContentDigestHex: proposal.proposal.contentDigestHex,
        authenticatedOperatorUserId: userId,
        humanDecision: HISTORICAL_FOUR_SURFACE_HUMAN_DECISION_V2,
      });
      const finalized = await TEST_ONLY_finalizeApprovedHistoricalProposalOnExecutionServerV2(
        pool,
        { organizationId, runId, releaseSha: RELEASE_SHA },
        (sql, input, actor, candidate, approvedProposal) =>
          TEST_ONLY_materializeApprovedHistoricalFourSurfaceCandidateV2(
            sql, input, actor, candidate, approvedProposal, testDependencies,
          ),
      );
      const humanRowsBeforeRetry = await pool<Array<Readonly<{
        surface_receipts: string; validated_lifecycles: string;
      }>>>`
        SELECT
          (SELECT count(*)::text FROM trader_scientific_admission_receipt_v1
            WHERE organization_id=${organizationId}::uuid
              AND receipt_kind='WF_PREDICTIVE') AS surface_receipts,
          (SELECT count(*)::text
             FROM trader_mi_hypothesis_lifecycle lifecycle
             JOIN trader_mi_hypothesis hypothesis
               ON hypothesis.id=lifecycle.hypothesis_id
              AND hypothesis.organization_id=lifecycle.organization_id
            WHERE lifecycle.organization_id=${organizationId}::uuid
              AND hypothesis.name LIKE ${`waia.trader.historical_prerun_knowledge_bootstrap.v2:${runId}:%`}
              AND lifecycle.lifecycle_state='VALIDATED') AS validated_lifecycles
      `;
      const finalizedRetry =
        await TEST_ONLY_finalizeApprovedHistoricalProposalOnExecutionServerV2(
          pool,
          { organizationId, runId, releaseSha: RELEASE_SHA },
          () => { throw new Error("FINALIZER_RETRY_MUST_NOT_REMATERIALIZE"); },
        );
      expect(finalizedRetry).toEqual(finalized);
      const humanRowsAfterRetry = await pool<Array<Readonly<{
        surface_receipts: string; validated_lifecycles: string;
      }>>>`
        SELECT
          (SELECT count(*)::text FROM trader_scientific_admission_receipt_v1
            WHERE organization_id=${organizationId}::uuid
              AND receipt_kind='WF_PREDICTIVE') AS surface_receipts,
          (SELECT count(*)::text
             FROM trader_mi_hypothesis_lifecycle lifecycle
             JOIN trader_mi_hypothesis hypothesis
               ON hypothesis.id=lifecycle.hypothesis_id
              AND hypothesis.organization_id=lifecycle.organization_id
            WHERE lifecycle.organization_id=${organizationId}::uuid
              AND hypothesis.name LIKE ${`waia.trader.historical_prerun_knowledge_bootstrap.v2:${runId}:%`}
              AND lifecycle.lifecycle_state='VALIDATED') AS validated_lifecycles
      `;
      expect(humanRowsAfterRetry).toEqual(humanRowsBeforeRetry);
      await pool.begin(async (transaction) => {
        await transaction.unsafe(`SET LOCAL ROLE ${HISTORICAL_RUNNER_ROLE}`);
        await expect(persistHistoricalForecastKnowledgeBootstrapWithinTransactionV2(
          transaction as unknown as postgres.Sql,
          neutralKnowledgeEdge,
        )).resolves.toEqual({ insertedNew: true });
        await expect(persistHistoricalForecastKnowledgeBootstrapWithinTransactionV2(
          transaction as unknown as postgres.Sql,
          neutralKnowledgeEdge,
        )).resolves.toEqual({ insertedNew: false });
      });
      ratifiedAuthorityId = finalized.authorityId;
      const finalizedRows = await pool<Array<Readonly<{
        authority_content_digest_hex: string;
      }>>>`
        SELECT authority_content_digest_hex
        FROM trader_historical_four_surface_ratified_admission_v2
        WHERE id=${ratifiedAuthorityId}::uuid
      `;
      expect(finalizedRows).toHaveLength(1);
      ratified = await requireHistoricalFourSurfaceRatifiedAdmissionV2(pool, {
        organizationId,
        runId,
        releaseSha: RELEASE_SHA,
        aggregateAdmissionReceiptId:
          proposal.proposal.technicalCandidate.aggregateAdmissionReceiptId,
        authorityContentDigestHex: finalizedRows[0]!.authority_content_digest_hex,
      });
      productionInput = finalized.manifest.bootstrap;

      reserved = await pool.reserve();
      const rawBackend = await reserved<
        Array<Readonly<{ pid: number }>>
      >`SELECT pg_backend_pid()::int AS pid`;
      const sql = bindPostgresReservedSession(pool, reserved);
      heldSql = sql;
      const boundBackend = await sql<
        Array<Readonly<{ pid: number }>>
      >`SELECT pg_backend_pid()::int AS pid`;
      expect(boundBackend[0]?.pid).toBe(rawBackend[0]?.pid);
      lockKey = historicalDatasetAuthorityRunLockKeyV2({ organizationId, runId });
      await sql`SELECT pg_advisory_lock(hashtextextended(${lockKey},0))`;
      const heldLock = await sql<Array<Readonly<{ held: boolean }>>>`SELECT EXISTS (
          SELECT 1 FROM pg_locks
          WHERE locktype='advisory' AND pid=pg_backend_pid() AND granted
        ) AS held`;
      expect(heldLock[0]?.held).toBe(true);
      expect(productionInput).toEqual({
        preflight,
        ratifiedAuthorityId,
        ...launchPlan,
        policyConfig: productionInput.policyConfig,
      });
      // Full executable K/M replay is verified by the dedicated DEE-917 suite. Keep this
      // persistence/cycle scenario bounded while retaining all 4,096 × 15 contract rows.
    // GitHub's shared runner can take more than ten minutes to build and
    // persist the deterministic 5,440-bar dual-symbol authority fixture.
    // Keep the hook budget aligned with the full 35-cycle production proof so
    // CI executes the assertions instead of timing out during preparation.
    }, 1_500_000);

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
      const verification = createCanonicalDecisionVerificationReceiptServiceV2(sql);
      const registration = (input: Readonly<{
        initialRecordIndex: number;
        cycleCount: number;
        volumePath?: string;
      }>) => verification.registerPreHoldoutDatasetAuthorityFromSource({
        datasetRoot: fixture.root,
        qualificationReceiptPath: fixture.qualificationPath,
        runtimeRequalificationReceiptPath: join(fixture.root, "unused-runtime.json"),
        htxVolumeQualificationReceiptPath:
          input.volumePath ?? fixture.volumePaths.BTCUSDT,
        releaseSha: RELEASE_SHA,
        organizationId,
        runId,
        partition: "WALK_FORWARD",
        symbol: "BTCUSDT",
        initialRecordIndex: input.initialRecordIndex,
        cycleCount: input.cycleCount,
      });
      await expect(registration({
        initialRecordIndex: WF_PREDICTIVE_BAR_COUNT - 2,
        cycleCount: 2,
      })).rejects.toThrow("HISTORICAL_DATASET_AUTHORITY_RANGE_GAP");
      await expect(registration({
        initialRecordIndex: WF_PREDICTIVE_BAR_COUNT + 35,
        cycleCount: 1,
      })).rejects.toThrow("HISTORICAL_DATASET_AUTHORITY_RANGE_OUTSIDE_APPROVAL");
      const mismatchedVolume = qualifyHtxKlineVolumeAuthority({
        symbol: "BTCUSDT",
        qualifiedAtUtc: "2026-08-01T00:00:01.000Z",
        rows: [{ id: 1, open: 100, high: 200, low: 90, close: 101,
          amount: 10, vol: 1_010, count: 1 }],
      });
      const mismatchedVolumePath = join(fixture.root, "BTCUSDT.volume-mismatch.json");
      writeFileSync(mismatchedVolumePath, JSON.stringify(mismatchedVolume));
      await expect(registration({
        initialRecordIndex: WF_PREDICTIVE_BAR_COUNT - 1,
        cycleCount: 1,
        volumePath: mismatchedVolumePath,
      })).rejects.toThrow("HISTORICAL_DATASET_AUTHORITY_RANGE_IDENTITY_CONFLICT");

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
        await expect(
          TEST_ONLY_prepareHistoricalProductionFirstCycleWithHeldPostgresV2(
            sql,
            productionInput,
            userId,
            (step) => {
              if (step === failAt) throw new Error(`DEE919_INJECTED_FAILURE:${step}`);
            },
          ),
        ).rejects.toThrow(`DEE919_INJECTED_FAILURE:${failAt}`);

        const invisible = await pool<
          Array<
            Readonly<{
              starts: string;
              forecasts: string;
              accounting: string;
              preregistrations: string;
              pits: string;
              intelligenceCycles: string;
            }>
          >
        >`
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

      await expect(
        TEST_ONLY_prepareHistoricalProductionFirstCycleWithHeldPostgresV2(
          sql,
          { ...productionInput, startingCashUsdt: "99999" },
          userId,
        ),
      ).rejects.toThrow("HISTORICAL_ACCOUNTING_INCEPTION_REFUSED:CONFLICT");

      const rows = await sql<
        Array<
          Readonly<{
            starts: string;
            forecasts: string;
            accounting: string;
            pits: string;
            intelligenceCycles: string;
          }>
        >
      >`
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

    it("runs the production bootstrap, queue and consumer only as the runner role", async () => {
      const unlocked = await heldSql<Array<Readonly<{ unlocked: boolean }>>>`
        SELECT pg_advisory_unlock(hashtextextended(${lockKey},0)) AS unlocked
      `;
      expect(unlocked[0]?.unlocked).toBe(true);
      lockKey = "";

      const prepared = await bootstrapAndQueueHistoricalSimulationOnExecutionServerV2(
        pool,
        productionInput,
      );
      expect(prepared.lifecycle.phase).toBe("QUEUED");
      expect(prepared.lifecycle.partition).toBe("WALK_FORWARD");
      expect(prepared.lifecycle.requestedByOperatorId).toBe(ratified.operatorUserId);

      const controller = new AbortController();
      controller.abort();
      const lifecycle = await runHistoricalSimulationLaunchConsumerCliV2(
        {
          WAIA_TRADER_CLI: "1",
          DATABASE_URL_POSTGRES_SESSION: url,
          WAIA_RELEASE_SHA: RELEASE_SHA,
          WAIA_HISTORICAL_ORGANIZATION_ID: organizationId,
          WAIA_HISTORICAL_RUN_ID: runId,
        },
        {
          async openDatabase(databaseUrl) {
            const consumerPool = postgres(databaseUrl, { max: 1 });
            const consumer = await consumerPool.reserve();
            return {
              sql: bindPostgresReservedSession(consumerPool, consumer),
              async close() {
                consumer.release();
                await consumerPool.end({ timeout: 5 });
              },
            };
          },
          assumeRunnerRole: assumeHistoricalSimulationRunnerRoleV2,
          resetRunnerRole: resetHistoricalSimulationRunnerRoleV2,
          createLifecycle: createHistoricalSimulationRunLifecyclePostgresV2,
          execute: executeQueuedHistoricalSimulationLaunchV2,
          releaseLease: releaseHistoricalSimulationConsumerLeasePostgresV2,
        },
        controller.signal,
      );
      expect(lifecycle.phase).toBe("STOPPED");
      expect(lifecycle.committedCycles).toBe(0);
    }, 600_000);

    it("commits 35 production cycles and applies the first future-only Forecast learning closure", async () => {
      const runnerReserved = await pool.reserve();
      const runnerSql = bindPostgresReservedSession(pool, runnerReserved);
      let latest:
        | Awaited<ReturnType<typeof runHistoricalSimulationNextCyclePostgresV2>>
        | undefined;
      try {
        await expect(
          runHistoricalSimulationNextCyclePostgresV2({
            sql: runnerSql,
            organizationId,
            accountId: productionInput.accountId,
            runId,
            partition: "WALK_FORWARD",
            symbol: "BTCUSDT",
            expectedCycleSequence: 0,
          }),
        ).rejects.toThrow("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:DATABASE_RUNNER_ROLE");
        const beforeRunnerRole = await pool<
          Array<Readonly<{ checkpoints: string; ledgers: string }>>
        >`
          SELECT
            (SELECT count(*)::text
             FROM trader_historical_simulation_resume_checkpoint_v2
             WHERE organization_id=${organizationId}::uuid AND run_id=${runId}) AS checkpoints,
            (SELECT count(*)::text
             FROM trader_historical_simulation_reason_ledger_v2
             WHERE organization_id=${organizationId}::uuid AND run_id=${runId}) AS ledgers
        `;
        expect(beforeRunnerRole[0]).toEqual({ checkpoints: "0", ledgers: "0" });
        await runnerSql.unsafe(`SET ROLE ${HISTORICAL_RUNNER_ROLE}`);
        const identity = await runnerSql<
          Array<Readonly<{ current_user: string }>>
        >`SELECT current_user`;
        expect(identity[0]?.current_user).toBe(HISTORICAL_RUNNER_ROLE);

        const first = await runHistoricalSimulationNextCyclePostgresV2({
          sql: runnerSql,
          organizationId,
          accountId: productionInput.accountId,
          runId,
          partition: "WALK_FORWARD",
          symbol: "BTCUSDT",
          expectedCycleSequence: 0,
        });
        expect(first.committedCycleId).toBe(
          `${runId}:WALK_FORWARD:BTCUSDT:${INITIAL_RECORD_INDEX}`,
        );
        expect(first.nextCycleSequence).toBe(1);
        expect(first.nextRecordIndex).toBe(INITIAL_RECORD_INDEX + 1);

        latest = first;
        for (let sequence = 1; sequence < 35; sequence += 1) {
          latest = await runHistoricalSimulationNextCyclePostgresV2({
            sql: runnerSql,
            organizationId,
            accountId: productionInput.accountId,
            runId,
            partition: "WALK_FORWARD",
            symbol: "BTCUSDT",
            expectedCycleSequence: sequence,
          });
        }

        const retry = await runHistoricalSimulationNextCyclePostgresV2({
          sql: runnerSql,
          organizationId,
          accountId: productionInput.accountId,
          runId,
          partition: "WALK_FORWARD",
          symbol: "BTCUSDT",
          expectedCycleSequence: 34,
        });
        expect(retry).toEqual(latest);

        // 0202 is NOT VALID so legacy compact rows remain readable, but PostgreSQL
        // must still reject every new incomplete accounting row — including an
        // all-NULL semantic group submitted through the constrained runner role.
        await expect(runnerSql`
          INSERT INTO trader_accounting_frontier (
            id, organization_id, account_key, run_id, accounting_sequence,
            frontier_as_of, cash, position_quantity_json,
            gross_position_basis_json, net_position_basis_json,
            gross_realized_pnl, net_realized_pnl, marks_json, equity, equity_hwm,
            account_drawdown_bps, source_fill_id, source_economics_digest,
            semantic_content_digest, idempotency_key, schema_version
          ) VALUES (
            ${randomUUID()}::uuid, ${organizationId}::uuid,
            ${productionInput.accountId}, ${runId}, 999999,
            ${"2026-01-01T00:00:00.000Z"}::timestamptz, '10000', '{}'::jsonb,
            '{}'::jsonb, '{}'::jsonb, '0', '0', '{}'::jsonb, '10000', '10000',
            0, NULL, ${"0".repeat(64)}, ${"1".repeat(64)},
            ${`dee-920-incomplete-accounting:${randomUUID()}`},
            'accounting-frontier/v1'
          )
        `).rejects.toThrow(/trader_accounting_frontier_semantic_state_complete/);
      } finally {
        await runnerSql.unsafe("RESET ROLE");
        runnerReserved.release();
      }
      if (!latest) throw new Error("DEE919_HISTORICAL_RUNNER_DID_NOT_COMMIT");
      expect(latest.committedCycleId).toBe(
        `${runId}:WALK_FORWARD:BTCUSDT:${INITIAL_RECORD_INDEX + 34}`,
      );
      expect(latest.nextCycleSequence).toBe(35);
      expect(latest.nextRecordIndex).toBe(INITIAL_RECORD_INDEX + 35);

      const rows = await heldSql<
        Array<
          Readonly<{
            checkpoints: string;
            bundles: string;
            pits: string;
            preregistrations: string;
            outcomes: string;
            calibrations: string;
            knowledgeUpdates: string;
            knowledgeCheckpoints: string;
            appliedLedgers: string;
            nonActionableLedgers: string;
            modeledOrders: string;
            modeledFills: string;
            modeledFillEvidence: string;
            knowledgeLinks: string;
            futureOnlyViolations: string;
            knowledgeBindingViolations: string;
            economicBoundaryViolations: string;
            latestCash: string;
            latestEquity: string;
            latestNetRealizedPnl: string;
            latestMarkedPositionValue: string;
            visibleEvidenceCount: number;
            distinctModelInputs: string;
            distinctTerminalDistributions: string;
            distinctCalibrationSnapshots: string;
            scoredKnowledgeUpdates: string;
            governedZeroDeltaUpdates: string;
          }>
        >
      >`
        SELECT
          (SELECT count(*)::text FROM trader_historical_simulation_resume_checkpoint_v2
           WHERE organization_id=${organizationId}::uuid
             AND account_id=${productionInput.accountId}
             AND run_id=${runId}) AS checkpoints,
          (SELECT count(*)::text FROM trader_dee659_authority_bundle_v2
           WHERE organization_id=${organizationId}::uuid
             AND account_id=${productionInput.accountId}
             AND run_id=${runId}) AS bundles,
          (SELECT count(*)::text FROM trader_historical_forecast_input_pit_v2
           WHERE organization_id=${organizationId}::uuid
             AND run_id=${runId}) AS pits,
          (SELECT count(*)::text FROM trader_dee659_authority_preregistration_v2
           WHERE organization_id=${organizationId}::uuid
             AND account_id=${productionInput.accountId}
             AND run_id=${runId}) AS preregistrations,
          (SELECT count(*)::text FROM trader_forecast_outcome_v2 o
             JOIN trader_forecast_bundle_v2 b
               ON b.organization_id=o.organization_id AND b.id=o.bundle_id
           WHERE b.organization_id=${organizationId}::uuid
             AND b.run_id=${runId}) AS outcomes,
          (SELECT count(*)::text FROM trader_forecast_calibration_observation_v2 c
             JOIN trader_forecast_bundle_v2 b
               ON b.organization_id=c.organization_id AND b.id=c.bundle_id
           WHERE b.organization_id=${organizationId}::uuid
             AND b.run_id=${runId}) AS calibrations,
          (SELECT count(*)::text FROM trader_knowledge_confidence_update_record
           WHERE organization_id=${organizationId}::uuid
             AND run_id=${runId}) AS "knowledgeUpdates",
          (SELECT count(*)::text FROM trader_knowledge_state_checkpoint_v2
           WHERE organization_id=${organizationId}::uuid
             AND checkpoint_namespace LIKE
               ${`waia.trader.historical_simulation_knowledge_binding.v2|${runId}|BTCUSDT|%`})
             AS "knowledgeCheckpoints",
          (SELECT count(*)::text FROM trader_historical_simulation_reason_ledger_v2
           WHERE organization_id=${organizationId}::uuid
             AND account_id=${productionInput.accountId} AND run_id=${runId}
             AND learning_json ->> 'status'='APPLIED') AS "appliedLedgers",
          (SELECT count(*)::text FROM trader_historical_simulation_reason_ledger_v2
           WHERE organization_id=${organizationId}::uuid
             AND account_id=${productionInput.accountId} AND run_id=${runId}
             AND forecast_json ->> 'status'='NON_ACTIONABLE') AS "nonActionableLedgers",
          (SELECT count(DISTINCT orders.id)::text FROM trader_orders orders
           WHERE orders.organization_id=${organizationId}::uuid
             AND orders.execution_mode='mock'
             AND orders.venue='HISTORICAL_SIMULATED_EXCHANGE'
             AND orders.historical_account_key=${productionInput.accountId}
             AND orders.historical_run_id=${runId}) AS "modeledOrders",
          (SELECT count(fills.id)::text FROM trader_fills fills
             JOIN trader_orders orders
               ON orders.organization_id=fills.organization_id
              AND orders.id=fills.order_id
           WHERE orders.organization_id=${organizationId}::uuid
             AND orders.execution_mode='mock'
             AND orders.venue='HISTORICAL_SIMULATED_EXCHANGE'
             AND orders.historical_account_key=${productionInput.accountId}
             AND orders.historical_run_id=${runId}) AS "modeledFills",
          (SELECT count(*)::text FROM trader_historical_simulation_modeled_evidence_v2 evidence
             JOIN trader_historical_simulation_reason_ledger_v2 ledger
               ON ledger.organization_id=evidence.organization_id
              AND ledger.entry_id=evidence.reason_ledger_entry_id
           WHERE ledger.organization_id=${organizationId}::uuid
             AND ledger.account_id=${productionInput.accountId} AND ledger.run_id=${runId}
             AND evidence.evidence_kind='FILL') AS "modeledFillEvidence",
          (SELECT count(*)::text FROM trader_historical_forecast_input_knowledge_link_v2 link
           WHERE link.organization_id=${organizationId}::uuid
             AND link.run_id=${runId}) AS "knowledgeLinks",
          (SELECT count(*)::text
           FROM trader_historical_forecast_input_knowledge_link_v2 link
           JOIN trader_historical_forecast_input_pit_v2 pit
             ON pit.organization_id=link.organization_id
            AND pit.run_id=link.run_id
            AND pit.cycle_id=link.cycle_id
           JOIN trader_knowledge_confidence_update_record knowledge
             ON knowledge.organization_id=link.organization_id
            AND knowledge.id=link.knowledge_update_id
            AND knowledge.content_digest=link.knowledge_update_content_digest_hex
           WHERE link.organization_id=${organizationId}::uuid
             AND link.run_id=${runId}
             AND (knowledge.resolved_at >= pit.pit_anchor
               OR knowledge.pit_evidence_boundary > pit.pit_anchor
               OR (knowledge.source_record_ids_json::jsonb ->>
                    'visible_from_cycle_pit_anchor')::timestamptz > pit.pit_anchor)
          ) AS "futureOnlyViolations",
          (SELECT count(*)::text
           FROM trader_historical_forecast_input_pit_v2 pit
           WHERE pit.organization_id=${organizationId}::uuid
             AND pit.run_id=${runId}
             AND (pit.knowledge_content_digest_hex IS DISTINCT FROM
                    pit.runtime_input_json ->> 'knowledgeContentDigestHex'
               OR pit.knowledge_content_digest_hex IS DISTINCT FROM
                    pit.runtime_input_json -> 'historicalKnowledgeSnapshotAuthority' ->>
                      'knowledgeContentDigestHex'
               OR pit.pit_anchor IS DISTINCT FROM
                    (pit.runtime_input_json -> 'historicalKnowledgeSnapshotAuthority' ->>
                      'pitAnchor')::timestamptz)
          ) AS "knowledgeBindingViolations",
          (SELECT count(*)::text
           FROM trader_historical_forecast_input_pit_v2 pit
           WHERE pit.organization_id=${organizationId}::uuid
             AND pit.run_id=${runId}
             AND (pit.record_index < ${WF_PREDICTIVE_BAR_COUNT}
               OR pit.pit_anchor <=
                    ${fixture.qualificationReceipt.canonicalBoundaries.wfPredictive.endUtc}::timestamptz)
          ) AS "economicBoundaryViolations",
          (SELECT state_json ->> 'cash'
           FROM trader_historical_simulation_durable_snapshot_v2
           WHERE organization_id=${organizationId}::uuid
             AND account_id=${productionInput.accountId} AND run_id=${runId}
             AND state_kind='ACCOUNTING_FRONTIER'
           ORDER BY cycle_sequence DESC LIMIT 1) AS "latestCash",
          (SELECT state_json ->> 'equity'
           FROM trader_historical_simulation_durable_snapshot_v2
           WHERE organization_id=${organizationId}::uuid
             AND account_id=${productionInput.accountId} AND run_id=${runId}
             AND state_kind='ACCOUNTING_FRONTIER'
           ORDER BY cycle_sequence DESC LIMIT 1) AS "latestEquity",
          (SELECT state_json ->> 'netRealizedPnl'
           FROM trader_historical_simulation_durable_snapshot_v2
           WHERE organization_id=${organizationId}::uuid
             AND account_id=${productionInput.accountId} AND run_id=${runId}
             AND state_kind='ACCOUNTING_FRONTIER'
           ORDER BY cycle_sequence DESC LIMIT 1) AS "latestNetRealizedPnl",
          (SELECT state_json ->> 'markedPositionValue'
           FROM trader_historical_simulation_durable_snapshot_v2
           WHERE organization_id=${organizationId}::uuid
             AND account_id=${productionInput.accountId} AND run_id=${runId}
             AND state_kind='ACCOUNTING_FRONTIER'
           ORDER BY cycle_sequence DESC LIMIT 1) AS "latestMarkedPositionValue",
          (SELECT (latest.runtime_input -> 'historicalKnowledgeSnapshotAuthority' ->>
                    'visibleEvidenceCount')::int
           FROM (
             SELECT pit_anchor, runtime_input_json AS runtime_input
             FROM trader_forecast_runtime_input_source_v2
             WHERE organization_id=${organizationId}::uuid AND run_id=${runId}
             UNION ALL
             SELECT ledger.replay_bar_closed_at_utc AS pit_anchor,
                    stage.artifacts_json -> 0 -> 'payload' -> 'runtimeInput' AS runtime_input
             FROM trader_historical_simulation_atomic_stage_v2 stage
             JOIN trader_historical_simulation_reason_ledger_v2 ledger
               ON ledger.organization_id=stage.organization_id
              AND ledger.account_id=stage.account_id
              AND ledger.run_id=stage.run_id
              AND ledger.cycle_sequence=stage.cycle_sequence
             WHERE stage.organization_id=${organizationId}::uuid
               AND stage.account_id=${productionInput.accountId}
               AND stage.run_id=${runId}
               AND stage.stage='FORECAST_LIFECYCLE'
               AND stage.artifacts_json -> 0 ->> 'artifactKind'='FORECAST_NON_ACTIONABLE'
           ) latest
           ORDER BY latest.pit_anchor DESC LIMIT 1) AS "visibleEvidenceCount",
          (SELECT count(DISTINCT input_semantic_digest)::text
           FROM trader_intelligence_cycle_envelope
           WHERE organization_id=${organizationId}::uuid
             AND run_id=${runId}) AS "distinctModelInputs",
          (SELECT count(DISTINCT encode(forecast.distribution_semantic_digest, 'hex'))::text
           FROM trader_forecast_v2 forecast
           JOIN trader_forecast_bundle_v2 bundle
             ON bundle.organization_id=forecast.organization_id
            AND bundle.id=forecast.bundle_id
           WHERE bundle.organization_id=${organizationId}::uuid
             AND bundle.run_id=${runId}
             AND forecast.target_role_id='TERMINAL_RETURN') AS "distinctTerminalDistributions",
          (SELECT count(DISTINCT calibration_snapshot_digest)::text
           FROM trader_knowledge_state_checkpoint_v2
           WHERE organization_id=${organizationId}::uuid
             AND checkpoint_namespace LIKE
               ${`waia.trader.historical_simulation_knowledge_binding.v2|${runId}|BTCUSDT|%`})
             AS "distinctCalibrationSnapshots",
          (SELECT count(*)::text
           FROM trader_knowledge_confidence_update_record
           WHERE organization_id=${organizationId}::uuid
             AND run_id=${runId} AND score::numeric <> 0) AS "scoredKnowledgeUpdates",
          (SELECT count(*)::text
           FROM trader_knowledge_confidence_update_record
           WHERE organization_id=${organizationId}::uuid
             AND run_id=${runId}
             AND prior_confidence::numeric=posterior_confidence::numeric
             AND delta::numeric=0
             AND terminal_reason='FORECAST_V2_EVIDENCE_ONLY_ZERO_DELTA')
             AS "governedZeroDeltaUpdates"
      `;
      expect(rows[0]).toMatchObject({
        checkpoints: "35",
        outcomes: "1",
        calibrations: "1",
        knowledgeUpdates: "1",
        knowledgeCheckpoints: "35",
        appliedLedgers: "1",
        visibleEvidenceCount: 1,
        // The first learned record becomes visible on the terminal cycle of this
        // bounded fixture. That cycle is scientifically NON_ACTIONABLE, so it has
        // no persisted Forecast-v2 row (and therefore no 0189 FK link). Its exact
        // runtime input is nevertheless sealed in the atomic FORECAST_LIFECYCLE
        // artifact and is the source of visibleEvidenceCount above.
        knowledgeLinks: "0",
        futureOnlyViolations: "0",
        knowledgeBindingViolations: "0",
        economicBoundaryViolations: "0",
      });
      const authorizedForecastCycles = Number(rows[0]!.bundles);
      const nonActionableCycles = Number(rows[0]!.nonActionableLedgers);
      expect(authorizedForecastCycles).toBeGreaterThan(0);
      expect(nonActionableCycles).toBeGreaterThan(0);
      expect(authorizedForecastCycles + nonActionableCycles).toBe(35);
      expect(rows[0]!.pits).toBe(rows[0]!.bundles);
      expect(rows[0]!.preregistrations).toBe(rows[0]!.bundles);
      // The qualification path must exercise both sides of a complete modeled
      // position lifecycle: one opening BUY and one exposure-reducing SELL.
      // Scope these counts by the durable historical run/account columns rather
      // than by allocation_decision_id: the opening order intentionally retains
      // the ratified allocation decision UUID, while the later deterministic
      // close uses the CASH receipt digest as its allocation authority.
      expect(rows[0]!.modeledOrders).toBe("2");
      expect(rows[0]!.modeledFills).toBe("2");
      expect(rows[0]!.modeledFillEvidence).toBe(rows[0]!.modeledFills);
      for (const value of [rows[0]!.latestCash, rows[0]!.latestEquity,
        rows[0]!.latestNetRealizedPnl, rows[0]!.latestMarkedPositionValue]) {
        expect(Number.isFinite(Number(value))).toBe(true);
      }
      expect(Number(rows[0]!.latestNetRealizedPnl)).not.toBe(0);
      expect(Number(rows[0]!.distinctModelInputs)).toBeGreaterThan(1);
      expect(Number(rows[0]!.distinctTerminalDistributions)).toBeGreaterThan(1);
      // Historical learning accumulates scored evidence and changes the
      // calibration snapshot visible to later PITs.  Confidence mutation stays
      // zero until operator disposition; this is the governed contract, not a
      // missing learning event.
      expect(Number(rows[0]!.distinctCalibrationSnapshots)).toBeGreaterThan(1);
      expect(rows[0]!.scoredKnowledgeUpdates).toBe("1");
      expect(rows[0]!.governedZeroDeltaUpdates).toBe("1");
      expect(fixture.qualificationReceipt.holdout.status)
        .toBe("PRE_HOLDOUT_ONLY_NOT_PRESENT_NOT_ACCESSED");
    // This is the full 35-cycle proof, not a synthetic smoke. It completes in
    // about 20 minutes locally, while GitHub's shared runner reached the old
    // 25-minute ceiling before completing. Preserve every assertion and give
    // the same workload enough wall-clock budget on the slower CI host.
    }, 2_400_000);

    it("persists valid historical evidence and rejects a rehashed receipt with tampered authority", async () => {
      const receiptRows = await heldSql<
        Array<
          Readonly<{
            profile_id: string;
            profile_content_digest: string;
            account_id: string | null;
            purpose: string;
            status: string;
            pit_anchor: Date;
            receipt_json: Record<string, unknown>;
            schema_version: string;
            authority: string;
          }>
        >
      >`
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

    it("rejects directly submitted, internally rehashed knowledge and market authority forgeries", async () => {
      const proposalRows = await pool<Array<Readonly<{
        id: string;
        content_digest_hex: string;
        technical_candidate_content_digest_hex: string;
      }>>>`
        SELECT id::text,content_digest_hex,technical_candidate_content_digest_hex
        FROM trader_historical_technical_proposal_v2
        WHERE organization_id=${organizationId}::uuid AND run_id=${runId}
      `;
      expect(proposalRows).toHaveLength(1);
      const proposal = proposalRows[0]!;

      async function expectForgedAuthorityRejected(
        mutate: (authority: Record<string, unknown>) => void,
      ): Promise<void> {
        const forged = structuredClone(ratified) as unknown as Record<string, unknown>;
        mutate(forged);
        forged.contentDigestHex = computeSemanticSha256Hex(
          semanticBody(forged, "contentDigestHex"),
        );
        const connection = await pool.reserve();
        const roleSql = bindPostgresReservedSession(pool, connection);
        try {
          await assumeHistoricalSimulationRunnerRoleV2(roleSql);
          await expect(roleSql`
            SELECT public.waia_finalize_historical_four_surface_authority_v2(
              ${proposal.id}::uuid,${proposal.content_digest_hex},
              ${proposal.technical_candidate_content_digest_hex},
              ${roleSql.json(forged as postgres.JSONValue)}::jsonb
            )
          `).rejects.toMatchObject({ code: "23514" });
        } finally {
          try { await resetHistoricalSimulationRunnerRoleV2(roleSql); }
          finally { connection.release(); }
        }
      }

      await expectForgedAuthorityRejected((forged) => {
        const snapshots = forged.knowledgeSnapshots as Array<Record<string, unknown>>;
        snapshots[0]!.selectedHypothesisType = "forged-hypothesis-type";
        snapshots[0]!.snapshotContentDigestHex = computeSemanticSha256Hex(
          semanticBody(snapshots[0]!, "snapshotContentDigestHex"),
        );
        forged.knowledgeSnapshotDigestHex = computeSemanticSha256Hex({
          schemaVersion: "waia.trader.historical_prerun_knowledge_snapshot_set.v2",
          organizationId,runId,releaseSha: RELEASE_SHA,
          epistemicRecordCutoff: forged.epistemicRecordCutoff,
          knowledgeSnapshots: snapshots,
        });
      });

      await expectForgedAuthorityRejected((forged) => {
        const evidence = forged.marketEvidence as Array<Record<string, unknown>>;
        evidence[0]!.trustScore = "0.5";
        evidence[0]!.contentDigestHex = computeSemanticSha256Hex(
          semanticBody(evidence[0]!, "contentDigestHex"),
        );
        forged.marketEvidenceDigestHex = computeSemanticSha256Hex({
          schemaVersion: "waia.trader.historical_ratified_market_evidence_set.v2",
          organizationId,runId,releaseSha: RELEASE_SHA,marketEvidence: evidence,
        });
      });

      await expectForgedAuthorityRejected((forged) => {
        const admissions = forged.surfaceAdmissions as Array<Record<string, unknown>>;
        const admission = admissions[0]!;
        const human = admission.humanRatificationReceipt as Record<string, unknown>;
        human.selectedK = Number(human.selectedK) + 1;
        human.contentDigestHex = computeSemanticSha256Hex(
          semanticBody(human, "contentDigestHex"),
        );
      });

      await expectForgedAuthorityRejected((forged) => {
        forged.unapprovedSemanticExtension = "runner-controlled";
      });

      await expectForgedAuthorityRejected((forged) => {
        forged.epistemicRecordCutoff = "2999-01-01T00:00:00.000Z";
        forged.knowledgeSnapshotDigestHex = computeSemanticSha256Hex({
          schemaVersion: "waia.trader.historical_prerun_knowledge_snapshot_set.v2",
          organizationId,runId,releaseSha: RELEASE_SHA,
          epistemicRecordCutoff: forged.epistemicRecordCutoff,
          knowledgeSnapshots: forged.knowledgeSnapshots,
        });
      });

      const durableRows = await pool<Array<Readonly<{ authority_json: unknown }>>>`
        SELECT authority_json FROM trader_historical_four_surface_ratified_admission_v2
        WHERE organization_id=${organizationId}::uuid AND run_id=${runId}
      `;
      expect(durableRows).toEqual([{ authority_json: ratified }]);
    });

    it("replays sealed historical evidence after its mutable source is deprecated", async () => {
      const executor = drizzle(heldSql, { schema: pgSchema });
      const sourceService = createPostgresMiSourceProvenanceService(executor, {
        actorType: "admin",
        actorId: userId,
      });
      for (const evidence of ratified.marketEvidence) {
        await sourceService.setSourceStatus({ organizationId }, evidence.sourceId, {
          status: "deprecated",
        });
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
