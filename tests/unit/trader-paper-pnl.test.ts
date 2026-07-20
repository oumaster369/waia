import { describe, expect, it, vi } from "vitest";

import type {
  FillRow,
  OrderRepository,
  OrderRow,
} from "@/lib/trader/execution/order-repository.types";
import { derivePaperBook } from "@/lib/trader/paper/derive-paper-book";
import { derivePaperPnL, walkFillsForPnL } from "@/lib/trader/paper/derive-paper-pnl";
import {
  PaperPnLReconciliationError,
  PaperPnLScopeError,
} from "@/lib/trader/paper/paper-pnl.errors";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORG_A = "00000000-0000-4000-8000-0000000268";
const ORG_B = "00000000-0000-4000-8000-0000000269";

function mockOrder(
  overrides: Partial<OrderRow> & Pick<OrderRow, "id">,
  organizationId = ORG_A,
): OrderRow {
  const base: OrderRow = {
    id: overrides.id,
    organizationId,
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
    riskDecisionId: "risk-268",
    strategySignalId: null,
    allocationDecisionId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };

  return { ...base, ...overrides };
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
    if (isFilled(order) && fillsByOrderId[order.id] === undefined) {
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
    recordFillProgress: vi.fn(),
    listEvents: vi.fn(),
    listFills: vi.fn(async (_context, orderId) => fillsByOrderId[orderId] ?? []),
  };
}

function isFilled(order: OrderRow): boolean {
  return order.state === "FILLED" && order.filledQuantity !== "0";
}

