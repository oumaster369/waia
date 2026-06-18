import { describe, expect, it, vi } from "vitest";

import type {
  FillRow,
  OrderRepository,
  OrderRow,
} from "@/lib/trader/execution/order-repository.types";
import { derivePaperPnL, walkFillsForPnL } from "@/lib/trader/paper/derive-paper-pnl";
import { derivePaperPnLPeriod } from "@/lib/trader/paper/derive-paper-pnl-period";
import {
  PaperPnLReconciliationError,
  PaperPnLScopeError,
  PaperPnLWindowError,
} from "@/lib/trader/paper/paper-pnl.errors";
import { subtractDecimal } from "@/lib/trader/risk/numeric";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORG_A = "00000000-0000-4000-8000-0000000269";
const ORG_B = "00000000-0000-4000-8000-0000000270";
const EPOCH = new Date(0);

function mockOrder(
  overrides: Partial<OrderRow> & Pick<OrderRow, "id">,
  organizationId = ORG_A,
): OrderRow {
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
    riskDecisionId: "risk-269",
    strategySignalId: null,
    allocationDecisionId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    organizationId,
    ...overrides,
  };
}

function mockFill(orderId: string, overrides: Partial<FillRow> = {}): FillRow {
  return {
    id: overrides.id ?? `fill-${orderId}-${overrides.exchangeTradeId ?? "t1"}`,
    organizationId: ORG_A,
    orderId,
    exchangeTradeId: overrides.exchangeTradeId ?? `trade-${orderId}`,
    price: overrides.price ?? "64000",
    quantity: overrides.quantity ?? "0.01",
    fee: overrides.fee ?? "0",
    feeAsset: overrides.feeAsset ?? "USDT",
    executedAt: overrides.executedAt ?? new Date(0),
    createdAt: overrides.createdAt ?? new Date(0),
  };
}

function mockRepository(
  orders: OrderRow[],
  options: {
    fillsByOrderId?: Record<string, FillRow[]>;
  } = {},
): OrderRepository {
  const fillsByOrderId = options.fillsByOrderId ?? {};

  for (const order of orders) {
    if (
      order.state === "FILLED" &&
      order.filledQuantity !== "0" &&
      fillsByOrderId[order.id] === undefined
    ) {
      fillsByOrderId[order.id] = [
        mockFill(order.id, {
          quantity: order.filledQuantity,
          price: order.avgFillPrice ?? "64000",
        }),
      ];
    }
  }

  return {
    createOrder: vi.fn(),
    getOrderById: vi.fn(),
    findOrderByClientOrderId: vi.fn(),
    findOrderByIdempotencyKey: vi.fn(),
    listOpenOrders: vi.fn(async () => []),
    listOrders: vi.fn(async (context, filter) => {
      return orders.filter((order) => {
        if (order.organizationId !== context.organizationId) {
          return false;
        }
        if (filter?.executionMode && order.executionMode !== filter.executionMode) {
          return false;
        }
        return true;
      });
    }),
    transitionOrder: vi.fn(),
    recordFill: vi.fn(),
    listEvents: vi.fn(),
    listFills: vi.fn(async (_context, orderId) => fillsByOrderId[orderId] ?? []),
  };
}

