import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { ExchangeConnector } from "@/lib/trader/connectors/exchange-connector";
import {
  createOrderExecutionServiceFromDeps,
  type OrderExecutionServiceDeps,
  type OrderRepository,
  type SubmitOrderInput,
} from "@/lib/trader/execution";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORG = "00000000-0000-4000-8000-000000067001";
const legacyConsumers = [
  "lib/trader/live/run-live-cycle.ts",
  "lib/trader/observability/control-replay-scientific-v2-driver-v1.ts",
  "lib/trader/paper/paper-cycle-runner.ts",
  "lib/trader/research/capital-path-trace-harness.ts",
] as const;

function serviceFixture() {
  const placeOrder = vi.fn();
  const placeFuturesOrder = vi.fn();
  const connector: ExchangeConnector = {
    venueId: "mock",
    marketType: "spot",
    validateCredentials: vi.fn(),
    getAccountInfo: vi.fn(),
    getBalances: vi.fn(),
    getPositions: vi.fn(),
    getOpenOrders: vi.fn(),
    getOrder: vi.fn(),
    placeOrder,
    cancelOrder: vi.fn(),
    getTradeHistory: vi.fn(),
    streamMarketData: vi.fn(),
    streamUserData: vi.fn(),
    getFuturesBalances: vi.fn(),
    getFuturesPositions: vi.fn(),
    placeFuturesOrder,
  };
  const repository: OrderRepository = {
    createOrder: vi.fn(),
    getOrderById: vi.fn(),
    findOrderByClientOrderId: vi.fn(),
    findOrderByIdempotencyKey: vi.fn(),
    listOpenOrders: vi.fn(),
    listOrders: vi.fn(),
    transitionOrder: vi.fn(),
    recordFill: vi.fn(),
    recordFillProgress: vi.fn(),
    listEvents: vi.fn(),
    listFills: vi.fn(),
  };
  const evaluateOrderRequest = vi.fn();
  const consumeRiskAllowanceV2 = vi.fn();
  const deps: OrderExecutionServiceDeps = {
    riskEngine: { evaluateOrderRequest },
    orderRepository: repository,
    killSwitchResolver: { getEffectiveState: vi.fn() },
    connectorForMode: () => connector,
    writeAudit: vi.fn(() => "audit-id"),
    nowMs: () => 1_700_000_000_000,
    assertLiveAuthorized: vi.fn(),
    consumeRiskAllowanceV2,
  };
  return {
    service: createOrderExecutionServiceFromDeps(deps),
    placeOrder,
    placeFuturesOrder,
    evaluateOrderRequest,
    consumeRiskAllowanceV2,
    repository,
  };
}

function rawInput(executionMode: SubmitOrderInput["executionMode"]): SubmitOrderInput {
  return {
    clientOrderId: `legacy-${executionMode}`,
    idempotencyKey: `legacy-idem-${executionMode}`,
    executionMode,
    symbol: "BTCUSDT",
    side: "buy",
    type: "limit",
    price: "25000",
    quantity: "0.001",
    referencePrice: "25000",
    accountKey: "legacy-account",
  };
}

describe("Execution V2 whole-repository consumer graph (DEE-670 / E651-D)", () => {
  it("fails every raw mock/paper/live caller before Risk, persistence, or network", async () => {
    for (const mode of ["mock", "paper", "live"] as const) {
      const fixture = serviceFixture();
      await expect(fixture.service.submitOrder(requireOrgContext(ORG), rawInput(mode)))
        .resolves.toEqual({
          status: "execution_v2_required",
          order: null,
          reason: "LEGACY_ORDER_SUBMISSION_DISABLED",
        });
      expect(fixture.evaluateOrderRequest).not.toHaveBeenCalled();
      expect(fixture.consumeRiskAllowanceV2).not.toHaveBeenCalled();
      expect(fixture.repository.createOrder).not.toHaveBeenCalled();
      expect(fixture.placeOrder).not.toHaveBeenCalled();
      expect(fixture.placeFuturesOrder).not.toHaveBeenCalled();
    }
  });

  it("rejects the former allowance-only bridge because plan/attempt binding is mandatory", async () => {
    const fixture = serviceFixture();
    const result = await fixture.service.submitOrder(requireOrgContext(ORG), {
      ...rawInput("paper"),
      riskAllowanceV2: {
        accountId: "account-a",
        riskAllowanceId: "00000000-0000-4000-8000-000000067010",
        nonce: "00000000-0000-4000-8000-000000067011",
        orderId: "00000000-0000-4000-8000-000000067012",
        consumptionEventId: "00000000-0000-4000-8000-000000067013",
      },
    });
    expect(result.status).toBe("execution_v2_required");
    expect(fixture.consumeRiskAllowanceV2).not.toHaveBeenCalled();
    expect(fixture.placeOrder).not.toHaveBeenCalled();
  });

  it("keeps the full known caller map explicit at the fail-closed boundary", () => {
    for (const file of legacyConsumers) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source).toContain(".submitOrder(");
    }
    const boundary = readFileSync(
      resolve(process.cwd(), "lib/trader/execution/execution-service.ts"),
      "utf8",
    );
    expect(boundary).toContain("LEGACY_ORDER_SUBMISSION_DISABLED");
    expect(boundary).not.toContain("connector.placeOrder(");
  });
});
