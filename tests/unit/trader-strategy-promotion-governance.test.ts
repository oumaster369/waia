import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { auditLogs } from "@/db/schema";
import type {
  FillRow,
  OrderRepository,
  OrderRow,
} from "@/lib/trader/execution/order-repository.types";
import { buildPaperEvaluationExportDocument } from "@/lib/trader/paper/build-paper-evaluation-export";
import {
  assertStrategyLiveAuthorized,
  createSqliteStrategyPromotionService,
  StrategyPromotionCoolingOffNotElapsedError,
  StrategyPromotionRequiredError,
  StrategyPromotionVersionMismatchError,
} from "@/lib/trader/validation-gate";
import { traderAuditActions } from "@/lib/trader/types";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { buildValidResearchEvidenceDocument } from "@/tests/helpers/build-research-evidence-fixture";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000272a";
const STRATEGY_ID = "mean_reversion_v0";
const STRATEGY_SIGNAL = "signal-272-gov";
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
    riskDecisionId: "risk-272",
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
    recordFillProgress: async () => {
      throw new Error("not implemented");
    },
    listEvents: async () => [],
    listFills: async (_context, orderId) => fillsByOrderId[orderId] ?? [],
  };
}

async function buildAssembly(orgId: string, strategyId = STRATEGY_ID, strategyVersion = "0.1.0") {
  const buy = mockOrder({ id: "gov-buy", avgFillPrice: "100" }, orgId);
  const sell = mockOrder({ id: "gov-sell", side: "sell", avgFillPrice: "110" }, orgId);
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

describe("strategy promotion governance (DEE-178 S3–S5)", () => {
  let orgA: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-strategy-promotion-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "strategy-promotion.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "promotion-gov@waia.invalid",
      password: "password123",
      identityLabel: "Promotion Gov",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Promotion Org A" });
  });

  it("runs request -> confirm -> effective with cooling-off", async () => {
    const db = getDb();
    let now = Date.now();
    const service = createSqliteStrategyPromotionService(db, { nowMs: () => now });
    const context = requireOrgContext(orgA);

    const requested = await service.requestPromotion(SERVICE_ACTOR, context, {
      idempotencyKey: randomUUID(),
      assembly: await buildAssembly(orgA, "mean_reversion_v0_flow"),
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

    const auditActions = db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.entityId, requested.id))
      .all()
      .map((row) => row.action);

    expect(auditActions).toContain(traderAuditActions.promotionRequested);
    expect(auditActions).toContain(traderAuditActions.promotionConfirmed);
    expect(auditActions).toContain(traderAuditActions.promotionEffective);
  });

  it("cancels during cooling-off", async () => {
    const db = getDb();
    const now = Date.now();
    const service = createSqliteStrategyPromotionService(db, { nowMs: () => now });
    const context = requireOrgContext(orgA);

    const requested = await service.requestPromotion(SERVICE_ACTOR, context, {
      idempotencyKey: randomUUID(),
      assembly: await buildAssembly(orgA, "mean_reversion_v0_cancel"),
    });

    const confirmed = await service.confirmPromotion(SERVICE_ACTOR, context, requested.id, {
      expectedStateVersion: requested.stateVersion,
      coolingOffMs: 60_000,
    });

    const cancelled = await service.cancelPromotion(SERVICE_ACTOR, context, requested.id, {
      expectedStateVersion: confirmed.stateVersion,
    });
    expect(cancelled.state).toBe("CANCELLED");
  });

  it("demotes effective promotion and blocks live authorization", async () => {
    const db = getDb();
    let now = Date.now();
    const service = createSqliteStrategyPromotionService(db, { nowMs: () => now });
    const context = requireOrgContext(orgA);

    const requested = await service.requestPromotion(SERVICE_ACTOR, context, {
      idempotencyKey: randomUUID(),
      assembly: await buildAssembly(orgA, "mean_reversion_v0_demote"),
    });
    const confirmed = await service.confirmPromotion(SERVICE_ACTOR, context, requested.id, {
      expectedStateVersion: requested.stateVersion,
      coolingOffMs: 1,
    });
    now += 2;
    const effective = await service.markEffective(SERVICE_ACTOR, context, requested.id, {
      expectedStateVersion: confirmed.stateVersion,
    });
    expect(effective.state).toBe("EFFECTIVE");

    await assertStrategyLiveAuthorized(service, context, {
      strategyId: "mean_reversion_v0_demote",
      strategyVersion: "0.1.0",
    });

    const demoted = await service.demoteStrategy(
      SERVICE_ACTOR,
      context,
      "mean_reversion_v0_demote",
      {
        expectedStateVersion: effective.stateVersion,
        reason: "operator review",
      },
    );
    expect(demoted.state).toBe("REVOKED");

    await expect(
      assertStrategyLiveAuthorized(service, context, {
        strategyId: "mean_reversion_v0_demote",
        strategyVersion: "0.1.0",
      }),
    ).rejects.toThrow(StrategyPromotionRequiredError);
  });

  it("isLiveAuthorized fails closed on version drift", async () => {
    const db = getDb();
    let now = Date.now();
    const service = createSqliteStrategyPromotionService(db, { nowMs: () => now });
    const context = requireOrgContext(orgA);

    const requested = await service.requestPromotion(SERVICE_ACTOR, context, {
      idempotencyKey: randomUUID(),
      assembly: await buildAssembly(orgA, "mean_reversion_v0_drift"),
    });
    const confirmed = await service.confirmPromotion(SERVICE_ACTOR, context, requested.id, {
      expectedStateVersion: requested.stateVersion,
      coolingOffMs: 1,
    });
    now += 2;
    await service.markEffective(SERVICE_ACTOR, context, requested.id, {
      expectedStateVersion: confirmed.stateVersion,
    });

    const authorized = await service.isLiveAuthorized(context, {
      strategyId: "mean_reversion_v0_drift",
      strategyVersion: "0.1.0",
    });
    expect(authorized).toBe(true);

    const drift = await service.isLiveAuthorized(context, {
      strategyId: "mean_reversion_v0_drift",
      strategyVersion: "0.2.0",
    });
    expect(drift).toBe(false);

    await expect(
      assertStrategyLiveAuthorized(service, context, {
        strategyId: "mean_reversion_v0_drift",
        strategyVersion: "0.2.0",
      }),
    ).rejects.toThrow(StrategyPromotionVersionMismatchError);
  });
});
