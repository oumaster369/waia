import { describe, expect, it, vi } from "vitest";

import type {
  FillRow,
  OrderRepository,
  OrderRow,
} from "@/lib/trader/execution/order-repository.types";
import { deriveAccountRiskStateFromMockOrders } from "@/lib/trader/paper/account-risk-state-from-orders";
import {
  derivePaperBook,
  netPositionsFromFilledOrders,
} from "@/lib/trader/paper/derive-paper-book";
import { PaperPnLReconciliationError } from "@/lib/trader/paper/paper-pnl.errors";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORG_A = "00000000-0000-4000-8000-0000000267";
const ORG_B = "00000000-0000-4000-8000-0000000268";

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
    riskDecisionId: "risk-267",
    strategySignalId: null,
    allocationDecisionId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };

  return { ...base, ...overrides };
}

function mockFill(orderId: string, overrides: Partial<FillRow> = {}): FillRow {
  return {
    id: overrides.id ?? `fill-${orderId}`,
    organizationId: ORG_A,
    orderId,
    exchangeTradeId: overrides.exchangeTradeId ?? `trade-${orderId}`,
    price: overrides.price ?? "64000",
    quantity: overrides.quantity ?? "0.01",
    fee: overrides.fee ?? "0",
    feeAsset: overrides.feeAsset ?? "",
    executedAt: overrides.executedAt ?? new Date(0),
    createdAt: overrides.createdAt ?? new Date(0),
  };
}

