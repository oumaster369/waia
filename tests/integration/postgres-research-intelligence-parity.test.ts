/**
 * RI-INTEGRATION-1 — Research Intelligence operational spine (opt-in Postgres).
 *
 * Enable with: WAIA_PG_INTEGRATION=1 + DATABASE_URL_POSTGRES (see docs/postgres-development.md).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
import { deleteKnowledgeAuthorityRowsForOrg } from "@/tests/helpers/knowledge-authority-test-cleanup";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import {
  createOrderExecutionServiceFromDeps,
  createPostgresOrderRepository,
  createPostgresReconciliationService,
} from "@/lib/trader/execution";
import type {
  FillRow,
  OrderRepository,
  OrderRow,
} from "@/lib/trader/execution/order-repository.types";
import { MEAN_REVERSION_V0 } from "@/lib/trader/intelligence/types";
import type { PaperCycleDeps } from "@/lib/trader/paper/paper-cycle.types";
import { buildPaperEvaluationExportDocument } from "@/lib/trader/paper/build-paper-evaluation-export";
import {
  insertMarketBarsPostgres,
  listMarketBarsPostgres,
} from "@/lib/trader/market-data/market-bars-repository-postgres";
import {
  getResearchDatasetByIdPostgres,
  getResearchDatasetByNamePostgres,
} from "@/lib/trader/market-data/research-dataset-repository-postgres";
import {
  buildM9BlindAuthorizationScope,
  computeM9BlindAuthorizationDigest,
  type M9CampaignAuthorizationScope,
} from "@/lib/trader/research/m9-operator-authorization";
import { computeM9DatasetSealPreviewPostgres } from "@/lib/trader/research/m9-dataset-seal-preview";
import { runResearchPipelinePostgres } from "@/lib/trader/research/research-orchestrator";
import { parseResearchValidationMetricsJson } from "@/lib/trader/research/parse-research-validation-metrics";
import { listWalkForwardWindowsForCandidatePostgres } from "@/lib/trader/research/strategy-candidate-repository-postgres";
import {
  RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
  RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1,
  type ResearchValidationMetrics,
} from "@/lib/trader/research/strategy-candidate.types";
import { buildResearchEvidenceDocument } from "@/lib/trader/research/build-research-evidence-export";
import { recordResearchPipelineKnowledgePostgres } from "@/lib/trader/research/record-research-knowledge";
import { computeResearchEvidenceExportDigest } from "@/lib/trader/research/serialize-research-evidence-export";
import { validateResearchEvidenceProvenancePostgres } from "@/lib/trader/research/validate-research-evidence-provenance";
import { hasSufficientCanonicalRegimeCoverage } from "@/lib/trader/research/regime-taxonomy";
import {
  buildHtrWp22MultiRegimePostgresEvidence,
  buildHtrGap044ResearchEvidenceDocumentFromPipeline,
} from "@/lib/trader/backtest/htr-wp22-multi-regime-postgres-evidence";
import {
  COST_MODEL_VERSION_V1,
  costModelV1FromAuthority,
  createHtrHistoricalCostModelAuthorityV1,
} from "@/lib/trader/execution/cost-model";
import { createInMemoryOrderRateStore } from "@/lib/trader/risk/order-rate-store";
import {
  createKillSwitchResolver,
  createPostgresKillSwitchRepository,
  createPostgresRiskEngineService,
  createPostgresRiskLimitsService,
} from "@/lib/trader/risk";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { writeTraderAuditLogPostgres } from "@/lib/trader/audit/write";
import { createPostgresStrategyPromotionService } from "@/lib/trader/validation-gate";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import {
  buildResearchIntegrationBars,
  RESEARCH_INTEGRATION_BAR_COUNT,
} from "@/tests/helpers/build-research-integration-bars";
import {
  buildHtrGap044PipelineBacktestOptions,
  buildHtrPostgresResearchSession,
  ensureAuthUsersSeed,
} from "@/tests/integration/htr-postgres-fixture-prelude";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

const USER_A = "00000000-0000-4000-8000-0000000400a1";
const STRATEGY_SIGNAL = "signal-400-ri";
const SERVICE_ACTOR = { actorType: "service" as const, actorId: null };

/** Validation split is 46 bars at 230 total; OOS windows must satisfy the 20-bar backtest minimum. */
const RESEARCH_PIPELINE_OOS_BAR_COUNT = 20;
const RESEARCH_PIPELINE_COST_MODEL = costModelV1FromAuthority(
  createHtrHistoricalCostModelAuthorityV1(),
);

