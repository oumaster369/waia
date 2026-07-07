import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { createCostModelV1 } from "@/lib/trader/execution/cost-model";
import type {
  FillRow,
  OrderRepository,
  OrderRow,
} from "@/lib/trader/execution/order-repository.types";
import { deriveAccountRiskStateFromMockOrders } from "@/lib/trader/paper/account-risk-state-from-orders";
import { derivePaperStrategyEvaluation } from "@/lib/trader/paper/derive-paper-strategy-eval";
import { PaperPnLReconciliationError } from "@/lib/trader/paper/paper-pnl.errors";
import * as repoPostgres from "@/lib/trader/execution/repository-postgres";
import * as backtestRunner from "@/lib/trader/research/research-backtest-runner";
import { runIsolatedResearchBacktest } from "@/lib/trader/research/research-backtest-isolation";
import type {
  ResearchValidationMetrics,
  ResearchValidationMetricsV1,
} from "@/lib/trader/research/strategy-candidate.types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORG_A = "00000000-0000-4000-8000-0000000280";
const STRATEGY_A = "mean_reversion_v0";
const BLIND_WINDOW = { start: new Date(1_000), end: new Date(5_000) };
const TEST_COST_MODEL = createCostModelV1("10", "5");

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
    riskDecisionId: "risk-280",
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
    id: overrides.id ?? `fill-${orderId}`,
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
  options: { fillsByOrderId?: Record<string, FillRow[]> } = {},
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
      return orders.filter(
        (order) =>
          order.organizationId === context.organizationId &&
          (filter?.executionMode === undefined || order.executionMode === filter.executionMode),
      );
    }),
    listFills: vi.fn(async (_context, orderId) => fillsByOrderId[orderId] ?? []),
    transitionOrder: vi.fn(),
    recordFill: vi.fn(),
    listEvents: vi.fn(async () => []),
  };
}

describe("research backtest isolation (DEE-368)", () => {
  it("P6: cumulative orphan sell in shared ledger throws PaperPnLReconciliationError", async () => {
    const validationBuy = mockOrder({ id: "val-buy", side: "buy" });
    const validationSell = mockOrder({
      id: "val-sell",
      side: "sell",
      avgFillPrice: "64500",
    });
    const blindSell = mockOrder({
      id: "blind-sell",
      side: "sell",
      avgFillPrice: "65000",
    });
    const repo = mockRepository([validationBuy, validationSell, blindSell], {
      fillsByOrderId: {
        "val-buy": [
          mockFill("val-buy", { executedAt: new Date(100), quantity: "0.01", price: "64000" }),
        ],
        "val-sell": [
          mockFill("val-sell", { executedAt: new Date(500), quantity: "0.01", price: "64500" }),
        ],
        "blind-sell": [
          mockFill("blind-sell", {
            executedAt: new Date(2_000),
            quantity: "0.01",
            price: "65000",
          }),
        ],
      },
    });

    await expect(
      derivePaperStrategyEvaluation({
        context: requireOrgContext(ORG_A),
        orderRepository: repo,
        strategySignalId: STRATEGY_A,
        window: BLIND_WINDOW,
      }),
    ).rejects.toBeInstanceOf(PaperPnLReconciliationError);
  });

  it("P3: blind window succeeds when only blind-phase fills remain in the ledger", async () => {
    const blindBuy = mockOrder({ id: "blind-buy", side: "buy" });
    const blindSell = mockOrder({
      id: "blind-sell",
      side: "sell",
      avgFillPrice: "65000",
    });
    const repo = mockRepository([blindBuy, blindSell], {
      fillsByOrderId: {
        "blind-buy": [
          mockFill("blind-buy", { executedAt: new Date(1_500), quantity: "0.01", price: "64000" }),
        ],
        "blind-sell": [
          mockFill("blind-sell", {
            executedAt: new Date(2_000),
            quantity: "0.01",
            price: "65000",
          }),
        ],
      },
    });

    const evaluation = await derivePaperStrategyEvaluation({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      strategySignalId: STRATEGY_A,
      window: BLIND_WINDOW,
    });

    expect(evaluation.closedTradeCount).toBe(1);
  });

  it("P5: account risk state is empty when only current-window orders exist after cleanup", async () => {
    const repo = mockRepository([]);

    const accountState = await deriveAccountRiskStateFromMockOrders({
      context: requireOrgContext(ORG_A),
      orderRepository: repo,
      executionMode: "mock",
    });

    expect(accountState.positions).toEqual([]);
    expect(accountState.openOrderCount).toBe(0);
  });

  it("runIsolatedResearchBacktest clears mock artifacts before each backtest", async () => {
    const deleteSpy = vi
      .spyOn(repoPostgres, "deleteMockExecutionArtifactsForOrgPostgres")
      .mockResolvedValue(undefined);
    const backtestSpy = vi
      .spyOn(backtestRunner, "runResearchValidationBacktest")
      // @ts-expect-error isolation tests stub legacy v1 metrics only
      .mockImplementation(async () => ({
        schemaVersion: "1.0.0",
        tradeCount: 0,
        periodRealizedPnl: "0",
        periodTotalFees: "0",
        byRegime: [],
      }));

    const ex = { delete: vi.fn() };
    const input = {
      context: requireOrgContext(ORG_A),
      bars: [],
      strategyId: STRATEGY_A,
      strategyVersion: "0.1.0",
      datasetId: "dataset",
      runId: "run",
      split: "blind" as const,
      costModel: TEST_COST_MODEL,
      deps: { execution: {} as never, reconciliation: {} as never },
      orderRepository: mockRepository([]),
      accountKey: "research",
      defaultQuantity: "0.01",
    };

    await runIsolatedResearchBacktest(ex, input);

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(backtestSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      backtestSpy.mock.invocationCallOrder[0]!,
    );

    deleteSpy.mockRestore();
    backtestSpy.mockRestore();
  });

  it("P6: research modules do not import external provider clients directly", () => {
    const researchDir = path.join(process.cwd(), "lib/trader/research");
    const forbidden = [
      "connectors/binance",
      "connectors/bybit",
      "connectors/alternative-me",
      "connectors/coingecko",
      "connectors/htx/client",
      "market-data-gateway",
    ];

    const files = readdirSync(researchDir).filter((name) => name.endsWith(".ts"));
    for (const file of files) {
      const content = readFileSync(path.join(researchDir, file), "utf8");
      for (const pattern of forbidden) {
        expect(content, `${file} must not import ${pattern}`).not.toContain(pattern);
      }
    }
  });
});
