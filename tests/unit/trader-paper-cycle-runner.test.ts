import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  OrderExecutionService,
  SubmitOrderResult,
} from "@/lib/trader/execution/execution-service.types";
import type { ReconciliationReport } from "@/lib/trader/execution/reconciliation.types";
import type {
  FillRow,
  OrderRepository,
  OrderRow,
} from "@/lib/trader/execution/order-repository.types";
import { createCostModelV1 } from "@/lib/trader/execution/cost-model";
import * as evaluationCycleModule from "@/lib/trader/intelligence/evaluation-cycle";
import type { Bar, EvaluationCycleResult, Quote } from "@/lib/trader/intelligence/types";
import { FixtureBarReplaySource } from "@/lib/trader/market-data/fixture-bar-replay-source";
import type { BarPollSource } from "@/lib/trader/market-data/types";
import { defaultStopDistanceProvider } from "@/lib/trader/portfolio/default-stop-distance-provider";
import { DEFAULT_PORTFOLIO_RUN_CONFIG } from "@/lib/trader/portfolio/portfolio-run-config.types";
import {
  cycleOrderKeys,
  runFixturePaperCycles,
  runPaperCycleOnce,
  runPollPaperCycles,
} from "@/lib/trader/paper/paper-cycle-runner";
import type { PaperCycleDeps, PortfolioCycleContext } from "@/lib/trader/paper/paper-cycle.types";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import { createInMemoryOrderRateStore } from "@/lib/trader/risk/order-rate-store";
import { capitalReasonCodes } from "@/lib/trader/risk/reason-codes";
import { createRiskEngineService } from "@/lib/trader/risk/risk-engine-service";
import type { SubmitOrderInput } from "@/lib/trader/execution/execution-service.types";
import type { KillSwitchResolverPort } from "@/lib/trader/risk/evaluate.types";
import type { EffectiveKillSwitchState } from "@/lib/trader/risk/kill-switch/types";
import type { OrgRiskLimitsMetadata, RiskLimitsService } from "@/lib/trader/risk/limits/types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORG = "00000000-0000-4000-8000-0000000260";

const EMPTY_STATE: AccountRiskState = {
  positions: [],
  openOrderCount: 0,
  dailyPnl: "0",
  drawdown: "0",
  quoteExposureByCurrency: {},
};

function mockEvaluation(overrides: Partial<EvaluationCycleResult> = {}): EvaluationCycleResult {
  const signal = {
    strategySignalId: "signal-260",
    strategyId: "mean_reversion_v0" as const,
    strategyVersion: "0.1.0",
    organizationId: ORG,
    symbol: "BTC/USDT" as const,
    outcome: "SIGNAL" as const,
    side: "buy" as const,
    confidence: "0.8",
    expectedEdge: "0.01",
    horizon: "1h" as const,
    maxRisk: "100",
    reasonCodes: ["STRAT_MR_ZSCORE_BUY"],
    msvId: "msv-260",
    featureSetId: "feature-set-260",
    evaluatedAt: "2026-01-01T00:25:00.000Z",
  };
  const result: EvaluationCycleResult = {
    features: {
      featureSetId: "feature-set-260",
      instrumentId: "BTC/USDT",
      evaluatedAt: "2026-01-01T00:25:00.000Z",
      features: {
        close: "64000",
        sma20: "65000",
        zscoreVsSma20: "-2.5",
        realizedVol20: "300",
        spreadBps: "1.5",
      },
      dataQualityScore: 0.9,
      inputs: { barCount: 25 },
    },
    msv: {
      msvId: "msv-260",
      instrumentId: "BTC/USDT",
      evaluatedAt: "2026-01-01T00:25:00.000Z",
      featureSetId: "feature-set-260",
      physics: { close: "64000", zscoreVsSma20: "-2.5", realizedVol20: "300" },
      liquidity: { spreadBps: "1.5" },
      crowd: { fearGreedIndex: null, newsSentiment: "0" },
      futureContext: { eventRiskScore: "0" },
      derived: {
        regime: "TREND_BEAR",
        tradingPermission: "ALLOW_TRADING",
        allowedStrategyIds: ["mean_reversion_v0", "liquidity_sweep_reversal_v0"],
        riskMultiplier: "1.0",
        dataQualityScore: 0.9,
        reasonCodes: ["CDE_QUALITY_ALLOW_TRADING", "CDE_REGIME_TREND_BEAR"],
      },
    },
    signal,
    signals: [signal],
    ...overrides,
  };
  if (overrides.signal && !overrides.signals) {
    result.signals = [overrides.signal];
  }
  return result;
}

