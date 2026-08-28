/**
 * DEE-527 — Forecast V2 package/bundle Postgres persistence roundtrip (opt-in).
 */

import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";

import { MODEL_TRANSFORM_VERSION } from "@/lib/trader/intelligence/forecast-v2/constants";
import {
  persistForecastBundleV2,
  persistForecastCalibrationObservationV2,
  persistObjectiveForecastOutcomeResolutionV2,
  persistPredictivePackageV2,
  verifyPersistedForecastV2RoundTrip,
} from "@/lib/trader/intelligence/forecast-v2/forecast-v2-persistence-service";
import type { ReplicaRootFamilyInput } from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import { digestHex } from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { scoreForecastV2MulticlassObservation } from "@/lib/trader/intelligence/calibration/calibration-scorer";
import { persistForecastV2TerminalClosurePostgres } from "@/lib/trader/intelligence/outcome-resolution/epistemic-closure-runtime";
import { createForecastV2DurableProducerV1 } from "@/lib/trader/intelligence/outcome-resolution/epistemic-closure-runtime";
import { qualifyHtxKlineVolumeAuthority } from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import { quantizeScale8HalfUp } from "@/lib/trader/intelligence/forecast-v2/quantize-scale8-half-up-v1";
import { buildForecastContractBindingV1 } from "@/lib/trader/intelligence/forecast-v2/forecast-contract-binding-service-v1";
import {
  buildForecastInputContractV2,
  buildForecastModelArtifactV2,
  buildForecastModelSpecV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-contract-foundation-v2";
import type { ForecastRuntimeInputV2 } from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
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

const WP518_PG_USER = "00000000-0000-4000-8000-000000051802";

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
    scientificAdmissionReceiptId: "22222222-2222-4222-8222-222222222222",
    scientificAdmissionReceiptContentDigestHex: hex("1"),
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
    anchorRealizedVol20m_1m: 0.018,
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
    knowledgeContentDigestHex: hex("6"),
  };
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
        "trader_forecast_pit_bar_v2",
        "trader_forecast_scenario_v2", "trader_forecast_calibration_observation_v2",
        "trader_forecast_outcome_v2", "trader_forecast_v2", "trader_forecast_bundle_v2",
        "trader_forecast_replica_artifact_v2", "trader_forecast_predictive_package_target_v2",
        "trader_forecast_target_bucket_v2", "trader_forecast_target_definition_v2",
        "trader_forecast_predictive_package_v2",
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
      await cleanupWp13Org(url!, WP518_PG_USER);
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
      await cleanupWp13Org(url!, WP518_PG_USER);
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
      const authorityBody = {
        schemaVersion: "waia.trader.forecast_runtime_authority.v2" as const,
        organizationId: orgId,
        analysisPurpose: "NEW_OPPORTUNITY" as const,
        anchorClosedBarAt: new Date(issuance.anchorClosedBarEpochMs).toISOString(),
        anchorClosedBarEpochMs: issuance.anchorClosedBarEpochMs,
        anchorRealizedVol20m_1m: issuance.anchorRealizedVol20m_1m,
        executionHorizonMinutes: issuance.executionHorizonMinutes,
        normalizationVersionDigestHex: issuance.normalizationVersionDigestHex,
        marketStateSnapshotContentDigestHex: "1".repeat(64),
        predictiveAdmissionReceiptContentDigestHex: "2".repeat(64),
        forecastContractBindingContentDigestHex: "3".repeat(64),
        scientificAdmissionReceiptContentDigestHex: "4".repeat(64),
        selectedPredictivePackageContentDigestHex: digestHex(
          issuance.package.predictivePackageContentDigest,
        ),
        inputContractDigestHex: "5".repeat(64),
        modelSpecDigestHex: "6".repeat(64),
        modelArtifactDigestHex: "7".repeat(64),
        qualifiedInputBindingDigestHex: "8".repeat(64),
        runtimeContractDigestHex: digestHex(issuance.package.runtimeContractDigest),
        terminalTargetDefinitionDigestHex: family.terminalTargetDefinitionDigestHex,
        executionOpportunityTargetDefinitionDigestHex:
          family.executionOpportunityTargetDefinitionDigestHex,
        forecastGenerationIdentityDigestHex: digestHex(issuance.forecastGenerationIdentityDigest),
        terminalDistributionSemanticDigestHex: digestHex(
          issuance.distributionSemanticDigestTerminal,
        ),
        executionDistributionSemanticDigestHex: digestHex(issuance.distributionSemanticDigestExec),
        terminalForecastContentDigestHex: digestHex(issuance.forecastContentDigestTerminal),
        executionForecastContentDigestHex: digestHex(issuance.forecastContentDigestExec),
        knowledgeEdgeId: "00000000-0000-4000-8000-000000063300",
        knowledgeContentDigestHex: "6".repeat(64),
      };
      const authorizedOutcome = {
        status: "FORECAST_AUTHORIZED" as const,
        authority: {
          ...authorityBody,
          contentDigestHex: computeSemanticSha256Hex(authorityBody),
        },
        issuance,
      };
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
          issuanceSequence: 0,
        }),
      ).rejects.toThrow(/package\/runtime issuance mismatch/);
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
          sourceCorpus: Array.from({ length: 120 }, (_, i) => anchor(i)),
          kConfigDec: 3,
          mConfigDec: 4,
        });
        const issuanceBar = bars[19]!;
        const runtimeInput = buildRuntimeInput(orgId, pkg, issuanceBar.barCloseTime);
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
        expect(rows[0]).toMatchObject({ outcomes: "1", calibrations: "1" });
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
        const runtimeInput = buildRuntimeInput(orgId, pkg, bars[0]!.barCloseTime);
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
