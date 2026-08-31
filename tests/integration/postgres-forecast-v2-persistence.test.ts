/**
 * DEE-527 — Forecast V2 package/bundle Postgres persistence roundtrip (opt-in).
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";

import { MODEL_TRANSFORM_VERSION } from "@/lib/trader/intelligence/forecast-v2/constants";
import {
  persistForecastBundleV2,
  persistForecastCalibrationObservationV2,
  persistObjectiveForecastOutcomeResolutionV2,
  persistPredictivePackageV2,
  purgeRetainedForecastV2PitBars,
  verifyPersistedForecastV2RoundTrip,
} from "@/lib/trader/intelligence/forecast-v2/forecast-v2-persistence-service";
import type { ReplicaRootFamilyInput } from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import { digestHex } from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import { canonicalizeSemanticJsonString, computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { scoreForecastV2MulticlassObservation } from "@/lib/trader/intelligence/calibration/calibration-scorer";
import { persistForecastV2TerminalClosurePostgres } from "@/lib/trader/intelligence/outcome-resolution/epistemic-closure-runtime";
import { createForecastV2DurableProducerV1 } from "@/lib/trader/intelligence/outcome-resolution/epistemic-closure-runtime";
import { assertHtxVolumeAuthorityQualified, qualifyHtxKlineVolumeAuthority } from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import { persistHtxVolumeQualificationReceipt } from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification-receipt-service";
import { buildKmConvergenceReceiptV1 } from "@/lib/trader/research/execopp-qualification/km-convergence-gate-v1";
import { buildEpistemicParameterRatificationReceiptV1, buildPredictiveTerminalReceiptV1 } from "@/lib/trader/research/execopp-qualification/scientific-admission-v2";
import { buildScientificAdmissionReceiptRecordV2, persistScientificAdmissionReceiptV2 } from "@/lib/trader/research/execopp-qualification/scientific-admission-receipt-service-v2";
import { readScientificAdmissionReceiptV1 } from "@/lib/trader/research/execopp-qualification/scientific-admission-receipt-service-v1";
import { bucketIndexForReturn, computeTerminalTargetGridFromDevelopmentReturns } from "@/lib/trader/research/benchmark/target-grid-ceremony-v1";
import { quantizeScale8HalfUp } from "@/lib/trader/intelligence/forecast-v2/quantize-scale8-half-up-v1";
import { buildForecastContractBindingV1, buildForecastContractBindingRecordV1,
  persistForecastContractBindingV1 } from "@/lib/trader/intelligence/forecast-v2/forecast-contract-binding-service-v1";
import {
  buildForecastInputContractV2,
  buildForecastModelArtifactV2,
  buildForecastModelSpecV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-contract-foundation-v2";
import { issueForecastRuntimeV2, type ForecastRuntimeInputV2 } from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import { buildMarketStateSnapshotV2 } from "@/lib/trader/intelligence/predictive-admission";
import type { PredictiveAdmissionReceiptV1 } from "@/lib/trader/intelligence/predictive-admission";
import { runBacktest } from "@/lib/trader/backtest/backtest-runner";
import { HistoricalBarReplaySource } from "@/lib/trader/market-data/historical-bar-replay-source";
import { createCostModelV1 } from "@/lib/trader/execution/cost-model";
import { createInMemoryResearchBacktestSession } from "@/lib/trader/research/create-in-memory-research-backtest-session";
import { createHtrInitialAccountRiskState } from "@/lib/trader/research/htr-initial-portfolio-contract";
import { getDb } from "@/db/client";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { MEAN_REVERSION_V0 } from "@/lib/trader/intelligence/types";
import { runPollPaperCycles } from "@/lib/trader/paper/paper-cycle-runner";
import type { MarketSnapshot } from "@/lib/trader/market-data/types";
import {
  buildPredictivePackageV1,
  issueForecastV1,
  verifyForecastDistributionReplayV1,
} from "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import type { SourceAnchor } from "@/lib/trader/intelligence/forecast-v2/source-anchor-v1";
import type { Bar } from "@/lib/trader/intelligence/types";
import { cleanupWp13Org, seedWp13User } from "./wp13-intelligence-test-helpers";
import { barToFhvBarsV2Record, serializeFhvBarsV2Record } from "@/lib/trader/market-data/fhv-bars-v2-ndjson";
import { computeFhvFileRawSha256, sealFhvV2Dataset, writeFhvAcquisitionReceipt } from "@/lib/trader/market-data/fhv-dataset-seal";
import { FHV_OFFICIAL_PARTITION_NAMES, FHV_OFFICIAL_SYMBOLS, fhvOfficialPartitionFileRelativePath,
  resolveFhvCanonicalPartitionInterval } from "@/lib/trader/market-data/fhv-partition-boundaries";
import { sealHistoricalMarketCycleV2 } from "@/lib/trader/historical-simulation-v2/modeled-execution-advance-v2";
import { createCanonicalDecisionVerificationReceiptServiceV2,
  createPostgresCanonicalDecisionVerificationReceiptPortV2 } from "@/lib/trader/historical-simulation-v2/canonical-verification-receipt-postgres-v2";
import { createPostgresDee659AuthorityRepositoryV2 } from "@/lib/trader/historical-simulation-v2/dee659-authority-repository-postgres-v2";
import { computeHistoricalForecastPitKnowledgeDigestV2,
  createPostgresHistoricalForecastInputPitProducerV2 } from "@/lib/trader/historical-simulation-v2/pit-forecast-input-producer-v2";
import { createPostgresHistoricalForecastInputPitLoaderV2 } from "@/lib/trader/historical-simulation-v2/pit-forecast-input-loader-v2";
import { runHistoricalSimulationNextCyclePostgresV2 } from "@/lib/trader/historical-simulation-v2/atomic-cycle-repository-postgres-v2";
import { getPostgresDrizzle } from "@/db/postgres-client";
import { createAccountingFrontierRepositoryPostgres, createInitialAccountingState,
  computeAccountingSemanticDigest, type AccountingFrontierV1 } from "@/lib/trader/accounting";

const WP518_PG_USER = "00000000-0000-4000-8000-000000051802";

async function cleanupForecastV2TestOrg(url: string, userId: string): Promise<void> {
  const cleanupSql = postgres(url, { max: 1 });
  const triggers = [
    ["trader_fill_execution_economics", "waia_trader_fill_execution_economics_block_delete"],
    ["trader_accounting_frontier", "trader_accounting_frontier_block_delete"],
  ] as const;
  try {
    for (const [table, trigger] of triggers) {
      await cleanupSql.unsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
    }
    await cleanupWp13Org(url, userId);
  } finally {
    for (const [table, trigger] of triggers.toReversed()) {
      await cleanupSql.unsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
    }
    await cleanupSql.end({ timeout: 5 });
  }
}

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

function anchor(i: number): SourceAnchor {
  return {
    venue: "htx",
    market: "spot",
    symbol: "BTCUSDT",
    closedBarEpochMs: 1_700_000_000_000 + i * 60_000,
    barContentDigest: createHash("sha256").update(String(i)).digest("hex"),
    realizedVol20m_1m: 0.01 + (i % 12) * 0.0015,
    outcome13d: [0, 0, 0, -0.002 + (i % 7) * 0.0004, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
}

function buildFamily(): ReplicaRootFamilyInput {
  return {
    organizationId: "00000000-0000-4000-8000-000000000001",
    venue: "htx",
    market: "spot",
    symbol: "BTCUSDT",
    primaryHorizonMinutes: 30,
    executionHorizonMinutes: 33,
    packageSubjectVersion: "pkg-subject/v1",
    terminalTargetDefinitionDigestHex: "a".repeat(64),
    executionOpportunityTargetDefinitionDigestHex: "b".repeat(64),
    modelTransformVersion: MODEL_TRANSFORM_VERSION,
    developmentDatasetDigestHex: createHash("sha256").update("dev-dataset").digest("hex"),
    featureVersion: "feature-engine/rv/v2",
    normalizationVersionDigestHex: "c".repeat(64),
    codeReleaseSha: "d".repeat(40),
  };
}

function buildRuntimeInput(
  organizationId: string,
  predictivePackage: ReturnType<typeof buildPredictivePackageV1>,
  pitAnchor: string,
  scientific: Readonly<{ id: string; contentDigestHex: string }>,
  anchorRealizedVol20m1m = 0.018,
): ForecastRuntimeInputV2 {
  const family = predictivePackage.family;
  const hex = (char: string) => char.repeat(64);
  const inputContract = buildForecastInputContractV2({
    measurementSemanticVersion: family.featureVersion,
    hypothesisAssessmentSchemaVersion: "waia.trader.hypothesis_assessment.v1",
  });
  const modelSpec = buildForecastModelSpecV2({
    modelId: "rv-state-conditional-empirical-joint/v1",
    modelTransformVersion: family.modelTransformVersion,
    inputContractDigestHex: inputContract.contentDigestHex,
    terminalTargetDefinitionDigestHex: family.terminalTargetDefinitionDigestHex,
    executionOpportunityTargetDefinitionDigestHex:
      family.executionOpportunityTargetDefinitionDigestHex,
  });
  const modelArtifact = buildForecastModelArtifactV2({
    modelSpecDigestHex: modelSpec.contentDigestHex,
    inputContractDigestHex: inputContract.contentDigestHex,
    developmentDatasetDigestHex: family.developmentDatasetDigestHex,
    runtimeContractDigestHex: digestHex(predictivePackage.runtimeContractDigest),
    artifactPayloadDigestHex: hex("f"),
  });
  const forecastContractBinding = buildForecastContractBindingV1({
    organizationId,
    scientificAdmissionReceiptId: scientific.id,
    scientificAdmissionReceiptContentDigestHex: scientific.contentDigestHex,
    selectedPredictivePackageContentDigestHex: digestHex(
      predictivePackage.predictivePackageContentDigest,
    ),
    inputContract,
    modelSpec,
    modelArtifact,
  });
  const marketStateSnapshot = buildMarketStateSnapshotV2({
    organizationId,
    accountId: null,
    instrumentId: "BTC-USDT",
    symbol: family.symbol,
    venue: "htx",
    analysisPurpose: "NEW_OPPORTUNITY",
    analyticalTimeframe: "1m",
    horizon: "30m",
    pitAnchor,
    runtimeContextDigestHex: hex("2"),
    runtimePosture: "FULL_ANALYSIS_AND_NEW_RISK",
    requiredInformationProfileDigestHex: hex("3"),
    informationSufficiencyReceiptDigestHex: hex("4"),
    reconstructionDigestHex: hex("5"),
    stateRepresentationSpecDigestHex: hex("6"),
    dynamicStateDescriptorDigestHex: hex("7"),
    understandingClaimSetDigestHex: hex("8"),
    activeKnowledgeStateDigestHex: hex("9"),
    selectedKnowledgeClaimDigestsHex: [hex("a")],
    selectedFailureBoundaryDigestsHex: [hex("b")],
    hypothesisAssessmentSetDigestHex: hex("c"),
    consumedHypothesisAssessments: [{
      hypothesisAssessmentContentDigestHex: hex("d"),
      evaluatorIdentityDigestHex: hex("e"),
      status: "APPLICABLE",
    }],
    sourceProfileDigestHex: hex("f"),
    representationProfileDigestHex: hex("1"),
    anchorRealizedVol20m_1m: anchorRealizedVol20m1m,
    forecastContractBinding,
  });
  const receiptBody = {
    schemaVersion: "waia.trader.predictive_admission_receipt.v1" as const,
    verdict: "ADMITTED" as const,
    capitalAuthority: "NONE" as const,
    analysisPurpose: "NEW_OPPORTUNITY" as const,
    pitAnchor,
    marketStateSnapshotContentDigestHex: marketStateSnapshot.contentDigestHex,
    selectedPredictivePackageContentDigestHex:
      forecastContractBinding.selectedPredictivePackageContentDigestHex,
    scientificAdmissionReceiptContentDigestHex:
      forecastContractBinding.scientificAdmissionReceiptContentDigestHex,
    inputContractDigestHex: inputContract.contentDigestHex,
    modelSpecDigestHex: modelSpec.contentDigestHex,
    modelArtifactDigestHex: modelArtifact.contentDigestHex,
    qualifiedInputBindingDigestHex: marketStateSnapshot.qualifiedInputBindingDigestHex,
    blockingReasons: [] as const,
  };
  const predictiveAdmissionReceipt: PredictiveAdmissionReceiptV1 = {
    ...receiptBody,
    contentDigestHex: computeSemanticSha256Hex(receiptBody),
  };
  return {
    predictiveAdmissionReceipt,
    marketStateSnapshot,
    forecastContractBinding,
    predictivePackage,
    executionHorizonMinutes: family.executionHorizonMinutes,
    normalizationVersionDigestHex: family.normalizationVersionDigestHex,
    knowledgeEdgeId: "00000000-0000-4000-8000-000000063300",
    knowledgeContentDigestHex: computeHistoricalForecastPitKnowledgeDigestV2(
      organizationId, family.symbol, pitAnchor, [],
    ),
  };
}

async function persistScientificForPackage(sql: postgres.Sql, organizationId: string,
  pkg: ReturnType<typeof buildPredictivePackageV1>, seed: string) {
  const h = (value: string) => createHash("sha256").update(value).digest("hex");
  const developmentReturns = Array.from({ length: 400 }, (_, i) => Math.sin(i / 17) * 0.02 + (i % 9) * 0.0005);
  const historyReturns = Array.from({ length: 2500 }, (_, i) => developmentReturns[i % developmentReturns.length]!);
  const grid = computeTerminalTargetGridFromDevelopmentReturns(developmentReturns);
  const identities = {
    developmentDatasetDigestHex: pkg.family.developmentDatasetDigestHex,
    targetGridReceiptDigestHex: h(`${seed}-grid`),
    predictivePackageGenerationIdentityDigestHex: digestHex(pkg.predictivePackageGenerationIdentityDigest),
    predictivePackageContentDigestHex: digestHex(pkg.predictivePackageContentDigest),
    runtimeContractDigestHex: digestHex(pkg.runtimeContractDigest),
    scoringContractVersion: "multiclass-log-score/v1" as const,
    evaluationPartitionReceiptDigestHex: h(`${seed}-partition`),
  };
  const predictive = buildPredictiveTerminalReceiptV1({ identities, harnessInput: {
    venue: "htx", market: "spot", symbol: "BTCUSDT", primaryHorizonMinutes: 30,
    challengerPackageContentDigestHex: identities.predictivePackageContentDigestHex,
    comparisonFamilyId: "mandatory-baseline-family/v1",
    evaluationPartitionReceiptDigestHex: identities.evaluationPartitionReceiptDigestHex,
    purgeDurationMinutes: 30, embargoDurationMinutes: 30, developmentReturns, historyReturns,
    historyReturnMinuteOpenTimesMs: historyReturns.map((_, i) => 1_700_000_000_000 + i * 60_000),
    anchors: developmentReturns.slice(0, 24).map((observedReturn, i) => {
      const bucket = bucketIndexForReturn(observedReturn, grid);
      return { anchorId: `anchor-${i}`, observedReturn,
        challengerProbabilities: Array.from({ length: 7 }, (_, j) => j === bucket ? 0.999 : 0.001 / 6) };
    }),
  }});
  const km = buildKmConvergenceReceiptV1({
    replicaRootFamilyIdentityDigestHex: digestHex(pkg.replicaRootFamilyIdentityDigest),
    kmGlobalAnchorSetDigestHex: h(`${seed}-global-anchor`), candidateGenerationDigestsHex: [h(`${seed}-candidate`)],
    configurations: [{ kConfig: pkg.kConfigDec, mConfig: pkg.mConfigDec, evLowerRelativeErrorP95: 0.001,
      evBaseRelativeErrorP95: 0.001, evUpperRelativeErrorP95: 0.001, mcEsRelativeErrorP95: 0.001, qualifies: true }],
    selectedPackageGenerationIdentityDigestHex: identities.predictivePackageGenerationIdentityDigestHex,
    selectedPackageContentDigestHex: identities.predictivePackageContentDigestHex,
  });
  const ratification = buildEpistemicParameterRatificationReceiptV1({
    kmConvergenceEvidenceSemanticDigestHex: km.evidenceSemanticDigestHex, selectedK: km.selectedK!, selectedM: km.selectedM!,
    alphaEpiConfigScale8: km.alphaEpiConfigScale8,
    selectedPackageGenerationIdentityDigestHex: identities.predictivePackageGenerationIdentityDigestHex,
    selectedPackageContentDigestHex: identities.predictivePackageContentDigestHex, humanReceiptIdentityDigestHex: h(`${seed}-human`),
  });
  const volume = qualifyHtxKlineVolumeAuthority({ symbol: "BTCUSDT", rows: [
    { id: 1, open: 100, high: 101, low: 99, close: 100, amount: 10, vol: 1000, count: 1 },
    { id: 2, open: 50, high: 51, low: 49, close: 50, amount: 10, vol: 500, count: 1 },
  ]});
  await persistHtxVolumeQualificationReceipt(sql, { organizationId, receipt: volume });
  const record = buildScientificAdmissionReceiptRecordV2({ organizationId, predictiveTerminalReceipt: predictive,
    kmConvergenceReceipt: km, epistemicParameterRatificationReceipt: ratification, htxVolumeQualificationReceipt: volume });
  await persistScientificAdmissionReceiptV2(sql, record);
  return { id: record.id, contentDigestHex: record.contentDigest,
    evidenceSemanticDigestHex: record.evidenceSemanticDigest };
}

function createCanonicalDatasetFixture(organizationId: string, selectedBarInput: Bar | readonly Bar[]) {
  const selectedBars = Array.isArray(selectedBarInput) ? selectedBarInput : [selectedBarInput];
  const selectedBar = selectedBars[0]!;
  const root = mkdtempSync(join(tmpdir(), "waia-0189-pg-"));
  const receipts = join(root, "receipts"); mkdirSync(receipts);
  const releaseSha = "1".repeat(40); const operatorId = "0189-integration";
  const capability = createHash("sha256").update("0189-capability").digest("hex");
  const receiptPaths: string[] = [];
  for (const partition of FHV_OFFICIAL_PARTITION_NAMES) for (const symbol of FHV_OFFICIAL_SYMBOLS) {
    const relative = fhvOfficialPartitionFileRelativePath({ partition, symbol });
    const path = join(root, relative); mkdirSync(join(path, ".."), { recursive: true });
    const interval = resolveFhvCanonicalPartitionInterval(partition);
    const bar = partition === "development" && symbol === "BTCUSDT" ? selectedBar : {
      ...selectedBar, symbol: symbol === "BTCUSDT" ? "BTC/USDT" : "ETH/USDT",
      barOpenTime: interval.startUtc,
      barCloseTime: new Date(Date.parse(interval.startUtc) + 60_000).toISOString(),
    } as Bar;
    writeFileSync(path, partition === "development" && symbol === "BTCUSDT"
      ? selectedBars.map((selected) => serializeFhvBarsV2Record(barToFhvBarsV2Record(selected))).join("")
      : serializeFhvBarsV2Record(barToFhvBarsV2Record(bar)));
    receiptPaths.push(writeFhvAcquisitionReceipt({ receiptDir: receipts,
      acquisitionRunId: `0189-${partition}-${symbol}`, releaseSha, organizationId, operatorId,
      sourceCapabilityReceiptDigest: capability, partition, symbol, startUtc: interval.startUtc,
      endUtc: interval.endUtc, outputRoot: root, fileRelativePath: relative,
      rawSha256: computeFhvFileRawSha256(path),
      actualBarCount: partition === "development" && symbol === "BTCUSDT" ? selectedBars.length : 1 }).receiptPath);
  }
  sealFhvV2Dataset({ datasetRoot: root, acquisitionReceiptPaths: receiptPaths, releaseSha,
    organizationId, operatorId, sourceCapabilityReceiptDigest: capability,
    writerVersion: "0189-integration", minimumReaderVersion: "0189-integration", sealRunId: "0189-seal" });
  return root;
}

describe.skipIf(!integrationEnabled || !url)(
  "postgres forecast-v2 persistence service (DEE-527)",
  () => {
    let orgId: string;
    let sql: postgres.Sql;

    async function cleanupKnowledgeFeedback(): Promise<void> {
      await sql.begin(async (tx) => {
        await tx.unsafe(
          "ALTER TABLE trader_knowledge_confidence_update_record DISABLE TRIGGER trader_knowledge_confidence_update_record_block_delete",
        );
        try {
          await tx`
            DELETE FROM trader_knowledge_confidence_update_record
            WHERE organization_id = ${orgId}::uuid
          `;
        } finally {
          await tx.unsafe(
            "ALTER TABLE trader_knowledge_confidence_update_record ENABLE TRIGGER trader_knowledge_confidence_update_record_block_delete",
          );
        }
      });
    }
    async function cleanupForecastRows(): Promise<void> {
      const tables = [
        "trader_historical_simulation_resume_snapshot_link_v2",
        "trader_historical_simulation_resume_stage_link_v2",
        "trader_historical_simulation_resume_checkpoint_v2",
        "trader_historical_simulation_durable_snapshot_v2",
        "trader_historical_simulation_atomic_stage_v2",
        "trader_historical_simulation_modeled_evidence_v2",
        "trader_historical_simulation_reason_ledger_v2",
        "trader_knowledge_state_checkpoint_v2",
        "trader_historical_forecast_input_knowledge_link_v2",
        "trader_historical_forecast_input_pit_v2",
        "trader_canonical_decision_verification_receipt_v2",
        "trader_historical_simulation_run_start_v2",
        "trader_dee659_authority_bundle_v2",
        "trader_dee659_authority_preregistration_v2",
        "trader_canonical_decision_verification_subject_v2",
        "trader_historical_dataset_authority_v2",
        "trader_historical_simulation_policy_config_v2",
        "trader_accounting_frontier",
        "trader_forecast_runtime_input_source_v2",
        "trader_forecast_pit_bar_retention_audit_v2",
        "trader_forecast_pit_bar_v2",
        "trader_forecast_scenario_v2", "trader_forecast_calibration_observation_v2",
        "trader_forecast_outcome_v2", "trader_forecast_v2", "trader_forecast_bundle_v2",
        "trader_forecast_replica_artifact_v2", "trader_forecast_predictive_package_target_v2",
        "trader_forecast_target_bucket_v2", "trader_forecast_target_definition_v2",
        "trader_forecast_predictive_package_v2",
        "trader_forecast_contract_binding_v1",
        "trader_scientific_admission_receipt_v1",
        "trader_htx_volume_qualification_receipt_v1",
      ];
      await sql.begin(async (tx) => {
        for (const table of tables) {
          await tx.unsafe(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
          await tx.unsafe(`DELETE FROM ${table} WHERE organization_id = $1`, [orgId]);
          await tx.unsafe(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
        }
      });
    }

    beforeAll(async () => {
      sql = postgres(url!, { max: 2 });
      await sql.begin(async (tx) => {
        await tx.unsafe(
          "ALTER TABLE trader_knowledge_confidence_update_record DISABLE TRIGGER trader_knowledge_confidence_update_record_block_delete",
        );
        try {
          await tx`DELETE FROM trader_knowledge_confidence_update_record`;
        } finally {
          await tx.unsafe(
            "ALTER TABLE trader_knowledge_confidence_update_record ENABLE TRIGGER trader_knowledge_confidence_update_record_block_delete",
          );
        }
      });
      await sql.begin(async (tx) => {
        await tx.unsafe(
          "ALTER TABLE trader_knowledge_state_checkpoint_v2 DISABLE TRIGGER trader_knowledge_state_checkpoint_v2_block_delete",
        );
        try {
          await tx`DELETE FROM trader_knowledge_state_checkpoint_v2`;
        } finally {
          await tx.unsafe(
            "ALTER TABLE trader_knowledge_state_checkpoint_v2 ENABLE TRIGGER trader_knowledge_state_checkpoint_v2_block_delete",
          );
        }
      });
      await cleanupForecastV2TestOrg(url!, WP518_PG_USER);
      orgId = await seedWp13User(url!, WP518_PG_USER, "Forecast V2 Persistence");
      await cleanupForecastRows();
    }, 600_000);

    beforeEach(async () => {
      await cleanupKnowledgeFeedback();
      await cleanupForecastRows();
    }, 120_000);

    afterAll(async () => {
      await cleanupKnowledgeFeedback();
      await cleanupForecastRows();
      await sql.end({ timeout: 10 });
      await cleanupForecastV2TestOrg(url!, WP518_PG_USER);
    });

    it("persists package, replica artifacts, bundle and dual-role forecasts", async () => {
      const family = { ...buildFamily(), organizationId: orgId };
      const pkg = buildPredictivePackageV1({
        family,
        sourceCorpus: Array.from({ length: 120 }, (_, i) => anchor(i)),
        kConfigDec: 3,
        mConfigDec: 4,
      });
      const persistedPackage = await persistPredictivePackageV2(sql, pkg, {
        organizationId: orgId,
        kmGlobalAnchorSetDigestHex: "f".repeat(64),
      });
      const retriedPackage = await persistPredictivePackageV2(sql, pkg, {
        organizationId: orgId,
        kmGlobalAnchorSetDigestHex: "f".repeat(64),
      });
      expect(retriedPackage).toEqual(persistedPackage);
      await expect(
        persistPredictivePackageV2(sql, pkg, {
          organizationId: orgId,
          kmGlobalAnchorSetDigestHex: "0".repeat(64),
        }),
      ).rejects.toThrow(/existing predictive package binding mismatch/);
      const forgedArtifactPackage = {
        ...pkg,
        replicaArtifacts: pkg.replicaArtifacts.map((artifact, index) =>
          index === 0 ? { ...artifact, q1: artifact.q1 + 0.000001 } : artifact,
        ),
      };
      await expect(
        persistPredictivePackageV2(sql, forgedArtifactPackage, {
          organizationId: orgId,
          kmGlobalAnchorSetDigestHex: "f".repeat(64),
        }),
      ).rejects.toThrow(/replica artifact full replay mismatch/);
      await sql.unsafe("ALTER TABLE trader_forecast_target_bucket_v2 DISABLE TRIGGER USER");
      await sql`
        UPDATE trader_forecast_target_bucket_v2
        SET upper_bound_scale8 = '999.00000000'
        WHERE organization_id = ${orgId}::uuid
          AND target_definition_id = ${persistedPackage.terminalTargetDefinitionId}::uuid
          AND bucket_ordinal = 0
      `;
      await expect(
        persistPredictivePackageV2(sql, pkg, {
          organizationId: orgId,
          kmGlobalAnchorSetDigestHex: "f".repeat(64),
        }),
      ).rejects.toThrow(/existing predictive package binding mismatch/);
      await sql`
        UPDATE trader_forecast_target_bucket_v2
        SET upper_bound_scale8 = ${quantizeScale8HalfUp(pkg.terminalTargetGrid.edges[0]!)}
        WHERE organization_id = ${orgId}::uuid
          AND target_definition_id = ${persistedPackage.terminalTargetDefinitionId}::uuid
          AND bucket_ordinal = 0
      `;
      await sql.unsafe("ALTER TABLE trader_forecast_target_bucket_v2 ENABLE TRIGGER USER");

      const concurrentPkg = buildPredictivePackageV1({
        family: { ...family, codeReleaseSha: "e".repeat(40) },
        sourceCorpus: Array.from({ length: 120 }, (_, i) => anchor(i)),
        kConfigDec: 3,
        mConfigDec: 4,
      });
      const concurrentKey = "dee-633-concurrent-identical-package";
      const concurrent = await Promise.all([
        persistPredictivePackageV2(sql, concurrentPkg, {
          organizationId: orgId,
          kmGlobalAnchorSetDigestHex: "f".repeat(64),
          idempotencyKey: concurrentKey,
        }),
        persistPredictivePackageV2(sql, concurrentPkg, {
          organizationId: orgId,
          kmGlobalAnchorSetDigestHex: "f".repeat(64),
          idempotencyKey: concurrentKey,
        }),
      ]);
      expect(concurrent[1]).toEqual(concurrent[0]);

      const lateFailureKey = "dee-633-late-rollback";
      await sql.unsafe(`
        CREATE OR REPLACE FUNCTION dee633_inject_artifact_failure() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'DEE633_INJECTED_LATE_FAILURE'; END $$;
        CREATE TRIGGER dee633_inject_artifact_failure
        BEFORE INSERT ON trader_forecast_replica_artifact_v2
        FOR EACH ROW EXECUTE FUNCTION dee633_inject_artifact_failure();
      `);
      try {
        const lateFailurePkg = buildPredictivePackageV1({
          family: { ...family, codeReleaseSha: "a".repeat(40) },
          sourceCorpus: Array.from({ length: 120 }, (_, i) => anchor(i)),
          kConfigDec: 3,
          mConfigDec: 4,
        });
        await expect(
          persistPredictivePackageV2(sql, lateFailurePkg, {
            organizationId: orgId,
            kmGlobalAnchorSetDigestHex: "f".repeat(64),
            idempotencyKey: lateFailureKey,
          }),
        ).rejects.toThrow(/DEE633_INJECTED_LATE_FAILURE/);
      } finally {
        await sql.unsafe(`
          DROP TRIGGER IF EXISTS dee633_inject_artifact_failure ON trader_forecast_replica_artifact_v2;
          DROP FUNCTION IF EXISTS dee633_inject_artifact_failure();
        `);
      }
      const leakedRows = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM trader_forecast_predictive_package_v2
        WHERE organization_id = ${orgId}::uuid AND idempotency_key = ${lateFailureKey}
      `;
      expect(leakedRows[0]?.count).toBe("0");

      const issuance = issueForecastV1({
        pkg,
        anchorClosedBarEpochMs: 1_700_000_360_000,
        anchorRealizedVol20m_1m: 0.015,
        executionHorizonMinutes: family.executionHorizonMinutes,
        normalizationVersionDigestHex: family.normalizationVersionDigestHex,
      });
      verifyForecastDistributionReplayV1({
        issuance,
        expectedDistributionSemanticDigestExec: issuance.distributionSemanticDigestExec,
      });

      const bundle = await persistForecastBundleV2(sql, {
        organizationId: orgId,
        packageId: persistedPackage.packageId,
        runId: "fv2-persist-run",
        cycleId: "0",
        symbol: family.symbol,
        anchorClosedBarEpochMs: issuance.anchorClosedBarEpochMs,
        issuance,
      });

      const packageRows = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM trader_forecast_predictive_package_v2 WHERE organization_id = ${orgId}::uuid
      `;
      const artifactRows = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM trader_forecast_replica_artifact_v2 WHERE organization_id = ${orgId}::uuid
      `;
      const forecastRows = await sql<{ target_role_id: string }[]>`
        SELECT target_role_id FROM trader_forecast_v2 WHERE bundle_id = ${bundle.bundleId}::uuid
      `;

      expect(Number(packageRows[0]?.count ?? 0)).toBe(2);
      expect(Number(artifactRows[0]?.count ?? 0)).toBe(6);
      expect(forecastRows.map((r) => r.target_role_id).sort()).toEqual([
        "EXECUTION_OPPORTUNITY",
        "TERMINAL_RETURN",
      ]);

      const roundTrip = await verifyPersistedForecastV2RoundTrip({
        sql,
        organizationId: orgId,
        bundleId: bundle.bundleId,
        packageId: persistedPackage.packageId,
        issuance,
      });

      expect(roundTrip.replayDigestMatch).toBe(true);
      // Issuance seal: 7 Terminal scenarios; outcomes/calibration arrive later (append-only).
      expect(roundTrip.loadedDigests.terminalScenarioCount).toBe(7);
      expect(roundTrip.loadedDigests.calibrationObservationCount).toBe(0);
      expect(roundTrip.loadedDigests.replicaArtifactCount).toBe(3);

      const outcomeCount = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM trader_forecast_outcome_v2
        WHERE organization_id = ${orgId}::uuid AND bundle_id = ${bundle.bundleId}::uuid
      `;
      expect(Number(outcomeCount[0]?.count ?? 0)).toBe(0);

      // DDL insert-legal value when outcomes absent — not a promotion lifecycle.
      const completeness = await sql<{ completeness_state: string }[]>`
        SELECT completeness_state
        FROM trader_forecast_bundle_v2
        WHERE organization_id = ${orgId}::uuid AND id = ${bundle.bundleId}::uuid
      `;
      expect(completeness[0]?.completeness_state).toBe("INCOMPLETE");

      const scenarios = await sql<
        {
          scenario_ordinal: number;
          lower_bound_scale8: string | null;
          upper_bound_scale8: string | null;
        }[]
      >`
        SELECT scenario_ordinal, lower_bound_scale8::text AS lower_bound_scale8,
               upper_bound_scale8::text AS upper_bound_scale8
        FROM trader_forecast_scenario_v2
        WHERE organization_id = ${orgId}::uuid AND forecast_id = ${bundle.terminalForecastId}::uuid
        ORDER BY scenario_ordinal
      `;
      expect(scenarios).toHaveLength(7);
      expect(scenarios[0]?.lower_bound_scale8).toBeNull();
      expect(scenarios[6]?.upper_bound_scale8).toBeNull();
      expect(scenarios[0]?.upper_bound_scale8).not.toBeNull();
      expect(scenarios[6]?.lower_bound_scale8).not.toBeNull();

      const buckets = await sql<
        {
          bucket_ordinal: number;
          tail_semantics: string;
          lower_bound_scale8: string | null;
          upper_bound_scale8: string | null;
        }[]
      >`
        SELECT bucket_ordinal, tail_semantics, lower_bound_scale8, upper_bound_scale8
        FROM trader_forecast_target_bucket_v2
        WHERE organization_id = ${orgId}::uuid
          AND target_definition_id = ${persistedPackage.terminalTargetDefinitionId}::uuid
        ORDER BY bucket_ordinal
      `;
      expect(buckets).toHaveLength(7);
      expect(buckets[0]?.tail_semantics).toBe("LOWER_TAIL");
      expect(buckets[0]?.lower_bound_scale8).toBeNull();
      expect(buckets[6]?.tail_semantics).toBe("UPPER_TAIL");
      expect(buckets[6]?.upper_bound_scale8).toBeNull();
      for (let i = 1; i <= 5; i += 1) {
        expect(buckets[i]?.tail_semantics).toBe("INTERIOR");
        expect(buckets[i]?.lower_bound_scale8).not.toBeNull();
        expect(buckets[i]?.upper_bound_scale8).not.toBeNull();
      }

      // Delayed objective resolution: append-only; no COMPLETE promotion required.
      const observedOutcomeDigestHex = createHash("sha256")
        .update("observed-outcome-terminal")
        .digest("hex");
      const contentDigestHex = createHash("sha256")
        .update("outcome-content-terminal")
        .digest("hex");
      const pitMeasurementIdentityDigestHex = createHash("sha256")
        .update("pit-measurement-terminal")
        .digest("hex");
      const eligibleIso = new Date(
        issuance.anchorClosedBarEpochMs + (family.primaryHorizonMinutes + 3) * 60_000 + 1,
      ).toISOString();
      const scientific = await persistScientificForPackage(sql, orgId, pkg, "durable-runtime-input");
      const runtimeInput = buildRuntimeInput(orgId, pkg,
        new Date(issuance.anchorClosedBarEpochMs).toISOString(), scientific,
        issuance.anchorRealizedVol20m_1m);
      const runtimeBinding = runtimeInput.forecastContractBinding;
      if (!runtimeBinding) throw new Error("canonical runtime binding missing");
      await persistForecastContractBindingV1(sql, {
        ...buildForecastContractBindingRecordV1({
          organizationId: orgId,
          scientificAdmissionReceiptId: scientific.id,
          scientificAdmissionReceiptContentDigestHex: scientific.contentDigestHex,
          selectedPredictivePackageContentDigestHex: runtimeBinding.selectedPredictivePackageContentDigestHex,
          inputContract: runtimeBinding.inputContract,
          modelSpec: runtimeBinding.modelSpec,
          modelArtifact: runtimeBinding.modelArtifact,
        }),
        binding: runtimeBinding,
        bindingJson: canonicalizeSemanticJsonString(runtimeBinding),
      });
      const authorizedOutcome = issueForecastRuntimeV2(runtimeInput);
      if (authorizedOutcome.status !== "FORECAST_AUTHORIZED") {
        throw new Error("expected exact authorized runtime input fixture");
      }
      const objectiveEvidence = {
        organizationId: orgId,
        symbol: family.symbol,
        primaryHorizonMinutes: family.primaryHorizonMinutes,
        anchorClosedBarEpochMs: issuance.anchorClosedBarEpochMs,
        resolvedAt: eligibleIso,
        pitEvidenceBoundary: eligibleIso,
        observedTerminalReturn: 0,
        observedOutcomeDigestHex,
        pitMeasurementIdentityDigestHex,
        knowledgeEdgeId: authorizedOutcome.authority.knowledgeEdgeId,
        knowledgeContentDigestHex: authorizedOutcome.authority.knowledgeContentDigestHex,
      };
      const scoredObservation = scoreForecastV2MulticlassObservation({
        authorizedOutcome,
        objectiveEvidence,
      });
      const objectiveResolutionInput = {
        organizationId: orgId,
        bundleId: bundle.bundleId,
        forecastId: bundle.terminalForecastId,
        targetRoleId: "TERMINAL_RETURN",
        resolvedAtIso: eligibleIso,
        anchorClosedBarEpochMs: issuance.anchorClosedBarEpochMs,
        primaryHorizonMinutes: family.primaryHorizonMinutes,
        observedOutcomeDigestHex,
        contentDigestHex,
        pitMeasurementIdentityDigestHex,
        feedbackPayload: {
          authorizedOutcome,
          objectiveEvidence,
        },
      } as const;
      const receipt = qualifyHtxKlineVolumeAuthority({
        symbol: "BTC/USDT",
        qualifiedAtUtc: new Date(issuance.anchorClosedBarEpochMs).toISOString(),
        rows: [
          { id: 1, open: 100, high: 101, low: 99, close: 100, amount: 2, vol: 200, count: 1 },
          { id: 2, open: 100, high: 101, low: 99, close: 100, amount: 3, vol: 300, count: 1 },
        ],
      });
      const durableConfig = {
        sql,
        kmGlobalAnchorSetDigestHex: "f".repeat(64),
        priorMachineRecommendedConfidence: "0.5000",
        provenance: {
          codeSha: "d".repeat(40), datasetContentDigest: "e".repeat(64),
          profileDigest: "f".repeat(64), canonicalizer: "HTR_SEMANTIC_CANONICAL_JSON_V1",
        },
        resolveVolumeAuthorityReceipt: () => receipt,
      } as const;
      let durable = createForecastV2DurableProducerV1(durableConfig);
      const barAt = (offset: number): Bar => {
        const closeEpochMs = issuance.anchorClosedBarEpochMs + offset * 60_000;
        return {
          symbol: family.symbol, interval: "1m", open: "100", high: "101", low: "99",
          close: String(100 + offset / 100), volume: "2",
          barOpenTime: new Date(closeEpochMs - 60_000).toISOString(),
          barCloseTime: new Date(closeEpochMs).toISOString(),
        };
      };
      const sparseOffsets = [...Array.from({ length: 34 }, (_, offset) => offset), 70];
      for (const offset of sparseOffsets) {
        if (offset === 10) durable = createForecastV2DurableProducerV1(durableConfig);
        const closeEpochMs = issuance.anchorClosedBarEpochMs + offset * 60_000;
        const bar = barAt(offset);
        await durable.processCycle({
          organizationId: orgId,
          runId: "fv2-durable-one-bar-run",
          cycleId: `durable-${offset}`,
          pitAnchor: new Date(closeEpochMs).toISOString(),
          bars: offset === 5 ? [bar, { ...bar, interval: "15m" }] : [bar],
          sequence: offset,
          outcome: offset === 0 ? authorizedOutcome : null,
          runtimeInput: offset === 0 ? runtimeInput : undefined,
        });
        const counts = await sql<{ count: string }[]>`
          SELECT count(*)::text AS count FROM trader_forecast_outcome_v2 o
          JOIN trader_forecast_bundle_v2 b ON b.id = o.bundle_id AND b.organization_id = o.organization_id
          WHERE b.organization_id = ${orgId}::uuid AND b.run_id = 'fv2-durable-one-bar-run'
        `;
        expect(Number(counts[0]?.count ?? 0)).toBe(offset < 70 ? 0 : 1);
      }
      const durableRetry = await persistForecastBundleV2(sql, {
        organizationId: orgId,
        packageId: persistedPackage.packageId,
        runId: "fv2-durable-one-bar-run",
        cycleId: "durable-0",
        symbol: family.symbol,
        anchorClosedBarEpochMs: authorizedOutcome.authority.anchorClosedBarEpochMs,
        issuance: authorizedOutcome.issuance,
        authorizedOutcome,
        runtimeInput,
        issuanceSequence: 0,
      });
      expect(durableRetry.retriedExisting).toBe(true);
      const changedKnowledgeAuthorityBody = {
        ...authorizedOutcome.authority,
        knowledgeContentDigestHex: "7".repeat(64),
        contentDigestHex: undefined,
      };
      const { contentDigestHex: _discarded, ...changedKnowledgeAuthority } =
        changedKnowledgeAuthorityBody;
      void _discarded;
      await expect(
        persistForecastBundleV2(sql, {
          organizationId: orgId,
          packageId: persistedPackage.packageId,
          runId: "fv2-durable-one-bar-run",
          cycleId: "durable-0",
          symbol: family.symbol,
          anchorClosedBarEpochMs: authorizedOutcome.authority.anchorClosedBarEpochMs,
          issuance: authorizedOutcome.issuance,
          authorizedOutcome: {
            ...authorizedOutcome,
            authority: {
              ...changedKnowledgeAuthority,
              contentDigestHex: computeSemanticSha256Hex(changedKnowledgeAuthority),
            },
          },
          runtimeInput,
          issuanceSequence: 0,
        }),
      ).rejects.toThrow(/runtime input does not reproduce authorized outcome/);
      const wrongReceipt = qualifyHtxKlineVolumeAuthority({
        symbol: "ETHUSDT",
        qualifiedAtUtc: new Date(issuance.anchorClosedBarEpochMs).toISOString(),
        rows: [
          { id: 1, open: 100, high: 101, low: 99, close: 100, amount: 2, vol: 200, count: 1 },
          { id: 2, open: 100, high: 101, low: 99, close: 100, amount: 3, vol: 300, count: 1 },
        ],
      });
      const wrongSymbolProducer = createForecastV2DurableProducerV1({
        ...durableConfig,
        resolveVolumeAuthorityReceipt: () => wrongReceipt,
      });
      for (const offset of [0, 30, 31, 32, 33]) {
        await wrongSymbolProducer.processCycle({
          organizationId: orgId,
          runId: "fv2-wrong-symbol-run",
          cycleId: `wrong-symbol-${offset}`,
          pitAnchor: barAt(offset).barCloseTime,
          bars: [barAt(offset)],
          sequence: offset,
          outcome: offset === 0 ? authorizedOutcome : null,
          runtimeInput: offset === 0 ? runtimeInput : undefined,
        });
      }
      await expect(
        wrongSymbolProducer.processCycle({
          organizationId: orgId,
          runId: "fv2-wrong-symbol-run",
          cycleId: "wrong-symbol-70",
          pitAnchor: barAt(70).barCloseTime,
          bars: [barAt(70)],
          sequence: 70,
          outcome: null,
        }),
      ).rejects.toThrow(/VOLUME_AUTHORITY_SYMBOL_MISMATCH/);
      const partitionedProducer = createForecastV2DurableProducerV1(durableConfig);
      await partitionedProducer.processCycle({
        organizationId: orgId,
        runId: "fv2-partition-a",
        cycleId: "partition-a-0",
        pitAnchor: barAt(0).barCloseTime,
        bars: [barAt(0)],
        sequence: 0,
        outcome: authorizedOutcome,
        runtimeInput,
      });
      await partitionedProducer.processCycle({
        organizationId: orgId,
        runId: "fv2-partition-b",
        cycleId: "partition-b-70",
        pitAnchor: barAt(70).barCloseTime,
        bars: [30, 31, 32, 33, 70].map(barAt),
        sequence: 70,
        outcome: null,
      });
      const partitionALeaks = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM trader_forecast_outcome_v2 o
        JOIN trader_forecast_bundle_v2 b
          ON b.organization_id = o.organization_id AND b.id = o.bundle_id
        WHERE b.organization_id = ${orgId}::uuid AND b.run_id = 'fv2-partition-a'
      `;
      expect(partitionALeaks[0]?.count).toBe("0");
      await expect(sql`
        UPDATE trader_forecast_pit_bar_v2
        SET bar_content_digest = ${"0".repeat(64)}
        WHERE organization_id = ${orgId}::uuid
          AND run_id = 'fv2-durable-one-bar-run'
      `).rejects.toThrow(/append-only/);
      await sql.unsafe("ALTER TABLE trader_forecast_pit_bar_v2 DISABLE TRIGGER USER");
      await sql`
        UPDATE trader_forecast_pit_bar_v2
        SET bar_json = jsonb_set(bar_json, '{close}', '"999"'::jsonb)
        WHERE organization_id = ${orgId}::uuid
          AND run_id = 'fv2-durable-one-bar-run'
          AND bar_close_time = ${barAt(0).barCloseTime}::timestamptz
      `;
      await sql.unsafe("ALTER TABLE trader_forecast_pit_bar_v2 ENABLE TRIGGER USER");
      const corruptedRestart = createForecastV2DurableProducerV1(durableConfig);
      await expect(
        corruptedRestart.processCycle({
          organizationId: orgId,
          runId: "fv2-durable-one-bar-run",
          cycleId: "durable-corrupted-restart",
          pitAnchor: barAt(71).barCloseTime,
          bars: [barAt(71)],
          sequence: 71,
          outcome: null,
        }),
      ).rejects.toThrow(/PERSISTED_PIT_BAR_IDENTITY_MISMATCH/);
      await expect(
        persistObjectiveForecastOutcomeResolutionV2(sql, {
          ...objectiveResolutionInput,
          feedbackPayload: {
            ...objectiveResolutionInput.feedbackPayload,
            objectiveEvidence: { ...objectiveEvidence, knowledgeEdgeId: "late-bound-edge" },
          },
        }),
      ).rejects.toThrow(/IDENTITY_MISMATCH/);
      await expect(
        persistObjectiveForecastOutcomeResolutionV2(sql, {
          ...objectiveResolutionInput,
          feedbackPayload: {
            ...objectiveResolutionInput.feedbackPayload,
            objectiveEvidence: {
              ...objectiveEvidence,
              pitEvidenceBoundary: authorizedOutcome.authority.anchorClosedBarAt,
            },
          },
        }),
      ).rejects.toThrow(/PIT_MISMATCH/);
      await persistObjectiveForecastOutcomeResolutionV2(sql, objectiveResolutionInput);
      await persistObjectiveForecastOutcomeResolutionV2(sql, objectiveResolutionInput);
      await expect(
        persistObjectiveForecastOutcomeResolutionV2(sql, {
          ...objectiveResolutionInput,
          contentDigestHex: "9".repeat(64),
        }),
      ).rejects.toThrow(/objective outcome natural-idempotent conflict/);
      const calibrationContentDigestHex = scoredObservation.contentDigest;
      const calibrationObservationInput = {
        organizationId: orgId,
        bundleId: bundle.bundleId,
        forecastId: bundle.terminalForecastId,
        targetRoleId: "TERMINAL_RETURN",
        contentDigestHex: calibrationContentDigestHex,
        scoringEligible: true,
        observation: scoredObservation,
      } as const;
      await expect(
        persistForecastCalibrationObservationV2(sql, {
          ...calibrationObservationInput,
          observation: { ...scoredObservation, normalizedBrierScore: "0" },
        }),
      ).rejects.toThrow(/CALIBRATION_OBSERVATION_INVALID/);
      await persistForecastCalibrationObservationV2(sql, calibrationObservationInput);
      await persistForecastCalibrationObservationV2(sql, calibrationObservationInput);
      await expect(
        persistForecastCalibrationObservationV2(sql, {
          ...calibrationObservationInput,
          contentDigestHex: "a".repeat(64),
          observation: undefined,
        }),
      ).rejects.toThrow(/calibration natural-idempotent conflict/);
      const feedbackRows = await sql<{
        observed_bucket_ordinal: number;
        pit_digest: string;
        scoring_version: string;
        probability_count: number;
      }[]>`
        SELECT o.observed_bucket_ordinal,
               encode(o.pit_measurement_identity_digest, 'hex') AS pit_digest,
               c.scoring_version,
               jsonb_array_length(c.probability_vector_json)::int AS probability_count
        FROM trader_forecast_outcome_v2 o
        JOIN trader_forecast_calibration_observation_v2 c
          ON c.organization_id = o.organization_id AND c.forecast_id = o.forecast_id
        WHERE o.organization_id = ${orgId}::uuid
          AND o.forecast_id = ${bundle.terminalForecastId}::uuid
      `;
      expect(feedbackRows[0]).toMatchObject({
        observed_bucket_ordinal: scoredObservation.observedBucketOrdinal,
        pit_digest: pitMeasurementIdentityDigestHex,
        scoring_version: "waia.trader.forecast_v2_multiclass_scoring.v1",
        probability_count: 7,
      });
      const afterOutcome = await sql<{ completeness_state: string; count: string }[]>`
        SELECT b.completeness_state, count(o.forecast_id)::text AS count
        FROM trader_forecast_bundle_v2 b
        LEFT JOIN trader_forecast_outcome_v2 o
          ON o.bundle_id = b.id AND o.organization_id = b.organization_id
        WHERE b.organization_id = ${orgId}::uuid AND b.id = ${bundle.bundleId}::uuid
        GROUP BY b.completeness_state
      `;
      expect(afterOutcome[0]?.completeness_state).toBe("INCOMPLETE");
      expect(Number(afterOutcome[0]?.count ?? 0)).toBe(1);

      const closureInput = {
        organizationId: orgId,
        bundleId: bundle.bundleId,
        forecastId: bundle.terminalForecastId,
        objectiveOutcomeContentDigestHex: contentDigestHex,
        authorizedOutcome,
        objectiveEvidence,
        futureRunId: "fv2-future-run",
        futureCycleId: "fv2-future-cycle",
        futureCyclePitAnchor: new Date(Date.parse(eligibleIso) + 60_000).toISOString(),
        priorMachineRecommendedConfidence: "0.5000",
        provenance: {
          codeSha: "d".repeat(40),
          datasetContentDigest: "e".repeat(64),
          profileDigest: "f".repeat(64),
          canonicalizer: "HTR_SEMANTIC_CANONICAL_JSON_V1" as const,
        },
        sequence: 1,
      } as const;
      await persistForecastV2TerminalClosurePostgres(sql, closureInput);
      await persistForecastV2TerminalClosurePostgres(sql, closureInput);
      const knowledgeRows = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM trader_knowledge_confidence_update_record
        WHERE organization_id = ${orgId}::uuid
          AND knowledge_edge_id = ${authorizedOutcome.authority.knowledgeEdgeId}::uuid
      `;
      expect(Number(knowledgeRows[0]?.count ?? 0)).toBe(2);

      const rollbackBundle = await persistForecastBundleV2(sql, {
        organizationId: orgId,
        packageId: persistedPackage.packageId,
        runId: "fv2-rollback-run",
        cycleId: "rollback",
        symbol: family.symbol,
        anchorClosedBarEpochMs: issuance.anchorClosedBarEpochMs,
        issuance,
      });
      await expect(
        persistForecastV2TerminalClosurePostgres(sql, {
          ...closureInput,
          bundleId: rollbackBundle.bundleId,
          forecastId: rollbackBundle.terminalForecastId,
          futureRunId: "different-future-run",
        }),
      ).rejects.toThrow(/knowledge confidence update conflict/);
      const rolledBackRows = await sql<{ outcome_count: string; calibration_count: string }[]>`
        SELECT
          (SELECT count(*) FROM trader_forecast_outcome_v2 WHERE bundle_id = ${rollbackBundle.bundleId}::uuid)::text AS outcome_count,
          (SELECT count(*) FROM trader_forecast_calibration_observation_v2 WHERE bundle_id = ${rollbackBundle.bundleId}::uuid)::text AS calibration_count
      `;
      expect(rolledBackRows[0]).toEqual({ outcome_count: "0", calibration_count: "0" });
    });

    it("closes a sealed Forecast-V2 issuance through the real runBacktest caller", async () => {
      const session = await createInMemoryResearchBacktestSession();
      try {
        const db = getDb();
        insertEmailPasswordUser(db, {
          id: WP518_PG_USER,
          email: "dee633-real-backtest@waia.invalid",
          password: "password123",
          identityLabel: "DEE-633 real backtest",
        });
        const sqliteOrgId = ensureUserCoreSeedSqlite(db, {
          userId: WP518_PG_USER,
          displayName: "DEE-633 real backtest",
        });
        expect(sqliteOrgId).toBe(orgId);
        const bars: Bar[] = Array.from({ length: 60 }, (_, offset) => {
          const closeEpochMs = 1_800_000_060_000 + offset * 60_000;
          return {
            symbol: "BTC/USDT",
            interval: "1m",
            open: "100",
            high: "101",
            low: "99",
            close: String(100 + offset / 100),
            volume: "2",
            barOpenTime: new Date(closeEpochMs - 60_000).toISOString(),
            barCloseTime: new Date(closeEpochMs).toISOString(),
          };
        });
        const family = { ...buildFamily(), organizationId: orgId };
        const pkg = buildPredictivePackageV1({
          family,
          sourceCorpus: Array.from({ length: 120 }, (_, i) => {
            const source = anchor(i);
            const outcome13d = [...source.outcome13d];
            for (let component = 0; component <= 2; component += 1) outcome13d[component] = 0;
            for (let component = 3; component <= 6; component += 1) {
              outcome13d[component] = 0.05 + (i % 7) * 0.0004;
            }
            for (let component = 7; component <= 12; component += 1) outcome13d[component] = 10;
            return { ...source, outcome13d };
          }),
          kConfigDec: 3,
          mConfigDec: 4,
        });
        const issuanceBar = bars[19]!;
        const secondIssuanceBar = bars[20]!;
        const scientific = await persistScientificForPackage(sql, orgId, pkg, "real-backtest");
        const runtimeInput = buildRuntimeInput(orgId, pkg, issuanceBar.barCloseTime, scientific);
        const secondRuntimeInput = buildRuntimeInput(orgId, pkg, secondIssuanceBar.barCloseTime, scientific);
        const runtimeBinding = runtimeInput.forecastContractBinding;
        if (!runtimeBinding) throw new Error("canonical runtime binding missing");
        await persistForecastContractBindingV1(sql, {
          ...buildForecastContractBindingRecordV1({
            organizationId: orgId,
            scientificAdmissionReceiptId: scientific.id,
            scientificAdmissionReceiptContentDigestHex: scientific.contentDigestHex,
            selectedPredictivePackageContentDigestHex: runtimeBinding.selectedPredictivePackageContentDigestHex,
            inputContract: runtimeBinding.inputContract, modelSpec: runtimeBinding.modelSpec,
            modelArtifact: runtimeBinding.modelArtifact,
          }), binding: runtimeBinding, bindingJson: canonicalizeSemanticJsonString(runtimeBinding),
        });
        const receipt = qualifyHtxKlineVolumeAuthority({
          symbol: "BTCUSDT",
            qualifiedAtUtc: issuanceBar.barCloseTime,
          rows: [
            { id: 1, open: 100, high: 101, low: 99, close: 100, amount: 2, vol: 200, count: 1 },
            { id: 2, open: 100, high: 101, low: 99, close: 100, amount: 3, vol: 300, count: 1 },
          ],
        });
        session.historicalExecutionProfile.htxVolumeAuthorityReceipt = receipt;
        await runBacktest({
          context: requireOrgContext(orgId),
          barSource: new HistoricalBarReplaySource({ bars, cycleIdPrefix: "dee633-real" }),
          deps: session.deps,
          orderRepository: session.orderRepository,
          accountKey: "dee633-real",
          defaultQuantity: "0.01",
          costModel: createCostModelV1("0", "0"),
          strategySignalIds: [MEAN_REVERSION_V0],
          strategyId: MEAN_REVERSION_V0,
          strategyVersion: "0.1.0",
          regimeLabel: "AGGREGATE",
          datasetId: "dee633-real",
          runId: "dee633-real-backtest",
          split: "validation",
          window: { start: new Date(bars[0]!.barOpenTime), end: new Date(bars.at(-1)!.barCloseTime) },
          accountState: createHtrInitialAccountRiskState(),
          exportedAt: new Date(bars.at(-1)!.barCloseTime),
          historicalExecutionProfile: session.historicalExecutionProfile,
          maxCycles: bars.length,
          enableReplayFusedContext: false,
          activeStrategyIds: ["__htr-blocked__"],
          forecastV2Producer: {
            sql,
            kmGlobalAnchorSetDigestHex: "f".repeat(64),
            priorMachineRecommendedConfidence: "0.5000",
            runtimeInputsByAnchorClosedBarEpochMs: new Map([
              [Date.parse(issuanceBar.barCloseTime), runtimeInput],
              [Date.parse(secondIssuanceBar.barCloseTime), secondRuntimeInput],
            ]),
            provenance: {
              codeSha: "d".repeat(40),
              datasetContentDigest: "e".repeat(64),
              profileDigest: "f".repeat(64),
              canonicalizer: "HTR_SEMANTIC_CANONICAL_JSON_V1",
            },
          },
        });
        const rows = await sql<{ outcomes: string; calibrations: string }[]>`
          SELECT count(DISTINCT o.forecast_id)::text AS outcomes,
                 count(DISTINCT c.forecast_id)::text AS calibrations
          FROM trader_forecast_bundle_v2 b
          LEFT JOIN trader_forecast_outcome_v2 o
            ON o.organization_id = b.organization_id AND o.bundle_id = b.id
          LEFT JOIN trader_forecast_calibration_observation_v2 c
            ON c.organization_id = b.organization_id AND c.bundle_id = b.id
          WHERE b.organization_id = ${orgId}::uuid AND b.run_id = 'dee633-real-backtest'
        `;
        expect(rows[0]).toMatchObject({ outcomes: "2", calibrations: "2" });

        const issued = await sql<{ forecast_id: string; cycle_id: string; authority_digest: string; pit_anchor: Date | string }[]>`
          SELECT s.execution_forecast_id::text AS forecast_id, s.cycle_id,
                 s.forecast_authority_content_digest_hex AS authority_digest, s.pit_anchor
          FROM trader_forecast_runtime_input_source_v2 s
          WHERE s.organization_id=${orgId}::uuid AND s.run_id='dee633-real-backtest'
          ORDER BY s.pit_anchor`;
        expect(issued).toHaveLength(2);
        // The backtest session owns its mutable profile receipt.  The sealed
        // historical graph receives a separate immutable qualification receipt.
        const modeledReceipt = qualifyHtxKlineVolumeAuthority({ symbol: "BTCUSDT",
          qualifiedAtUtc: issuanceBar.barCloseTime,
          rows: [{ id: 1, open: 100, high: 101, low: 99, close: 100, amount: 2, vol: 200, count: 1 }] });
        assertHtxVolumeAuthorityQualified(modeledReceipt);
        const cycle = sealHistoricalMarketCycleV2({ cycleId: issued[0]!.cycle_id, barIndex: 0,
          closedBar: issuanceBar, htxVolumeAuthorityReceipt: modeledReceipt,
          htxVolumeRaw: { amount: 2, vol: 200 } });
        const secondCycle = sealHistoricalMarketCycleV2({ cycleId: issued[1]!.cycle_id, barIndex: 1,
          closedBar: secondIssuanceBar, htxVolumeAuthorityReceipt: modeledReceipt,
          htxVolumeRaw: { amount: 2, vol: 200 } });
        const datasetRoot = createCanonicalDatasetFixture(orgId, [issuanceBar, secondIssuanceBar]);
        try {
          const verification = createCanonicalDecisionVerificationReceiptServiceV2(sql);
          const datasetIds = await verification.registerDatasetAuthority({ datasetRoot, organizationId: orgId,
            runId: "dee633-real-backtest", partition: "DEVELOPMENT", symbol: "BTCUSDT", cycles: [cycle, secondCycle] });
          const datasetAuthorityId = datasetIds.get(cycle.cycleId)!;
          const state = createInitialAccountingState({ organizationId: orgId,
            accountKey: "dee633-real", runId: "dee633-real-backtest", frontierAsOf: issuanceBar.barCloseTime });
          const base = { ...state, id: randomUUID(), sourceFillId: null,
            sourceEconomicsDigest: "0".repeat(64), idempotencyKey: randomUUID() };
          const frontier = { ...base, semanticContentDigest: computeAccountingSemanticDigest(base as AccountingFrontierV1) } as AccountingFrontierV1;
          await createAccountingFrontierRepositoryPostgres(getPostgresDrizzle()).append(requireOrgContext(orgId), frontier);
          const policyConfig = {
              policyInstanceId: "0189-policy", interimPositionPolicyId: "fixed-horizon-qualification/unrepresentable-normal-exits-disabled/v1",
              sliceAllocationPolicy: "explicit-weights-last-slice-remainder-no-top-up/v1", roundingPolicy: "scale8-floor-step-truncate-half-up/v1",
              entrySliceOffsets: [1, 2, 3], entrySliceWeights: ["0.4", "0.3", "0.3"],
              exitSliceOffsetsAfterHorizon: [1, 2, 3], exitSliceWeights: ["0.4", "0.3", "0.3"],
              participationCapFraction: "0.1", quantityStep: "0.0001", minimumQuantity: "0.0001",
              minimumNotionalUsdt: "1", entryCosts: { feeBps: "0", spreadBps: "0", impactBps: "0", slippageBps: "0", conservativeStressBps: "0" },
              exitCosts: { feeBps: "0", spreadBps: "0", impactBps: "0", slippageBps: "0", conservativeStressBps: "0" },
              partialFillPolicy: "EXPLICIT_CAPACITY_BOUNDED_NO_TOP_UP", unfilledEntryPolicy: "RETAIN_AS_CASH",
              postExitResidualPolicy: "SIZE_ECONOMICALLY_INADMISSIBLE",
            } as const;
          const prereg = await verification.preregisterExecution({ organizationId: orgId, accountId: "dee633-real",
            runId: "dee633-real-backtest", forecastId: issued[0]!.forecast_id,
            datasetAuthorityId, cycleId: cycle.cycleId, policyConfig, defaultQuantity: "0.1",
            initialAccountingFrontierId: frontier.id });
          await verification.startRun({ organizationId: orgId, accountId: "dee633-real",
            runId: "dee633-real-backtest", preregistrationId: prereg.preregistrationId,
            datasetSealDigestHex: prereg.datasetSealDigestHex });
          await verification.issueForecast({ organizationId: orgId, forecastId: issued[0]!.forecast_id,
            subjectContentDigestHex: issued[0]!.authority_digest });
          await verification.issueScientific({ organizationId: orgId, runId: "dee633-real-backtest",
            forecastId: issued[0]!.forecast_id,
            scientificAdmissionContentDigestHex: scientific.contentDigestHex });
          const executionPayoffVerification = await verification.issueExecution({ preregistrationId: prereg.preregistrationId,
            organizationId: orgId, accountId: "dee633-real", runId: "dee633-real-backtest",
            forecastId: issued[0]!.forecast_id, datasetSealDigestHex: prereg.datasetSealDigestHex,
            pitAnchor: issuanceBar.barCloseTime, subjectContentDigestHex: {
              anchor: prereg.authorities.anchor.contentDigestHex,
              executablePolicy: prereg.authorities.executablePolicy.contentDigestHex,
              economicSize: prereg.authorities.economicSize.contentDigestHex,
              cash: prereg.authorities.cash.contentDigestHex,
            } });
          const verificationPort = createPostgresCanonicalDecisionVerificationReceiptPortV2(sql);
          const forecastVerification = await verificationPort.loadForecastVerification({ organizationId: orgId,
            forecastId: issued[0]!.forecast_id, subjectContentDigestHex: issued[0]!.authority_digest });
          const scientificAdmission = await readScientificAdmissionReceiptV1(sql, { organizationId: orgId,
            evidenceSemanticDigestHex: scientific.evidenceSemanticDigestHex });
          if (!scientificAdmission) throw new Error("scientific admission missing");
          const scientificVerification = await verificationPort.loadScientificVerification({ organizationId: orgId,
            forecastId: issued[0]!.forecast_id,
            scientificAdmissionContentDigestHex: scientificAdmission.contentDigest });
          const issuance = await sql<{ digest: string }[]>`
            SELECT encode(bundle_content_digest,'hex') digest FROM trader_forecast_bundle_v2
            WHERE organization_id=${orgId}::uuid AND cycle_id=${cycle.cycleId}`;
          await createPostgresDee659AuthorityRepositoryV2({ sql, verificationReceipts: verificationPort }).persist({
            organizationId: orgId, accountId: "dee633-real", runId: "dee633-real-backtest",
            cycleId: cycle.cycleId, forecastId: issued[0]!.forecast_id,
            forecastAuthorityContentDigestHex: issued[0]!.authority_digest,
            datasetSealDigestHex: prereg.datasetSealDigestHex,
            dee659PreregistrationId: prereg.preregistrationId, pitAnchor: issuanceBar.barCloseTime,
            forecastIssuanceReceiptDigestHex: issuance[0]!.digest,
            forecastVerificationReceiptDigestHex: forecastVerification.verificationReceiptDigestHex,
            scientificAdmission,
            scientificVerificationReceiptDigestHex: scientificVerification.verificationReceiptDigestHex,
            anchorAuthority: prereg.authorities.anchor,
            executablePolicy: prereg.authorities.executablePolicy,
            economicSizeSet: prereg.authorities.economicSize,
            cashAuthority: prereg.authorities.cash, executionPayoffVerification,
          });
          const produce = createPostgresHistoricalForecastInputPitProducerV2(sql);
          const firstProductionInput = { organizationId: orgId, runId: "dee633-real-backtest",
            cycleId: cycle.cycleId, forecastId: issued[0]!.forecast_id, symbol: "BTCUSDT",
            pitAnchor: issuanceBar.barCloseTime, datasetAuthorityId } as const;
          const firstRace = await Promise.all([produce(firstProductionInput), produce(firstProductionInput)]);
          expect(firstRace[0].contentDigestHex).toBe(firstRace[1].contentDigestHex);
          const record = firstRace[0];
          const persistedCount = await sql<{ count: string }[]>`SELECT count(*)::text AS count
            FROM trader_historical_forecast_input_pit_v2 WHERE organization_id=${orgId}::uuid
              AND run_id=${record.runId} AND cycle_id=${record.cycleId}`;
          expect(persistedCount[0]?.count).toBe("1");
          const load = createPostgresHistoricalForecastInputPitLoaderV2(sql);
          const loaded = await load({ organizationId: orgId, runId: record.runId, cycleId: record.cycleId,
            forecastId: record.forecastId, symbol: record.symbol, pitAnchor: record.pitAnchor,
            knowledgeContentDigestHex: record.knowledgeContentDigestHex,
            forecastAuthorityContentDigestHex: record.forecastAuthorityContentDigestHex,
            datasetAuthorityId: record.datasetAuthorityId });
          expect(loaded).toEqual(runtimeInput);
          const committedCycle = await runHistoricalSimulationNextCyclePostgresV2({ sql,
            organizationId: orgId, accountId: "dee633-real", runId: "dee633-real-backtest",
            partition: "DEVELOPMENT", symbol: "BTCUSDT", expectedCycleSequence: 0 });
          expect(committedCycle).toMatchObject({ committedCycleId: cycle.cycleId,
            nextCycleSequence: 1, nextRecordIndex: 1 });
          const exactRetry = await runHistoricalSimulationNextCyclePostgresV2({ sql,
            organizationId: orgId, accountId: "dee633-real", runId: "dee633-real-backtest",
            partition: "DEVELOPMENT", symbol: "BTCUSDT", expectedCycleSequence: 0 });
          expect(exactRetry).toEqual(committedCycle);
          const secondDatasetAuthorityId = datasetIds.get(secondCycle.cycleId)!;
          const secondPrereg = await verification.preregisterExecution({ organizationId: orgId, accountId: "dee633-real",
            runId: "dee633-real-backtest", forecastId: issued[1]!.forecast_id,
            datasetAuthorityId: secondDatasetAuthorityId, cycleId: secondCycle.cycleId, policyConfig,
            defaultQuantity: "0.1", initialAccountingFrontierId: frontier.id });
          await verification.issueForecast({ organizationId: orgId, forecastId: issued[1]!.forecast_id,
            subjectContentDigestHex: issued[1]!.authority_digest });
          await verification.issueScientific({ organizationId: orgId, runId: "dee633-real-backtest",
            forecastId: issued[1]!.forecast_id, scientificAdmissionContentDigestHex: scientific.contentDigestHex });
          const secondExecutionVerification = await verification.issueExecution({ preregistrationId: secondPrereg.preregistrationId,
            organizationId: orgId, accountId: "dee633-real", runId: "dee633-real-backtest",
            forecastId: issued[1]!.forecast_id, datasetSealDigestHex: secondPrereg.datasetSealDigestHex,
            pitAnchor: secondIssuanceBar.barCloseTime, subjectContentDigestHex: {
              anchor: secondPrereg.authorities.anchor.contentDigestHex,
              executablePolicy: secondPrereg.authorities.executablePolicy.contentDigestHex,
              economicSize: secondPrereg.authorities.economicSize.contentDigestHex,
              cash: secondPrereg.authorities.cash.contentDigestHex,
            } });
          const secondForecastVerification = await verificationPort.loadForecastVerification({ organizationId: orgId,
            forecastId: issued[1]!.forecast_id, subjectContentDigestHex: issued[1]!.authority_digest });
          const secondScientificVerification = await verificationPort.loadScientificVerification({ organizationId: orgId,
            forecastId: issued[1]!.forecast_id, scientificAdmissionContentDigestHex: scientificAdmission.contentDigest });
          const secondIssuance = await sql<{ digest: string }[]>`
            SELECT encode(bundle_content_digest,'hex') digest FROM trader_forecast_bundle_v2
            WHERE organization_id=${orgId}::uuid AND cycle_id=${secondCycle.cycleId}`;
          await createPostgresDee659AuthorityRepositoryV2({ sql, verificationReceipts: verificationPort }).persist({
            organizationId: orgId, accountId: "dee633-real", runId: "dee633-real-backtest",
            cycleId: secondCycle.cycleId, forecastId: issued[1]!.forecast_id,
            forecastAuthorityContentDigestHex: issued[1]!.authority_digest,
            datasetSealDigestHex: secondPrereg.datasetSealDigestHex,
            dee659PreregistrationId: secondPrereg.preregistrationId, pitAnchor: secondIssuanceBar.barCloseTime,
            forecastIssuanceReceiptDigestHex: secondIssuance[0]!.digest,
            forecastVerificationReceiptDigestHex: secondForecastVerification.verificationReceiptDigestHex,
            scientificAdmission, scientificVerificationReceiptDigestHex: secondScientificVerification.verificationReceiptDigestHex,
            anchorAuthority: secondPrereg.authorities.anchor,
            executablePolicy: secondPrereg.authorities.executablePolicy,
            economicSizeSet: secondPrereg.authorities.economicSize,
            cashAuthority: secondPrereg.authorities.cash, executionPayoffVerification: secondExecutionVerification,
          });
          const secondProductionInput = { organizationId: orgId, runId: "dee633-real-backtest",
            cycleId: secondCycle.cycleId, forecastId: issued[1]!.forecast_id, symbol: "BTCUSDT",
            pitAnchor: secondIssuanceBar.barCloseTime, datasetAuthorityId: secondDatasetAuthorityId } as const;
          await produce(secondProductionInput);
          const datasetParity = await sql<{ previous_authority: unknown; next_membership: unknown;
            volume_receipt: unknown }[]>`
            SELECT c.checkpoint_json->'datasetAuthority' previous_authority, d.membership_json next_membership,
              d.sealed_cycle_json->'htxVolumeAuthorityReceipt' volume_receipt
            FROM trader_historical_simulation_resume_checkpoint_v2 c
            JOIN trader_historical_dataset_authority_v2 d ON d.id=${secondDatasetAuthorityId}::uuid
            WHERE c.organization_id=${orgId}::uuid AND c.run_id='dee633-real-backtest'
              AND c.committed_cycle_sequence=0`;
          expect(datasetParity).toHaveLength(1);
          expect(datasetParity[0]!.volume_receipt).toEqual(modeledReceipt);
          const nextMembership = datasetParity[0]!.next_membership as Record<string, unknown>;
          expect(datasetParity[0]!.previous_authority).toEqual({
            manifestSemanticDigestHex: nextMembership.manifestSemanticDigestHex,
            sealReceiptDigestHex: nextMembership.sealReceiptDigestHex,
            partitionDigestHex: nextMembership.partitionDigestHex,
            partitionRawSha256Hex: nextMembership.partitionRawSha256Hex,
            split: nextMembership.partition,
            symbol: nextMembership.symbol,
          });
          const secondCommittedCycle = await runHistoricalSimulationNextCyclePostgresV2({ sql,
            organizationId: orgId, accountId: "dee633-real", runId: "dee633-real-backtest",
            partition: "DEVELOPMENT", symbol: "BTCUSDT", expectedCycleSequence: 1 });
          expect(secondCommittedCycle).toMatchObject({ committedCycleId: secondCycle.cycleId,
            nextCycleSequence: 2, nextRecordIndex: 2 });
          expect(await runHistoricalSimulationNextCyclePostgresV2({ sql,
            organizationId: orgId, accountId: "dee633-real", runId: "dee633-real-backtest",
            partition: "DEVELOPMENT", symbol: "BTCUSDT", expectedCycleSequence: 1 })).toEqual(secondCommittedCycle);
          const chronology = await sql<{ cycle_sequence: number; forecast_status: string; forecast_reasons: unknown;
            decision_status: string; decision_reasons: unknown; risk_status: string;
            execution_status: string; accounting_status: string; effect_count: number }[]>`
            SELECT cycle_sequence,forecast_json->>'status' forecast_status,forecast_json->'reasonCodes' forecast_reasons,
              decision_json->>'status' decision_status,decision_json->'reasonCodes' decision_reasons,risk_json->>'status' risk_status,
              execution_json->>'status' execution_status,accounting_json->>'status' accounting_status,
              jsonb_array_length(observed_execution_effects_json) effect_count
            FROM trader_historical_simulation_reason_ledger_v2
            WHERE organization_id=${orgId}::uuid AND account_id='dee633-real' AND run_id='dee633-real-backtest'
            ORDER BY cycle_sequence`;
          expect(chronology[0]).toMatchObject({ cycle_sequence: 0, decision_status: "ENTER_LONG",
            risk_status: "APPROVE", execution_status: "COMMITTED", accounting_status: "UNCHANGED", effect_count: 0 });
          expect(chronology[1]).toMatchObject({ cycle_sequence: 1, decision_status: "ENTER_LONG",
            risk_status: "APPROVE", accounting_status: "APPLIED" });
          expect(chronology[1]!.effect_count).toBeGreaterThan(0);
          const semanticChronology = await sql<{ accounting_digest: string; risk_accounting_digest: string | null;
            effect_status: string; report_count: number; fill_count: number;
            originating_decision_id: string; order_id: string }[]>`
            SELECT r.accounting_json->>'frontierContentDigestHex' accounting_digest,
              risk_artifact->'payload'->'sourcePayload'->>'accountingFrontierContentDigestHex' risk_accounting_digest,
              r.observed_execution_effects_json->0->>'status' effect_status,
              jsonb_array_length(r.observed_execution_effects_json->0->'reportContentDigestHexes') report_count,
              jsonb_array_length(r.observed_execution_effects_json->0->'fillContentDigestHexes') fill_count,
              r.observed_execution_effects_json->0->>'originatingDecisionId' originating_decision_id,
              r.observed_execution_effects_json->0->>'originatingOrderId' order_id
            FROM trader_historical_simulation_reason_ledger_v2 r
            JOIN trader_historical_simulation_atomic_stage_v2 s
              ON s.organization_id=r.organization_id AND s.account_id=r.account_id AND s.run_id=r.run_id
             AND s.cycle_sequence=r.cycle_sequence AND s.stage='MODELED_RISK'
            LEFT JOIN LATERAL (
              SELECT artifact risk_artifact FROM jsonb_array_elements(s.artifacts_json) artifact
              WHERE artifact->'payload'->>'sourceContentDigestHex'=r.risk_json->>'verdictContentDigestHex'
              LIMIT 1
            ) risk ON true
            WHERE r.organization_id=${orgId}::uuid AND r.account_id='dee633-real'
              AND r.run_id='dee633-real-backtest' AND r.cycle_sequence=1`;
          expect(semanticChronology).toHaveLength(1);
          expect(semanticChronology[0]!.risk_accounting_digest).not.toBeNull();
          expect(semanticChronology[0]!.risk_accounting_digest).toBe(semanticChronology[0]!.accounting_digest);
          expect(semanticChronology[0]).toMatchObject({ effect_status: "FILLED", report_count: 1, fill_count: 1 });
          expect(semanticChronology[0]!.originating_decision_id).toMatch(/^[0-9a-f-]{36}$/);
          expect(semanticChronology[0]!.order_id).toMatch(/^[0-9a-f-]{36}$/);
          const graphCounts = await sql<{ checkpoints: string; ledgers: string; stages: string; snapshots: string }[]>`
            SELECT
              (SELECT count(*)::text FROM trader_historical_simulation_resume_checkpoint_v2
                WHERE organization_id=${orgId}::uuid AND run_id='dee633-real-backtest') checkpoints,
              (SELECT count(*)::text FROM trader_historical_simulation_reason_ledger_v2
                WHERE organization_id=${orgId}::uuid AND run_id='dee633-real-backtest') ledgers,
              (SELECT count(*)::text FROM trader_historical_simulation_atomic_stage_v2
                WHERE organization_id=${orgId}::uuid AND run_id='dee633-real-backtest') stages,
              (SELECT count(*)::text FROM trader_historical_simulation_durable_snapshot_v2
                WHERE organization_id=${orgId}::uuid AND run_id='dee633-real-backtest') snapshots`;
          expect(graphCounts[0]).toEqual({ checkpoints: "2", ledgers: "2", stages: "18", snapshots: "12" });
          await expect(produce({ ...firstProductionInput, datasetAuthorityId: randomUUID() }))
            .rejects.toThrow(/IDEMPOTENCY_CONFLICT/);
          expect(await load({ organizationId: orgId, runId: record.runId, cycleId: record.cycleId,
            forecastId: record.forecastId, symbol: record.symbol, pitAnchor: record.pitAnchor,
            knowledgeContentDigestHex: record.knowledgeContentDigestHex,
            forecastAuthorityContentDigestHex: record.forecastAuthorityContentDigestHex,
            datasetAuthorityId: record.datasetAuthorityId })).toEqual(runtimeInput);

          await expect(load({ organizationId: orgId, runId: record.runId, cycleId: record.cycleId,
            forecastId: record.forecastId, symbol: record.symbol, pitAnchor: record.pitAnchor,
            knowledgeContentDigestHex: record.knowledgeContentDigestHex,
            forecastAuthorityContentDigestHex: record.forecastAuthorityContentDigestHex,
            datasetAuthorityId: randomUUID() })).rejects.toThrow(/HISTORICAL_FORECAST_PIT_REFUSED/);
          const savedRelease = process.env.WAIA_RELEASE_SHA;
          process.env.WAIA_RELEASE_SHA = "2".repeat(40);
          try {
            await expect(load({ organizationId: orgId, runId: record.runId, cycleId: record.cycleId,
              forecastId: record.forecastId, symbol: record.symbol, pitAnchor: record.pitAnchor,
              knowledgeContentDigestHex: record.knowledgeContentDigestHex,
              forecastAuthorityContentDigestHex: record.forecastAuthorityContentDigestHex,
              datasetAuthorityId: record.datasetAuthorityId })).rejects.toThrow(/SOURCE_BUILD|SCOPE_OR_PIT/);
          } finally { process.env.WAIA_RELEASE_SHA = savedRelease; }

          await expect(sql`UPDATE trader_forecast_runtime_input_source_v2 SET cycle_id='substituted'
            WHERE organization_id=${orgId}::uuid`).rejects.toThrow(/append-only/);
          await expect(sql`UPDATE trader_historical_forecast_input_pit_v2 SET cycle_id='substituted'
            WHERE organization_id=${orgId}::uuid`).rejects.toThrow(/append-only/);
          await expect(sql`DELETE FROM trader_historical_forecast_input_pit_v2
            WHERE organization_id=${orgId}::uuid`).rejects.toThrow(/append-only/);
          await expect(sql`INSERT INTO trader_historical_forecast_input_knowledge_link_v2
            (organization_id, run_id, cycle_id, knowledge_update_id, knowledge_update_content_digest_hex)
            VALUES (${orgId}::uuid, ${record.runId}, ${record.cycleId}, ${randomUUID()}::uuid, ${"3".repeat(64)})`
          ).rejects.toThrow(/foreign key/);

          const ownerVisible = await sql<{ count: string }[]>`SELECT count(*)::text AS count
            FROM trader_historical_forecast_input_pit_v2 WHERE organization_id=${orgId}::uuid`;
          expect(ownerVisible[0]?.count).toBe("2");
          await expect(sql.begin(async (tx) => {
            await tx.unsafe("SET LOCAL ROLE authenticated");
            return tx<{ count: string }[]>`SELECT count(*)::text AS count
              FROM trader_historical_forecast_input_pit_v2 WHERE organization_id=${orgId}::uuid`;
          })).rejects.toThrow(/permission denied/);
        } finally { rmSync(datasetRoot, { recursive: true, force: true }); }
      } finally {
        session.cleanup();
      }
    }, 120_000);

    it("closes one-bar-per-poll Forecast-V2 issuance through the real paper caller", async () => {
      const session = await createInMemoryResearchBacktestSession();
      try {
        const db = getDb();
        insertEmailPasswordUser(db, {
          id: WP518_PG_USER,
          email: "dee633-real-paper@waia.invalid",
          password: "password123",
          identityLabel: "DEE-633 real paper",
        });
        const sqliteOrgId = ensureUserCoreSeedSqlite(db, {
          userId: WP518_PG_USER,
          displayName: "DEE-633 real paper",
        });
        expect(sqliteOrgId).toBe(orgId);
        const paperOffsets = [...Array.from({ length: 34 }, (_, offset) => offset), 70];
        const bars: Bar[] = paperOffsets.map((offset) => {
          const closeEpochMs = 1_810_000_060_000 + offset * 60_000;
          return {
            symbol: "BTC/USDT", interval: "1m", open: "100", high: "101", low: "99",
            close: String(100 + offset / 100), volume: "2",
            barOpenTime: new Date(closeEpochMs - 60_000).toISOString(),
            barCloseTime: new Date(closeEpochMs).toISOString(),
          };
        });
        const family = { ...buildFamily(), organizationId: orgId };
        const pkg = buildPredictivePackageV1({
          family,
          sourceCorpus: Array.from({ length: 120 }, (_, i) => anchor(i)),
          kConfigDec: 3,
          mConfigDec: 4,
        });
        const scientific = await persistScientificForPackage(sql, orgId, pkg, "real-paper");
        const runtimeInput = buildRuntimeInput(orgId, pkg, bars[0]!.barCloseTime, scientific);
        const runtimeBinding = runtimeInput.forecastContractBinding;
        if (!runtimeBinding) throw new Error("canonical runtime binding missing");
        await persistForecastContractBindingV1(sql, {
          ...buildForecastContractBindingRecordV1({
            organizationId: orgId,
            scientificAdmissionReceiptId: scientific.id,
            scientificAdmissionReceiptContentDigestHex: scientific.contentDigestHex,
            selectedPredictivePackageContentDigestHex: runtimeBinding.selectedPredictivePackageContentDigestHex,
            inputContract: runtimeBinding.inputContract, modelSpec: runtimeBinding.modelSpec,
            modelArtifact: runtimeBinding.modelArtifact,
          }), binding: runtimeBinding, bindingJson: canonicalizeSemanticJsonString(runtimeBinding),
        });
        const receipt = qualifyHtxKlineVolumeAuthority({
          symbol: "BTCUSDT",
          qualifiedAtUtc: bars[0]!.barCloseTime,
          rows: [
            { id: 1, open: 100, high: 101, low: 99, close: 100, amount: 2, vol: 200, count: 1 },
            { id: 2, open: 100, high: 101, low: 99, close: 100, amount: 3, vol: 300, count: 1 },
          ],
        });
        let pollIndex = 0;
        const poll = {
          async fetchSnapshot() {
            const bar = bars[pollIndex]!;
            const cycleIndex = pollIndex;
            pollIndex += 1;
            return {
              bars: [bar],
              quote: {
                symbol: bar.symbol,
                bid: bar.close,
                ask: bar.close,
                last: bar.close,
                timestamp: bar.barCloseTime,
              },
              evaluatedAt: bar.barCloseTime,
              cycleIndex,
              cycleId: `dee633-paper-${cycleIndex}`,
              activeStrategyIds: ["__htr-blocked__"],
            };
          },
          reset() { pollIndex = 0; },
        };
        const paperInput = {
          deps: session.deps,
          context: requireOrgContext(orgId),
          poll,
          accountKey: "dee633-real-paper",
          defaultQuantity: "0.01",
          executionMode: "mock",
          accountState: createHtrInitialAccountRiskState(),
          forecastRuntimeInputResolver: (snapshot: MarketSnapshot) =>
            snapshot.cycleIndex === 0 ? runtimeInput : null,
          forecastV2Producer: {
            sql,
            runId: "dee633-real-paper",
            kmGlobalAnchorSetDigestHex: "f".repeat(64),
            priorMachineRecommendedConfidence: "0.5000",
            resolveVolumeAuthorityReceipt: () => receipt,
            provenance: {
              codeSha: "d".repeat(40), datasetContentDigest: "e".repeat(64),
              profileDigest: "f".repeat(64), canonicalizer: "HTR_SEMANTIC_CANONICAL_JSON_V1",
            },
          },
        } as const;
        await runPollPaperCycles({ ...paperInput, n: 10 });
        // A second runner constructs a new durable producer: unresolved issuance
        // and pre-restart PIT bars must hydrate from PostgreSQL, not process memory.
        await runPollPaperCycles({ ...paperInput, n: bars.length - 10 });
        const rows = await sql<{ outcomes: string; calibrations: string }[]>`
          SELECT count(DISTINCT o.forecast_id)::text AS outcomes,
                 count(DISTINCT c.forecast_id)::text AS calibrations
          FROM trader_forecast_bundle_v2 b
          LEFT JOIN trader_forecast_outcome_v2 o
            ON o.organization_id = b.organization_id AND o.bundle_id = b.id
          LEFT JOIN trader_forecast_calibration_observation_v2 c
            ON c.organization_id = b.organization_id AND c.bundle_id = b.id
          WHERE b.organization_id = ${orgId}::uuid AND b.run_id = 'dee633-real-paper'
        `;
        expect(rows[0]).toMatchObject({ outcomes: "1", calibrations: "1" });
      } finally {
        session.cleanup();
      }
    }, 120_000);

    it("natural-idempotent retry returns canonical existing bundle", async () => {
      const family = { ...buildFamily(), organizationId: orgId };
      const pkg = buildPredictivePackageV1({
        family,
        sourceCorpus: Array.from({ length: 120 }, (_, i) => anchor(i)),
        kConfigDec: 3,
        mConfigDec: 4,
      });
      const persistedPackage = await persistPredictivePackageV2(sql, pkg, {
        organizationId: orgId,
        kmGlobalAnchorSetDigestHex: "f".repeat(64),
      });
      const issuance = issueForecastV1({
        pkg,
        anchorClosedBarEpochMs: 1_700_000_360_000,
        anchorRealizedVol20m_1m: 0.015,
        executionHorizonMinutes: family.executionHorizonMinutes,
        normalizationVersionDigestHex: family.normalizationVersionDigestHex,
      });
      const first = await persistForecastBundleV2(sql, {
        organizationId: orgId,
        packageId: persistedPackage.packageId,
        runId: "fv2-idem-run",
        cycleId: "7",
        symbol: family.symbol,
        anchorClosedBarEpochMs: issuance.anchorClosedBarEpochMs,
        issuance,
      });
      const second = await persistForecastBundleV2(sql, {
        organizationId: orgId,
        packageId: persistedPackage.packageId,
        runId: "fv2-idem-run",
        cycleId: "7",
        symbol: family.symbol,
        anchorClosedBarEpochMs: issuance.anchorClosedBarEpochMs,
        issuance,
      });
      expect(second.retriedExisting).toBe(true);
      expect(second.bundleId).toBe(first.bundleId);
      const count = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM trader_forecast_bundle_v2
        WHERE organization_id = ${orgId}::uuid
          AND run_id = 'fv2-idem-run'
          AND cycle_id = '7'
      `;
      expect(Number(count[0]?.count ?? 0)).toBe(1);
    });

    it("purges only tenant-scoped unreferenced PIT bars after 30 days with audit, rollback, and idempotency", async () => {
      const otherUserId = "00000000-0000-4000-8000-000000051803";
      await cleanupWp13Org(url!, otherUserId);
      const otherOrgId = await seedWp13User(url!, otherUserId, "Forecast V2 Retention Other");
      const now = Date.now();
      const cutoffAtIso = new Date(now - 30 * 86_400_000 - 60_000).toISOString();
      const oldCreatedAt = new Date(now - 31 * 86_400_000).toISOString();
      const recentCreatedAt = new Date(now - 20 * 86_400_000).toISOString();
      const barClose = (minute: number) => new Date(1_700_100_000_000 + minute * 60_000);
      const insertPit = async (input: {
        organizationId: string;
        runId: string;
        minute: number;
        createdAt: string;
      }) => {
        const payload = {
          symbol: "BTCUSDT",
          interval: "1m",
          closeTime: barClose(input.minute).toISOString(),
          close: "100",
        };
        await sql`
          INSERT INTO trader_forecast_pit_bar_v2 (
            organization_id, run_id, symbol, interval, bar_close_time,
            bar_content_digest, bar_json, created_at
          ) VALUES (
            ${input.organizationId}::uuid, ${input.runId}, 'BTCUSDT', '1m',
            ${barClose(input.minute)}::timestamptz,
            ${createHash("sha256").update(JSON.stringify(payload)).digest("hex")},
            ${sql.json(payload as never)}::jsonb, ${input.createdAt}::timestamptz
          )
        `;
      };

      try {
        const family = { ...buildFamily(), organizationId: orgId };
        const pkg = buildPredictivePackageV1({
          family,
          sourceCorpus: Array.from({ length: 120 }, (_, i) => anchor(i)),
          kConfigDec: 3,
          mConfigDec: 4,
        });
        const persistedPackage = await persistPredictivePackageV2(sql, pkg, {
          organizationId: orgId,
          kmGlobalAnchorSetDigestHex: "f".repeat(64),
        });
        const issuance = issueForecastV1({
          pkg,
          anchorClosedBarEpochMs: 1_700_100_000_000,
          anchorRealizedVol20m_1m: 0.015,
          executionHorizonMinutes: family.executionHorizonMinutes,
          normalizationVersionDigestHex: family.normalizationVersionDigestHex,
        });
        await persistForecastBundleV2(sql, {
          organizationId: orgId,
          packageId: persistedPackage.packageId,
          runId: "retention-pending",
          cycleId: "0",
          symbol: family.symbol,
          anchorClosedBarEpochMs: issuance.anchorClosedBarEpochMs,
          issuance,
        });

        await insertPit({ organizationId: orgId, runId: "retention-old-free", minute: 1, createdAt: oldCreatedAt });
        await insertPit({ organizationId: orgId, runId: "retention-recent", minute: 2, createdAt: recentCreatedAt });
        await insertPit({ organizationId: orgId, runId: "retention-pending", minute: 3, createdAt: oldCreatedAt });
        await insertPit({ organizationId: otherOrgId, runId: "retention-other", minute: 4, createdAt: oldCreatedAt });
        await insertPit({ organizationId: orgId, runId: "retention-equality", minute: 6, createdAt: cutoffAtIso });

        await expect(purgeRetainedForecastV2PitBars({
          sql,
          organizationId: orgId,
          requestId: "00000000-0000-4000-8000-000000063301",
          cutoffAtIso: new Date(now - 29 * 86_400_000).toISOString(),
        })).rejects.toThrow(/at least 30 days/);

        const first = await purgeRetainedForecastV2PitBars({
          sql,
          organizationId: orgId,
          requestId: "00000000-0000-4000-8000-000000063302",
          cutoffAtIso,
        });
        expect(first.purgedRowCount).toBe(1);
        const replay = await purgeRetainedForecastV2PitBars({
          sql,
          organizationId: orgId,
          requestId: first.requestId,
          cutoffAtIso,
        });
        expect(replay).toEqual(first);
        await expect(purgeRetainedForecastV2PitBars({
          sql,
          organizationId: orgId,
          requestId: first.requestId,
          cutoffAtIso: new Date(Date.parse(cutoffAtIso) - 60_000).toISOString(),
        })).rejects.toThrow(/request conflict/);

        const remaining = await sql<{ organization_id: string; run_id: string }[]>`
          SELECT organization_id::text, run_id
          FROM trader_forecast_pit_bar_v2
          WHERE organization_id IN (${orgId}::uuid, ${otherOrgId}::uuid)
          ORDER BY run_id
        `;
        expect(remaining.map((row) => row.run_id)).toEqual([
          "retention-equality",
          "retention-other",
          "retention-pending",
          "retention-recent",
        ]);
        const audits = await sql<{ purged_row_count: string }[]>`
          SELECT purged_row_count::text
          FROM trader_forecast_pit_bar_retention_audit_v2
          WHERE organization_id = ${orgId}::uuid
            AND request_id = ${first.requestId}::uuid
        `;
        expect(audits).toEqual([{ purged_row_count: "1" }]);
        await expect(sql`
          UPDATE trader_forecast_pit_bar_retention_audit_v2 SET purged_row_count = 9
          WHERE organization_id = ${orgId}::uuid AND request_id = ${first.requestId}::uuid
        `).rejects.toThrow(/append-only/);
        await expect(sql`
          DELETE FROM trader_forecast_pit_bar_retention_audit_v2
          WHERE organization_id = ${orgId}::uuid AND request_id = ${first.requestId}::uuid
        `).rejects.toThrow(/append-only/);
        await sql`SELECT set_config('waia.forecast_pit_retention_purge_org', ${orgId}, false)`;
        await expect(sql`
          DELETE FROM trader_forecast_pit_bar_v2
          WHERE organization_id = ${orgId}::uuid AND run_id = 'retention-pending'
        `).rejects.toThrow(/append-only/);

        await insertPit({ organizationId: orgId, runId: "retention-concurrent", minute: 7, createdAt: oldCreatedAt });
        let lockAcquired!: () => void;
        const acquired = new Promise<void>((resolve) => { lockAcquired = resolve; });
        const pendingInsert = sql.begin(async (tx) => {
          await tx`SELECT pg_advisory_xact_lock(hashtextextended(${orgId}::text, 633))`;
          lockAcquired();
          await tx`
            INSERT INTO trader_forecast_bundle_v2 (
              id, organization_id, predictive_package_id, run_id, cycle_id, symbol,
              anchor_closed_bar_epoch_ms, completeness_state, bundle_content_digest,
              schema_version, forecast_runtime_authorized_outcome_json,
              forecast_runtime_issuance_sequence
            )
            SELECT
              '00000000-0000-4000-8000-000000063399'::uuid, organization_id,
              predictive_package_id, 'retention-concurrent', '0', symbol,
              anchor_closed_bar_epoch_ms, completeness_state, bundle_content_digest,
              schema_version, forecast_runtime_authorized_outcome_json,
              forecast_runtime_issuance_sequence
            FROM trader_forecast_bundle_v2
            WHERE organization_id = ${orgId}::uuid AND run_id = 'retention-pending'
          `;
          await new Promise((resolve) => setTimeout(resolve, 50));
        });
        await acquired;
        const concurrentPurge = purgeRetainedForecastV2PitBars({
          sql,
          organizationId: orgId,
          requestId: "00000000-0000-4000-8000-000000063304",
          cutoffAtIso,
        });
        await pendingInsert;
        const concurrentReceipt = await concurrentPurge;
        expect(concurrentReceipt.purgedRowCount).toBe(0);
        const concurrentRows = await sql<{ count: string }[]>`
          SELECT count(*)::text AS count FROM trader_forecast_pit_bar_v2
          WHERE organization_id = ${orgId}::uuid AND run_id = 'retention-concurrent'
        `;
        expect(concurrentRows[0]?.count).toBe("1");

        await insertPit({ organizationId: orgId, runId: "retention-rollback", minute: 5, createdAt: oldCreatedAt });
        await sql.unsafe(`
          CREATE OR REPLACE FUNCTION dee633_inject_retention_audit_failure() RETURNS trigger
          LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'DEE633_RETENTION_AUDIT_FAILURE'; END $$;
          CREATE TRIGGER dee633_inject_retention_audit_failure
          BEFORE INSERT ON trader_forecast_pit_bar_retention_audit_v2
          FOR EACH ROW EXECUTE FUNCTION dee633_inject_retention_audit_failure();
        `);
        try {
          await expect(purgeRetainedForecastV2PitBars({
            sql,
            organizationId: orgId,
            requestId: "00000000-0000-4000-8000-000000063303",
            cutoffAtIso,
          })).rejects.toThrow(/DEE633_RETENTION_AUDIT_FAILURE/);
        } finally {
          await sql.unsafe("DROP TRIGGER IF EXISTS dee633_inject_retention_audit_failure ON trader_forecast_pit_bar_retention_audit_v2");
          await sql.unsafe("DROP FUNCTION IF EXISTS dee633_inject_retention_audit_failure()");
        }
        const rollbackRows = await sql<{ count: string }[]>`
          SELECT count(*)::text AS count FROM trader_forecast_pit_bar_v2
          WHERE organization_id = ${orgId}::uuid AND run_id = 'retention-rollback'
        `;
        expect(rollbackRows[0]?.count).toBe("1");
      } finally {
        await sql.unsafe("ALTER TABLE trader_forecast_pit_bar_v2 DISABLE TRIGGER USER");
        await sql`DELETE FROM trader_forecast_pit_bar_v2 WHERE organization_id = ${otherOrgId}::uuid`;
        await sql.unsafe("ALTER TABLE trader_forecast_pit_bar_v2 ENABLE TRIGGER USER");
        await cleanupWp13Org(url!, otherUserId);
      }
    }, 120_000);

    it("natural-idempotent conflict (same identity, different content) fails closed", async () => {
      const family = { ...buildFamily(), organizationId: orgId };
      const pkg = buildPredictivePackageV1({
        family,
        sourceCorpus: Array.from({ length: 120 }, (_, i) => anchor(i)),
        kConfigDec: 3,
        mConfigDec: 4,
      });
      const persistedPackage = await persistPredictivePackageV2(sql, pkg, {
        organizationId: orgId,
        kmGlobalAnchorSetDigestHex: "f".repeat(64),
      });
      const issuanceA = issueForecastV1({
        pkg,
        anchorClosedBarEpochMs: 1_700_000_420_000,
        anchorRealizedVol20m_1m: 0.015,
        executionHorizonMinutes: family.executionHorizonMinutes,
        normalizationVersionDigestHex: family.normalizationVersionDigestHex,
      });
      await persistForecastBundleV2(sql, {
        organizationId: orgId,
        packageId: persistedPackage.packageId,
        runId: "fv2-conflict-run",
        cycleId: "9",
        symbol: family.symbol,
        anchorClosedBarEpochMs: issuanceA.anchorClosedBarEpochMs,
        issuance: issuanceA,
      });
      const issuanceB = issueForecastV1({
        pkg,
        anchorClosedBarEpochMs: 1_700_000_420_000,
        anchorRealizedVol20m_1m: 0.022,
        executionHorizonMinutes: family.executionHorizonMinutes,
        normalizationVersionDigestHex: family.normalizationVersionDigestHex,
      });
      await expect(
        persistForecastBundleV2(sql, {
          organizationId: orgId,
          packageId: persistedPackage.packageId,
          runId: "fv2-conflict-run",
          cycleId: "9",
          symbol: family.symbol,
          anchorClosedBarEpochMs: issuanceB.anchorClosedBarEpochMs,
          issuance: issuanceB,
        }),
      ).rejects.toThrow(/natural-idempotent conflict/);
    });
  },
);