const RESEARCH_PIPELINE_BASE = {
  symbol: "BTC/USDT" as const,
  interval: "1m" as const,
  strategyId: MEAN_REVERSION_V0,
  strategyVersion: "0.1.0",
  oosBarCount: RESEARCH_PIPELINE_OOS_BAR_COUNT,
  costModel: RESEARCH_PIPELINE_COST_MODEL,
};

function createResearchPipelineIdFactory(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, "0")}`;
  };
}

function mockOrder(overrides: Partial<OrderRow> & Pick<OrderRow, "id">, orgId: string): OrderRow {
  return {
    credentialId: null,
    venue: "mock",
    executionMode: "paper",
    symbol: "BTC/USDT",
    side: "buy",
    type: "market",
    price: null,
    quantity: "0.01",
    filledQuantity: "0.01",
    avgFillPrice: "64000",
    state: "FILLED",
    stateVersion: 1,
    exchangeOrderId: null,
    clientOrderId: `client-${overrides.id}`,
    idempotencyKey: `idem-${overrides.id}`,
    riskDecisionId: "risk-400",
    strategySignalId: STRATEGY_SIGNAL,
    allocationDecisionId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    organizationId: orgId,
    ...overrides,
  };
}

function mockRepository(orders: OrderRow[]): OrderRepository {
  const fillsByOrderId: Record<string, FillRow[]> = {};
  for (const order of orders) {
    fillsByOrderId[order.id] = [
      {
        id: `fill-${order.id}`,
        organizationId: order.organizationId,
        orderId: order.id,
        exchangeTradeId: `trade-${order.id}`,
        price: order.avgFillPrice ?? "100",
        quantity: "0.01",
        fee: "0",
        feeAsset: "USDT",
        executedAt: new Date(150),
        createdAt: new Date(150),
      },
    ];
  }

  return {
    createOrder: async () => {
      throw new Error("not implemented");
    },
    getOrderById: async () => null,
    findOrderByClientOrderId: async () => null,
    findOrderByIdempotencyKey: async () => null,
    listOpenOrders: async () => [],
    listOrders: async (context) =>
      orders.filter((order) => order.organizationId === context.organizationId),
    transitionOrder: async () => {
      throw new Error("not implemented");
    },
    recordFill: async () => {
      throw new Error("not implemented");
    },
    recordFillProgress: async () => {
      throw new Error("not implemented");
    },
    listEvents: async () => [],
    listFills: async (_context, orderId) => fillsByOrderId[orderId] ?? [],
  };
}

async function buildPostgresResearchSession(
  db: ReturnType<typeof getPostgresDrizzle>,
  orgId: string,
) {
  return buildHtrPostgresResearchSession(db, orgId, { replayNamespaceSeed: 0x400_400 });
}

describe.skipIf(!integrationEnabled || !url)(
  "postgres research intelligence parity (RI-INTEGRATION-1)",
  () => {
    let orgA: string;
    let db: ReturnType<typeof getPostgresDrizzle>;
    let syntheticBarRevision = 0;

    async function appendUniqueSyntheticTailBar(context: ReturnType<typeof requireOrgContext>) {
      syntheticBarRevision += 1;
      // DEE-540 consumes each blind-bar content digest globally and append-only.
      const bars = await listMarketBarsPostgres(db, context, {
        symbol: RESEARCH_PIPELINE_BASE.symbol,
        interval: RESEARCH_PIPELINE_BASE.interval,
      });
      const last = bars.at(-1);
      if (!last) throw new Error("research parity fixture has no seed bars");
      const openMs = Date.parse(last.barOpenTime) + 60_000;
      const closeMs = Date.parse(last.barCloseTime) + 60_000;
      const open = Number(last.close);
      const close = open + syntheticBarRevision / 100_000;
      const high = Math.max(open, close) + 0.01;
      const low = Math.min(open, close) - 0.01;
      await insertMarketBarsPostgres(db, context, [
        {
          bar: {
            symbol: RESEARCH_PIPELINE_BASE.symbol,
            interval: RESEARCH_PIPELINE_BASE.interval,
            barOpenTime: new Date(openMs).toISOString(),
            barCloseTime: new Date(closeMs).toISOString(),
            open: open.toFixed(8),
            high: high.toFixed(8),
            low: low.toFixed(8),
            close: close.toFixed(8),
            volume: (1 + syntheticBarRevision).toFixed(4),
          },
        },
      ]);
    }

    async function buildAuthorizationForCurrentBars(input: {
      datasetName: string;
      strategyVersion: string;
      vaultDir: string;
    }) {
      const context = requireOrgContext(orgA);
      const sealPreview = await computeM9DatasetSealPreviewPostgres(db, context, {
        symbol: RESEARCH_PIPELINE_BASE.symbol,
        interval: RESEARCH_PIPELINE_BASE.interval,
      });
      const campaignScope: M9CampaignAuthorizationScope = {
        organizationId: orgA,
        strategyId: RESEARCH_PIPELINE_BASE.strategyId,
        strategyVersion: input.strategyVersion,
        symbol: RESEARCH_PIPELINE_BASE.symbol,
        interval: RESEARCH_PIPELINE_BASE.interval,
        vaultDir: input.vaultDir,
        metricsSchemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
      };
      const blindScope = buildM9BlindAuthorizationScope({
        campaignScope,
        datasetName: input.datasetName,
        blindDigest: sealPreview.sealed.blindDigest,
        sidecarContentDigest: null,
      });
      return {
        blindDigest: sealPreview.sealed.blindDigest,
        blindAuthorizationScope: blindScope,
        operatorBlindAuthorization: computeM9BlindAuthorizationDigest(blindScope),
      };
    }

    async function runAuthorizedResearchPipeline(input: {
      datasetName: string;
      strategyVersion: string;
      appendUniqueTail?: boolean;
      newId?: () => string;
    }) {
      const context = requireOrgContext(orgA);
      if (input.appendUniqueTail !== false) await appendUniqueSyntheticTailBar(context);
      const authorization = await buildAuthorizationForCurrentBars({
        datasetName: input.datasetName,
        strategyVersion: input.strategyVersion,
        vaultDir: `tests/fixtures/${input.datasetName}`,
      });
      const session = await buildPostgresResearchSession(db, orgA);
      return runResearchPipelinePostgres(db, {
        context,
        datasetName: input.datasetName,
        deps: session.deps,
        historicalExecutionProfile: session.historicalExecutionProfile,
        requireMultiRegimeCoverage: false,
        createOrderRepository: () => createPostgresOrderRepository(db),
        newId: input.newId ?? createResearchPipelineIdFactory(),
        ...RESEARCH_PIPELINE_BASE,
        strategyVersion: input.strategyVersion,
        pipelineBacktest: {
          ...buildHtrGap044PipelineBacktestOptions(),
          operatorBlindAuthorization: authorization.operatorBlindAuthorization,
          blindAuthorizationScope: authorization.blindAuthorizationScope,
        },
      });
    }

    async function deleteAuditLogsForOrg(sql: postgres.Sql, orgId: string): Promise<void> {
      await sql.unsafe(`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_block_delete`);
      await sql.unsafe(
        `DELETE FROM audit_logs WHERE organization_id = $1 OR entity_id IN (
          SELECT id::text FROM trader_strategy_promotion_records WHERE organization_id = $1
        )`,
        [orgId],
      );
      await sql.unsafe(`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_block_delete`);
    }

    async function cleanupResearchArtifacts(orgId: string): Promise<void> {
      const sql = postgres(url!, { max: 1 });
      try {
        await deleteAuditLogsForOrg(sql, orgId);
        await deleteKnowledgeAuthorityRowsForOrg(sql, orgId);
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
        await sql.unsafe(
          `DELETE FROM trader_strategy_promotion_records WHERE organization_id = $1`,
          [orgId],
        );
      } finally {
        await sql.end({ timeout: 5 });
      }
    }

    async function cleanup(): Promise<void> {
      const orgId = personalOrganizationIdFromUserId(USER_A);
      const sql = postgres(url!, { max: 1 });
      try {
        await cleanupResearchArtifacts(orgId);
        await sql.unsafe(`DELETE FROM trader_market_bars WHERE organization_id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM organization_members WHERE organization_id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM organizations WHERE id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM user_platform_roles WHERE user_id = $1`, [USER_A]);
        await sql.unsafe(`DELETE FROM profiles WHERE user_id = $1`, [USER_A]);
        await sql.unsafe(`DELETE FROM users WHERE id = $1`, [USER_A]);
        await sql.unsafe(`DELETE FROM auth.users WHERE id = $1`, [USER_A]);
      } finally {
        await sql.end({ timeout: 5 });
      }
    }

    beforeAll(async () => {
      await cleanup();
      await ensureAuthUsersSeed(url!, [USER_A]);

      db = getPostgresDrizzle();
      await db.insert(pgSchema.users).values({
        id: USER_A,
        identityLabel: "Research Intelligence Integration",
        email: "research-intelligence-400@waia.invalid",
        passwordHash: null,
      });

      orgA = await ensureUserCoreSeedPostgres(db, {
        userId: USER_A,
        displayName: "Research Intelligence Integration",
      });

      const context = requireOrgContext(orgA);
      const bars = buildResearchIntegrationBars(RESEARCH_INTEGRATION_BAR_COUNT);
      await insertMarketBarsPostgres(
        db,
        context,
        bars.map((bar) => ({ bar })),
      );
    });

    beforeEach(async () => {
      await cleanupResearchArtifacts(orgA);
    });

    afterAll(async () => {
      await cleanup();
      resetPostgresSingletonForTests();
    });

    it("runs bars → dataset → backtest → walk-forward → blind → evidence → knowledge", async () => {
      const context = requireOrgContext(orgA);
      const first = await runAuthorizedResearchPipeline({
        datasetName: "ri-integration-run-1",
        strategyVersion: "0.1.200",
      });

      const dataset = await getResearchDatasetByIdPostgres(db, context, first.dataset.id);
      expect(dataset?.trainBarCount).toBeGreaterThan(0);
      expect(dataset?.validationBarCount).toBeGreaterThan(0);
      expect(dataset?.blindBarCount).toBeGreaterThan(0);

      await validateResearchEvidenceProvenancePostgres(db, context, first.evidenceDocument, {
        requireRegimeCoverage: false,
      });

      const knowledgeRows = await db
        .select()
        .from(pgSchema.traderMarketEvents)
        .where(eq(pgSchema.traderMarketEvents.organizationId, orgA));
      expect(knowledgeRows.some((row) => row.eventKind === "research_pipeline_completed")).toBe(
        true,
      );

      const edgeRows = await db
        .select()
        .from(pgSchema.traderKnowledgeEdges)
        .where(eq(pgSchema.traderKnowledgeEdges.organizationId, orgA));
      const researchEdge = edgeRows.find(
        (row) => row.relationKind === "observed_by_research_pipeline",
      );
      expect(researchEdge).toMatchObject({
        confidence: "0.0000",
        strength: "0.0000",
        verified: false,
      });

      const mockOrders = await db
        .select()
        .from(pgSchema.traderOrders)
        .where(
          and(
            eq(pgSchema.traderOrders.organizationId, orgA),
            eq(pgSchema.traderOrders.executionMode, "mock"),
          ),
        );

      for (const order of mockOrders) {
        expect(order.clientOrderId).toContain("ri-blind-");
      }

      const walkForwardMetrics = (
        await listWalkForwardWindowsForCandidatePostgres(db, context, first.strategyCandidateId)
      ).map((window) => parseResearchValidationMetricsJson(window.metricsJson));

      const regimeEvidence = buildHtrWp22MultiRegimePostgresEvidence({
        validationMetrics: first.validationMetrics,
        walkForwardMetrics,
        blindMetrics: first.blindMetrics,
        validationCycleResults: first.validationCycleResults,
      });
      expect(regimeEvidence.metricsSources.metricsObservedRegimes).toBe(true);
      expect(hasSufficientCanonicalRegimeCoverage(regimeEvidence.regimeCoverage)).toBe(true);
      expect(regimeEvidence.regimeCoverage.nonTrendingCount).toBeGreaterThan(0);
      expect(regimeEvidence.regimeCoverage.downRegimeCount).toBeGreaterThan(0);
      expect(
        first.evidenceDocument.evidenceBody.regimeCoverage.regimes.every((label) =>
          regimeEvidence.regimeCoverage.regimes.includes(label),
        ),
      ).toBe(true);
    });

    it("stores full-coverage negative-outcome evidence as observation only", async () => {
      const context = requireOrgContext(orgA);
      const negativeMetrics = {
        schemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1,
        tradeCount: 2,
        periodRealizedPnl: "-20",
        periodTotalFees: "2",
        byRegime: [
          {
            regimeLabel: "RANGE",
            tradeCount: 1,
            periodRealizedPnl: "-10",
            periodTotalFees: "1",
          },
          {
            regimeLabel: "TREND_BEAR",
            tradeCount: 1,
            periodRealizedPnl: "-10",
            periodTotalFees: "1",
          },
        ],
      } satisfies ResearchValidationMetrics;
      const evidenceDocument = buildResearchEvidenceDocument({
        organizationId: orgA,
        strategyId: RESEARCH_PIPELINE_BASE.strategyId,
        strategyVersion: RESEARCH_PIPELINE_BASE.strategyVersion,
        datasetId: crypto.randomUUID(),
        backtestRunId: crypto.randomUUID(),
        strategyCandidateId: crypto.randomUUID(),
        blindValidationResultId: crypto.randomUUID(),
        costModelVersion: COST_MODEL_VERSION_V1,
        validationMetrics: negativeMetrics,
        walkForwardMetrics: [],
        blindMetrics: negativeMetrics,
      });
      expect(evidenceDocument.evidenceBody.regimeCoverage.satisfiesRequirement).toBe(true);

      const recorded = await recordResearchPipelineKnowledgePostgres(db, context, {
        evidenceDocument,
        candidateId: evidenceDocument.evidenceBody.strategyCandidateId,
        recordedAt: new Date("2026-06-18T12:00:00.000Z"),
      });

      const eventRows = await db
        .select()
        .from(pgSchema.traderMarketEvents)
        .where(eq(pgSchema.traderMarketEvents.id, recorded.marketEventId));
      expect(eventRows).toHaveLength(1);
      expect(eventRows[0]?.confidence).toBe("1.0000");
      expect(JSON.parse(eventRows[0]!.payloadJson)).toMatchObject({
        regimeCoverage: { satisfiesRequirement: true, regimes: ["RANGE", "TREND_BEAR"] },
      });

      const edgeRows = await db
        .select()
        .from(pgSchema.traderKnowledgeEdges)
        .where(eq(pgSchema.traderKnowledgeEdges.id, recorded.knowledgeEdgeId));
      expect(edgeRows).toHaveLength(1);
      expect(edgeRows[0]).toMatchObject({
        relationKind: "observed_by_research_pipeline",
        confidence: "0.0000",
        strength: "0.0000",
        verified: false,
        regimeScope: "RANGE|TREND_BEAR",
      });
    });

    it("DEE-540: a second opener cannot reuse an already-consumed blind bar digest", async () => {
      const context = requireOrgContext(orgA);
      const datasetName = "ri-repeat-idempotency";
      const sharedNewId = createResearchPipelineIdFactory();
      const first = await runAuthorizedResearchPipeline({
        datasetName,
        strategyVersion: "0.1.210",
        newId: sharedNewId,
      });

      const repeatedAuthorization = await buildAuthorizationForCurrentBars({
        datasetName,
        vaultDir: `tests/fixtures/${datasetName}-second-opener`,
        strategyVersion: "0.1.211",
      });

      expect(repeatedAuthorization.blindDigest).toBe(first.dataset.blindDigest);
      const secondSession = await buildPostgresResearchSession(db, orgA);
      await expect(
        runResearchPipelinePostgres(db, {
          context,
          datasetName,
          deps: secondSession.deps,
          historicalExecutionProfile: secondSession.historicalExecutionProfile,
          requireMultiRegimeCoverage: false,
          createOrderRepository: () => createPostgresOrderRepository(db),
          newId: sharedNewId,
          ...RESEARCH_PIPELINE_BASE,
          strategyVersion: "0.1.211",
          pipelineBacktest: {
            ...buildHtrGap044PipelineBacktestOptions(),
            operatorBlindAuthorization: repeatedAuthorization.operatorBlindAuthorization,
            blindAuthorizationScope: repeatedAuthorization.blindAuthorizationScope,
          },
        }),
      ).rejects.toMatchObject({ code: "DEE540_AUTHORIZATION_ALREADY_CONSUMED" });

      const rows = await db
        .select()
        .from(pgSchema.researchDataset)
        .where(
          and(
            eq(pgSchema.researchDataset.organizationId, orgA),
            eq(pgSchema.researchDataset.name, datasetName),
          ),
        );
      expect(rows).toHaveLength(1);
      const secondCandidate = await db
        .select()
        .from(pgSchema.traderStrategyCandidates)
        .where(
          and(
            eq(pgSchema.traderStrategyCandidates.organizationId, orgA),
            eq(pgSchema.traderStrategyCandidates.strategyVersion, "0.1.211"),
          ),
        );
      expect(secondCandidate).toHaveLength(1);
      expect(secondCandidate[0]).toMatchObject({
        status: "walk_forward_validated",
        blindUsed: false,
      });
      const secondBlindRows = await db
        .select()
        .from(pgSchema.traderBlindValidationResults)
        .where(eq(pgSchema.traderBlindValidationResults.candidateId, secondCandidate[0]!.id));
      expect(secondBlindRows).toHaveLength(0);
    });

    it("DEE-398: valid content-bound blind authorization proceeds through blind holdout", async () => {
      const datasetName = "ri-auth-happy-path";
      const strategyVersion = "0.1.220";
      const result = await runAuthorizedResearchPipeline({
        datasetName,
        strategyVersion,
      });
      expect(result.blindValidationResultId).toBeTruthy();
      expect(result.dataset.blindDigest).toBeTruthy();
    });

    it("DEE-398: runtime content mismatch fails closed before any dataset or blind side effect", async () => {
      const context = requireOrgContext(orgA);
      const session = await buildPostgresResearchSession(db, orgA);
      const datasetName = "ri-auth-content-mismatch";
      const strategyVersion = "0.1.221";

      const campaignScope: M9CampaignAuthorizationScope = {
        organizationId: orgA,
        strategyId: RESEARCH_PIPELINE_BASE.strategyId,
        strategyVersion,
        symbol: RESEARCH_PIPELINE_BASE.symbol,
        interval: RESEARCH_PIPELINE_BASE.interval,
        vaultDir: "tests/fixtures/m9-auth-content-mismatch",
        metricsSchemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
      };
      // Authorized over content A ("0".repeat(64)) — the campaign always seals content B
      // (the real stored bars) at runtime, so this must never match.
      const blindScope = buildM9BlindAuthorizationScope({
        campaignScope,
        datasetName,
        blindDigest: "0".repeat(64),
        sidecarContentDigest: null,
      });
      const operatorBlindAuthorization = computeM9BlindAuthorizationDigest(blindScope);

      await expect(
        runResearchPipelinePostgres(db, {
          context,
          datasetName,
          deps: session.deps,
          historicalExecutionProfile: session.historicalExecutionProfile,
          pipelineBacktest: {
            ...buildHtrGap044PipelineBacktestOptions(),
            operatorBlindAuthorization,
            blindAuthorizationScope: blindScope,
          },
          createOrderRepository: () => createPostgresOrderRepository(db),
          newId: createResearchPipelineIdFactory(),
          ...RESEARCH_PIPELINE_BASE,
          strategyVersion,
        }),
      ).rejects.toMatchObject({ code: "M9_BLIND_AUTHORIZATION_CONTENT_MISMATCH" });

      const dataset = await getResearchDatasetByNamePostgres(db, context, datasetName);
      expect(dataset).toBeNull();
    });

    it("rejects promotion when research evidence references fabricated artifact IDs", async () => {
      const context = requireOrgContext(orgA);
      const pipeline = await runAuthorizedResearchPipeline({
        datasetName: "ri-promotion-gate-run",
        strategyVersion: RESEARCH_PIPELINE_BASE.strategyVersion,
      });

      const paperDocument = await buildPaperEvaluationExportDocument({
        context,
        orderRepository: mockRepository([
          mockOrder({ id: "ri-buy", avgFillPrice: "100" }, orgA),
          mockOrder({ id: "ri-sell", side: "sell", avgFillPrice: "110" }, orgA),
        ]),
        window: { start: new Date(100), end: new Date(200) },
        strategySignalIds: [STRATEGY_SIGNAL],
        executionMode: "paper",
        exportedAt: new Date("2026-06-18T12:00:00.000Z"),
      });

      const walkForwardMetrics = (
        await listWalkForwardWindowsForCandidatePostgres(db, context, pipeline.strategyCandidateId)
      ).map((window) => parseResearchValidationMetricsJson(window.metricsJson));
      const originalEvidence = buildHtrGap044ResearchEvidenceDocumentFromPipeline({
        organizationId: orgA,
        strategyId: RESEARCH_PIPELINE_BASE.strategyId,
        strategyVersion: RESEARCH_PIPELINE_BASE.strategyVersion,
        costModelVersion: RESEARCH_PIPELINE_COST_MODEL.version,
        pipeline,
        walkForwardMetrics,
      });
      await validateResearchEvidenceProvenancePostgres(db, context, originalEvidence);
      const tamperedEvidence = structuredClone(originalEvidence);
      tamperedEvidence.evidenceBody.backtestRunId = crypto.randomUUID();
      tamperedEvidence.envelope.contentDigest = computeResearchEvidenceExportDigest(
        tamperedEvidence.evidenceBody,
      );

      const assemblyInput = {
        organizationId: orgA,
        strategyId: MEAN_REVERSION_V0,
        strategyVersion: "0.1.0",
        gitCommitSha: "fa63f09661884594f0a8f7e2aab4d46bfda21cde",
        hypothesis: "Mean reversion in range",
        intendedRegime: "RANGE",
        costModel: {
          feesBps: RESEARCH_PIPELINE_COST_MODEL.feesBps,
          slippageBps: RESEARCH_PIPELINE_COST_MODEL.slippageBps,
        },
        failureModes: ["liquidity vacuum"],
        reasonCodeDistribution: { STRAT_MR_ZSCORE_BUY: 3 },
        paperTradingEvidenceDocument: paperDocument,
        researchEvidenceDocument: tamperedEvidence,
        confidenceAttestation: {
          edgeNetOfCosts: "Net edge after costs.",
          liveTracksPaper: "Live should track paper.",
          downsideRiskBounded: "Risk engine caps downside.",
        },
      };

      const service = createPostgresStrategyPromotionService(db);
      await expect(
        service.requestPromotion(SERVICE_ACTOR, context, {
          idempotencyKey: crypto.randomUUID(),
          assembly: assemblyInput,
        }),
      ).rejects.toMatchObject({ code: "RESEARCH_EVIDENCE_BACKTEST_RUN_NOT_FOUND" });
    });

    it("accepts matching pipeline evidence into pending confirmation, without claiming scientific admission", async () => {
      const context = requireOrgContext(orgA);
      const pipeline = await runAuthorizedResearchPipeline({
        datasetName: "ri-promotion-accept-run",
        strategyVersion: RESEARCH_PIPELINE_BASE.strategyVersion,
      });

      const walkForwardMetrics = (
        await listWalkForwardWindowsForCandidatePostgres(db, context, pipeline.strategyCandidateId)
      ).map((window) => parseResearchValidationMetricsJson(window.metricsJson));
      const promotionResearchEvidence = buildHtrGap044ResearchEvidenceDocumentFromPipeline({
        organizationId: orgA,
        strategyId: RESEARCH_PIPELINE_BASE.strategyId,
        strategyVersion: RESEARCH_PIPELINE_BASE.strategyVersion,
        costModelVersion: RESEARCH_PIPELINE_COST_MODEL.version,
        pipeline,
        walkForwardMetrics,
      });
      await validateResearchEvidenceProvenancePostgres(db, context, promotionResearchEvidence);

      const paperDocument = await buildPaperEvaluationExportDocument({
        context,
        orderRepository: mockRepository([
          mockOrder({ id: "ri-accept-buy", avgFillPrice: "100" }, orgA),
          mockOrder({ id: "ri-accept-sell", side: "sell", avgFillPrice: "110" }, orgA),
        ]),
        window: { start: new Date(100), end: new Date(200) },
        strategySignalIds: [STRATEGY_SIGNAL],
        executionMode: "paper",
        exportedAt: new Date("2026-06-18T12:00:00.000Z"),
      });

      const assemblyInput = {
        organizationId: orgA,
        strategyId: MEAN_REVERSION_V0,
        strategyVersion: "0.1.0",
        gitCommitSha: "fa63f09661884594f0a8f7e2aab4d46bfda21cde",
        hypothesis: "Mean reversion in range",
        intendedRegime: "RANGE",
        costModel: {
          feesBps: RESEARCH_PIPELINE_COST_MODEL.feesBps,
          slippageBps: RESEARCH_PIPELINE_COST_MODEL.slippageBps,
        },
        failureModes: ["liquidity vacuum"],
        reasonCodeDistribution: { STRAT_MR_ZSCORE_BUY: 3 },
        paperTradingEvidenceDocument: paperDocument,
        researchEvidenceDocument: promotionResearchEvidence,
        confidenceAttestation: {
          edgeNetOfCosts: "Net edge after costs.",
          liveTracksPaper: "Live should track paper.",
          downsideRiskBounded: "Risk engine caps downside.",
        },
      };

      const service = createPostgresStrategyPromotionService(db);
      const record = await service.requestPromotion(SERVICE_ACTOR, context, {
        idempotencyKey: crypto.randomUUID(),
        assembly: assemblyInput,
      });
      expect(record.state).toBe("PENDING_CONFIRM");
      // This only proves an artifact-backed review request was created; no
      // independent scientific admission record is part of this legacy path.
      expect(record.researchEvidence?.contentDigest).toBe(
        promotionResearchEvidence.envelope.contentDigest,
      );
    });

    it("denies authenticated role direct reads on research tables (0065 RLS)", async () => {
      const sql = postgres(url!, { max: 1, prepare: false });
      try {
        await sql.unsafe(`SET ROLE authenticated`);
        await expect(sql.unsafe(`SELECT 1 FROM research_dataset LIMIT 1`)).rejects.toThrow();
        await expect(sql.unsafe(`SELECT 1 FROM trader_market_bars LIMIT 1`)).rejects.toThrow();
      } finally {
        await sql.unsafe(`RESET ROLE`);
        await sql.end({ timeout: 5 });
      }
    });
  },
);
