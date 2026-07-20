import { describe, expect, it, vi } from "vitest";

import type {
  FillRow,
  OrderRepository,
  OrderRow,
} from "@/lib/trader/execution/order-repository.types";
import { defaultStopDistanceProvider } from "@/lib/trader/portfolio/default-stop-distance-provider";
import {
  computeQuoteExposureUsdt,
  createInitialPortfolioAccountState,
  derivePortfolioAccountState,
} from "@/lib/trader/portfolio/derive-portfolio-account-state";
import { DEFAULT_PORTFOLIO_RUN_CONFIG } from "@/lib/trader/portfolio/portfolio-run-config.types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORG = "00000000-0000-4000-8000-0000000377";
const LIMITS = {
  maxRiskPerTradePct: "0.01",
  maxPortfolioRiskPct: "0.05",
  maxConcurrentPositions: 3,
  maxNotional: "100000.00",
};

function mockOrder(overrides: Partial<OrderRow> & Pick<OrderRow, "id">): OrderRow {
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
    avgFillPrice: "100",
    state: "FILLED",
    stateVersion: 1,
    exchangeOrderId: null,
    clientOrderId: `client-${overrides.id}`,
    idempotencyKey: `idem-${overrides.id}`,
    riskDecisionId: "risk-377",
    strategySignalId: null,
    allocationDecisionId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    organizationId: ORG,
    ...overrides,
  };
}

function mockFill(orderId: string, overrides: Partial<FillRow> = {}): FillRow {
  return {
    id: overrides.id ?? `fill-${orderId}`,
    organizationId: ORG,
    orderId,
    exchangeTradeId: overrides.exchangeTradeId ?? `trade-${orderId}`,
    price: overrides.price ?? "100",
    quantity: overrides.quantity ?? "0.01",
    fee: overrides.fee ?? "1",
    feeAsset: overrides.feeAsset ?? "USDT",
    executedAt: overrides.executedAt ?? new Date(0),
    createdAt: overrides.createdAt ?? new Date(0),
  };
}

function mockRepository(
  orders: OrderRow[],
  fillsByOrderId: Record<string, FillRow[]>,
): OrderRepository {
  return {
    createOrder: vi.fn(),
    getOrderById: vi.fn(),
    findOrderByClientOrderId: vi.fn(),
    findOrderByIdempotencyKey: vi.fn(),
    listOpenOrders: vi.fn(async () => []),
    listOrders: vi.fn(async (context, filter) =>
      orders.filter(
        (order) =>
          order.organizationId === context.organizationId &&
          (!filter?.executionMode || order.executionMode === filter.executionMode),
      ),
    ),
    transitionOrder: vi.fn(),
    recordFill: vi.fn(),
    recordFillProgress: vi.fn(),
    listEvents: vi.fn(),
    listFills: vi.fn(async (_context, orderId) => fillsByOrderId[orderId] ?? []),
  };
}

describe("portfolio account state (M2 ledger)", () => {
  it("seeds reservedMarginUsdt at zero", () => {
    const state = createInitialPortfolioAccountState({
      runConfig: DEFAULT_PORTFOLIO_RUN_CONFIG,
      limits: LIMITS,
      stopDistanceProvider: defaultStopDistanceProvider,
    });

    expect(state.reservedMarginUsdt).toBe("0");
    expect(state.availableBalanceUsdt).toBe(DEFAULT_PORTFOLIO_RUN_CONFIG.startingBalanceUsdt);
    expect(state.equityUsdt).toBe(DEFAULT_PORTFOLIO_RUN_CONFIG.startingBalanceUsdt);
  });

  it("computeQuoteExposureUsdt unwinds sells against buys", () => {
    const exposure = computeQuoteExposureUsdt([
      {
        fill: { price: "100", quantity: "0.01" },
        order: { side: "buy", symbol: "BTC/USDT" },
      },
      {
        fill: { price: "120", quantity: "0.01" },
        order: { side: "sell", symbol: "BTC/USDT" },
      },
    ]);

    expect(exposure).toBe("0");
  });

  it("derives cash, fees, and equity after buy and sell fills", async () => {
    const buy = mockOrder({ id: "buy-1", side: "buy", avgFillPrice: "100" });
    const sell = mockOrder({
      id: "sell-1",
      side: "sell",
      avgFillPrice: "120",
      filledQuantity: "0.01",
    });
    const repo = mockRepository([buy, sell], {
      "buy-1": [mockFill("buy-1", { price: "100", quantity: "0.01", fee: "1" })],
      "sell-1": [mockFill("sell-1", { price: "120", quantity: "0.01", fee: "1" })],
    });

    const state = await derivePortfolioAccountState({
      context: requireOrgContext(ORG),
      orderRepository: repo,
      runConfig: { ...DEFAULT_PORTFOLIO_RUN_CONFIG, startingBalanceUsdt: "10000.00" },
      limits: LIMITS,
      stopDistanceProvider: defaultStopDistanceProvider,
      markPrices: { marks: { "BTC/USDT": "120" } },
    });

    expect(state.feesPaidUsdt).toBe("2");
    expect(state.availableBalanceUsdt).toBe("9998.2");
    expect(state.realizedPnlUsdt).toBe("-1.8");
    expect(state.openPositionCount).toBe(0);
    expect(state.equityUsdt).toBe("9998.2");
    expect(state.reservedMarginUsdt).toBe("0");
  });
});