function flatBars(count: number, close = "65000.00"): Bar[] {
  const bars: Bar[] = [];
  for (let index = 0; index < count; index += 1) {
    const openTime = new Date(
      Date.parse("2026-01-01T00:00:00.000Z") + index * 60_000,
    ).toISOString();
    const closeTime = new Date(Date.parse(openTime) + 60_000).toISOString();
    bars.push({
      symbol: "BTC/USDT",
      interval: "1m",
      open: close,
      high: close,
      low: close,
      close,
      volume: "10.00",
      barOpenTime: openTime,
      barCloseTime: closeTime,
    });
  }
  return bars;
}

function mockDeps(): PaperCycleDeps {
  const submittedOrder = {
    id: "order-260",
    organizationId: ORG,
    clientOrderId: "client-paper-cycle-dee-260-0",
    state: "FILLED" as const,
    strategySignalId: "signal-260",
  };

  const executionResult: SubmitOrderResult = {
    status: "submitted",
    order: submittedOrder as SubmitOrderResult extends { status: "submitted" }
      ? SubmitOrderResult["order"]
      : never,
  };

  const reconciliationReport: ReconciliationReport = {
    organizationId: ORG,
    runStartedAt: new Date(0),
    outcomes: [
      {
        clientOrderId: "client-paper-cycle-dee-260-0",
        classification: "IN_SYNC",
        recordedFills: [],
        markedReconciliationRequired: false,
      },
    ],
    counts: {
      IN_SYNC: 1,
      VENUE_ACKED: 0,
      FILL_PROGRESS: 0,
      VENUE_TERMINALIZED: 0,
      NOT_FOUND_AT_VENUE: 0,
      UNKNOWN_POSITION: 0,
      AMBIGUOUS_STALE: 0,
      TERMINAL_DRIFT: 0,
      SKIPPED_CONFLICT: 0,
    },
  };

  return {
    execution: {
      submitOrder: vi.fn(async () => executionResult),
    } satisfies OrderExecutionService,
    reconciliation: {
      reconcile: vi.fn(async () => reconciliationReport),
    },
  };
}

