import { describe, expect, it, vi } from "vitest";

import type {
  FillRow,
  OrderRepository,
  OrderRow,
} from "@/lib/trader/execution/order-repository.types";
import {
  buildPaperEvaluationExport,
  buildPaperEvaluationExportDocument,
} from "@/lib/trader/paper/build-paper-evaluation-export";
import { derivePaperPnLPeriod } from "@/lib/trader/paper/derive-paper-pnl-period";
import { derivePaperStrategyEvaluations } from "@/lib/trader/paper/derive-paper-strategy-eval";
import { PaperEvaluationExportError } from "@/lib/trader/paper/paper-evaluation-export.errors";
import {
  PaperPnLReconciliationError,
  PaperPnLScopeError,
  PaperPnLWindowError,
} from "@/lib/trader/paper/paper-pnl.errors";
import {
  canonicalJsonString,
  computePaperEvaluationExportDigest,
} from "@/lib/trader/paper/serialize-paper-evaluation-export";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORG_A = "00000000-0000-4000-8000-0000000271";
const STRATEGY_A = "signal-271-a";
const STRATEGY_B = "signal-271-b";
const EXPORTED_AT = new Date("2026-06-18T12:00:00.000Z");

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
    riskDecisionId: "risk-271",
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

describe("buildPaperEvaluationExport (AT-E9 S4 / DEE-271)", () => {
  it("AC1: org period rollup and strategy evaluations match independent S2/S3 calls", async () => {
    const buy = mockOrder({ id: "ac1-buy", strategySignalId: STRATEGY_A, avgFillPrice: "100" });
    const sell = mockOrder({
      id: "ac1-sell",
      side: "sell",
      strategySignalId: STRATEGY_A,
      avgFillPrice: "120",
    });
    const repo = mockRepository([buy, sell], {
      fillsByOrderId: {
        "ac1-buy": [
          mockFill("ac1-buy", { price: "100", quantity: "0.01", executedAt: new Date(100) }),
        ],
        "ac1-sell": [
          mockFill("ac1-sell", { price: "120", quantity: "0.01", executedAt: new Date(150) }),
        ],
      },
    });
    const context = requireOrgContext(ORG_A);
    const window = { start: new Date(120), end: new Date(200) };
    const input = {
      context,
      orderRepository: repo,
      window,
      strategySignalIds: [STRATEGY_A],
      executionMode: "mock" as const,
      exportedAt: EXPORTED_AT,
    };

    const bundle = await buildPaperEvaluationExport(input);
    const independentPeriod = await derivePaperPnLPeriod({
      context,
      orderRepository: repo,
      window,
      executionMode: "mock",
      derivedAt: EXPORTED_AT,
    });
    const independentEvaluations = await derivePaperStrategyEvaluations({
      context,
      orderRepository: repo,
      strategySignalIds: [STRATEGY_A],
      window,
      executionMode: "mock",
      derivedAt: EXPORTED_AT,
    });

    expect(bundle.orgPeriodRollup.periodRealizedPnl).toBe(independentPeriod.periodRealizedPnl);
    expect(bundle.orgPeriodRollup.endSnapshot.realizedPnl).toBe(
      independentPeriod.endSnapshot.realizedPnl,
    );
    expect(bundle.strategyEvaluations).toHaveLength(1);
    expect(bundle.strategyEvaluations[0]?.periodRealizedPnl).toBe(
      independentEvaluations[0]?.periodRealizedPnl,
    );
    expect(bundle.strategyEvaluations[0]?.closedTradeCount).toBe(
      independentEvaluations[0]?.closedTradeCount,
    );
  });

  it("AC2: identical inputs produce identical canonical evidenceBody and digest", async () => {
    const buy = mockOrder({ id: "ac2-buy", avgFillPrice: "100" });
    const sell = mockOrder({ id: "ac2-sell", side: "sell", avgFillPrice: "110" });
    const repo = mockRepository([buy, sell], {
      fillsByOrderId: {
        "ac2-buy": [
          mockFill("ac2-buy", { price: "100", quantity: "0.01", executedAt: new Date(100) }),
        ],
        "ac2-sell": [
          mockFill("ac2-sell", { price: "110", quantity: "0.01", executedAt: new Date(150) }),
        ],
      },
    });
    const input = {
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      window: { start: new Date(120), end: new Date(200) },
      strategySignalIds: [STRATEGY_A],
      executionMode: "mock" as const,
      exportedAt: EXPORTED_AT,
    };

    const docA = await buildPaperEvaluationExportDocument(input);
    const docB = await buildPaperEvaluationExportDocument(input);

    const bodyJsonA = canonicalJsonString(docA.evidenceBody);
    const bodyJsonB = canonicalJsonString(docB.evidenceBody);

    expect(bodyJsonA).toBe(bodyJsonB);
    expect(docA.envelope.contentDigest).toBe(docB.envelope.contentDigest);
  });

  it("AC2a: strategy input order does not affect evidenceBody or digest", async () => {
    const buyA = mockOrder({
      id: "ac2a-buy-a",
      strategySignalId: STRATEGY_A,
      avgFillPrice: "100",
    });
    const sellA = mockOrder({
      id: "ac2a-sell-a",
      side: "sell",
      strategySignalId: STRATEGY_A,
      avgFillPrice: "110",
    });
    const buyB = mockOrder({
      id: "ac2a-buy-b",
      strategySignalId: STRATEGY_B,
      avgFillPrice: "200",
    });
    const repo = mockRepository([buyA, sellA, buyB], {
      fillsByOrderId: {
        "ac2a-buy-a": [
          mockFill("ac2a-buy-a", {
            price: "100",
            quantity: "0.01",
            executedAt: new Date(100),
          }),
        ],
        "ac2a-sell-a": [
          mockFill("ac2a-sell-a", {
            price: "110",
            quantity: "0.01",
            executedAt: new Date(150),
          }),
        ],
        "ac2a-buy-b": [
          mockFill("ac2a-buy-b", {
            price: "200",
            quantity: "0.01",
            executedAt: new Date(160),
          }),
        ],
      },
    });
    const base = {
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      window: { start: new Date(120), end: new Date(200) },
      executionMode: "mock" as const,
      exportedAt: EXPORTED_AT,
    };

    const docA = await buildPaperEvaluationExportDocument({
      ...base,
      strategySignalIds: [STRATEGY_B, STRATEGY_A],
    });
    const docB = await buildPaperEvaluationExportDocument({
      ...base,
      strategySignalIds: [STRATEGY_A, STRATEGY_B],
    });

    expect(docA.evidenceBody.strategyEvaluations.map((e) => e.strategySignalId)).toEqual([
      STRATEGY_A,
      STRATEGY_B,
    ]);
    expect(docB.evidenceBody.strategyEvaluations.map((e) => e.strategySignalId)).toEqual([
      STRATEGY_A,
      STRATEGY_B,
    ]);
    expect(canonicalJsonString(docA.evidenceBody)).toBe(canonicalJsonString(docB.evidenceBody));
    expect(docA.envelope.contentDigest).toBe(docB.envelope.contentDigest);
  });

  it("AC3: envelope contentDigest matches sha256 of evidenceBody", async () => {
    const buy = mockOrder({ id: "ac3-buy", avgFillPrice: "100" });
    const repo = mockRepository([buy], {
      fillsByOrderId: {
        "ac3-buy": [
          mockFill("ac3-buy", { price: "100", quantity: "0.01", executedAt: new Date(150) }),
        ],
      },
    });

    const document = await buildPaperEvaluationExportDocument({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      window: { start: new Date(120), end: new Date(200) },
      strategySignalIds: [STRATEGY_A],
      executionMode: "mock",
      exportedAt: EXPORTED_AT,
    });

    expect(document.envelope.contentDigest).toBe(
      computePaperEvaluationExportDigest(document.evidenceBody),
    );
  });

  it("AC4: propagates reconciliation, scope, and window errors without partial artifact", async () => {
    const badQty = mockOrder({ id: "ac4-bad", filledQuantity: "0.02" });
    const repoBadQty = mockRepository([badQty], {
      fillsByOrderId: {
        "ac4-bad": [mockFill("ac4-bad", { quantity: "0.01" })],
      },
    });
    const context = requireOrgContext(ORG_A);
    const window = { start: new Date(0), end: new Date(200) };
    const baseInput = {
      context,
      window,
      strategySignalIds: [STRATEGY_A],
      executionMode: "mock" as const,
      exportedAt: EXPORTED_AT,
    };

    await expect(
      buildPaperEvaluationExport({ ...baseInput, orderRepository: repoBadQty }),
    ).rejects.toBeInstanceOf(PaperPnLReconciliationError);

    const liveOrder = mockOrder({ id: "ac4-live", executionMode: "live" });
    const repoLive = mockRepository([liveOrder]);
    await expect(
      buildPaperEvaluationExport({
        ...baseInput,
        orderRepository: repoLive,
        executionMode: "live" as "mock",
      }),
    ).rejects.toBeInstanceOf(PaperPnLScopeError);

    await expect(
      buildPaperEvaluationExport({
        ...baseInput,
        orderRepository: mockRepository([]),
        window: { start: new Date(200), end: new Date(100) },
      }),
    ).rejects.toBeInstanceOf(PaperPnLWindowError);

    await expect(
      buildPaperEvaluationExport({
        ...baseInput,
        orderRepository: mockRepository([]),
        strategySignalIds: [],
      }),
    ).rejects.toBeInstanceOf(PaperEvaluationExportError);
  });

  it("AC5: merges valuation gaps from org rollup and strategies", async () => {
    const buy = mockOrder({ id: "ac5-buy", avgFillPrice: "100" });
    const repo = mockRepository([buy], {
      fillsByOrderId: {
        "ac5-buy": [
          mockFill("ac5-buy", {
            price: "100",
            quantity: "0.01",
            fee: "0.001",
            feeAsset: "BTC",
            executedAt: new Date(150),
          }),
        ],
      },
    });

    const bundle = await buildPaperEvaluationExport({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      window: { start: new Date(120), end: new Date(200) },
      strategySignalIds: [STRATEGY_A],
      executionMode: "mock",
      exportedAt: EXPORTED_AT,
    });

    expect(bundle.dataQuality.valuationGapCount).toBe(bundle.dataQuality.valuationGaps.length);
    expect(bundle.dataQuality.valuationGaps.length).toBeGreaterThan(0);
    expect(
      bundle.orgPeriodRollup.periodValuationGaps.every((gap) =>
        bundle.dataQuality.valuationGaps.includes(gap),
      ),
    ).toBe(true);
  });

  it("AC6: zero-fill strategies appear in output and strategiesWithNoFills", async () => {
    const buy = mockOrder({ id: "ac6-buy", strategySignalId: STRATEGY_A, avgFillPrice: "100" });
    const repo = mockRepository([buy], {
      fillsByOrderId: {
        "ac6-buy": [
          mockFill("ac6-buy", { price: "100", quantity: "0.01", executedAt: new Date(150) }),
        ],
      },
    });

    const bundle = await buildPaperEvaluationExport({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      window: { start: new Date(120), end: new Date(200) },
      strategySignalIds: [STRATEGY_A, STRATEGY_B],
      executionMode: "mock",
      exportedAt: EXPORTED_AT,
    });

    expect(bundle.strategyEvaluations.map((e) => e.strategySignalId)).toEqual([
      STRATEGY_A,
      STRATEGY_B,
    ]);
    expect(bundle.dataQuality.strategiesWithNoFills).toEqual([STRATEGY_B]);
    const emptyEval = bundle.strategyEvaluations.find((e) => e.strategySignalId === STRATEGY_B);
    expect(emptyEval?.closedTradeCount).toBe(0);
    expect(emptyEval?.periodRealizedPnl).toBe("0");
  });

  it("AC7: sets unrealizedAvailable false when markPrices omitted", async () => {
    const buy = mockOrder({ id: "ac7-buy", avgFillPrice: "100" });
    const repo = mockRepository([buy], {
      fillsByOrderId: {
        "ac7-buy": [
          mockFill("ac7-buy", { price: "100", quantity: "0.01", executedAt: new Date(150) }),
        ],
      },
    });

    const bundle = await buildPaperEvaluationExport({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      window: { start: new Date(120), end: new Date(200) },
      strategySignalIds: [STRATEGY_A],
      executionMode: "mock",
      exportedAt: EXPORTED_AT,
    });

    expect(bundle.dataQuality.unrealizedAvailable).toBe(false);
    expect(bundle.dataQuality.reconciliationStatus).toBe("clean");
    expect(bundle.provenance.readModelSlices).toEqual([
      "paper-pnl.v1",
      "paper-pnl-period.v1",
      "paper-strategy-eval.v1",
    ]);
  });
});
