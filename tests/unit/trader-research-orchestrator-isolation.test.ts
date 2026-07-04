import { describe, expect, it, vi } from "vitest";

import { createCostModelV1 } from "@/lib/trader/execution/cost-model";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import * as repoPostgres from "@/lib/trader/execution/repository-postgres";
import * as backtestRunner from "@/lib/trader/research/research-backtest-runner";
import { runIsolatedResearchBacktest } from "@/lib/trader/research/research-backtest-isolation";
import type { RunResearchValidationBacktestInput } from "@/lib/trader/research/research-backtest-runner";
import type {
  ResearchValidationMetrics,
  ResearchValidationMetricsV1,
} from "@/lib/trader/research/strategy-candidate.types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORG_A = "00000000-0000-4000-8000-0000000290";
const STRATEGY_A = "mean_reversion_v0";
const TEST_COST_MODEL = createCostModelV1("10", "5");

const EMPTY_METRICS: ResearchValidationMetricsV1 = {
  schemaVersion: "1.0.0",
  tradeCount: 0,
  periodRealizedPnl: "0",
  periodTotalFees: "0",
  byRegime: [],
};

function stubOrderRepository(): OrderRepository {
  return {
    createOrder: vi.fn(),
    getOrderById: vi.fn(),
    findOrderByClientOrderId: vi.fn(),
    findOrderByIdempotencyKey: vi.fn(),
    listOpenOrders: vi.fn(async () => []),
    listOrders: vi.fn(async () => []),
    listFills: vi.fn(async () => []),
    transitionOrder: vi.fn(),
    recordFill: vi.fn(),
    listEvents: vi.fn(async () => []),
  };
}

function buildBacktestInput(
  overrides: Partial<RunResearchValidationBacktestInput> = {},
): RunResearchValidationBacktestInput {
  return {
    context: requireOrgContext(ORG_A),
    bars: [],
    strategyId: STRATEGY_A,
    strategyVersion: "0.1.0",
    datasetId: "00000000-0000-4000-8000-0000000291",
    runId: "00000000-0000-4000-8000-0000000292",
    split: "validation",
    costModel: TEST_COST_MODEL,
    deps: { execution: {} as never, reconciliation: {} as never },
    orderRepository: stubOrderRepository(),
    accountKey: "research",
    defaultQuantity: "0.01",
    ...overrides,
  };
}

describe("research orchestrator backtest isolation (DEE-368)", () => {
  it("invokes mock cleanup before validation, each walk-forward window, and blind", async () => {
    const deleteSpy = vi
      .spyOn(repoPostgres, "deleteMockExecutionArtifactsForOrgPostgres")
      .mockResolvedValue(undefined);
    const backtestSpy = vi
      .spyOn(backtestRunner, "runResearchValidationBacktest")
      // @ts-expect-error isolation tests stub legacy v1 metrics only
      .mockImplementation(async () => EMPTY_METRICS);

    const ex = { delete: vi.fn() };

    await runIsolatedResearchBacktest(ex, buildBacktestInput({ cycleIdPrefix: "ri-val-run" }));

    const walkForwardWindowCount = 3;
    for (let windowIndex = 0; windowIndex < walkForwardWindowCount; windowIndex += 1) {
      await runIsolatedResearchBacktest(
        ex,
        buildBacktestInput({ cycleIdPrefix: `ri-wf-run-${windowIndex}` }),
      );
    }

    await runIsolatedResearchBacktest(
      ex,
      buildBacktestInput({ split: "blind", cycleIdPrefix: "ri-blind-run" }),
    );

    expect(deleteSpy).toHaveBeenCalledTimes(1 + walkForwardWindowCount + 1);
    expect(backtestSpy).toHaveBeenCalledTimes(1 + walkForwardWindowCount + 1);

    for (const call of deleteSpy.mock.calls) {
      expect(call[0]).toBe(ex);
      expect(call[1]).toEqual({ organizationId: ORG_A });
    }

    deleteSpy.mockRestore();
    backtestSpy.mockRestore();
  });
});
