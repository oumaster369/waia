/**
 * HTR-WP22 — Postgres multi-regime semantic coverage (GAP-044).
 *
 * Enable with: WAIA_PG_INTEGRATION=1 + DATABASE_URL_POSTGRES (local validate profile).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import { createPostgresOrderRepository } from "@/lib/trader/execution";
import { insertMarketBarsPostgres } from "@/lib/trader/market-data/market-bars-repository-postgres";
import { MEAN_REVERSION_V0 } from "@/lib/trader/intelligence/types";
import {
  buildHtrWp22MultiRegimePostgresEvidence,
  evaluateHtrWp22MultiRegimePostgresEvidence,
} from "@/lib/trader/backtest/htr-wp22-multi-regime-postgres-evidence";
import { hasSufficientCanonicalRegimeCoverage } from "@/lib/trader/research/regime-taxonomy";
import type { ResearchValidationBacktestArtifactSink } from "@/lib/trader/research/research-backtest-runner";
import type { RunResearchPipelineResult } from "@/lib/trader/research/research-orchestrator";
import { runResearchPipelinePostgres } from "@/lib/trader/research/research-orchestrator";
import { parseResearchValidationMetricsJson } from "@/lib/trader/research/parse-research-validation-metrics";
import { listWalkForwardWindowsForCandidatePostgres } from "@/lib/trader/research/strategy-candidate-repository-postgres";
import { verifyHtrPostgresConnectionIdentity } from "@/lib/trader/readiness/htr-postgres-connection-preflight";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import {
  buildResearchIntegrationBars,
  RESEARCH_INTEGRATION_BAR_COUNT,
} from "@/tests/helpers/build-research-integration-bars";
import {
  buildHtrGap044PipelineBacktestOptions,
  buildHtrPostgresResearchSession,
  cleanupHtrPostgresOrg,
  createHtrPostgresUuidFactory,
  HTR_PG_USER_A,
  seedHtrPostgresUser,
} from "@/tests/integration/htr-postgres-fixture-prelude";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

const RESEARCH_PIPELINE_OOS_BAR_COUNT = 20;
const RESEARCH_PIPELINE_BASE = {
  symbol: "BTC/USDT" as const,
  interval: "1m" as const,
  strategyId: MEAN_REVERSION_V0,
  strategyVersion: "0.1.0",
  oosBarCount: RESEARCH_PIPELINE_OOS_BAR_COUNT,
};

async function runHtrWp22ResearchPipeline(
  db: ReturnType<typeof getPostgresDrizzle>,
  orgId: string,
  input: { datasetName: string; idSeed: number },
): Promise<
  RunResearchPipelineResult & { validationArtifactSink: ResearchValidationBacktestArtifactSink }
> {
  const context = requireOrgContext(orgId);
  const validationArtifactSink: ResearchValidationBacktestArtifactSink = {};
  const session = await buildHtrPostgresResearchSession(db, orgId, {
    replayNamespaceSeed: input.idSeed,
  });
  const pipeline = await runResearchPipelinePostgres(db, {
    context,
    deps: session.deps,
    historicalExecutionProfile: session.historicalExecutionProfile,
    requireMultiRegimeCoverage: false,
    pipelineBacktest: {
      ...buildHtrGap044PipelineBacktestOptions(),
      validationArtifactSink,
    },
    createOrderRepository: () => createPostgresOrderRepository(db),
    newId: createHtrPostgresUuidFactory(input.idSeed),
    datasetName: input.datasetName,
    ...RESEARCH_PIPELINE_BASE,
  });
  return { ...pipeline, validationArtifactSink };
}

describe.skipIf(!integrationEnabled || !url)(
  "postgres trader wp22 multi-regime parity (HTR-GAP-044)",
  () => {
    let orgA: string;
    let db: ReturnType<typeof getPostgresDrizzle>;

    beforeAll(async () => {
      await verifyHtrPostgresConnectionIdentity(url!);
      await cleanupHtrPostgresOrg(url!, HTR_PG_USER_A);
      orgA = await seedHtrPostgresUser(url!, HTR_PG_USER_A, "HTR WP22 Multi-Regime");
      db = getPostgresDrizzle();
      const context = requireOrgContext(orgA);
      const bars = buildResearchIntegrationBars(RESEARCH_INTEGRATION_BAR_COUNT);
      await insertMarketBarsPostgres(
        db,
        context,
        bars.map((bar) => ({ bar })),
      );
    });

    beforeEach(async () => {
      const sql = postgres(url!, { max: 1 });
      const orgId = orgA;
      try {
        await sql.unsafe(`DELETE FROM trader_knowledge_edges WHERE organization_id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM trader_market_events WHERE organization_id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM trader_blind_validation_results WHERE organization_id = $1`, [
          orgId,
        ]);
        await sql.unsafe(`DELETE FROM trader_walk_forward_windows WHERE organization_id = $1`, [
          orgId,
        ]);
        await sql.unsafe(`DELETE FROM trader_strategy_candidates WHERE organization_id = $1`, [
          orgId,
        ]);
        await sql.unsafe(`DELETE FROM trader_backtest_results WHERE organization_id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM trader_backtest_runs WHERE organization_id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM research_dataset WHERE organization_id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM trader_fills WHERE organization_id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM trader_order_events WHERE organization_id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM trader_orders WHERE organization_id = $1`, [orgId]);
      } finally {
        await sql.end({ timeout: 5 });
      }
    });

    afterAll(async () => {
      await cleanupHtrPostgresOrg(url!, HTR_PG_USER_A);
      resetPostgresSingletonForTests();
    });

    it("runs connection-identity preflight against local validate profile", async () => {
      const env = await verifyHtrPostgresConnectionIdentity(url!);
      expect(env.database).toBe("waia_validate");
      expect(env.role).toBe("waia_validate");
    });

    it("executes research pipeline on real Postgres and reaches assertions", async () => {
      const pipeline = await runHtrWp22ResearchPipeline(db, orgA, {
        datasetName: "htr-wp22-multi-regime-run",
        idSeed: 0x415_220,
      });

      expect(pipeline.evidenceDocument.evidenceBody.datasetId).toBe(pipeline.dataset.id);
      expect(pipeline.validationMetrics).toBeDefined();
      expect(pipeline.blindMetrics).toBeDefined();
    });

    it("collects canonical regime labels from validation, walk-forward, and blind metrics", async () => {
      const context = requireOrgContext(orgA);
      const pipeline = await runHtrWp22ResearchPipeline(db, orgA, {
        datasetName: "htr-wp22-multi-regime-labels",
        idSeed: 0x415_221,
      });

      const walkForwardMetrics = (
        await listWalkForwardWindowsForCandidatePostgres(db, context, pipeline.strategyCandidateId)
      ).map((window) => parseResearchValidationMetricsJson(window.metricsJson));

      const evidence = buildHtrWp22MultiRegimePostgresEvidence({
        validationMetrics: pipeline.validationMetrics,
        walkForwardMetrics,
        blindMetrics: pipeline.blindMetrics,
        validationCycleResults: pipeline.validationCycleResults,
      });

      expect(evidence.observedRegimeLabels.length).toBeGreaterThan(0);
      expect(evidence.regimeCoverage.regimes.length).toBe(evidence.observedRegimeLabels.length);
    });

    it("requires non-trending and down canonical regime coverage (ADR-0010)", async () => {
      const context = requireOrgContext(orgA);
      const pipeline = await runHtrWp22ResearchPipeline(db, orgA, {
        datasetName: "htr-wp22-multi-regime-coverage",
        idSeed: 0x415_222,
      });

      const walkForwardMetrics = (
        await listWalkForwardWindowsForCandidatePostgres(db, context, pipeline.strategyCandidateId)
      ).map((window) => parseResearchValidationMetricsJson(window.metricsJson));

      const evidence = buildHtrWp22MultiRegimePostgresEvidence({
        validationMetrics: pipeline.validationMetrics,
        walkForwardMetrics,
        blindMetrics: pipeline.blindMetrics,
        validationCycleResults: pipeline.validationCycleResults,
      });

      expect(evidence.regimeCoverage.nonTrendingCount).toBeGreaterThan(0);
      expect(evidence.regimeCoverage.downRegimeCount).toBeGreaterThan(0);
      expect(hasSufficientCanonicalRegimeCoverage(evidence.regimeCoverage)).toBe(true);
      expect(evaluateHtrWp22MultiRegimePostgresEvidence(evidence)).toBe(true);
      expect(evidence.terminalState).toBe("HTR_WP22_MULTI_REGIME_POSTGRES_PASS");
    });

    it("binds evidence export regimeCoverage to pipeline metrics lineage", async () => {
      const context = requireOrgContext(orgA);
      const pipeline = await runHtrWp22ResearchPipeline(db, orgA, {
        datasetName: "htr-wp22-multi-regime-lineage",
        idSeed: 0x415_223,
      });

      const walkForwardMetrics = (
        await listWalkForwardWindowsForCandidatePostgres(db, context, pipeline.strategyCandidateId)
      ).map((window) => parseResearchValidationMetricsJson(window.metricsJson));

      const exportCoverage = pipeline.evidenceDocument.evidenceBody.regimeCoverage;
      const evidence = buildHtrWp22MultiRegimePostgresEvidence({
        validationMetrics: pipeline.validationMetrics,
        walkForwardMetrics,
        blindMetrics: pipeline.blindMetrics,
        validationCycleResults: pipeline.validationCycleResults,
      });

      expect(
        exportCoverage.regimes.every((label) => evidence.regimeCoverage.regimes.includes(label)),
      ).toBe(true);
      expect(hasSufficientCanonicalRegimeCoverage(evidence.regimeCoverage)).toBe(true);
    });
  },
);