describe("derivePaperPnL (AT-E9 S1 / DEE-268)", () => {
  it("AC1: returns zero PnL for empty org", async () => {
    const repo = mockRepository([]);
    const pnl = await derivePaperPnL({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
    });

    expect(pnl.realizedPnl).toBe("0");
    expect(pnl.totalFees).toBe("0");
    expect(pnl.positions).toEqual([]);
    expect(pnl.unrealizedPnl).toBeNull();
    expect(pnl.totalPnl).toBeNull();
    expect(pnl.feesByAsset).toEqual({});
  });

  it("AC2: capitalizes quote buy fees into avgCost", async () => {
    const buy = mockOrder({ id: "buy-fee" });
    const fillsByOrderId = {
      "buy-fee": [
        mockFill("buy-fee", {
          price: "100",
          quantity: "0.01",
          fee: "1",
          feeAsset: "USDT",
        }),
      ],
    };
    const repo = mockRepository([buy], { fillsByOrderId });

    const pnl = await derivePaperPnL({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
    });

    expect(pnl.realizedPnl).toBe("0");
    expect(pnl.totalFees).toBe("0");
    expect(pnl.positions).toEqual([
      expect.objectContaining({
        quantity: "0.01",
        avgCost: "200",
        costBasis: "2",
      }),
    ]);
  });

  it("AC3: realizes PnL on full sell with quote sell fee", async () => {
    const buy = mockOrder({
      id: "buy-round",
      filledQuantity: "0.01",
      avgFillPrice: "100",
      createdAt: new Date(0),
    });
    const sell = mockOrder({
      id: "sell-round",
      side: "sell",
      filledQuantity: "0.01",
      avgFillPrice: "110",
      createdAt: new Date(1),
    });
    const fillsByOrderId = {
      "buy-round": [
        mockFill("buy-round", { price: "100", quantity: "0.01", executedAt: new Date(0) }),
      ],
      "sell-round": [
        mockFill("sell-round", {
          price: "110",
          quantity: "0.01",
          fee: "0.5",
          feeAsset: "USDT",
          executedAt: new Date(1),
        }),
      ],
    };
    const repo = mockRepository([buy, sell], { fillsByOrderId });

    const pnl = await derivePaperPnL({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
    });

    expect(pnl.positions).toEqual([]);
    expect(pnl.realizedPnl).toBe("-0.4");
    expect(pnl.totalFees).toBe("0.5");
  });

  it("AC4: partial sell leaves remaining position matching Paper Book", async () => {
    const buy = mockOrder({ id: "buy-partial", filledQuantity: "0.02", avgFillPrice: "100" });
    const sell = mockOrder({
      id: "sell-partial",
      side: "sell",
      filledQuantity: "0.01",
      avgFillPrice: "110",
      createdAt: new Date(1),
    });
    const fillsByOrderId = {
      "buy-partial": [mockFill("buy-partial", { price: "100", quantity: "0.02" })],
      "sell-partial": [
        mockFill("sell-partial", { price: "110", quantity: "0.01", executedAt: new Date(1) }),
      ],
    };
    const repo = mockRepository([buy, sell], { fillsByOrderId });
    const context = requireOrgContext(ORG_A);

    const [pnl, book] = await Promise.all([
      derivePaperPnL({ context, orderRepository: repo }),
      derivePaperBook({ context, orderRepository: repo }),
    ]);

    expect(pnl.positions).toHaveLength(1);
    expect(pnl.positions[0]?.quantity).toBe("0.01");
    expect(book.positions).toEqual([{ symbol: "BTC/USDT", quantity: "0.01" }]);
    expect(pnl.realizedPnl).toBe("0.1");
  });

  it("AC5: quote buy fees do not change realizedPnl or totalFees directly", async () => {
    const withoutFee = mockOrder({ id: "buy-plain", avgFillPrice: "100" });
    const withFee = mockOrder({ id: "buy-fee2", avgFillPrice: "100" });
    const repoPlain = mockRepository([withoutFee], {
      fillsByOrderId: {
        "buy-plain": [mockFill("buy-plain", { price: "100", quantity: "0.01", fee: "0" })],
      },
    });
    const repoFee = mockRepository([withFee], {
      fillsByOrderId: {
        "buy-fee2": [
          mockFill("buy-fee2", { price: "100", quantity: "0.01", fee: "1", feeAsset: "USDT" }),
        ],
      },
    });
    const context = requireOrgContext(ORG_A);

    const [plain, fee] = await Promise.all([
      derivePaperPnL({ context, orderRepository: repoPlain }),
      derivePaperPnL({ context, orderRepository: repoFee }),
    ]);

    expect(plain.realizedPnl).toBe("0");
    expect(fee.realizedPnl).toBe("0");
    expect(plain.totalFees).toBe("0");
    expect(fee.totalFees).toBe("0");
    expect(plain.totalPnl).toBeNull();
    expect(fee.totalPnl).toBeNull();
    expect(fee.positions[0]?.avgCost).toBe("200");
  });

  it("AC6: quote sell fees reduce realizedPnl and accumulate in totalFees", async () => {
    const buy = mockOrder({ id: "buy-sellfee", avgFillPrice: "100" });
    const sell = mockOrder({
      id: "sell-sellfee",
      side: "sell",
      filledQuantity: "0.01",
      avgFillPrice: "120",
      createdAt: new Date(1),
    });
    const repo = mockRepository([buy, sell], {
      fillsByOrderId: {
        "buy-sellfee": [mockFill("buy-sellfee", { price: "100", quantity: "0.01" })],
        "sell-sellfee": [
          mockFill("sell-sellfee", {
            price: "120",
            quantity: "0.01",
            fee: "0.25",
            feeAsset: "USDT",
            executedAt: new Date(1),
          }),
        ],
      },
    });

    const pnl = await derivePaperPnL({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      markPrices: { marks: { "BTC/USDT": "120" } },
    });

    expect(pnl.totalFees).toBe("0.25");
    expect(pnl.realizedPnl).toBe("-0.05");
    expect(pnl.totalPnl).toBe("-0.05");
  });

  it("AC7: non-quote fees appear only in feesByAsset and valuationGaps", async () => {
    const buy = mockOrder({ id: "buy-basefee", avgFillPrice: "100" });
    const repo = mockRepository([buy], {
      fillsByOrderId: {
        "buy-basefee": [
          mockFill("buy-basefee", {
            price: "100",
            quantity: "0.01",
            fee: "0.0001",
            feeAsset: "BTC",
          }),
        ],
      },
    });
    const context = requireOrgContext(ORG_A);

    const baseline = await derivePaperPnL({
      context,
      orderRepository: mockRepository([mockOrder({ id: "buy-plain2", avgFillPrice: "100" })], {
        fillsByOrderId: {
          "buy-plain2": [mockFill("buy-plain2", { price: "100", quantity: "0.01", fee: "0" })],
        },
      }),
    });
    const withBaseFee = await derivePaperPnL({ context, orderRepository: repo });

    expect(withBaseFee.feesByAsset).toEqual({ BTC: "0.0001" });
    expect(withBaseFee.valuationGaps.length).toBeGreaterThan(0);
    expect(withBaseFee.positions[0]?.avgCost).toBe(baseline.positions[0]?.avgCost);
    expect(withBaseFee.realizedPnl).toBe(baseline.realizedPnl);
    expect(withBaseFee.totalFees).toBe(baseline.totalFees);
    expect(withBaseFee.totalPnl).toBe(baseline.totalPnl);
  });

  it("AC8: computes unrealized and total PnL when markPrices provided", async () => {
    const buy = mockOrder({ id: "buy-open", avgFillPrice: "100" });
    const repo = mockRepository([buy], {
      fillsByOrderId: {
        "buy-open": [mockFill("buy-open", { price: "100", quantity: "0.01" })],
      },
    });

    const pnl = await derivePaperPnL({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      markPrices: { marks: { "BTC/USDT": "110" } },
    });

    expect(pnl.unrealizedPnl).toBe("0.1");
    expect(pnl.totalPnl).toBe("0.1");
    expect(pnl.positions[0]).toMatchObject({
      markPrice: "110",
      marketValue: "1.1",
      costBasis: "1",
      unrealizedPnl: "0.1",
    });
  });

  it("AC9: leaves unrealized and total PnL null without markPrices", async () => {
    const buy = mockOrder({ id: "buy-nomarks" });
    const repo = mockRepository([buy]);

    const pnl = await derivePaperPnL({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
    });

    expect(pnl.unrealizedPnl).toBeNull();
    expect(pnl.totalPnl).toBeNull();
    expect(pnl.realizedPnl).toBe("0");
    expect(pnl.totalFees).toBe("0");
  });

  it("AC10: position quantities match derivePaperBook", async () => {
    const orders = [
      mockOrder({ id: "parity-buy", filledQuantity: "0.02", avgFillPrice: "100" }),
      mockOrder({
        id: "parity-sell",
        side: "sell",
        filledQuantity: "0.01",
        avgFillPrice: "110",
        createdAt: new Date(1),
      }),
    ];
    const fillsByOrderId = {
      "parity-buy": [mockFill("parity-buy", { price: "100", quantity: "0.02" })],
      "parity-sell": [
        mockFill("parity-sell", { price: "110", quantity: "0.01", executedAt: new Date(1) }),
      ],
    };
    const repo = mockRepository(orders, { fillsByOrderId });
    const context = requireOrgContext(ORG_A);

    const [pnl, book] = await Promise.all([
      derivePaperPnL({ context, orderRepository: repo }),
      derivePaperBook({ context, orderRepository: repo }),
    ]);

    expect(
      pnl.positions.map((position) => ({ symbol: position.symbol, quantity: position.quantity })),
    ).toEqual(book.positions);
  });

  it("AC11: rejects order/fill quantity mismatch", async () => {
    const order = mockOrder({ id: "drift", filledQuantity: "0.02" });
    const repo = mockRepository([order], {
      fillsByOrderId: {
        drift: [mockFill("drift", { quantity: "0.01" })],
      },
    });

    await expect(
      derivePaperPnL({
        context: requireOrgContext(ORG_A),
        orderRepository: repo,
      }),
    ).rejects.toBeInstanceOf(PaperPnLReconciliationError);
  });

  it("AC12: scopes derivation to organization context", async () => {
    const repo = mockRepository(
      [mockOrder({ id: "org-a" }, ORG_A), mockOrder({ id: "org-b" }, ORG_B)],
      {},
    );

    const pnlA = await derivePaperPnL({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
    });
    const pnlB = await derivePaperPnL({
      context: requireOrgContext(ORG_B),
      orderRepository: repo,
    });

    expect(pnlA.positions).toHaveLength(1);
    expect(pnlB.positions).toHaveLength(1);
    expect(pnlA.organizationId).toBe(ORG_A);
    expect(pnlB.organizationId).toBe(ORG_B);
  });

  it("AC13: partitions mock and paper execution modes", async () => {
    const repo = mockRepository([
      mockOrder({ id: "mock-order", executionMode: "mock" }),
      mockOrder({
        id: "paper-order",
        executionMode: "paper",
        symbol: "ETH/USDT",
        avgFillPrice: "3000",
        filledQuantity: "0.2",
      }),
    ]);

    const mockPnl = await derivePaperPnL({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      executionMode: "mock",
    });
    const paperPnl = await derivePaperPnL({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      executionMode: "paper",
    });

    expect(mockPnl.positions).toEqual([
      expect.objectContaining({ symbol: "BTC/USDT", quantity: "0.01" }),
    ]);
    expect(paperPnl.positions).toEqual([
      expect.objectContaining({ symbol: "ETH/USDT", quantity: "0.2" }),
    ]);
  });

  it("AC14: is idempotent across repeated derivation", async () => {
    const repo = mockRepository([mockOrder({ id: "buy-idem" })]);
    const input = {
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
    };

    const first = await derivePaperPnL(input);
    const second = await derivePaperPnL(input);

    expect(second.realizedPnl).toBe(first.realizedPnl);
    expect(second.totalFees).toBe(first.totalFees);
    expect(second.positions).toEqual(first.positions);
  });

  it("AC15: is deterministic under permuted fill fetch order", () => {
    const buy = mockOrder({ id: "buy-sort", filledQuantity: "0.02", avgFillPrice: "100" });
    const sell = mockOrder({
      id: "sell-sort",
      side: "sell",
      filledQuantity: "0.01",
      avgFillPrice: "110",
    });
    const eventsA = [
      {
        fill: mockFill("buy-sort", { id: "f1", quantity: "0.02", executedAt: new Date(0) }),
        order: buy,
      },
      {
        fill: mockFill("sell-sort", {
          id: "f2",
          quantity: "0.01",
          price: "110",
          executedAt: new Date(1),
        }),
        order: sell,
      },
    ];
    const eventsB = [...eventsA].reverse();
    const quoteMap = { "BTC/USDT": "USDT" };

    const walkA = walkFillsForPnL(eventsA, quoteMap);
    const walkB = walkFillsForPnL(eventsB, quoteMap);

    expect(walkA.realizedPnl).toBe(walkB.realizedPnl);
    expect(walkA.totalFees).toBe(walkB.totalFees);
  });

  it("AC16: rejects sell quantity exceeding open holdings", async () => {
    const sell = mockOrder({
      id: "sell-naked",
      side: "sell",
      filledQuantity: "0.01",
      avgFillPrice: "100",
    });
    const repo = mockRepository([sell], {
      fillsByOrderId: {
        "sell-naked": [mockFill("sell-naked", { price: "100", quantity: "0.01" })],
      },
    });

    await expect(
      derivePaperPnL({
        context: requireOrgContext(ORG_A),
        orderRepository: repo,
      }),
    ).rejects.toBeInstanceOf(PaperPnLReconciliationError);
  });

  it("AC17: rejects mixed quote currencies", async () => {
    const repo = mockRepository([
      mockOrder({ id: "btc", symbol: "BTC/USDT" }),
      mockOrder({ id: "eth-eur", symbol: "ETH/EUR", avgFillPrice: "3000", filledQuantity: "0.1" }),
    ]);

    await expect(
      derivePaperPnL({
        context: requireOrgContext(ORG_A),
        orderRepository: repo,
      }),
    ).rejects.toBeInstanceOf(PaperPnLScopeError);
  });

  it("AC18: rejects out-of-scope execution mode at runtime", async () => {
    const repo = mockRepository([]);

    await expect(
      derivePaperPnL({
        context: requireOrgContext(ORG_A),
        orderRepository: repo,
        executionMode: "live" as "mock",
      }),
    ).rejects.toBeInstanceOf(PaperPnLScopeError);
  });
});