describe("paper cycle runner (DEE-260)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("cycleOrderKeys uses cycleId suffix convention", () => {
    expect(cycleOrderKeys("dee-260-2")).toEqual({
      clientOrderId: "client-paper-cycle-dee-260-2",
      idempotencyKey: "idem-paper-cycle-dee-260-2",
    });
    expect(cycleOrderKeys("dee-260-2", "mean_reversion_v0")).toEqual({
      clientOrderId: "client-paper-cycle-dee-260-2-mean_reversion_v0",
      idempotencyKey: "idem-paper-cycle-dee-260-2-mean_reversion_v0",
    });
  });

  it("passes telemetrySink to runEvaluationCycle", async () => {
    const lines: string[] = [];
    const sink = (line: string) => lines.push(line);
    const deps = mockDeps();
    const replay = new FixtureBarReplaySource({ mode: "full", cycleIdPrefix: "dee-260" });
    const next = replay.next();
    expect(next.done).toBe(false);
    if (next.done) {
      return;
    }

    const spy = vi
      .spyOn(evaluationCycleModule, "runEvaluationCycle")
      .mockReturnValue(mockEvaluation());

    await runPaperCycleOnce(deps, {
      context: requireOrgContext(ORG),
      snapshot: next.snapshot,
      accountKey: "acct-260",
      defaultQuantity: "0.01",
      accountState: EMPTY_STATE,
      telemetrySink: sink,
    });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ telemetrySink: sink }));
  });

  it("uses cycleId-derived idempotency keys on submit", async () => {
    const deps = mockDeps();
    vi.spyOn(evaluationCycleModule, "runEvaluationCycle").mockReturnValue(mockEvaluation());

    const snapshot = {
      bars: flatBars(25),
      quote: {
        symbol: "BTC/USDT",
        bid: "65000.00",
        ask: "65000.00",
        last: "65000.00",
        timestamp: flatBars(25).at(-1)!.barCloseTime,
      } satisfies Quote,
      evaluatedAt: flatBars(25).at(-1)!.barCloseTime,
      cycleIndex: 2,
      cycleId: "dee-260-2",
    };

    await runPaperCycleOnce(deps, {
      context: requireOrgContext(ORG),
      snapshot,
      accountKey: "acct-260",
      defaultQuantity: "0.01",
      accountState: EMPTY_STATE,
    });

    expect(deps.execution.submitOrder).toHaveBeenCalledWith(
      requireOrgContext(ORG),
      expect.objectContaining({
        clientOrderId: "client-paper-cycle-dee-260-2-mean_reversion_v0",
        idempotencyKey: "idem-paper-cycle-dee-260-2-mean_reversion_v0",
      }),
    );
  });

  it("dispatches every actionable registered strategy signal", async () => {
    const deps = mockDeps();
    const mrSignal = mockEvaluation().signal;
    const lsSignal = {
      ...mockEvaluation().signal,
      strategySignalId: "signal-ls-260",
      strategyId: "liquidity_sweep_reversal_v0" as const,
      side: "buy" as const,
      reasonCodes: ["STRAT_LS_REVERSAL_BUY"],
    };
    vi.spyOn(evaluationCycleModule, "runEvaluationCycle").mockReturnValue(
      mockEvaluation({
        signals: [mrSignal, lsSignal],
        signal: mrSignal,
      }),
    );

    const snapshot = {
      bars: flatBars(25),
      quote: {
        symbol: "BTC/USDT",
        bid: "65000.00",
        ask: "65000.00",
        last: "65000.00",
        timestamp: flatBars(25).at(-1)!.barCloseTime,
      } satisfies Quote,
      evaluatedAt: flatBars(25).at(-1)!.barCloseTime,
      cycleIndex: 0,
      cycleId: "dee-260-dual",
    };

    const result = await runPaperCycleOnce(deps, {
      context: requireOrgContext(ORG),
      snapshot,
      accountKey: "acct-260",
      defaultQuantity: "0.01",
      accountState: EMPTY_STATE,
    });

    expect(result.strategyExecutions).toHaveLength(2);
    expect(deps.execution.submitOrder).toHaveBeenCalledTimes(2);
    expect(result.submitBlocked).toBe(false);
  });

  it("returns NO_SIGNAL without submitting", async () => {
    const deps = mockDeps();
    vi.spyOn(evaluationCycleModule, "runEvaluationCycle").mockReturnValue(
      mockEvaluation({
        signal: {
          ...mockEvaluation().signal,
          outcome: "NO_SIGNAL",
          side: undefined,
        },
      }),
    );

    const replay = new FixtureBarReplaySource({ mode: "full" });
    const next = replay.next();
    expect(next.done).toBe(false);
    if (next.done) {
      return;
    }

    const result = await runPaperCycleOnce(deps, {
      context: requireOrgContext(ORG),
      snapshot: next.snapshot,
      accountKey: "acct-260",
      defaultQuantity: "0.01",
      accountState: EMPTY_STATE,
    });

    expect(result.skipReason).toBe("no_signal");
    expect(result.execution).toBeNull();
    expect(deps.execution.submitOrder).not.toHaveBeenCalled();
  });

  it("runFixturePaperCycles runs N cycles with shared replay source", async () => {
    const deps = mockDeps();
    vi.spyOn(evaluationCycleModule, "runEvaluationCycle").mockReturnValue(mockEvaluation());
    const replay = new FixtureBarReplaySource({ mode: "full", cycleIdPrefix: "batch" });

    const { results } = await runFixturePaperCycles({
      deps,
      context: requireOrgContext(ORG),
      n: 3,
      replay,
      accountKey: "acct-260",
      defaultQuantity: "0.01",
      accountState: EMPTY_STATE,
    });

    expect(results).toHaveLength(3);
    expect(deps.execution.submitOrder).toHaveBeenCalledTimes(3);
    expect(deps.reconciliation.reconcile).toHaveBeenCalledTimes(3);
  });

  it("runPollPaperCycles runs N cycles with shared poll source", async () => {
    const deps = mockDeps();
    vi.spyOn(evaluationCycleModule, "runEvaluationCycle").mockReturnValue(mockEvaluation());
    const replay = new FixtureBarReplaySource({ mode: "full", cycleIdPrefix: "poll-batch" });
    const poll: BarPollSource = {
      reset: () => replay.reset(),
      fetchSnapshot: async () => {
        const next = replay.next();
        if (next.done) {
          throw new Error("[test] poll source exhausted");
        }
        return next.snapshot;
      },
    };

    const { results } = await runPollPaperCycles({
      deps,
      context: requireOrgContext(ORG),
      n: 3,
      poll,
      accountKey: "acct-260",
      defaultQuantity: "0.01",
      accountState: EMPTY_STATE,
    });

    expect(results).toHaveLength(3);
    expect(deps.execution.submitOrder).toHaveBeenCalledTimes(3);
    expect(deps.reconciliation.reconcile).toHaveBeenCalledTimes(3);
  });
});

