import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { ExchangeConnector } from "@/lib/trader/connectors/exchange-connector";
import type { Order } from "@/lib/trader/connectors/types";
import { createOrderExecutionServiceFromDeps } from "@/lib/trader/execution/execution-service";
import type {
  OrderRepository,
  OrderRow,
} from "@/lib/trader/execution/order-repository.types";
import type { SubmitOrderInput } from "@/lib/trader/execution/execution-service.types";
import { RiskV2AdmissionRefusedError } from "@/lib/trader/risk/v2/risk-allowance-repository-postgres";

const ORG = "00000000-0000-4000-8000-000000066601";
const ALLOWANCE = "00000000-0000-4000-8000-000000066602";
const ORDER = "00000000-0000-4000-8000-000000066603";
const DIGEST = "a".repeat(64);

function baseOrder(): OrderRow {
  return {
    id: ORDER,
    organizationId: ORG,
    credentialId: null,
    venue: "HTX",
    executionMode: "paper",
    symbol: "BTCUSDT",
    side: "buy",
    type: "market",
    price: null,
    quantity: "0.001",
    filledQuantity: "0",
    avgFillPrice: null,
    state: "CREATED",
    stateVersion: 1,
    exchangeOrderId: null,
    clientOrderId: "client-risk-v2",
    idempotencyKey: "idempotency-risk-v2",
    riskDecisionId: "risk-verdict-v2",
    riskAllowanceId: ALLOWANCE,
    riskAllowanceBindingDigest: DIGEST,
    strategySignalId: null,
    allocationDecisionId: null,
    createdAt: new Date("2026-08-21T00:00:00.000Z"),
    updatedAt: new Date("2026-08-21T00:00:00.000Z"),
  };
}

function input(): SubmitOrderInput {
  return {
    clientOrderId: "client-risk-v2",
    idempotencyKey: "idempotency-risk-v2",
    executionMode: "paper",
    symbol: "BTCUSDT",
    side: "buy",
    type: "market",
    quantity: "0.001",
    referencePrice: "25000",
    accountKey: "spot-main",
    riskAllowanceV2: {
      accountId: "spot-main",
      riskAllowanceId: ALLOWANCE,
      nonce: "00000000-0000-4000-8000-000000066604",
      orderId: ORDER,
      consumptionEventId: "00000000-0000-4000-8000-000000066605",
    },
  };
}

function connector(placeOrder = vi.fn(async (): Promise<Order> => ({
  orderId: "venue-order",
  clientOrderId: "client-risk-v2",
  symbol: "BTCUSDT",
  side: "buy",
  type: "market",
  status: "open",
  quantity: "0.001",
  filledQuantity: "0",
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
}))): ExchangeConnector {
  return {
    venueId: "htx",
    marketType: "spot",
    validateCredentials: vi.fn(),
    getAccountInfo: vi.fn(),
    getBalances: vi.fn(),
    getPositions: vi.fn(),
    getOpenOrders: vi.fn(),
    getOrder: vi.fn(),
    placeOrder,
    cancelOrder: vi.fn(),
    getTradeHistory: vi.fn().mockResolvedValue([]),
    streamMarketData: vi.fn(),
    streamUserData: vi.fn(),
    getFuturesBalances: vi.fn(),
    getFuturesPositions: vi.fn(),
    placeFuturesOrder: vi.fn(),
  };
}

function harness(options: {
  consume?: ReturnType<typeof vi.fn>;
  connector?: ExchangeConnector;
} = {}) {
  let current = baseOrder();
  const repository: OrderRepository = {
    createOrder: vi.fn(),
    getOrderById: async () => current,
    findOrderByClientOrderId: async () => null,
    findOrderByIdempotencyKey: async () => null,
    listOpenOrders: async () => [],
    listOrders: async () => [current],
    transitionOrder: async (_context, transition) => {
      current = {
        ...current,
        state: transition.toState,
        stateVersion: current.stateVersion + 1,
        exchangeOrderId: transition.exchangeOrderId ?? current.exchangeOrderId,
      };
      return current;
    },
    recordFill: vi.fn(),
    recordFillProgress: vi.fn(),
    listEvents: async () => [],
    listFills: async () => [],
  };
  const exchange = options.connector ?? connector();
  const consume = options.consume;
  const service = createOrderExecutionServiceFromDeps({
    riskEngine: { evaluateOrderRequest: vi.fn(() => { throw new Error("legacy Risk must not run"); }) },
    orderRepository: repository,
    killSwitchResolver: {
      getEffectiveState: async () => ({
        organizationId: ORG,
        blocked: false,
        enforcementMode: null,
        bindingState: null,
        resolutionStatus: "ok",
        contributors: [],
        resolvedAt: "2026-08-21T00:00:00.000Z",
      }),
    },
    connectorForMode: () => exchange,
    writeAudit: vi.fn(() => "audit-id"),
    nowMs: () => Date.parse("2026-08-21T00:00:00.000Z"),
    consumeRiskAllowanceV2: consume,
  });
  return { service, exchange, consume, getCurrent: () => current };
}

