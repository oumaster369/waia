import { describe, expect, it, vi } from "vitest";

import type { OrderRepository, OrderRow } from "@/lib/trader/execution/order-repository.types";
import { deriveAccountRiskStateFromMockOrders } from "@/lib/trader/paper/account-risk-state-from-orders";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORG = "00000000-0000-4000-8000-0000000265";

function mockOrder(overrides: Partial<OrderRow> & Pick<OrderRow, "id">): OrderRow {
  const base: OrderRow = {
    id: overrides.id,
    organizationId: ORG,
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
    riskDecisionId: "risk-265",
    strategySignalId: null,
    allocationDecisionId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };

  return { ...base, ...overrides };
}

function mockRepository(orders: OrderRow[], openOrders: OrderRow[] = []): OrderRepository {
  return {
    createOrder: vi.fn(),
    getOrderById: vi.fn(),
    findOrderByClientOrderId: vi.fn(),
    findOrderByIdempotencyKey: vi.fn(),
    listOpenOrders: vi.fn(async () => openOrders),
    listOrders: vi.fn(async (_context, filter) => {
      return orders.filter((order) => {
        if (filter?.executionMode && order.executionMode !== filter.executionMode) {
          return false;
        }
        if (filter?.venue && order.venue !== filter.venue) {
          return false;
        }
        return true;
      });
    }),
    transitionOrder: vi.fn(),
    recordFill: vi.fn(),
    listEvents: vi.fn(),
    listFills: vi.fn(),
  };
}

describe("deriveAccountRiskStateFromMockOrders (AT-E9 S6)", () => {
  it("returns empty state when no orders exist", async () => {
    const repo = mockRepository([]);
    const state = await deriveAccountRiskStateFromMockOrders({
      context: requireOrgContext(ORG),
      orderRepository: repo,
    });

    expect(state).toEqual({
      positions: [],
      openOrderCount: 0,
      dailyPnl: "0",
      drawdown: "0",
      quoteExposureByCurrency: {},
    });
    expect(repo.listOrders).toHaveBeenCalledWith(requireOrgContext(ORG), { executionMode: "mock" });
  });

  it("derives position and buy-side quote exposure from a filled buy", async () => {
    const buy = mockOrder({ id: "order-buy-265" });
    const repo = mockRepository([buy]);

    const state = await deriveAccountRiskStateFromMockOrders({
      context: requireOrgContext(ORG),
      orderRepository: repo,
    });

    expect(state.positions).toEqual([{ symbol: "BTC/USDT", quantity: "0.01" }]);
    expect(state.quoteExposureByCurrency).toEqual({ USDT: "640" });
    expect(state.dailyPnl).toBe("0");
    expect(state.drawdown).toBe("0");
  });

  it("legacy path keeps buy-only quote exposure after sells (M2 portfolio adapter supersedes)", async () => {
    const buy = mockOrder({
      id: "order-buy-partial",
      filledQuantity: "0.02",
      avgFillPrice: "100",
    });
    const sell = mockOrder({
      id: "order-sell-partial",
      side: "sell",
      filledQuantity: "0.01",
      avgFillPrice: "110",
    });
    const repo = mockRepository([buy, sell]);

    const state = await deriveAccountRiskStateFromMockOrders({
      context: requireOrgContext(ORG),
      orderRepository: repo,
    });

    expect(state.positions).toEqual([{ symbol: "BTC/USDT", quantity: "0.01" }]);
    expect(state.quoteExposureByCurrency).toEqual({ USDT: "2" });
  });

  it("counts open non-terminal orders via listOpenOrders", async () => {
    const open = mockOrder({
      id: "order-open-265",
      state: "RISK_APPROVED",
      filledQuantity: "0",
      avgFillPrice: null,
    });
    const repo = mockRepository([], [open]);

    const state = await deriveAccountRiskStateFromMockOrders({
      context: requireOrgContext(ORG),
      orderRepository: repo,
    });

    expect(state.positions).toEqual([]);
    expect(state.openOrderCount).toBe(1);
  });
});