function mockFill(orderId: string, overrides: Partial<FillRow> = {}): FillRow {
  return {
    id: overrides.id ?? `fill-${orderId}`,
    organizationId: ORG,
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

function mockPortfolioOrderRepository(
  orders: OrderRow[],
  fillsByOrderId: Record<string, FillRow[]> = {},
): OrderRepository {
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
    listOrders: vi.fn(async (_context, filter) =>
      orders.filter(
        (order) =>
          order.organizationId === ORG &&
          (!filter?.executionMode || order.executionMode === filter.executionMode),
      ),
    ),
    transitionOrder: vi.fn(),
    recordFill: vi.fn(),
    listEvents: vi.fn(),
    listFills: vi.fn(async (_context, orderId) => fillsByOrderId[orderId] ?? []),
  };
}

function portfolioContext(
  overrides: Partial<PortfolioCycleContext> & {
    runConfig?: PortfolioCycleContext["runConfig"];
    limits?: PortfolioCycleContext["limits"];
  } = {},
): PortfolioCycleContext {
  return {
    runConfig: {
      ...DEFAULT_PORTFOLIO_RUN_CONFIG,
      startingBalanceUsdt: "100000.00",
      defaultStopDistancePct: "0.02",
      ...overrides.runConfig,
    },
    limits: {
      maxRiskPerTradePct: "0.01",
      maxPortfolioRiskPct: "0.50",
      maxConcurrentPositions: 3,
      maxNotional: "100000.00",
      ...overrides.limits,
    },
    stopDistanceProvider: defaultStopDistanceProvider,
    costModel: createCostModelV1("10", "5"),
    ...overrides,
  };
}

function riskLimitsMetadata(overrides: Partial<OrgRiskLimitsMetadata> = {}): OrgRiskLimitsMetadata {
  return {
    id: "limits-m2",
    scopeType: "organization",
    scopeRef: null,
    configVersion: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    allowedSymbols: ["BTC/USDT", "ETH/USDT"],
    maxNotional: "100000.00",
    maxOrdersPerWindow: 10,
    windowMs: 60_000,
    collarBps: 500,
    maxPositionPerSymbol: "10",
    maxDailyLoss: "500",
    maxDrawdown: "1000",
    maxOpenOrders: 10,
    maxQuoteExposure: "1000000",
    maxRiskPerTradePct: "0.10",
    maxPortfolioRiskPct: "0.50",
    maxConcurrentPositions: 10,
    ...overrides,
  };
}

function portfolioSnapshot(cycleId = "dee-377-m2") {
  return {
    bars: flatBars(25),
    quote: {
      symbol: "BTC/USDT",
      bid: "64000.00",
      ask: "64000.00",
      last: "64000.00",
      timestamp: flatBars(25).at(-1)!.barCloseTime,
    } satisfies Quote,
    evaluatedAt: flatBars(25).at(-1)!.barCloseTime,
    cycleIndex: 0,
    cycleId,
  };
}

describe("paper cycle runner — M2 portfolio sizing (DEE-377)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("skips submit when low deposit produces dust-sized quantity", async () => {
    const deps = mockDeps();
    vi.spyOn(evaluationCycleModule, "runEvaluationCycle").mockReturnValue(mockEvaluation());
    const orderRepository = mockPortfolioOrderRepository([]);

    const result = await runPaperCycleOnce(deps, {
      context: requireOrgContext(ORG),
      snapshot: portfolioSnapshot(),
      accountKey: "acct-m2",
      defaultQuantity: "0.01",
      accountState: EMPTY_STATE,
      orderRepository,
      portfolio: portfolioContext({
        runConfig: {
          ...DEFAULT_PORTFOLIO_RUN_CONFIG,
          startingBalanceUsdt: "1.00",
          defaultStopDistancePct: "0.02",
        },
      }),
    });

    expect(deps.execution.submitOrder).not.toHaveBeenCalled();
    expect(result.strategyExecutions).toHaveLength(1);
    expect(result.strategyExecutions[0]?.submitBlocked).toBe(true);
    expect(result.strategyExecutions[0]?.skipReason).toBe("no_submit");
  });

  it("risk-rejects new symbol submit when portfolio concurrent cap is reached", async () => {
    const existingBuy = {
      id: "existing-btc",
      organizationId: ORG,
      credentialId: null,
      venue: "mock" as const,
      executionMode: "mock" as const,
      symbol: "BTC/USDT",
      side: "buy" as const,
      type: "market" as const,
      price: null,
      quantity: "0.01",
      filledQuantity: "0.01",
      avgFillPrice: "64000",
      state: "FILLED" as const,
      stateVersion: 1,
      exchangeOrderId: null,
      clientOrderId: "client-existing-btc",
      idempotencyKey: "idem-existing-btc",
      riskDecisionId: "risk-existing",
      strategySignalId: null,
      allocationDecisionId: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const orderRepository = mockPortfolioOrderRepository([existingBuy]);

    const limitsService: RiskLimitsService = {
      getLimitsForOrg: async () =>
        riskLimitsMetadata({
          maxConcurrentPositions: 1,
          maxQuoteExposure: "1000000",
          maxPositionPerSymbol: "10",
        }),
      getOrCreateLimitsForOrg: async () => {
        throw new Error("not used");
      },
      upsertLimitsForOrg: async () => {
        throw new Error("not used");
      },
    };
    const killSwitchResolver: KillSwitchResolverPort = {
      getEffectiveState: async () =>
        ({
          organizationId: ORG,
          blocked: false,
          enforcementMode: null,
          bindingState: null,
          resolutionStatus: "ok",
          contributors: [],
          resolvedAt: new Date(0).toISOString(),
        }) satisfies EffectiveKillSwitchState,
    };
    const riskEngine = createRiskEngineService({
      limitsService,
      killSwitchResolver,
      rateStore: createInMemoryOrderRateStore(),
      writeAudit: vi.fn(),
      nowMs: () => 1_700_000_000_000,
      newDecisionId: () => "rd-m2-concurrent",
    });

    const deps = mockDeps();
    deps.execution.submitOrder = vi.fn(async (context, input: SubmitOrderInput) => {
      const decision = await riskEngine.evaluateOrderRequest({
        context,
        order: {
          clientOrderId: input.clientOrderId,
          symbol: input.symbol,
          side: input.side,
          type: input.type,
          price: input.price ?? undefined,
          quantity: input.quantity,
        },
        referencePrice: input.referencePrice,
        accountKey: input.accountKey,
        accountState: input.accountState,
        stopDistanceUsdt: input.stopDistanceUsdt,
      });
      if (decision.decision.outcome !== "APPROVE") {
        return {
          status: "risk_rejected" as const,
          riskDecision: decision,
          order: null,
        };
      }
      return {
        status: "submitted" as const,
        order: {
          id: "order-m2-reject",
          organizationId: ORG,
          clientOrderId: input.clientOrderId,
          state: "FILLED" as const,
          strategySignalId: "signal-eth",
        },
      } as SubmitOrderResult;
    });

    const ethSignal = {
      ...mockEvaluation().signal,
      strategySignalId: "signal-eth",
      symbol: "ETH/USDT" as const,
      side: "buy" as const,
    };
    vi.spyOn(evaluationCycleModule, "runEvaluationCycle").mockReturnValue(
      mockEvaluation({ signal: ethSignal, signals: [ethSignal] }),
    );

    const result = await runPaperCycleOnce(deps, {
      context: requireOrgContext(ORG),
      snapshot: portfolioSnapshot("dee-377-concurrent"),
      accountKey: "acct-m2",
      defaultQuantity: "0.01",
      accountState: EMPTY_STATE,
      orderRepository,
      portfolio: portfolioContext({
        limits: {
          maxRiskPerTradePct: "0.10",
          maxPortfolioRiskPct: "0.50",
          maxConcurrentPositions: 1,
          maxNotional: "100000.00",
        },
      }),
    });

    expect(deps.execution.submitOrder).toHaveBeenCalledTimes(1);
    const submitArg = vi.mocked(deps.execution.submitOrder).mock.calls[0]?.[1];
    expect(submitArg?.accountState?.openPositionCount).toBe(1);
    expect(result.strategyExecutions[0]?.submitBlocked).toBe(true);
    expect(result.strategyExecutions[0]?.execution?.status).toBe("risk_rejected");
    if (result.strategyExecutions[0]?.execution?.status === "risk_rejected") {
      expect(result.strategyExecutions[0].execution.riskDecision.decision.reasonCodes).toContain(
        capitalReasonCodes.maxConcurrentPositionsExceeded,
      );
    }
  });
});
