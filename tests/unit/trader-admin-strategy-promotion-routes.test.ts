import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { userPlatformRoles } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { AdminRouteHandlerDeps } from "@/lib/trader/admin-route-shared";
import type {
  FillRow,
  OrderRepository,
  OrderRow,
} from "@/lib/trader/execution/order-repository.types";
import { buildPaperEvaluationExportDocument } from "@/lib/trader/paper/build-paper-evaluation-export";
import {
  handleAdminStrategyPromotionCommandPost,
  handleAdminStrategyPromotionsGet,
} from "@/lib/trader/validation-gate/admin-route-handler";
import { REQUIRED_EFFECTIVE_ACK } from "@/lib/trader/validation-gate/operator-promotion-inputs";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { buildValidResearchEvidenceDocument } from "@/tests/helpers/build-research-evidence-fixture";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const ADMIN_ID = "00000000-0000-4000-8000-00000000d804";
const SIGNAL = "signal-s4-route";

function createDeps(getUserId: () => Promise<string | null>): AdminRouteHandlerDeps {
  return {
    getUserId,
    getRuntimeDb: getWaiaRuntimeDb,
    disposeRuntimeDb: disposeWaiaRuntimeDb,
  };
}

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
    riskDecisionId: "risk-s4",
    strategySignalId: SIGNAL,
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

async function buildEvidenceObject(orgId: string) {
  return buildPaperEvaluationExportDocument({
    context: requireOrgContext(orgId),
    orderRepository: mockRepository([
      mockOrder({ id: "s4-buy", avgFillPrice: "100" }, orgId),
      mockOrder({ id: "s4-sell", side: "sell", avgFillPrice: "110" }, orgId),
    ]),
    window: { start: new Date(100), end: new Date(200) },
    strategySignalIds: [SIGNAL],
    executionMode: "paper",
    exportedAt: new Date("2026-06-18T12:00:00.000Z"),
  });
}

function buildInputsObject(strategyId: string, strategyVersion = "0.1.0") {
  return {
    strategyId,
    strategyVersion,
    gitCommitSha: "fa63f09661884594f0a8f7e2aab4d46bfda21cde",
    hypothesis: "Mean reversion in range",
    intendedRegime: "RANGE",
    costModel: { feesBps: "10", slippageBps: "25" },
    failureModes: ["liquidity vacuum -> exposure cap"],
    reasonCodeDistribution: { STRAT_MR_ZSCORE_BUY: 3 },
    confidenceAttestation: {
      edgeNetOfCosts: "Net edge after costs.",
      liveTracksPaper: "Live should track paper.",
      downsideRiskBounded: "Risk engine caps downside.",
    },
  };
}

