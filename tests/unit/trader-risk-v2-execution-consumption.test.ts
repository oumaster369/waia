import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { ExchangeConnector } from "@/lib/trader/connectors/exchange-connector";
import { createOrderExecutionServiceFromDeps } from "@/lib/trader/execution/execution-service";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import type { SubmitOrderInput } from "@/lib/trader/execution/execution-service.types";

const ORG = "00000000-0000-4000-8000-000000066601";

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
      riskAllowanceId: "00000000-0000-4000-8000-000000066602",
      nonce: "00000000-0000-4000-8000-000000066604",
      orderId: "00000000-0000-4000-8000-000000066603",
      consumptionEventId: "00000000-0000-4000-8000-000000066605",
    },
  };
}

function harness() {
  const placeOrder = vi.fn();
  const placeFuturesOrder = vi.fn();
  const connector: ExchangeConnector = {
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
  const consumeRiskAllowanceV2 = vi.fn();
  const evaluateOrderRequest = vi.fn();
  const service = createOrderExecutionServiceFromDeps({
    riskEngine: { evaluateOrderRequest },
    orderRepository: repository,
    killSwitchResolver: { getEffectiveState: vi.fn() },
    connectorForMode: () => connector,
    writeAudit: vi.fn(() => "audit-id"),
    nowMs: () => Date.parse("2026-08-21T00:00:00.000Z"),
    consumeRiskAllowanceV2,
  });
  return {
    service,
    placeOrder,
    placeFuturesOrder,
    repository,
    consumeRiskAllowanceV2,
    evaluateOrderRequest,
  };
}

describe("Risk V2 execution consumption boundary", () => {
  it("fail-closes the former allowance-only bridge before Risk, persistence, or network", async () => {
    const fixture = harness();
    await expect(fixture.service.submitOrder({ organizationId: ORG }, input()))
      .resolves.toEqual({
        status: "execution_v2_required",
        order: null,
        reason: "LEGACY_ORDER_SUBMISSION_DISABLED",
      });
    expect(fixture.consumeRiskAllowanceV2).not.toHaveBeenCalled();
    expect(fixture.evaluateOrderRequest).not.toHaveBeenCalled();
    expect(fixture.repository.createOrder).not.toHaveBeenCalled();
    expect(fixture.placeOrder).not.toHaveBeenCalled();
    expect(fixture.placeFuturesOrder).not.toHaveBeenCalled();
  });

  it("remains fail-closed across deterministic restart", async () => {
    const fixture = harness();
    const first = await fixture.service.submitOrder({ organizationId: ORG }, input());
    const restart = await fixture.service.submitOrder({ organizationId: ORG }, input());
    expect(restart).toEqual(first);
    expect(fixture.consumeRiskAllowanceV2).not.toHaveBeenCalled();
    expect(fixture.placeOrder).not.toHaveBeenCalled();
  });

  it("proves the sole production connector submission site consumes a committed V2 attempt", () => {
    const legacySource = readFileSync(
      join(process.cwd(), "lib/trader/execution/execution-service.ts"),
      "utf8",
    );
    const dispatcherSource = readFileSync(
      join(process.cwd(), "lib/trader/execution/v2/connector-dispatch.ts"),
      "utf8",
    );
    expect(legacySource).not.toContain("connector.placeOrder(");
    expect(legacySource).toContain("LEGACY_ORDER_SUBMISSION_DISABLED");
    expect(dispatcherSource.match(/connector\.placeOrder\(/g)).toHaveLength(1);
    expect(dispatcherSource).toContain("await bindExecutionAuthorityV2Postgres");
    expect(dispatcherSource).toContain("await dispatchAndRecordExecutionAttemptV2");
    expect(dispatcherSource).toContain(
      "submitCommittedAttemptToConnectorV2(connector, authority.attempt)",
    );
  });
});
