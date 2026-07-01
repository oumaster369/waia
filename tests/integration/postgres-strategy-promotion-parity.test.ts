/**
 * IMP-U1 S5 — Strategy promotion Postgres repository + service parity (opt-in).
 *
 * Enable with: WAIA_PG_INTEGRATION=1 + DATABASE_URL_POSTGRES (see docs/postgres-development.md).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
import type {
  FillRow,
  OrderRepository,
  OrderRow,
} from "@/lib/trader/execution/order-repository.types";
import { buildPaperEvaluationExportDocument } from "@/lib/trader/paper/build-paper-evaluation-export";
import { traderAuditActions } from "@/lib/trader/types";
import {
  assertStrategyLiveAuthorized,
  createPostgresStrategyPromotionService,
  StrategyPromotionCoolingOffNotElapsedError,
  StrategyPromotionVersionMismatchError,
} from "@/lib/trader/validation-gate";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { buildValidResearchEvidenceDocument } from "@/tests/helpers/build-research-evidence-fixture";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

const USER_A = "00000000-0000-4000-8000-0000000357a1";
const STRATEGY_SIGNAL = "signal-357-pg-parity";
const SERVICE_ACTOR = { actorType: "service" as const, actorId: null };

function mockOrder(overrides: Partial<OrderRow> & Pick<OrderRow, "id">, orgId: string): OrderRow {
  return {
    credentialId: null,
    venue: "mock",
    executionMode: "mock",
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
    riskDecisionId: "risk-357",
    strategySignalId: STRATEGY_SIGNAL,
    allocationDecisionId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    organizationId: orgId,
    ...overrides,
  };
}

function mockFill(orderId: string, orgId: string): FillRow {
  return {
    id: `fill-${orderId}`,
    organizationId: orgId,
    orderId,
    exchangeTradeId: `trade-${orderId}`,
    price: "64000",
    quantity: "0.01",
    fee: "0",
    feeAsset: "USDT",
    executedAt: new Date(0),
    createdAt: new Date(0),
  };
}

function mockRepository(orders: OrderRow[]): OrderRepository {
  const fillsByOrderId: Record<string, FillRow[]> = {};
  for (const order of orders) {
    fillsByOrderId[order.id] = [mockFill(order.id, order.organizationId)];
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

async function buildAssembly(orgId: string, strategyId: string, strategyVersion = "0.1.0") {
  const buy = mockOrder(
    { id: `gov-buy-${strategyId}`, avgFillPrice: "100", executionMode: "paper" },
    orgId,
  );
  const sell = mockOrder(
    { id: `gov-sell-${strategyId}`, side: "sell", avgFillPrice: "110", executionMode: "paper" },
    orgId,
  );
  const document = await buildPaperEvaluationExportDocument({
    context: requireOrgContext(orgId),
    orderRepository: mockRepository([buy, sell]),
    window: { start: new Date(100), end: new Date(200) },
    strategySignalIds: [STRATEGY_SIGNAL],
    executionMode: "paper",
    exportedAt: new Date("2026-06-18T12:00:00.000Z"),
  });

  return {
    organizationId: orgId,
    strategyId,
    strategyVersion,
    gitCommitSha: "fa63f09661884594f0a8f7e2aab4d46bfda21cde",
    hypothesis: "Mean reversion in range",
    intendedRegime: "RANGE",
    costModel: { feesBps: "10", slippageBps: "5" },
    failureModes: ["liquidity vacuum"],
    reasonCodeDistribution: { STRAT_MR_ZSCORE_BUY: 3 },
    paperTradingEvidenceDocument: document,
    researchEvidenceDocument: buildValidResearchEvidenceDocument(orgId, { strategyId }),
    confidenceAttestation: {
      edgeNetOfCosts: "Net edge after costs.",
      liveTracksPaper: "Live should track paper.",
      downsideRiskBounded: "Risk engine caps downside.",
    },
  };
}

async function auditActionsForRecord(recordId: string): Promise<string[]> {
  const db = getPostgresDrizzle();
  const rows = await db
    .select({ action: pgSchema.auditLogs.action })
    .from(pgSchema.auditLogs)
    .where(eq(pgSchema.auditLogs.entityId, recordId));
  return rows.map((row) => row.action);
}

describe.skipIf(!integrationEnabled || !url)(
  "postgres strategy promotion parity (IMP-U1 S5)",
  () => {
    let orgA: string;

    async function cleanup(): Promise<void> {
      const sql = postgres(url!, { max: 1 });
      try {
        const orgId = personalOrganizationIdFromUserId(USER_A);
        await sql.unsafe(`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_block_delete`);
        await sql.unsafe(
          `DELETE FROM audit_logs WHERE organization_id = $1 OR entity_id IN (
          SELECT id::text FROM trader_strategy_promotion_records WHERE organization_id = $1
        )`,
          [orgId],
        );
        await sql.unsafe(`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_block_delete`);
        await sql.unsafe(
          `DELETE FROM trader_strategy_promotion_records WHERE organization_id = $1`,
          [orgId],
        );
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

      const db = getPostgresDrizzle();
      await db.insert(pgSchema.users).values({
        id: USER_A,
        identityLabel: "Strategy Promotion Postgres Parity",
        email: "promotion-pg-parity-357@waia.invalid",
        passwordHash: null,
      });

      orgA = await ensureUserCoreSeedPostgres(db, {
        userId: USER_A,
        displayName: "Strategy Promotion Postgres Parity",
      });
    });

    afterAll(async () => {
      await cleanup();
      await resetPostgresSingletonForTests();
    });

    it("runs request -> confirm -> effective with cooling-off and audit trail", async () => {
      const db = getPostgresDrizzle();
      let now = Date.now();
      const service = createPostgresStrategyPromotionService(db, {
        nowMs: () => now,
        validateResearchProvenance: false,
      });
      const context = requireOrgContext(orgA);
      const strategyId = "mean_reversion_v0_pg_fsm";

      const requested = await service.requestPromotion(SERVICE_ACTOR, context, {
        idempotencyKey: randomUUID(),
        assembly: await buildAssembly(orgA, strategyId),
      });
      expect(requested.state).toBe("PENDING_CONFIRM");

      const confirmed = await service.confirmPromotion(SERVICE_ACTOR, context, requested.id, {
        expectedStateVersion: requested.stateVersion,
        coolingOffMs: 1_000,
      });
      expect(confirmed.state).toBe("COOLING_OFF");

      await expect(
        service.markEffective(SERVICE_ACTOR, context, requested.id, {
          expectedStateVersion: confirmed.stateVersion,
        }),
      ).rejects.toThrow(StrategyPromotionCoolingOffNotElapsedError);

      now += 1_000;

      const effective = await service.markEffective(SERVICE_ACTOR, context, requested.id, {
        expectedStateVersion: confirmed.stateVersion,
      });
      expect(effective.state).toBe("EFFECTIVE");

      const auditActions = await auditActionsForRecord(requested.id);
      expect(auditActions).toContain(traderAuditActions.promotionRequested);
      expect(auditActions).toContain(traderAuditActions.promotionConfirmed);
      expect(auditActions).toContain(traderAuditActions.promotionEffective);
    });

    it("replays requestPromotion with the same idempotency key", async () => {
      const db = getPostgresDrizzle();
      const service = createPostgresStrategyPromotionService(db, {
        validateResearchProvenance: false,
      });
      const context = requireOrgContext(orgA);
      const idempotencyKey = randomUUID();
      const assembly = await buildAssembly(orgA, "mean_reversion_v0_pg_idem");

      const first = await service.requestPromotion(SERVICE_ACTOR, context, {
        idempotencyKey,
        assembly,
      });
      const second = await service.requestPromotion(SERVICE_ACTOR, context, {
        idempotencyKey,
        assembly,
      });

      expect(second.id).toBe(first.id);
      expect(second.state).toBe("PENDING_CONFIRM");
    });

    it("getEffectivePromotion returns version-bound EFFECTIVE record", async () => {
      const db = getPostgresDrizzle();
      let now = Date.now();
      const service = createPostgresStrategyPromotionService(db, {
        nowMs: () => now,
        validateResearchProvenance: false,
      });
      const context = requireOrgContext(orgA);
      const strategyId = "mean_reversion_v0_pg_effective";

      const requested = await service.requestPromotion(SERVICE_ACTOR, context, {
        idempotencyKey: randomUUID(),
        assembly: await buildAssembly(orgA, strategyId, "0.1.0"),
      });
      const confirmed = await service.confirmPromotion(SERVICE_ACTOR, context, requested.id, {
        expectedStateVersion: requested.stateVersion,
        coolingOffMs: 1,
      });
      now += 2;
      await service.markEffective(SERVICE_ACTOR, context, requested.id, {
        expectedStateVersion: confirmed.stateVersion,
      });

      const effective = await service.getEffectivePromotion(context, strategyId);
      expect(effective).not.toBeNull();
      expect(effective?.state).toBe("EFFECTIVE");
      expect(effective?.strategyVersion).toBe("0.1.0");
    });

    it("isLiveAuthorized fails closed on version drift", async () => {
      const db = getPostgresDrizzle();
      let now = Date.now();
      const service = createPostgresStrategyPromotionService(db, {
        nowMs: () => now,
        validateResearchProvenance: false,
      });
      const context = requireOrgContext(orgA);
      const strategyId = "mean_reversion_v0_pg_drift";

      const requested = await service.requestPromotion(SERVICE_ACTOR, context, {
        idempotencyKey: randomUUID(),
        assembly: await buildAssembly(orgA, strategyId, "0.1.0"),
      });
      const confirmed = await service.confirmPromotion(SERVICE_ACTOR, context, requested.id, {
        expectedStateVersion: requested.stateVersion,
        coolingOffMs: 1,
      });
      now += 2;
      await service.markEffective(SERVICE_ACTOR, context, requested.id, {
        expectedStateVersion: confirmed.stateVersion,
      });

      expect(
        await service.isLiveAuthorized(context, {
          strategyId,
          strategyVersion: "0.1.0",
        }),
      ).toBe(true);

      expect(
        await service.isLiveAuthorized(context, {
          strategyId,
          strategyVersion: "0.2.0",
        }),
      ).toBe(false);
    });

    it("assertStrategyLiveAuthorized throws on version mismatch", async () => {
      const db = getPostgresDrizzle();
      let now = Date.now();
      const service = createPostgresStrategyPromotionService(db, {
        nowMs: () => now,
        validateResearchProvenance: false,
      });
      const context = requireOrgContext(orgA);
      const strategyId = "mean_reversion_v0_pg_assert";

      const requested = await service.requestPromotion(SERVICE_ACTOR, context, {
        idempotencyKey: randomUUID(),
        assembly: await buildAssembly(orgA, strategyId, "0.1.0"),
      });
      const confirmed = await service.confirmPromotion(SERVICE_ACTOR, context, requested.id, {
        expectedStateVersion: requested.stateVersion,
        coolingOffMs: 1,
      });
      now += 2;
      await service.markEffective(SERVICE_ACTOR, context, requested.id, {
        expectedStateVersion: confirmed.stateVersion,
      });

      await expect(
        assertStrategyLiveAuthorized(service, context, {
          strategyId,
          strategyVersion: "0.2.0",
        }),
      ).rejects.toThrow(StrategyPromotionVersionMismatchError);
    });
  },
);