async function postCommand(
  deps: AdminRouteHandlerDeps,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const result = await handleAdminStrategyPromotionCommandPost(
    new Request("http://localhost/api/trader/admin/strategy-promotions/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    deps,
  );
  return { status: result.status, body: result.body as Record<string, unknown> };
}

async function getPromotions(
  deps: AdminRouteHandlerDeps,
  organizationId: string,
  strategyId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const result = await handleAdminStrategyPromotionsGet(
    new Request(
      `http://localhost/api/trader/admin/strategy-promotions?organization_id=${encodeURIComponent(organizationId)}&strategy_id=${encodeURIComponent(strategyId)}`,
    ),
    deps,
  );
  return { status: result.status, body: result.body as Record<string, unknown> };
}

describe("trader admin strategy promotion routes (IMP-U1 S4)", () => {
  let db: WaiaDb;
  let orgId: string;
  let adminDeps: AdminRouteHandlerDeps;
  let unauthenticatedDeps: AdminRouteHandlerDeps;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-trader-admin-promotion-routes-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "admin-promotion-routes.sqlite")}`;
    migrateDatabaseFromEnv();
    db = getDb();

    insertEmailPasswordUser(db, {
      id: ADMIN_ID,
      email: "admin-promotion-routes@waia.invalid",
      password: "password123",
    });
    orgId = ensureUserCoreSeedSqlite(db, {
      userId: ADMIN_ID,
      displayName: "Promotion Routes Admin",
    });

    db.update(userPlatformRoles)
      .set({ role: "admin" })
      .where(eq(userPlatformRoles.userId, ADMIN_ID))
      .run();

    adminDeps = createDeps(async () => ADMIN_ID);
    unauthenticatedDeps = createDeps(async () => null);
  });

  it("returns 401 when unauthenticated for strategy promotion GET", async () => {
    const result = await getPromotions(unauthenticatedDeps, orgId, "mean_reversion_v0");
    expect(result.status).toBe(401);
  });

  it("returns 401 when unauthenticated for strategy promotion POST", async () => {
    const result = await postCommand(unauthenticatedDeps, {
      command: "request",
      organization_id: orgId,
      strategy_id: "mean_reversion_v0",
      evidence: {},
      inputs: {},
    });
    expect(result.status).toBe(401);
  });

  it("runs request -> confirm -> mark-effective via handlers with pending GET", async () => {
    const strategyId = "mean_reversion_v0_s4_fsm";
    const evidence = await buildEvidenceObject(orgId);
    const inputs = buildInputsObject(strategyId);

    const requestResult = await postCommand(adminDeps, {
      command: "request",
      organization_id: orgId,
      strategy_id: strategyId,
      idempotency_key: randomUUID(),
      evidence,
      research_evidence: buildValidResearchEvidenceDocument(orgId, { strategyId }),
      inputs,
    });
    expect(requestResult.status).toBe(200);
    const requested = requestResult.body.record as {
      id: string;
      state: string;
      stateVersion: number;
    };
    expect(requested.state).toBe("PENDING_CONFIRM");

    const getAfterRequest = await getPromotions(adminDeps, orgId, strategyId);
    expect(getAfterRequest.status).toBe(200);
    expect(getAfterRequest.body.effective).toBeNull();
    const pending = getAfterRequest.body.pending as { id: string; state: string };
    expect(pending.id).toBe(requested.id);
    expect(pending.state).toBe("PENDING_CONFIRM");

    const confirmResult = await postCommand(adminDeps, {
      command: "confirm",
      organization_id: orgId,
      strategy_id: strategyId,
      record_id: requested.id,
      expected_state_version: requested.stateVersion,
      cooling_off_ms: 1,
    });
    expect(confirmResult.status).toBe(200);
    const confirmed = confirmResult.body.record as { state: string; stateVersion: number };
    expect(confirmed.state).toBe("COOLING_OFF");

    const effectiveResult = await postCommand(adminDeps, {
      command: "mark-effective",
      organization_id: orgId,
      strategy_id: strategyId,
      record_id: requested.id,
      expected_state_version: confirmed.stateVersion,
      ack: REQUIRED_EFFECTIVE_ACK,
    });
    expect(effectiveResult.status).toBe(200);
    const effective = effectiveResult.body.record as { state: string };
    expect(effective.state).toBe("EFFECTIVE");
  });

  it("returns 400 for invalid evidence on request", async () => {
    const strategyId = "mean_reversion_v0_s4_bad_evidence";
    const result = await postCommand(adminDeps, {
      command: "request",
      organization_id: orgId,
      strategy_id: strategyId,
      evidence: { schemaVersion: "not-valid" },
      inputs: buildInputsObject(strategyId),
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatchObject({
      code: expect.any(String),
      message: expect.any(String),
    });
  });

  it("returns 400 for wrong ack on mark-effective", async () => {
    const strategyId = "mean_reversion_v0_s4_wrong_ack";
    const evidence = await buildEvidenceObject(orgId);
    const requestResult = await postCommand(adminDeps, {
      command: "request",
      organization_id: orgId,
      strategy_id: strategyId,
      idempotency_key: randomUUID(),
      evidence,
      research_evidence: buildValidResearchEvidenceDocument(orgId, { strategyId }),
      inputs: buildInputsObject(strategyId),
    });
    expect(requestResult.status).toBe(200);
    const requested = requestResult.body.record as { id: string; stateVersion: number };

    const confirmResult = await postCommand(adminDeps, {
      command: "confirm",
      organization_id: orgId,
      strategy_id: strategyId,
      record_id: requested.id,
      expected_state_version: requested.stateVersion,
      cooling_off_ms: 1,
    });
    expect(confirmResult.status).toBe(200);
    const confirmed = confirmResult.body.record as { stateVersion: number };

    const markResult = await postCommand(adminDeps, {
      command: "mark-effective",
      organization_id: orgId,
      strategy_id: strategyId,
      record_id: requested.id,
      expected_state_version: confirmed.stateVersion,
      ack: "wrong ack phrase",
    });
    expect(markResult.status).toBe(400);
    expect(markResult.body.error).toMatchObject({
      code: "OperatorRunwayInputError",
    });
  });
});
