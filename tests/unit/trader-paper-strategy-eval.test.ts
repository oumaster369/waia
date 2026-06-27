import { describe, expect, it, vi } from "vitest";

import type {
  FillRow,
  OrderRepository,
  OrderRow,
} from "@/lib/trader/execution/order-repository.types";
import { loadPaperFillEvents } from "@/lib/trader/paper/derive-paper-pnl";
import {
  derivePaperStrategyEvaluation,
  derivePaperStrategyEvaluations,
} from "@/lib/trader/paper/derive-paper-strategy-eval";
import {
  PaperPnLReconciliationError,
  PaperPnLScopeError,
  PaperPnLWindowError,
} from "@/lib/trader/paper/paper-pnl.errors";
import { addDecimal } from "@/lib/trader/risk/numeric";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORG_A = "00000000-0000-4000-8000-0000000270";
const STRATEGY_A = "signal-270-a";
const STRATEGY_B = "signal-270-b";
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
    riskDecisionId: "risk-270",
    strategySignalId: STRATEGY_A,
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

describe("derivePaperStrategyEvaluation (AT-E9 S3 / DEE-270)", () => {
  it("AC1: returns strategy-scoped period fields matching two-walk delta", async () => {
    const buy = mockOrder({ id: "ac1-buy", avgFillPrice: "100" });
    const sell = mockOrder({
      id: "ac1-sell",
      side: "sell",
      avgFillPrice: "120",
      filledQuantity: "0.01",
    });
    const repo = mockRepository([buy, sell], {
      fillsByOrderId: {
        "ac1-buy": [
          mockFill("ac1-buy", { price: "100", quantity: "0.01", executedAt: new Date(100) }),
        ],
        "ac1-sell": [
          mockFill("ac1-sell", {
            price: "120",
            quantity: "0.01",
            executedAt: new Date(150),
          }),
        ],
      },
    });

    const evaluation = await derivePaperStrategyEvaluation({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      strategySignalId: STRATEGY_A,
      window: { start: new Date(120), end: new Date(200) },
    });

    expect(evaluation.periodRealizedPnl).toBe("0.2");
    expect(evaluation.endSnapshot.realizedPnl).toBe("0.2");
    expect(evaluation.strategySignalId).toBe(STRATEGY_A);
  });

  it("AC2: ignores fills on orders with different or null strategySignalId", async () => {
    const strategyBuy = mockOrder({ id: "iso-buy", avgFillPrice: "100" });
    const otherBuy = mockOrder({
      id: "other-buy",
      avgFillPrice: "200",
      strategySignalId: STRATEGY_B,
    });
    const nullBuy = mockOrder({
      id: "null-buy",
      avgFillPrice: "300",
      strategySignalId: null,
    });
    const repo = mockRepository([strategyBuy, otherBuy, nullBuy], {
      fillsByOrderId: {
        "iso-buy": [
          mockFill("iso-buy", { price: "100", quantity: "0.01", executedAt: new Date(100) }),
        ],
        "other-buy": [
          mockFill("other-buy", { price: "200", quantity: "0.01", executedAt: new Date(110) }),
        ],
        "null-buy": [
          mockFill("null-buy", { price: "300", quantity: "0.01", executedAt: new Date(120) }),
        ],
      },
    });

    const evaluation = await derivePaperStrategyEvaluation({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      strategySignalId: STRATEGY_A,
      window: { start: EPOCH, end: new Date(500) },
    });

    expect(evaluation.endSnapshot.positions).toEqual([
      expect.objectContaining({ quantity: "0.01", avgCost: "100" }),
    ]);
    expect(evaluation.periodRealizedPnl).toBe("0");
  });

  it("AC3: endSnapshot excludes fills with executedAt >= window.end", async () => {
    const buy = mockOrder({ id: "bound-buy", avgFillPrice: "100" });
    const inSell = mockOrder({
      id: "bound-in-sell",
      side: "sell",
      avgFillPrice: "110",
      filledQuantity: "0.01",
    });
    const postSell = mockOrder({
      id: "bound-post-sell",
      side: "sell",
      avgFillPrice: "130",
      filledQuantity: "0.01",
    });
    const repo = mockRepository([buy, inSell, postSell], {
      fillsByOrderId: {
        "bound-buy": [
          mockFill("bound-buy", { price: "100", quantity: "0.01", executedAt: new Date(100) }),
        ],
        "bound-in-sell": [
          mockFill("bound-in-sell", {
            price: "110",
            quantity: "0.01",
            executedAt: new Date(150),
          }),
        ],
        "bound-post-sell": [
          mockFill("bound-post-sell", {
            price: "130",
            quantity: "0.01",
            executedAt: new Date(250),
          }),
        ],
      },
    });

    const evaluation = await derivePaperStrategyEvaluation({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      strategySignalId: STRATEGY_A,
      window: { start: new Date(120), end: new Date(200) },
    });

    expect(evaluation.endSnapshot.realizedPnl).toBe("0.1");
    expect(evaluation.periodRealizedPnl).toBe("0.1");
    expect(evaluation.closedTradeCount).toBe(1);
  });

  it("AC4: periodRealizedPnl equals sum of in-window sell tradePnl from window start", async () => {
    const buy = mockOrder({ id: "sum-buy", avgFillPrice: "100" });
    const sell = mockOrder({
      id: "sum-sell",
      side: "sell",
      avgFillPrice: "120",
      filledQuantity: "0.01",
    });
    const repo = mockRepository([buy, sell], {
      fillsByOrderId: {
        "sum-buy": [
          mockFill("sum-buy", { price: "100", quantity: "0.01", executedAt: new Date(50) }),
        ],
        "sum-sell": [
          mockFill("sum-sell", {
            price: "120",
            quantity: "0.01",
            executedAt: new Date(150),
          }),
        ],
      },
    });

    const evaluation = await derivePaperStrategyEvaluation({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      strategySignalId: STRATEGY_A,
      window: { start: EPOCH, end: new Date(500) },
    });

    const tradeSum = evaluation.closedTrades.reduce(
      (sum, trade) => addDecimal(sum, trade.tradePnl),
      "0",
    );
    expect(evaluation.periodRealizedPnl).toBe(tradeSum);
    expect(evaluation.periodRealizedPnl).toBe("0.2");
  });

  it("AC5: computes period total PnL change when marks complete", async () => {
    const buy = mockOrder({ id: "mtm-buy", avgFillPrice: "100" });
    const repo = mockRepository([buy], {
      fillsByOrderId: {
        "mtm-buy": [
          mockFill("mtm-buy", { price: "100", quantity: "0.01", executedAt: new Date(100) }),
        ],
      },
    });

    const evaluation = await derivePaperStrategyEvaluation({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      strategySignalId: STRATEGY_A,
      window: { start: new Date(50), end: new Date(200) },
      markPrices: { marks: { "BTC/USDT": "110" } },
    });

    expect(evaluation.periodUnrealizedChange).toBe("0.1");
    expect(evaluation.periodTotalPnlChange).toBe("0.1");
  });

  it("AC6: leaves change fields null without markPrices", async () => {
    const buy = mockOrder({ id: "no-marks" });
    const repo = mockRepository([buy], {
      fillsByOrderId: {
        "no-marks": [mockFill("no-marks", { executedAt: new Date(100) })],
      },
    });

    const evaluation = await derivePaperStrategyEvaluation({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      strategySignalId: STRATEGY_A,
      window: { start: new Date(50), end: new Date(200) },
    });

    expect(evaluation.periodUnrealizedChange).toBeNull();
    expect(evaluation.periodTotalPnlChange).toBeNull();
    expect(evaluation.periodRealizedPnl).toBe("0");
  });

  it("AC7: classifies win, loss, and breakeven trades; breakevens excluded from rates", async () => {
    const buy = mockOrder({
      id: "stats-buy",
      avgFillPrice: "100",
      quantity: "0.04",
      filledQuantity: "0.04",
    });
    const winSell = mockOrder({
      id: "stats-win",
      side: "sell",
      avgFillPrice: "120",
      quantity: "0.01",
      filledQuantity: "0.01",
    });
    const lossSell = mockOrder({
      id: "stats-loss",
      side: "sell",
      avgFillPrice: "90",
      quantity: "0.01",
      filledQuantity: "0.01",
    });
    const flatSell = mockOrder({
      id: "stats-flat",
      side: "sell",
      avgFillPrice: "100",
      quantity: "0.01",
      filledQuantity: "0.01",
    });
    const repo = mockRepository([buy, winSell, lossSell, flatSell], {
      fillsByOrderId: {
        "stats-buy": [
          mockFill("stats-buy", {
            price: "100",
            quantity: "0.04",
            executedAt: new Date(50),
          }),
        ],
        "stats-win": [
          mockFill("stats-win", {
            price: "120",
            quantity: "0.01",
            executedAt: new Date(100),
          }),
        ],
        "stats-loss": [
          mockFill("stats-loss", {
            price: "90",
            quantity: "0.01",
            executedAt: new Date(110),
          }),
        ],
        "stats-flat": [
          mockFill("stats-flat", {
            price: "100",
            quantity: "0.01",
            executedAt: new Date(120),
          }),
        ],
      },
    });

    const evaluation = await derivePaperStrategyEvaluation({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      strategySignalId: STRATEGY_A,
      window: { start: EPOCH, end: new Date(500) },
    });

    expect(evaluation.winCount).toBe(1);
    expect(evaluation.lossCount).toBe(1);
    expect(evaluation.breakevenCount).toBe(1);
    expect(evaluation.closedTradeCount).toBe(3);
    expect(evaluation.winRate).toBe("0.5");
    expect(evaluation.lossRate).toBe("0.5");
  });

  it("AC8: null profit metrics when prerequisite counts are zero", async () => {
    const buy = mockOrder({ id: "only-buy", avgFillPrice: "100" });
    const repo = mockRepository([buy], {
      fillsByOrderId: {
        "only-buy": [
          mockFill("only-buy", { price: "100", quantity: "0.01", executedAt: new Date(100) }),
        ],
      },
    });

    const evaluation = await derivePaperStrategyEvaluation({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      strategySignalId: STRATEGY_A,
      window: { start: EPOCH, end: new Date(500) },
    });

    expect(evaluation.profitFactor).toBeNull();
    expect(evaluation.expectancy).toBeNull();
    expect(evaluation.averageWin).toBeNull();
    expect(evaluation.averageLoss).toBeNull();
    expect(evaluation.winRate).toBeNull();
    expect(evaluation.lossRate).toBeNull();
    expect(evaluation.maxRealizedDrawdown).toBe("0");
    expect(evaluation.recoveryFactor).toBeNull();
  });

  it("AC9: maxRealizedDrawdown matches peak-to-trough on cumulative sell curve", async () => {
    const buy = mockOrder({
      id: "dd-buy",
      avgFillPrice: "100",
      quantity: "0.03",
      filledQuantity: "0.03",
    });
    const winSell = mockOrder({
      id: "dd-win",
      side: "sell",
      avgFillPrice: "120",
      quantity: "0.01",
      filledQuantity: "0.01",
    });
    const lossSell = mockOrder({
      id: "dd-loss",
      side: "sell",
      avgFillPrice: "80",
      quantity: "0.01",
      filledQuantity: "0.01",
    });
    const repo = mockRepository([buy, winSell, lossSell], {
      fillsByOrderId: {
        "dd-buy": [
          mockFill("dd-buy", { price: "100", quantity: "0.03", executedAt: new Date(50) }),
        ],
        "dd-win": [
          mockFill("dd-win", { price: "120", quantity: "0.01", executedAt: new Date(100) }),
        ],
        "dd-loss": [
          mockFill("dd-loss", { price: "80", quantity: "0.01", executedAt: new Date(110) }),
        ],
      },
    });

    const evaluation = await derivePaperStrategyEvaluation({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      strategySignalId: STRATEGY_A,
      window: { start: EPOCH, end: new Date(500) },
    });

    expect(evaluation.maxRealizedDrawdown).toBe("0.2");
  });

  it("AC10: recoveryFactor null when drawdown zero; otherwise periodRealizedPnl / drawdown", async () => {
    const buy = mockOrder({ id: "rf-buy", avgFillPrice: "100" });
    const sell = mockOrder({
      id: "rf-sell",
      side: "sell",
      avgFillPrice: "120",
      filledQuantity: "0.01",
    });
    const repo = mockRepository([buy, sell], {
      fillsByOrderId: {
        "rf-buy": [
          mockFill("rf-buy", { price: "100", quantity: "0.01", executedAt: new Date(50) }),
        ],
        "rf-sell": [
          mockFill("rf-sell", { price: "120", quantity: "0.01", executedAt: new Date(100) }),
        ],
      },
    });

    const evaluation = await derivePaperStrategyEvaluation({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      strategySignalId: STRATEGY_A,
      window: { start: EPOCH, end: new Date(500) },
    });

    expect(evaluation.maxRealizedDrawdown).toBe("0");
    expect(evaluation.recoveryFactor).toBeNull();
    expect(evaluation.periodRealizedPnl).toBe("0.2");
  });

  it("AC11: unknown strategySignalId returns zeros and nulls without throw", async () => {
    const buy = mockOrder({ id: "other-strat-buy" });
    const repo = mockRepository([buy], {
      fillsByOrderId: {
        "other-strat-buy": [mockFill("other-strat-buy", { executedAt: new Date(100) })],
      },
    });

    const evaluation = await derivePaperStrategyEvaluation({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      strategySignalId: "signal-never-used",
      window: { start: EPOCH, end: new Date(500) },
    });

    expect(evaluation.periodRealizedPnl).toBe("0");
    expect(evaluation.endSnapshot.positions).toEqual([]);
    expect(evaluation.closedTradeCount).toBe(0);
    expect(evaluation.winRate).toBeNull();
  });

  it("AC12: preserves S1 fee policy for strategy-scoped fills", async () => {
    const withBaseFee = mockOrder({ id: "fee-buy", avgFillPrice: "100" });
    const plain = mockOrder({ id: "plain-buy", avgFillPrice: "100", strategySignalId: STRATEGY_B });
    const repoBase = mockRepository([withBaseFee], {
      fillsByOrderId: {
        "fee-buy": [
          mockFill("fee-buy", {
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

    const [feeEval, plainEval] = await Promise.all([
      derivePaperStrategyEvaluation({
        context,
        orderRepository: repoBase,
        strategySignalId: STRATEGY_A,
        window,
      }),
      derivePaperStrategyEvaluation({
        context,
        orderRepository: repoPlain,
        strategySignalId: STRATEGY_B,
        window,
      }),
    ]);

    expect(feeEval.periodFeesByAsset).toEqual({ BTC: "0.0001" });
    expect(feeEval.periodValuationGaps.length).toBeGreaterThan(0);
    expect(feeEval.periodRealizedPnl).toBe(plainEval.periodRealizedPnl);
    expect(feeEval.periodTotalFees).toBe(plainEval.periodTotalFees);
  });

  it("AC13: injected fillEvents matches repository-loaded evaluation", async () => {
    const buy = mockOrder({ id: "inject-buy", avgFillPrice: "100" });
    const sell = mockOrder({
      id: "inject-sell",
      side: "sell",
      avgFillPrice: "120",
      filledQuantity: "0.01",
    });
    const repo = mockRepository([buy, sell], {
      fillsByOrderId: {
        "inject-buy": [
          mockFill("inject-buy", { price: "100", quantity: "0.01", executedAt: new Date(100) }),
        ],
        "inject-sell": [
          mockFill("inject-sell", {
            price: "120",
            quantity: "0.01",
            executedAt: new Date(150),
          }),
        ],
      },
    });
    const context = requireOrgContext(ORG_A);
    const window = { start: new Date(120), end: new Date(200) };
    const { fillEvents } = await loadPaperFillEvents({
      context,
      orderRepository: repo,
      executionMode: "mock",
    });

    const [fromRepo, fromInject] = await Promise.all([
      derivePaperStrategyEvaluation({
        context,
        orderRepository: repo,
        strategySignalId: STRATEGY_A,
        window,
      }),
      derivePaperStrategyEvaluation({
        context,
        orderRepository: repo,
        strategySignalId: STRATEGY_A,
        window,
        fillEvents,
      }),
    ]);

    expect(fromInject.periodRealizedPnl).toBe(fromRepo.periodRealizedPnl);
    expect(fromInject.closedTradeCount).toBe(fromRepo.closedTradeCount);
    expect(fromInject.endSnapshot.realizedPnl).toBe(fromRepo.endSnapshot.realizedPnl);
  });

  it("batch helper evaluates multiple strategies from one fill load", async () => {
    const buyA = mockOrder({ id: "batch-a", avgFillPrice: "100" });
    const buyB = mockOrder({
      id: "batch-b",
      avgFillPrice: "200",
      strategySignalId: STRATEGY_B,
    });
    const repo = mockRepository([buyA, buyB], {
      fillsByOrderId: {
        "batch-a": [
          mockFill("batch-a", { price: "100", quantity: "0.01", executedAt: new Date(100) }),
        ],
        "batch-b": [
          mockFill("batch-b", { price: "200", quantity: "0.01", executedAt: new Date(110) }),
        ],
      },
    });

    const evaluations = await derivePaperStrategyEvaluations({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      strategySignalIds: [STRATEGY_A, STRATEGY_B],
      window: { start: EPOCH, end: new Date(500) },
    });

    expect(evaluations).toHaveLength(2);
    expect(evaluations[0]?.strategySignalId).toBe(STRATEGY_A);
    expect(evaluations[1]?.strategySignalId).toBe(STRATEGY_B);
    expect(evaluations[0]?.endSnapshot.positions[0]?.avgCost).toBe("100");
    expect(evaluations[1]?.endSnapshot.positions[0]?.avgCost).toBe("200");
  });

  it("rejects invalid window and unsupported execution mode", async () => {
    const repo = mockRepository([]);

    await expect(
      derivePaperStrategyEvaluation({
        context: requireOrgContext(ORG_A),
        orderRepository: repo,
        strategySignalId: STRATEGY_A,
        window: { start: new Date(200), end: new Date(100) },
      }),
    ).rejects.toBeInstanceOf(PaperPnLWindowError);

    await expect(
      derivePaperStrategyEvaluation({
        context: requireOrgContext(ORG_A),
        orderRepository: repo,
        strategySignalId: STRATEGY_A,
        window: { start: EPOCH, end: new Date(500) },
        executionMode: "live" as "mock",
      }),
    ).rejects.toBeInstanceOf(PaperPnLScopeError);
  });

  it("throws when strategy sell exceeds isolated open quantity", async () => {
    const sell = mockOrder({
      id: "orphan-sell",
      side: "sell",
      avgFillPrice: "120",
      filledQuantity: "0.01",
    });
    const repo = mockRepository([sell], {
      fillsByOrderId: {
        "orphan-sell": [
          mockFill("orphan-sell", {
            price: "120",
            quantity: "0.01",
            executedAt: new Date(100),
          }),
        ],
      },
    });

    await expect(
      derivePaperStrategyEvaluation({
        context: requireOrgContext(ORG_A),
        orderRepository: repo,
        strategySignalId: STRATEGY_A,
        window: { start: EPOCH, end: new Date(500) },
      }),
    ).rejects.toBeInstanceOf(PaperPnLReconciliationError);
  });
});