function consumed(order = baseOrder(), digest = DIGEST, consumedNow = true) {
  return {
    status: "CONSUMED" as const,
    order,
    riskAllowanceId: ALLOWANCE,
    orderBindingDigestHex: digest,
    consumedNow,
  };
}

describe("Risk V2 execution consumption boundary", () => {
  it("refuses before connector when the atomic consumer is unavailable or refuses", async () => {
    const unavailable = harness();
    await expect(unavailable.service.submitOrder({ organizationId: ORG }, input()))
      .resolves.toMatchObject({ status: "risk_allowance_refused" });
    expect(unavailable.exchange.placeOrder).not.toHaveBeenCalled();

    const refuse = vi.fn().mockRejectedValue(new RiskV2AdmissionRefusedError("ALLOWANCE_EXPIRED"));
    const refused = harness({ consume: refuse });
    await expect(refused.service.submitOrder({ organizationId: ORG }, input()))
      .resolves.toEqual({ status: "risk_allowance_refused", order: null, reason: "ALLOWANCE_EXPIRED" });
    expect(refused.exchange.placeOrder).not.toHaveBeenCalled();
  });

  it("submits only after consumed proof exactly matches the durably bound order", async () => {
    const consume = vi.fn().mockResolvedValue(consumed());
    const valid = harness({ consume });
    await expect(valid.service.submitOrder({ organizationId: ORG }, input()))
      .resolves.toMatchObject({ status: "submitted" });
    expect(consume).toHaveBeenCalledOnce();
    expect(valid.exchange.placeOrder).toHaveBeenCalledOnce();

    const mismatched = harness({
      consume: vi.fn().mockResolvedValue(consumed(baseOrder(), "b".repeat(64))),
    });
    await expect(mismatched.service.submitOrder({ organizationId: ORG }, input()))
      .resolves.toEqual({
        status: "risk_allowance_refused",
        order: null,
        reason: "CONSUMED_ALLOWANCE_PROOF_MISSING_OR_MISMATCHED",
      });
    expect(mismatched.exchange.placeOrder).not.toHaveBeenCalled();
  });

  it("does not resend an uncertain same-bound order and cannot create residual authority", async () => {
    const placeOrder = vi.fn().mockRejectedValue(new Error("uncertain venue outcome"));
    const exchange = connector(placeOrder);
    let getCurrent: () => OrderRow = baseOrder;
    const consume = vi.fn(async () => consumed(getCurrent(), DIGEST, consume.mock.calls.length === 1));
    const setup = harness({ consume, connector: exchange });
    getCurrent = setup.getCurrent;
    await expect(setup.service.submitOrder({ organizationId: ORG }, input()))
      .resolves.toMatchObject({ status: "connector_uncertain" });
    await expect(setup.service.submitOrder({ organizationId: ORG }, input()))
      .resolves.toMatchObject({ status: "connector_uncertain" });
    expect(placeOrder).toHaveBeenCalledOnce();
    expect(consume).toHaveBeenCalledTimes(2);
  });

  it("proves the Risk V2 branch is consumed before the sole connector submission site", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/trader/execution/execution-service.ts"),
      "utf8",
    );
    expect(source.match(/connector\.placeOrder\(/g)).toHaveLength(1);
    const riskV2BranchAt = source.indexOf("if (input.riskAllowanceV2)");
    const legacyBranchAt = source.indexOf("const existingByClient", riskV2BranchAt);
    const riskV2Branch = source.slice(riskV2BranchAt, legacyBranchAt);
    expect(riskV2BranchAt).toBeGreaterThan(-1);
    expect(riskV2Branch).toContain("await consumeRiskAllowanceV2");
    expect(riskV2Branch).toContain('claim.status === "REFUSED"');
    expect(riskV2Branch).toMatch(/await dispatchToConnector\([\s\S]*consumed,[\s\S]*\)/);

    const callAt = source.indexOf("connector.placeOrder(");
    const guardAt = source.indexOf("CONSUMED_ALLOWANCE_PROOF_MISSING_OR_MISMATCHED");
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(callAt);
    expect(source.slice(guardAt, callAt)).toContain("transitionOrConflict");
  });
});