describe("derivePaperPnLPeriod (AT-E9 S2 / DEE-269)", () => {
  it("AC1: returns zero period metrics for empty org", async () => {
    const repo = mockRepository([]);
    const rollup = await derivePaperPnLPeriod({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      window: { start: EPOCH, end: new Date(10_000) },
    });

    expect(rollup.periodRealizedPnl).toBe("0");
    expect(rollup.periodTotalFees).toBe("0");
    expect(rollup.periodFeesByAsset).toEqual({});
    expect(rollup.endSnapshot.realizedPnl).toBe("0");
    expect(rollup.endSnapshot.positions).toEqual([]);
  });

  it("AC2: uses pre-window avgCost for in-window sell", async () => {
    const buy = mockOrder({ id: "pre-buy", avgFillPrice: "100" });
    const sell = mockOrder({
      id: "in-sell",
      side: "sell",
      avgFillPrice: "120",
      filledQuantity: "0.01",
    });
    const repo = mockRepository([buy, sell], {
      fillsByOrderId: {
        "pre-buy": [
          mockFill("pre-buy", { price: "100", quantity: "0.01", executedAt: new Date(100) }),
        ],
        "in-sell": [
          mockFill("in-sell", {
            price: "120",
            quantity: "0.01",
            executedAt: new Date(150),
          }),
        ],
      },
    });

    const rollup = await derivePaperPnLPeriod({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      window: { start: new Date(120), end: new Date(200) },
    });

    expect(rollup.periodRealizedPnl).toBe("0.2");
    expect(rollup.endSnapshot.realizedPnl).toBe("0.2");
  });

  it("AC3: full-history window reconciles period totals to endSnapshot", async () => {
    const buy = mockOrder({ id: "full-buy", avgFillPrice: "100" });
    const sell = mockOrder({
      id: "full-sell",
      side: "sell",
      avgFillPrice: "110",
      filledQuantity: "0.01",
    });
    const repo = mockRepository([buy, sell], {
      fillsByOrderId: {
        "full-buy": [
          mockFill("full-buy", { price: "100", quantity: "0.01", executedAt: new Date(1) }),
        ],
        "full-sell": [
          mockFill("full-sell", {
            price: "110",
            quantity: "0.01",
            fee: "0.1",
            feeAsset: "USDT",
            executedAt: new Date(2),
          }),
        ],
      },
    });

    const rollup = await derivePaperPnLPeriod({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      window: { start: EPOCH, end: new Date(10_000) },
    });

    expect(rollup.periodRealizedPnl).toBe(rollup.endSnapshot.realizedPnl);
    expect(rollup.periodTotalFees).toBe(rollup.endSnapshot.totalFees);
    expect(rollup.periodRealizedPnl).toBe("0");
    expect(rollup.periodTotalFees).toBe("0.1");
  });

  it("AC4: zero in-window activity yields zero period metrics", async () => {
    const buy = mockOrder({ id: "pre-only", avgFillPrice: "100" });
    const repo = mockRepository([buy], {
      fillsByOrderId: {
        "pre-only": [
          mockFill("pre-only", { price: "100", quantity: "0.01", executedAt: new Date(50) }),
        ],
      },
    });

    const rollup = await derivePaperPnLPeriod({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      window: { start: new Date(100), end: new Date(200) },
    });

    expect(rollup.periodRealizedPnl).toBe("0");
    expect(rollup.periodTotalFees).toBe("0");
    expect(rollup.endSnapshot.positions).toEqual([
      expect.objectContaining({ quantity: "0.01", avgCost: "100" }),
    ]);
  });

  it("AC5: applies quote buy and sell fee rules within the window", async () => {
    const buy = mockOrder({ id: "fee-buy", avgFillPrice: "100" });
    const sell = mockOrder({
      id: "fee-sell",
      side: "sell",
      avgFillPrice: "120",
      filledQuantity: "0.01",
    });
    const repo = mockRepository([buy, sell], {
      fillsByOrderId: {
        "fee-buy": [
          mockFill("fee-buy", {
            price: "100",
            quantity: "0.01",
            fee: "1",
            feeAsset: "USDT",
            executedAt: new Date(100),
          }),
        ],
        "fee-sell": [
          mockFill("fee-sell", {
            price: "120",
            quantity: "0.01",
            fee: "0.25",
            feeAsset: "USDT",
            executedAt: new Date(150),
          }),
        ],
      },
    });

    const rollup = await derivePaperPnLPeriod({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      window: { start: new Date(90), end: new Date(200) },
    });

    expect(rollup.periodRealizedPnl).toBe("-1.05");
    expect(rollup.periodTotalFees).toBe("0.25");
    expect(rollup.endSnapshot.positions).toEqual([]);
  });

  it("AC6: isolates non-quote fees to periodFeesByAsset without PnL impact", async () => {
    const withBaseFee = mockOrder({ id: "base-fee-buy", avgFillPrice: "100" });
    const plain = mockOrder({ id: "plain-buy", avgFillPrice: "100" });
    const repoBase = mockRepository([withBaseFee], {
      fillsByOrderId: {
        "base-fee-buy": [
          mockFill("base-fee-buy", {
            price: "100",
            quantity: "0.01",
            fee: "0.0001",
            feeAsset: "BTC",
            executedAt: new Date(100),
          }),
        ],
      },
    });
    const repoPlain = mockRepository([plain], {
      fillsByOrderId: {
        "plain-buy": [
          mockFill("plain-buy", {
            price: "100",
            quantity: "0.01",
            fee: "0",
            executedAt: new Date(100),
          }),
        ],
      },
    });
    const context = requireOrgContext(ORG_A);
    const window = { start: new Date(90), end: new Date(200) };

    const [baseRollup, plainRollup] = await Promise.all([
      derivePaperPnLPeriod({ context, orderRepository: repoBase, window }),
      derivePaperPnLPeriod({ context, orderRepository: repoPlain, window }),
    ]);

    expect(baseRollup.periodFeesByAsset).toEqual({ BTC: "0.0001" });
    expect(baseRollup.periodValuationGaps.length).toBeGreaterThan(0);
    expect(baseRollup.periodRealizedPnl).toBe(plainRollup.periodRealizedPnl);
    expect(baseRollup.periodTotalFees).toBe(plainRollup.periodTotalFees);
    expect(baseRollup.periodTotalPnlChange).toBe(plainRollup.periodTotalPnlChange);
  });

  it("AC7: computes period unrealized and total PnL change when marks complete", async () => {
    const buy = mockOrder({ id: "mtm-buy", avgFillPrice: "100" });
    const repo = mockRepository([buy], {
      fillsByOrderId: {
        "mtm-buy": [
          mockFill("mtm-buy", { price: "100", quantity: "0.01", executedAt: new Date(100) }),
        ],
      },
    });

    const rollup = await derivePaperPnLPeriod({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      window: { start: new Date(50), end: new Date(200) },
      markPrices: { marks: { "BTC/USDT": "110" } },
    });

    expect(rollup.periodUnrealizedChange).toBe("0.1");
    expect(rollup.periodTotalPnlChange).toBe("0.1");
  });

  it("AC8: leaves change fields null without markPrices", async () => {
    const buy = mockOrder({ id: "no-marks" });
    const repo = mockRepository([buy], {
      fillsByOrderId: {
        "no-marks": [mockFill("no-marks", { executedAt: new Date(100) })],
      },
    });

    const rollup = await derivePaperPnLPeriod({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      window: { start: new Date(50), end: new Date(200) },
    });

    expect(rollup.periodUnrealizedChange).toBeNull();
    expect(rollup.periodTotalPnlChange).toBeNull();
    expect(rollup.periodRealizedPnl).toBe("0");
  });

  it("AC9: rejects invalid window when start >= end", async () => {
    const repo = mockRepository([]);

    await expect(
      derivePaperPnLPeriod({
        context: requireOrgContext(ORG_A),
        orderRepository: repo,
        window: { start: new Date(200), end: new Date(100) },
      }),
    ).rejects.toBeInstanceOf(PaperPnLWindowError);

    await expect(
      derivePaperPnLPeriod({
        context: requireOrgContext(ORG_A),
        orderRepository: repo,
        window: { start: new Date(100), end: new Date(100) },
      }),
    ).rejects.toBeInstanceOf(PaperPnLWindowError);
  });

  it("AC10: includes fill at window start and excludes fill at window end", async () => {
    const atStart = mockOrder({ id: "at-start", avgFillPrice: "100" });
    const atEnd = mockOrder({ id: "at-end", avgFillPrice: "200", filledQuantity: "0.02" });
    const repo = mockRepository([atStart, atEnd], {
      fillsByOrderId: {
        "at-start": [
          mockFill("at-start", { price: "100", quantity: "0.01", executedAt: new Date(100) }),
        ],
        "at-end": [
          mockFill("at-end", { price: "200", quantity: "0.02", executedAt: new Date(200) }),
        ],
      },
    });

    const rollup = await derivePaperPnLPeriod({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      window: { start: new Date(100), end: new Date(200) },
    });

    expect(rollup.periodRealizedPnl).toBe("0");
    expect(rollup.endSnapshot.positions).toEqual([
      expect.objectContaining({ quantity: "0.01", avgCost: "100" }),
    ]);
  });

  it("AC11: endSnapshot excludes fills at or after window.end", async () => {
    const buy = mockOrder({ id: "snap-buy", avgFillPrice: "100", filledQuantity: "0.02" });
    const inWindowSell = mockOrder({
      id: "snap-sell-in",
      side: "sell",
      avgFillPrice: "110",
      filledQuantity: "0.01",
    });
    const postSell = mockOrder({
      id: "snap-sell-post",
      side: "sell",
      avgFillPrice: "130",
      filledQuantity: "0.01",
    });
    const repo = mockRepository([buy, inWindowSell, postSell], {
      fillsByOrderId: {
        "snap-buy": [
          mockFill("snap-buy", { price: "100", quantity: "0.02", executedAt: new Date(10) }),
        ],
        "snap-sell-in": [
          mockFill("snap-sell-in", {
            price: "110",
            quantity: "0.01",
            executedAt: new Date(100),
          }),
        ],
        "snap-sell-post": [
          mockFill("snap-sell-post", {
            price: "130",
            quantity: "0.01",
            executedAt: new Date(300),
          }),
        ],
      },
    });

    const rollup = await derivePaperPnLPeriod({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      window: { start: new Date(50), end: new Date(200) },
    });

    expect(rollup.periodRealizedPnl).toBe("0.1");
    expect(rollup.endSnapshot.realizedPnl).toBe("0.1");
    expect(rollup.endSnapshot.positions).toEqual([expect.objectContaining({ quantity: "0.01" })]);
  });

  it("AC11a: endSnapshot matches ITD derivePaperPnL when all fills are before window.end", async () => {
    const buy = mockOrder({ id: "parity-buy", avgFillPrice: "100" });
    const repo = mockRepository([buy], {
      fillsByOrderId: {
        "parity-buy": [
          mockFill("parity-buy", { price: "100", quantity: "0.01", executedAt: new Date(50) }),
        ],
      },
    });
    const context = requireOrgContext(ORG_A);
    const input = { context, orderRepository: repo };

    const [rollup, itd] = await Promise.all([
      derivePaperPnLPeriod({
        ...input,
        window: { start: EPOCH, end: new Date(10_000) },
      }),
      derivePaperPnL(input),
    ]);

    expect(rollup.endSnapshot.realizedPnl).toBe(itd.realizedPnl);
    expect(rollup.endSnapshot.totalFees).toBe(itd.totalFees);
    expect(rollup.endSnapshot.positions).toEqual(itd.positions);
  });

  it("AC11b: endSnapshot is less than ITD when post-window fills exist", async () => {
    const buy = mockOrder({ id: "post-buy", avgFillPrice: "100", filledQuantity: "0.02" });
    const inSell = mockOrder({
      id: "post-sell-in",
      side: "sell",
      avgFillPrice: "110",
      filledQuantity: "0.01",
    });
    const postSell = mockOrder({
      id: "post-sell-after",
      side: "sell",
      avgFillPrice: "130",
      filledQuantity: "0.01",
    });
    const repo = mockRepository([buy, inSell, postSell], {
      fillsByOrderId: {
        "post-buy": [
          mockFill("post-buy", { price: "100", quantity: "0.02", executedAt: new Date(10) }),
        ],
        "post-sell-in": [
          mockFill("post-sell-in", {
            price: "110",
            quantity: "0.01",
            executedAt: new Date(100),
          }),
        ],
        "post-sell-after": [
          mockFill("post-sell-after", {
            price: "130",
            quantity: "0.01",
            executedAt: new Date(500),
          }),
        ],
      },
    });
    const context = requireOrgContext(ORG_A);
    const input = { context, orderRepository: repo };

    const [rollup, itd] = await Promise.all([
      derivePaperPnLPeriod({
        ...input,
        window: { start: EPOCH, end: new Date(200) },
      }),
      derivePaperPnL(input),
    ]);

    expect(Number(rollup.endSnapshot.realizedPnl)).toBeLessThan(Number(itd.realizedPnl));
  });

  it("AC12: scopes by org and execution mode; rejects live", async () => {
    const repo = mockRepository(
      [
        mockOrder({ id: "org-a", executionMode: "mock" }, ORG_A),
        mockOrder({ id: "org-b", executionMode: "mock" }, ORG_B),
        mockOrder({
          id: "paper-mode",
          executionMode: "paper",
          symbol: "ETH/USDT",
          avgFillPrice: "3000",
          filledQuantity: "0.2",
        }),
      ],
      {},
    );
    const window = { start: EPOCH, end: new Date(10_000) };

    const mockRollup = await derivePaperPnLPeriod({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      executionMode: "mock",
      window,
    });
    const paperRollup = await derivePaperPnLPeriod({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      executionMode: "paper",
      window,
    });

    expect(mockRollup.endSnapshot.positions).toEqual([
      expect.objectContaining({ symbol: "BTC/USDT" }),
    ]);
    expect(paperRollup.endSnapshot.positions).toEqual([
      expect.objectContaining({ symbol: "ETH/USDT" }),
    ]);

    await expect(
      derivePaperPnLPeriod({
        context: requireOrgContext(ORG_A),
        orderRepository: repo,
        executionMode: "live" as "mock",
        window,
      }),
    ).rejects.toBeInstanceOf(PaperPnLScopeError);
  });

  it("AC13: is deterministic under permuted fill fetch order via walk kernel", () => {
    const buy = mockOrder({ id: "sort-buy", filledQuantity: "0.02", avgFillPrice: "100" });
    const sell = mockOrder({
      id: "sort-sell",
      side: "sell",
      filledQuantity: "0.01",
      avgFillPrice: "110",
    });
    const eventsA = [
      {
        fill: mockFill("sort-buy", { id: "f1", quantity: "0.02", executedAt: new Date(0) }),
        order: buy,
      },
      {
        fill: mockFill("sort-sell", {
          id: "f2",
          quantity: "0.01",
          price: "110",
          executedAt: new Date(1),
        }),
        order: sell,
      },
    ];
    const opening = walkFillsForPnL([], { "BTC/USDT": "USDT" });
    const walkA = walkFillsForPnL(eventsA, { "BTC/USDT": "USDT" }, opening.ledgerBySymbol);
    const walkB = walkFillsForPnL(
      [...eventsA].reverse(),
      { "BTC/USDT": "USDT" },
      opening.ledgerBySymbol,
    );

    expect(walkA.realizedPnl).toBe(walkB.realizedPnl);
  });

  it("AC14: rejects order/fill quantity mismatch", async () => {
    const order = mockOrder({ id: "drift", filledQuantity: "0.02" });
    const repo = mockRepository([order], {
      fillsByOrderId: {
        drift: [mockFill("drift", { quantity: "0.01" })],
      },
    });

    await expect(
      derivePaperPnLPeriod({
        context: requireOrgContext(ORG_A),
        orderRepository: repo,
        window: { start: EPOCH, end: new Date(10_000) },
      }),
    ).rejects.toBeInstanceOf(PaperPnLReconciliationError);
  });

  it("AC16: walkFillsForPnL supports opening ledger carry-forward", () => {
    const buy = mockOrder({ id: "carry-buy", avgFillPrice: "100" });
    const sell = mockOrder({
      id: "carry-sell",
      side: "sell",
      avgFillPrice: "120",
      filledQuantity: "0.01",
    });
    const opening = walkFillsForPnL(
      [{ fill: mockFill("carry-buy", { price: "100", quantity: "0.01" }), order: buy }],
      { "BTC/USDT": "USDT" },
    );
    const period = walkFillsForPnL(
      [
        {
          fill: mockFill("carry-sell", { price: "120", quantity: "0.01", executedAt: new Date(1) }),
          order: sell,
        },
      ],
      { "BTC/USDT": "USDT" },
      opening.ledgerBySymbol,
    );

    expect(subtractDecimal(period.realizedPnl, opening.realizedPnl)).toBe("0.2");
  });
});