function mockRepository(
  orders: OrderRow[],
  options: {
    openOrders?: OrderRow[];
    fillsByOrderId?: Record<string, FillRow[]>;
  } = {},
): OrderRepository {
  const fillsByOrderId = options.fillsByOrderId ?? {};

  for (const order of orders) {
    if (
      order.state === "FILLED" &&
      Number(order.filledQuantity) > 0 &&
      fillsByOrderId[order.id] === undefined
    ) {
      fillsByOrderId[order.id] = [
        mockFill(order.id, {
          organizationId: order.organizationId,
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
    listOpenOrders: vi.fn(async () => options.openOrders ?? []),
    listOrders: vi.fn(async (context, filter) => {
      return orders.filter((order) => {
        if (order.organizationId !== context.organizationId) {
          return false;
        }
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
    recordFillProgress: vi.fn(),
    listEvents: vi.fn(),
    listFills: vi.fn(async (_context, orderId) => fillsByOrderId[orderId] ?? []),
  };
}

function positionsFromFillWalk(
  orders: OrderRow[],
  fillsByOrderId: Record<string, FillRow[]>,
): { symbol: string; quantity: string }[] {
  const slices = orders.flatMap((order) => {
    const fills = fillsByOrderId[order.id] ?? [];
    return fills.map((fill) => ({
      id: `${order.id}-${fill.exchangeTradeId}`,
      symbol: order.symbol,
      side: order.side,
      state: "FILLED" as const,
      filledQuantity: fill.quantity,
      createdAt: fill.executedAt,
    }));
  });

  const net = netPositionsFromFilledOrders(slices);
  return [...net.entries()]
    .filter(([, quantity]) => quantity !== "0")
    .map(([symbol, quantity]) => ({ symbol, quantity }));
}

describe("derivePaperBook (AT-E9 S8)", () => {
  it("AC1: returns empty book when no FILLED orders exist", async () => {
    const repo = mockRepository([]);
    const book = await derivePaperBook({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
    });

    expect(book.organizationId).toBe(ORG_A);
    expect(book.executionMode).toBe("mock");
    expect(book.positions).toEqual([]);
    expect(book.derivedAt).toBeInstanceOf(Date);
  });

  it("AC2: derives a single buy position", async () => {
    const repo = mockRepository([mockOrder({ id: "buy-1" })]);
    const book = await derivePaperBook({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
    });

    expect(book.positions).toEqual([{ symbol: "BTC/USDT", quantity: "0.01" }]);
  });

  it("AC3: nets partial sell quantity", async () => {
    const repo = mockRepository([
      mockOrder({ id: "buy-2", filledQuantity: "0.02", avgFillPrice: "100" }),
      mockOrder({
        id: "sell-1",
        side: "sell",
        filledQuantity: "0.01",
        avgFillPrice: "110",
      }),
    ]);

    const book = await derivePaperBook({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
    });

    expect(book.positions).toEqual([{ symbol: "BTC/USDT", quantity: "0.01" }]);
  });

  it("AC4: omits symbol when fully closed", async () => {
    const repo = mockRepository([
      mockOrder({ id: "buy-3", filledQuantity: "0.01" }),
      mockOrder({
        id: "sell-2",
        side: "sell",
        filledQuantity: "0.01",
      }),
    ]);

    const book = await derivePaperBook({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
    });

    expect(book.positions).toEqual([]);
  });

  it("AC5: keeps independent nets per symbol", async () => {
    const repo = mockRepository([
      mockOrder({ id: "btc-buy", symbol: "BTC/USDT", filledQuantity: "0.01" }),
      mockOrder({
        id: "eth-buy",
        symbol: "ETH/USDT",
        filledQuantity: "0.5",
        avgFillPrice: "3000",
      }),
    ]);

    const book = await derivePaperBook({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
    });

    expect(book.positions).toEqual([
      { symbol: "BTC/USDT", quantity: "0.01" },
      { symbol: "ETH/USDT", quantity: "0.5" },
    ]);
  });

  it("AC6: rejects oversell during canonical fill-walk", async () => {
    const repo = mockRepository([
      mockOrder({ id: "buy-4", filledQuantity: "0.01" }),
      mockOrder({
        id: "sell-3",
        side: "sell",
        filledQuantity: "0.02",
      }),
    ]);

    await expect(
      derivePaperBook({
        context: requireOrgContext(ORG_A),
        orderRepository: repo,
      }),
    ).rejects.toThrow(PaperPnLReconciliationError);
  });

  it("AC7: is idempotent across repeated derivation", async () => {
    const repo = mockRepository([mockOrder({ id: "buy-5" })]);
    const input = {
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
    };

    const first = await derivePaperBook(input);
    const second = await derivePaperBook(input);

    expect(second.positions).toEqual(first.positions);
    expect(second.executionMode).toBe(first.executionMode);
    expect(second.organizationId).toBe(first.organizationId);
  });

  it("AC8: partitions mock and paper execution modes", async () => {
    const repo = mockRepository([
      mockOrder({ id: "mock-order", executionMode: "mock", filledQuantity: "0.01" }),
      mockOrder({
        id: "paper-order",
        executionMode: "paper",
        symbol: "ETH/USDT",
        filledQuantity: "0.2",
        avgFillPrice: "3000",
      }),
    ]);

    const mockBook = await derivePaperBook({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      executionMode: "mock",
    });
    const paperBook = await derivePaperBook({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      executionMode: "paper",
    });

    expect(mockBook.positions).toEqual([{ symbol: "BTC/USDT", quantity: "0.01" }]);
    expect(paperBook.positions).toEqual([{ symbol: "ETH/USDT", quantity: "0.2" }]);
  });

  it("AC9: scopes derivation to the requested organization context", async () => {
    const repo = mockRepository(
      [mockOrder({ id: "org-a-buy" }, ORG_A), mockOrder({ id: "org-b-buy" }, ORG_B)],
      {},
    );

    const bookA = await derivePaperBook({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
    });
    const bookB = await derivePaperBook({
      context: requireOrgContext(ORG_B),
      orderRepository: repo,
    });

    expect(bookA.positions).toEqual([{ symbol: "BTC/USDT", quantity: "0.01" }]);
    expect(bookB.positions).toEqual([{ symbol: "BTC/USDT", quantity: "0.01" }]);
    expect(repo.listOrders).toHaveBeenCalledWith(requireOrgContext(ORG_A), {
      executionMode: "mock",
    });
  });

  it("AC10: excludes non-FILLED orders from the book", async () => {
    const repo = mockRepository([
      mockOrder({
        id: "open-order",
        state: "RISK_APPROVED",
        filledQuantity: "0",
        avgFillPrice: null,
      }),
      mockOrder({
        id: "partial",
        state: "PARTIALLY_FILLED",
        filledQuantity: "0.005",
      }),
    ]);

    const book = await derivePaperBook({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
    });

    expect(book.positions).toEqual([]);
  });

  it("AC11: matches AccountRiskState positions", async () => {
    const orders = [
      mockOrder({ id: "parity-buy", filledQuantity: "0.02", avgFillPrice: "100" }),
      mockOrder({
        id: "parity-sell",
        side: "sell",
        filledQuantity: "0.01",
        avgFillPrice: "110",
      }),
    ];
    const repo = mockRepository(orders);
    const context = requireOrgContext(ORG_A);

    const [book, state] = await Promise.all([
      derivePaperBook({ context, orderRepository: repo }),
      deriveAccountRiskStateFromMockOrders({ context, orderRepository: repo }),
    ]);

    expect(state.positions).toEqual(book.positions);
  });

  it("AC14: fill-level aggregation matches order-level aggregation", async () => {
    const buy = mockOrder({ id: "fill-buy", filledQuantity: "0.03", avgFillPrice: "100" });
    const sell = mockOrder({
      id: "fill-sell",
      side: "sell",
      filledQuantity: "0.01",
      avgFillPrice: "110",
    });
    const fillsByOrderId = {
      "fill-buy": [
        mockFill("fill-buy", { quantity: "0.02", exchangeTradeId: "t1" }),
        mockFill("fill-buy", { quantity: "0.01", exchangeTradeId: "t2" }),
      ],
      "fill-sell": [mockFill("fill-sell", { quantity: "0.01", exchangeTradeId: "t3" })],
    };
    const repo = mockRepository([buy, sell], { fillsByOrderId });

    const book = await derivePaperBook({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
    });
    const fromFills = positionsFromFillWalk([buy, sell], fillsByOrderId);

    expect(book.positions).toEqual(fromFills);
    expect(book.positions).toEqual([{ symbol: "BTC/USDT", quantity: "0.02" }]);
  });
});

describe("derivePaperBook deterministic ordering", () => {
  it("sorts by createdAt then id before netting", () => {
    const net = netPositionsFromFilledOrders([
      {
        id: "b",
        symbol: "BTC/USDT",
        side: "sell",
        state: "FILLED",
        filledQuantity: "0.01",
        createdAt: new Date(2),
      },
      {
        id: "a",
        symbol: "BTC/USDT",
        side: "buy",
        state: "FILLED",
        filledQuantity: "0.02",
        createdAt: new Date(1),
      },
    ]);

    expect([...net.entries()]).toEqual([["BTC/USDT", "0.01"]]);
  });
});
