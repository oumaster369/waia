/**
 * RI-INTEGRATION-1 — Research Intelligence operational spine (opt-in Postgres).
 *
 * Enable with: WAIA_PG_INTEGRATION=1 + DATABASE_URL_POSTGRES (see docs/postgres-development.md).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
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
import { insertMarketBarsPostgres } from "@/lib/trader/market-data/market-bars-repository-postgres";
import { getResearchDatasetByIdPostgres } from "@/lib/trader/market-data/research-dataset-repository-postgres";
import { runResearchPipelinePostgres } from "@/lib/trader/research/research-orchestrator";
import { validateResearchEvidenceProvenancePostgres } from "@/lib/trader/research/validate-research-evidence-provenance";
import { createInMemoryOrderRateStore } from "@/lib/trader/risk/order-rate-store";
import {
  createKillSwitchResolver,
  createPostgresKillSwitchRepository,
  createPostgresRiskEngineService,
  createPostgresRiskLimitsService,
} from "@/lib/trader/risk";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { writeTraderAuditLogPostgres } from "@/lib/trader/audit/write";
import {
  createPostgresStrategyPromotionService,
  StrategyPromotionValidationError,
} from "@/lib/trader/validation-gate";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import {
  buildResearchIntegrationBars,
  RESEARCH_INTEGRATION_BAR_COUNT,
} from "@/tests/helpers/build-research-integration-bars";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

const USER_A = "00000000-0000-4000-8000-0000000400a1";
const STRATEGY_SIGNAL = "signal-400-ri";
const SERVICE_ACTOR = { actorType: "service" as const, actorId: null };

/** Validation split is 46 bars at 230 total; OOS windows must satisfy the 20-bar backtest minimum. */
const RESEARCH_PIPELINE_OOS_BAR_COUNT = 20;

const RESEARCH_PIPELINE_BASE = {
  symbol: "BTC/USDT" as const,
  interval: "1m" as const,
  strategyId: MEAN_REVERSION_V0,
  strategyVersion: "0.1.0",
  oosBarCount: RESEARCH_PIPELINE_OOS_BAR_COUNT,
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
    listEvents: async () => [],
    listFills: async (_context, orderId) => fillsByOrderId[orderId] ?? [],
  };
}

async function buildPostgresResearchDeps(
  db: ReturnType<typeof getPostgresDrizzle>,
  orgId: string,
): Promise<PaperCycleDeps> {
  const context = requireOrgContext(orgId);
  const writeAudit = (input: Parameters<typeof writeTraderAuditLogPostgres>[1]) =>
    writeTraderAuditLogPostgres(db, input);
  const nowMs = () => Date.now();
  const connector = new MockExchangeConnector();
  await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });

  const limits = createPostgresRiskLimitsService(db);
  await limits.upsertLimitsForOrg(context, {
    ...DEFAULT_ORG_RISK_LIMITS,
    maxOrdersPerWindow: 500,
  });

  const killSwitchResolver = createKillSwitchResolver({
    repository: createPostgresKillSwitchRepository(db),
    nowMs,
  });
  const orderRepository = createPostgresOrderRepository(db);
  const riskEngine = createPostgresRiskEngineService(db, {
    limitsService: limits,
    killSwitchResolver,
    rateStore: createInMemoryOrderRateStore(),
    writeAudit,
    nowMs,
    newDecisionId: () => crypto.randomUUID(),
  });

  return {
    execution: createOrderExecutionServiceFromDeps({
      riskEngine,
      orderRepository,
      killSwitchResolver,
      connectorForMode: () => connector,
      writeAudit,
      nowMs,
    }),
    reconciliation: createPostgresReconciliationService(db, {
      connectorForMode: () => connector,
      nowMs,
      writeAudit,
    }),
  };
}

describe.skipIf(!integrationEnabled || !url)(
  "postgres research intelligence parity (RI-INTEGRATION-1)",
  () => {
    let orgA: string;
    let db: ReturnType<typeof getPostgresDrizzle>;

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
      const sql = postgres(url!, { max: 1 });
      try {
        await sql.unsafe(`INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [
          USER_A,
        ]);
      } finally {
        await sql.end({ timeout: 5 });
      }

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
      const deps = await buildPostgresResearchDeps(db, orgA);
      const pipelineInput = {
        context,
        deps,
        createOrderRepository: () => createPostgresOrderRepository(db),
        newId: createResearchPipelineIdFactory(),
        ...RESEARCH_PIPELINE_BASE,
      };

      const first = await runResearchPipelinePostgres(db, {
        ...pipelineInput,
        datasetName: "ri-integration-run-1",
      });

      await cleanupResearchArtifacts(orgA);

      const second = await runResearchPipelinePostgres(db, {
        ...pipelineInput,
        newId: createResearchPipelineIdFactory(),
        datasetName: "ri-integration-run-2",
      });

      expect(first.evidenceDocument.envelope.contentDigest).toBe(
        second.evidenceDocument.envelope.contentDigest,
      );

      const dataset = await getResearchDatasetByIdPostgres(db, context, first.dataset.id);
      expect(dataset?.trainBarCount).toBeGreaterThan(0);
      expect(dataset?.validationBarCount).toBeGreaterThan(0);
      expect(dataset?.blindBarCount).toBeGreaterThan(0);

      await validateResearchEvidenceProvenancePostgres(db, context, first.evidenceDocument);

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
      expect(edgeRows.some((row) => row.relationKind === "validated_by_research_pipeline")).toBe(
        true,
      );
    });

    it("rejects promotion when research evidence references fabricated artifact IDs", async () => {
      const context = requireOrgContext(orgA);
      const deps = await buildPostgresResearchDeps(db, orgA);
      const pipeline = await runResearchPipelinePostgres(db, {
        context,
        datasetName: "ri-promotion-gate-run",
        deps,
        createOrderRepository: () => createPostgresOrderRepository(db),
        ...RESEARCH_PIPELINE_BASE,
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

      const tamperedEvidence = structuredClone(pipeline.evidenceDocument);
      tamperedEvidence.evidenceBody.backtestRunId = crypto.randomUUID();

      const assemblyInput = {
        organizationId: orgA,
        strategyId: MEAN_REVERSION_V0,
        strategyVersion: "0.1.0",
        gitCommitSha: "fa63f09661884594f0a8f7e2aab4d46bfda21cde",
        hypothesis: "Mean reversion in range",
        intendedRegime: "RANGE",
        costModel: { feesBps: "10", slippageBps: "5" },
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
      ).rejects.toThrow(StrategyPromotionValidationError);
    });

    it("accepts promotion when research evidence matches persisted pipeline artifacts", async () => {
      const context = requireOrgContext(orgA);
      const deps = await buildPostgresResearchDeps(db, orgA);
      const pipeline = await runResearchPipelinePostgres(db, {
        context,
        datasetName: "ri-promotion-accept-run",
        deps,
        createOrderRepository: () => createPostgresOrderRepository(db),
        ...RESEARCH_PIPELINE_BASE,
      });

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
        costModel: { feesBps: "10", slippageBps: "5" },
        failureModes: ["liquidity vacuum"],
        reasonCodeDistribution: { STRAT_MR_ZSCORE_BUY: 3 },
        paperTradingEvidenceDocument: paperDocument,
        researchEvidenceDocument: pipeline.evidenceDocument,
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
      expect(record.researchEvidence?.contentDigest).toBe(
        pipeline.evidenceDocument.envelope.contentDigest,
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
