import { describe, expect, it, vi } from "vitest";

import {
  buildBacktestEvaluationExport,
  buildBacktestEvaluationExportDocument,
} from "@/lib/trader/backtest/build-backtest-evaluation-export";
import { BacktestEvaluationExportError } from "@/lib/trader/backtest/backtest-evaluation-export.errors";
import {
  canonicalJsonString,
  computeBacktestEvaluationExportDigest,
} from "@/lib/trader/backtest/serialize-backtest-evaluation-export";
import { createCostModelV1 } from "@/lib/trader/execution/cost-model";
import type {
  FillRow,
  OrderRepository,
  OrderRow,
} from "@/lib/trader/execution/order-repository.types";
import { derivePaperPnLPeriod } from "@/lib/trader/paper/derive-paper-pnl-period";
import { derivePaperStrategyEvaluations } from "@/lib/trader/paper/derive-paper-strategy-eval";
import {
  PaperPnLReconciliationError,
  PaperPnLScopeError,
  PaperPnLWindowError,
} from "@/lib/trader/paper/paper-pnl.errors";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORG_A = "00000000-0000-4000-8000-0000000281";
const STRATEGY_A = "mean_reversion_v0";
const STRATEGY_B = "liquidity_sweep_reversal_v0";
const DATASET_ID = "00000000-0000-4000-8000-0000000281d";
const RUN_ID = "00000000-0000-4000-8000-0000000281r";
const EXPORTED_AT = new Date("2026-06-18T12:00:00.000Z");
const COST_MODEL = createCostModelV1("10", "25");

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
    riskDecisionId: "risk-281",
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
    fee: overrides.fee ?? "0.64",
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

function baseExportInput(
  overrides: Partial<Parameters<typeof buildBacktestEvaluationExport>[0]> = {},
) {
  return {
    context: requireOrgContext(ORG_A),
    orderRepository: mockRepository([]),
    window: { start: new Date(120), end: new Date(200) },
    strategySignalIds: [STRATEGY_A],
    strategyId: STRATEGY_A,
    strategyVersion: "0.1.0",
    costModel: COST_MODEL,
    regimeLabel: "RANGE",
    datasetId: DATASET_ID,
    runId: RUN_ID,
    split: "train" as const,
    cycleCount: 42,
    executionMode: "mock" as const,
    exportedAt: EXPORTED_AT,
    ...overrides,
  };
}

describe("buildBacktestEvaluationExport (RI-P2 / Batch C)", () => {
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
    const input = baseExportInput({
      context,
      orderRepository: repo,
      window,
      strategySignalIds: [STRATEGY_A],
    });

    const bundle = await buildBacktestEvaluationExport(input);
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
    expect(bundle.strategyEvaluations[0]?.periodRealizedPnl).toBe(
      independentEvaluations[0]?.periodRealizedPnl,
    );
    expect(bundle.provenance.source).toBe("backtest_run");
    expect(bundle.provenance.costModelVersion).toBe(COST_MODEL.version);
    expect(bundle.provenance.cycleCount).toBe(42);
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
    const input = baseExportInput({ orderRepository: repo });

    const docA = await buildBacktestEvaluationExportDocument(input);
    const docB = await buildBacktestEvaluationExportDocument(input);

    expect(canonicalJsonString(docA.evidenceBody)).toBe(canonicalJsonString(docB.evidenceBody));
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
    const base = baseExportInput({ orderRepository: repo });

    const docA = await buildBacktestEvaluationExportDocument({
      ...base,
      strategySignalIds: [STRATEGY_B, STRATEGY_A],
    });
    const docB = await buildBacktestEvaluationExportDocument({
      ...base,
      strategySignalIds: [STRATEGY_A, STRATEGY_B],
    });

    expect(docA.evidenceBody.strategyEvaluations.map((e) => e.strategySignalId)).toEqual([
      STRATEGY_B,
      STRATEGY_A,
    ]);
    expect(docB.evidenceBody.strategyEvaluations.map((e) => e.strategySignalId)).toEqual([
      STRATEGY_B,
      STRATEGY_A,
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

    const document = await buildBacktestEvaluationExportDocument(
      baseExportInput({ orderRepository: repo }),
    );

    expect(document.envelope.contentDigest).toBe(
      computeBacktestEvaluationExportDigest(document.evidenceBody),
    );
    expect(document.evidenceBody.costModel.version).toBe(COST_MODEL.version);
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
    const baseInput = baseExportInput({ context, window });

    await expect(
      buildBacktestEvaluationExport({ ...baseInput, orderRepository: repoBadQty }),
    ).rejects.toBeInstanceOf(PaperPnLReconciliationError);

    const liveOrder = mockOrder({ id: "ac4-live", executionMode: "live" });
    const repoLive = mockRepository([liveOrder]);
    await expect(
      buildBacktestEvaluationExport({
        ...baseInput,
        orderRepository: repoLive,
        executionMode: "live" as "mock",
      }),
    ).rejects.toBeInstanceOf(PaperPnLScopeError);

    await expect(
      buildBacktestEvaluationExport({
        ...baseInput,
        orderRepository: mockRepository([]),
        window: { start: new Date(200), end: new Date(100) },
      }),
    ).rejects.toBeInstanceOf(PaperPnLWindowError);

    await expect(
      buildBacktestEvaluationExport({
        ...baseInput,
        orderRepository: mockRepository([]),
        strategySignalIds: [],
      }),
    ).rejects.toBeInstanceOf(BacktestEvaluationExportError);
  });

  it("AC5: includes backtest provenance fields in evidenceBody", async () => {
    const buy = mockOrder({ id: "ac5-buy", avgFillPrice: "100" });
    const repo = mockRepository([buy], {
      fillsByOrderId: {
        "ac5-buy": [
          mockFill("ac5-buy", { price: "100", quantity: "0.01", executedAt: new Date(150) }),
        ],
      },
    });

    const bundle = await buildBacktestEvaluationExport(baseExportInput({ orderRepository: repo }));

    expect(bundle.dataQuality.reconciliationStatus).toBe("clean");
    expect(bundle.provenance.readModelSlices).toContain("backtest-cost-model.v1");
    expect(bundle.provenance.datasetId).toBe(DATASET_ID);
    expect(bundle.provenance.runId).toBe(RUN_ID);
    expect(bundle.provenance.regimeLabel).toBe("RANGE");
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

    const bundle = await buildBacktestEvaluationExport(
      baseExportInput({
        orderRepository: repo,
        strategySignalIds: [STRATEGY_A, STRATEGY_B],
      }),
    );

    expect(bundle.dataQuality.strategiesWithNoFills).toEqual([STRATEGY_B]);
    const emptyEval = bundle.strategyEvaluations.find((e) => e.strategySignalId === STRATEGY_B);
    expect(emptyEval?.closedTradeCount).toBe(0);
  });
});
