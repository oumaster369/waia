import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import { GUARDIAN_REASON_RECORD_SCHEMA_VERSION, guardianReasonCodes } from "@/lib/trader/guardian";
import { buildExitPlan } from "@/lib/trader/exits/exit-plan-builder";
import { exitReasonCodes } from "@/lib/trader/exits/exit-reason-codes";
import { DEFAULT_EXIT_RUN_CONFIG } from "@/lib/trader/exits/exit-types";
import { DEFAULT_EXIT_INTELLIGENCE_RUN_CONFIG } from "@/lib/trader/intelligence/m5/exit-intelligence-types";
import {
  createLifecycleRecorder,
  createSqliteLifecycleRepository,
  TRADE_LIFECYCLE_SEMANTICS_VERSION_V2,
} from "@/lib/trader/lifecycle";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";

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
import {
  createOrderExecutionServiceFromDeps,
  createSqliteOrderRepository,
  createSqliteReconciliationService,
} from "@/lib/trader/execution";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
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
import {
  createKillSwitchResolver,
  createRiskEngineService,
  createSqliteKillSwitchRepository,
  createSqliteRiskLimitsService,
  DEFAULT_ORG_RISK_LIMITS,
} from "@/lib/trader/risk";
import { capitalReasonCodes } from "@/lib/trader/risk/reason-codes";
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

type M3PaperCycleHarness = {
  orgM3: string;
  deps: PaperCycleDeps;
  lifecycleRepository: ReturnType<typeof createSqliteLifecycleRepository>;
  orderRepository: OrderRepository;
  cleanup: () => void;
};

async function createM3PaperCycleHarness(): Promise<M3PaperCycleHarness> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-m3-paper-cycle-"));
  const dbPath = path.join(tmpDir, "m3-paper-cycle.sqlite");
  process.env.DATABASE_URL = `file:${dbPath}`;
  migrateDatabaseFromEnv();
  const db = getDb();

  const userId = crypto.randomUUID();
  insertEmailPasswordUser(db, {
    id: userId,
    email: `m3-paper-cycle-${userId}@waia.invalid`,
    password: "password123",
    identityLabel: "M3 Paper Cycle Org",
  });
  const orgM3 = ensureUserCoreSeedSqlite(db, { userId, displayName: "M3 Paper Cycle Org" });

  const orderRepository = createSqliteOrderRepository(db);
  const lifecycleRepository = createSqliteLifecycleRepository(db);
  const lifecycleRecorder = createLifecycleRecorder({ repository: lifecycleRepository });
  const connector = new MockExchangeConnector();
  await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });
  const writeAudit = () => "m3-audit";
  const nowMs = () => Date.now();
  const killSwitchResolver = createKillSwitchResolver({
    repository: createSqliteKillSwitchRepository(db),
    nowMs,
  });
  const limitsService = createSqliteRiskLimitsService(db);
  await limitsService.upsertLimitsForOrg(requireOrgContext(orgM3), {
    ...DEFAULT_ORG_RISK_LIMITS,
  });
  const riskEngine = createRiskEngineService({
    limitsService,
    killSwitchResolver,
    rateStore: createInMemoryOrderRateStore(),
    writeAudit,
    nowMs,
    newDecisionId: () => crypto.randomUUID(),
  });
  const execution = createOrderExecutionServiceFromDeps({
    riskEngine,
    orderRepository,
    killSwitchResolver,
    connectorForMode: () => connector,
    writeAudit,
    nowMs,
    lifecycleRecorder,
  });
  const reconciliation = createSqliteReconciliationService(db, {
    connectorForMode: () => connector,
    nowMs,
    writeAudit,
  });

  return {
    orgM3,
    deps: {
      execution,
      reconciliation,
      lifecycleRecorder,
      lifecycleRepository,
    },
    lifecycleRepository,
    orderRepository,
    cleanup: () => {
      resetWaiaSqliteSingleton();
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    },
  };
}

async function seedFilledBuyOrderForHarness(
  harness: M3PaperCycleHarness,
  input: {
    orderKey: string;
    strategySignalId: string;
    quantity?: string;
    avgFillPrice?: string;
    executedAt?: Date;
  },
): Promise<void> {
  const context = requireOrgContext(harness.orgM3);
  const quantity = input.quantity ?? "0.01";
  const price = input.avgFillPrice ?? "64000";
  const executedAt = input.executedAt ?? new Date("2026-01-01T00:00:00.000Z");

  let order = await harness.orderRepository.createOrder(context, {
    venue: "mock",
    executionMode: "mock",
    symbol: "BTC/USDT",
    side: "buy",
    type: "market",
    quantity,
    clientOrderId: `client-${input.orderKey}`,
    idempotencyKey: `idem-${input.orderKey}`,
    riskDecisionId: "risk-m3-inv",
    strategySignalId: input.strategySignalId,
  });

  const transition = async (
    toState: "RISK_APPROVED" | "SENT_TO_EXCHANGE" | "ACCEPTED" | "FILLED",
  ) => {
    order = await harness.orderRepository.transitionOrder(context, {
      orderId: order.id,
      expectedStateVersion: order.stateVersion,
      toState,
      ...(toState === "FILLED" ? { filledQuantity: quantity, avgFillPrice: price } : {}),
    });
  };

  await transition("RISK_APPROVED");
  await transition("SENT_TO_EXCHANGE");
  await transition("ACCEPTED");
  await harness.orderRepository.recordFill(context, {
    orderId: order.id,
    exchangeTradeId: `trade-${input.orderKey}`,
    price,
    quantity,
    fee: "0",
    feeAsset: "USDT",
    executedAt,
  });
  await transition("FILLED");
}

describe("paper cycle runner — M3 position guardian (DEE-378)", () => {
  let harness: M3PaperCycleHarness;

  beforeEach(async () => {
    vi.restoreAllMocks();
    harness = await createM3PaperCycleHarness();
  });

  afterEach(() => {
    harness.cleanup();
  });

  async function seedOpenLot(input: {
    tradeId: string;
    lotId: string;
    strategySignalId: string;
    openedAt?: Date;
  }): Promise<void> {
    const context = requireOrgContext(harness.orgM3);
    const openedAt = input.openedAt ?? new Date("2026-01-01T00:00:00.000Z");
    await harness.lifecycleRepository.insertTrade(context, {
      trade: {
        id: input.tradeId,
        organizationId: harness.orgM3,
        symbol: "BTC/USDT",
        venue: "mock",
        accountKey: "paper",
        positionSide: "LONG",
        instrumentKind: "SPOT",
        strategySignalId: input.strategySignalId,
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.0",
        state: "OPEN",
        semanticsVersion: TRADE_LIFECYCLE_SEMANTICS_VERSION_V2,
        openedAt,
        closedAt: null,
        realizedPnl: "0",
        markedPnl: "0",
        hypothesisId: null,
        patternId: null,
        riskDecisionId: "risk-m3",
        allocationDecisionId: null,
        reasoningSessionId: null,
        signalConfidence: null,
        openingRegime: "RANGE",
        openingMsvId: "msv-m3",
        openingFeatureSetId: "fs-m3",
        closingMsvId: null,
        closingFeatureSetId: null,
        closingRegime: null,
        frozenAt: null,
      },
    });
    await harness.lifecycleRepository.insertPositionLot(context, {
      lot: {
        id: input.lotId,
        organizationId: harness.orgM3,
        symbol: "BTC/USDT",
        venue: "mock",
        accountKey: "paper",
        positionSide: "LONG",
        instrumentKind: "SPOT",
        strategySignalId: input.strategySignalId,
        state: "OPEN",
        openQty: "0.01",
        remainingQty: "0.01",
        avgCost: "64000",
        openedAt,
        closedAt: null,
        tradeId: input.tradeId,
        hedgeGroupId: null,
        targetLotId: null,
      },
    });
    await seedFilledBuyOrderForHarness(harness, {
      orderKey: input.lotId,
      strategySignalId: input.strategySignalId,
      executedAt: openedAt,
    });
  }

  it("runs guardian on no-signal bar when open lots exist and submits close-only exit", async () => {
    const lotId = "lot-m3";
    const tradeId = "trade-m3";

    await seedOpenLot({
      tradeId,
      lotId,
      strategySignalId: "signal-m3-open",
    });

    vi.spyOn(evaluationCycleModule, "runEvaluationCycle").mockReturnValue({
      ...mockEvaluation(),
      signals: [],
      signal: {
        ...mockEvaluation().signal,
        outcome: "NO_SIGNAL",
        side: undefined,
      },
      msv: {
        ...mockEvaluation().msv,
        derived: {
          ...mockEvaluation().msv.derived,
          tradingPermission: "ONLY_CLOSE_POSITIONS",
        },
      },
    });

    const exitIntentSpy = vi.spyOn(harness.deps.lifecycleRecorder!, "recordGuardianExitIntent");
    const submitSpy = vi.spyOn(harness.deps.execution, "submitOrder");

    const result = await runPaperCycleOnce(harness.deps, {
      context: requireOrgContext(harness.orgM3),
      snapshot: portfolioSnapshot("cycle-m3-close-only"),
      accountKey: "paper",
      defaultQuantity: "0.01",
      accountState: EMPTY_STATE,
      executionMode: "mock",
      orderRepository: harness.orderRepository,
      refreshAccountStateBetweenStrategies: true,
      guardian: { runConfig: { enabled: true, maxHoldBars: 0 } },
    });

    expect(result.guardian?.exitIntents).toHaveLength(1);
    expect(result.guardian?.evaluations).toHaveLength(1);
    expect(submitSpy).toHaveBeenCalledTimes(1);
    const submitArg = submitSpy.mock.calls[0]?.[1];
    expect(submitArg?.side).toBe("sell");
    expect(submitArg?.strategySignalId).toBe("signal-m3-open");
    expect(result.guardianExecutions?.[0]?.submitBlocked).toBe(false);

    expect(exitIntentSpy).toHaveBeenCalledTimes(1);
    expect(exitIntentSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      submitSpy.mock.invocationCallOrder[0]!,
    );

    const context = requireOrgContext(harness.orgM3);
    const lotEvents = await harness.lifecycleRepository.listLifecycleEvents(context, {
      entityType: "POSITION_LOT",
      entityId: lotId,
    });
    expect(lotEvents.map((event) => event.phase)).toEqual([
      "GUARDIAN_EVALUATED",
      "GUARDIAN_EXIT_INTENT",
    ]);
    expect(JSON.parse(lotEvents[0]!.payload!)).toMatchObject({
      schemaVersion: GUARDIAN_REASON_RECORD_SCHEMA_VERSION,
      reasonCode: guardianReasonCodes.closeOnlyPermission,
      positionLotId: lotId,
    });
    expect(JSON.parse(lotEvents[1]!.payload!)).toMatchObject({
      intentId: result.guardian?.exitIntents[0]?.intentId,
      quantity: "0.01",
    });

    const tradeEvents = await harness.lifecycleRepository.listLifecycleEvents(context, {
      entityType: "TRADE",
      entityId: tradeId,
    });
    expect(tradeEvents.some((event) => event.phase === "TRADE_CLOSED")).toBe(true);

    const trade = await harness.lifecycleRepository.getTradeById(context, tradeId);
    expect(trade?.state).toBe("CLOSED");

    const openLots = await harness.lifecycleRepository.listOpenPositionLots(context, {});
    expect(openLots).toHaveLength(0);
  });

  it("emits HOLD guardian evaluation without submit when permission allows trading", async () => {
    const lotId = "lot-m3-hold";

    await seedOpenLot({
      tradeId: "trade-m3-hold",
      lotId,
      strategySignalId: "signal-m3-hold",
    });

    vi.spyOn(evaluationCycleModule, "runEvaluationCycle").mockReturnValue({
      ...mockEvaluation(),
      signals: [],
      signal: {
        ...mockEvaluation().signal,
        outcome: "NO_SIGNAL",
        side: undefined,
      },
    });

    const submitSpy = vi.spyOn(harness.deps.execution, "submitOrder");

    const result = await runPaperCycleOnce(harness.deps, {
      context: requireOrgContext(harness.orgM3),
      snapshot: portfolioSnapshot("cycle-m3-hold"),
      accountKey: "paper",
      defaultQuantity: "0.01",
      accountState: EMPTY_STATE,
      orderRepository: harness.orderRepository,
      guardian: { runConfig: { enabled: true, maxHoldBars: 0 } },
    });

    expect(result.guardian?.evaluations).toHaveLength(1);
    expect(result.guardian?.evaluations[0]?.decision).toBe("HOLD");
    expect(result.guardian?.exitIntents).toHaveLength(0);
    expect(submitSpy).not.toHaveBeenCalled();

    const lotEvents = await harness.lifecycleRepository.listLifecycleEvents(
      requireOrgContext(harness.orgM3),
      {
        entityType: "POSITION_LOT",
        entityId: lotId,
      },
    );
    expect(lotEvents.map((event) => event.phase)).toEqual(["GUARDIAN_EVALUATED"]);
    expect(JSON.parse(lotEvents[0]!.payload!)).toMatchObject({
      reasonCode: guardianReasonCodes.hold,
      decision: "HOLD",
    });
  });

  it("closes open lot when maxHoldBars is exceeded on an allow-trading bar", async () => {
    const lotId = "lot-m3-max-hold";
    const tradeId = "trade-m3-max-hold";

    await seedOpenLot({
      tradeId,
      lotId,
      strategySignalId: "signal-m3-max-hold",
    });

    vi.spyOn(evaluationCycleModule, "runEvaluationCycle").mockReturnValue({
      ...mockEvaluation(),
      signals: [],
      signal: {
        ...mockEvaluation().signal,
        outcome: "NO_SIGNAL",
        side: undefined,
      },
    });

    const result = await runPaperCycleOnce(harness.deps, {
      context: requireOrgContext(harness.orgM3),
      snapshot: portfolioSnapshot("cycle-m3-max-hold"),
      accountKey: "paper",
      defaultQuantity: "0.01",
      accountState: EMPTY_STATE,
      executionMode: "mock",
      orderRepository: harness.orderRepository,
      refreshAccountStateBetweenStrategies: true,
      guardian: { runConfig: { enabled: true, maxHoldBars: 5, barIntervalMs: 60_000 } },
    });

    expect(result.guardian?.evaluations).toHaveLength(1);
    expect(result.guardian?.evaluations[0]?.reason.reasonCode).toBe(
      guardianReasonCodes.maxHoldBars,
    );
    expect(result.guardian?.exitIntents).toHaveLength(1);
    expect(result.guardianExecutions?.[0]?.submitBlocked).toBe(false);

    const context = requireOrgContext(harness.orgM3);
    const lotEvents = await harness.lifecycleRepository.listLifecycleEvents(context, {
      entityType: "POSITION_LOT",
      entityId: lotId,
    });
    expect(lotEvents.map((event) => event.phase)).toEqual([
      "GUARDIAN_EVALUATED",
      "GUARDIAN_EXIT_INTENT",
    ]);

    const trade = await harness.lifecycleRepository.getTradeById(context, tradeId);
    expect(trade?.state).toBe("CLOSED");
  });

  it("attaches exitIntelligenceContext on HOLD without adding exit intents (M5)", async () => {
    const lotId = "lot-m5-hold";
    await seedOpenLot({
      tradeId: "trade-m5-hold",
      lotId,
      strategySignalId: "signal-m5-hold",
    });

    vi.spyOn(evaluationCycleModule, "runEvaluationCycle").mockReturnValue({
      ...mockEvaluation(),
      signals: [],
      signal: {
        ...mockEvaluation().signal,
        outcome: "NO_SIGNAL",
        side: undefined,
      },
    });

    const submitSpy = vi.spyOn(harness.deps.execution, "submitOrder");

    const result = await runPaperCycleOnce(harness.deps, {
      context: requireOrgContext(harness.orgM3),
      snapshot: portfolioSnapshot("cycle-m5-hold"),
      accountKey: "paper",
      defaultQuantity: "0.01",
      accountState: EMPTY_STATE,
      orderRepository: harness.orderRepository,
      guardian: {
        runConfig: { enabled: true, maxHoldBars: 0 },
        exitIntelligence: {
          runConfig: { ...DEFAULT_EXIT_INTELLIGENCE_RUN_CONFIG, enabled: true },
        },
      },
    });

    expect(result.guardian?.evaluations).toHaveLength(1);
    expect(result.guardian?.evaluations[0]?.decision).toBe("HOLD");
    expect(result.guardian?.evaluations[0]?.reason.exitIntelligenceContext).not.toBeNull();
    expect(result.guardian?.exitIntents).toHaveLength(0);
    expect(submitSpy).not.toHaveBeenCalled();
  });
});

function m4VolatileBars(count: number, baseClose = "64000.00"): Bar[] {
  const bars: Bar[] = [];
  for (let index = 0; index < count; index += 1) {
    const openTime = new Date(
      Date.parse("2026-01-01T00:00:00.000Z") + index * 60_000,
    ).toISOString();
    const closeTime = new Date(Date.parse(openTime) + 60_000).toISOString();
    const closeNum = Number(baseClose) + (index % 2 === 0 ? 2 : -1);
    const close = closeNum.toFixed(2);
    const high = (closeNum + 3).toFixed(2);
    const low = (closeNum - 3).toFixed(2);
    bars.push({
      symbol: "BTC/USDT",
      interval: "1m",
      open: close,
      high,
      low,
      close,
      volume: "10.00",
      barOpenTime: openTime,
      barCloseTime: closeTime,
    });
  }
  return bars;
}

describe("paper cycle runner — M4 dynamic SL/TP (DEE-379)", () => {
  let harness: M3PaperCycleHarness;

  beforeEach(async () => {
    vi.restoreAllMocks();
    harness = await createM3PaperCycleHarness();
  });

  afterEach(() => {
    harness.cleanup();
  });

  it("submits stop-loss exit when mark crosses SL and populates slTpLevels", async () => {
    const lotId = "lot-m4-sl";
    const tradeId = "trade-m4-sl";
    const openedAt = new Date("2026-01-01T00:00:00.000Z");
    const bars = m4VolatileBars(25);

    await harness.lifecycleRepository.insertTrade(requireOrgContext(harness.orgM3), {
      trade: {
        id: tradeId,
        organizationId: harness.orgM3,
        symbol: "BTC/USDT",
        venue: "mock",
        accountKey: "paper",
        positionSide: "LONG",
        instrumentKind: "SPOT",
        strategySignalId: "signal-m4-sl",
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.0",
        state: "OPEN",
        semanticsVersion: TRADE_LIFECYCLE_SEMANTICS_VERSION_V2,
        openedAt,
        closedAt: null,
        realizedPnl: "0",
        markedPnl: "0",
        hypothesisId: null,
        patternId: null,
        riskDecisionId: "risk-m4",
        allocationDecisionId: null,
        reasoningSessionId: null,
        signalConfidence: null,
        openingRegime: "RANGE",
        openingMsvId: "msv-m4",
        openingFeatureSetId: "fs-m4",
        closingMsvId: null,
        closingFeatureSetId: null,
        closingRegime: null,
        frozenAt: null,
      },
    });
    await harness.lifecycleRepository.insertPositionLot(requireOrgContext(harness.orgM3), {
      lot: {
        id: lotId,
        organizationId: harness.orgM3,
        symbol: "BTC/USDT",
        venue: "mock",
        accountKey: "paper",
        positionSide: "LONG",
        instrumentKind: "SPOT",
        strategySignalId: "signal-m4-sl",
        state: "OPEN",
        openQty: "0.01",
        remainingQty: "0.01",
        avgCost: "64000.00",
        openedAt,
        closedAt: null,
        tradeId,
        hedgeGroupId: null,
        targetLotId: null,
      },
    });

    await seedFilledBuyOrderForHarness(harness, {
      orderKey: lotId,
      strategySignalId: "signal-m4-sl",
      avgFillPrice: "64000.00",
      executedAt: openedAt,
    });

    const evaluatedAt = bars.at(-1)!.barCloseTime;
    const plan = buildExitPlan({
      lot: {
        id: lotId,
        organizationId: harness.orgM3,
        symbol: "BTC/USDT",
        venue: "mock",
        accountKey: "paper",
        positionSide: "LONG",
        instrumentKind: "SPOT",
        strategySignalId: "signal-m4-sl",
        state: "OPEN",
        openQty: "0.01",
        remainingQty: "0.01",
        avgCost: "64000.00",
        openedAt,
        closedAt: null,
        tradeId,
        hedgeGroupId: null,
        targetLotId: null,
        createdAt: openedAt,
        updatedAt: openedAt,
      },
      bars,
      runConfig: DEFAULT_EXIT_RUN_CONFIG,
      evaluatedAt,
    });
    expect(plan).not.toBeNull();

    vi.spyOn(evaluationCycleModule, "runEvaluationCycle").mockReturnValue({
      ...mockEvaluation(),
      signals: [],
      signal: {
        ...mockEvaluation().signal,
        outcome: "NO_SIGNAL",
        side: undefined,
      },
      features: {
        ...mockEvaluation().features,
        features: {
          ...mockEvaluation().features.features,
          close: plan!.stopLoss.price,
        },
      },
    });

    const submitSpy = vi.spyOn(harness.deps.execution, "submitOrder");

    const result = await runPaperCycleOnce(harness.deps, {
      context: requireOrgContext(harness.orgM3),
      snapshot: {
        bars,
        quote: {
          symbol: "BTC/USDT",
          bid: plan!.stopLoss.price,
          ask: plan!.stopLoss.price,
          last: plan!.stopLoss.price,
          timestamp: evaluatedAt,
        },
        evaluatedAt,
        cycleIndex: 0,
        cycleId: "cycle-m4-sl",
      },
      accountKey: "paper",
      defaultQuantity: "0.01",
      accountState: EMPTY_STATE,
      executionMode: "mock",
      orderRepository: harness.orderRepository,
      refreshAccountStateBetweenStrategies: true,
      guardian: {
        runConfig: { enabled: true, maxHoldBars: 0 },
        exitEngine: {
          runConfig: DEFAULT_EXIT_RUN_CONFIG,
          trailingStateByLotId: new Map(),
        },
      },
    });

    expect(result.guardian?.exitIntents).toHaveLength(1);
    expect(result.guardian?.evaluations[0]?.reason.reasonCode).toBe(exitReasonCodes.stopLossHit);
    expect(result.guardian?.evaluations[0]?.reason.slTpLevels).not.toBeNull();
    expect(submitSpy).toHaveBeenCalledTimes(1);

    const trade = await harness.lifecycleRepository.getTradeById(
      requireOrgContext(harness.orgM3),
      tradeId,
    );
    expect(trade?.state).toBe("CLOSED");
  });

  it("holds without ExitIntent when ATR bars are insufficient", async () => {
    const lotId = "lot-m4-insufficient-atr";
    const openedAt = new Date("2026-01-01T00:20:00.000Z");
    const bars = m4VolatileBars(25);

    await harness.lifecycleRepository.insertTrade(requireOrgContext(harness.orgM3), {
      trade: {
        id: "trade-m4-insufficient",
        organizationId: harness.orgM3,
        symbol: "BTC/USDT",
        venue: "mock",
        accountKey: "paper",
        positionSide: "LONG",
        instrumentKind: "SPOT",
        strategySignalId: "signal-m4-insufficient",
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.0",
        state: "OPEN",
        semanticsVersion: TRADE_LIFECYCLE_SEMANTICS_VERSION_V2,
        openedAt,
        closedAt: null,
        realizedPnl: "0",
        markedPnl: "0",
        hypothesisId: null,
        patternId: null,
        riskDecisionId: "risk-m4",
        allocationDecisionId: null,
        reasoningSessionId: null,
        signalConfidence: null,
        openingRegime: "RANGE",
        openingMsvId: "msv-m4",
        openingFeatureSetId: "fs-m4",
        closingMsvId: null,
        closingFeatureSetId: null,
        closingRegime: null,
        frozenAt: null,
      },
    });
    await harness.lifecycleRepository.insertPositionLot(requireOrgContext(harness.orgM3), {
      lot: {
        id: lotId,
        organizationId: harness.orgM3,
        symbol: "BTC/USDT",
        venue: "mock",
        accountKey: "paper",
        positionSide: "LONG",
        instrumentKind: "SPOT",
        strategySignalId: "signal-m4-insufficient",
        state: "OPEN",
        openQty: "0.01",
        remainingQty: "0.01",
        avgCost: "64000.00",
        openedAt,
        closedAt: null,
        tradeId: "trade-m4-insufficient",
        hedgeGroupId: null,
        targetLotId: null,
      },
    });

    const evaluatedAt = bars.at(-1)!.barCloseTime;

    vi.spyOn(evaluationCycleModule, "runEvaluationCycle").mockReturnValue({
      ...mockEvaluation(),
      signals: [],
      signal: {
        ...mockEvaluation().signal,
        outcome: "NO_SIGNAL",
        side: undefined,
      },
    });

    const submitSpy = vi.spyOn(harness.deps.execution, "submitOrder");

    const result = await runPaperCycleOnce(harness.deps, {
      context: requireOrgContext(harness.orgM3),
      snapshot: {
        bars,
        quote: {
          symbol: "BTC/USDT",
          bid: "64000.00",
          ask: "64000.00",
          last: "64000.00",
          timestamp: evaluatedAt,
        },
        evaluatedAt,
        cycleIndex: 0,
        cycleId: "cycle-m4-insufficient-atr",
      },
      accountKey: "paper",
      defaultQuantity: "0.01",
      accountState: EMPTY_STATE,
      orderRepository: harness.orderRepository,
      guardian: {
        runConfig: { enabled: true, maxHoldBars: 0 },
        exitEngine: {
          runConfig: DEFAULT_EXIT_RUN_CONFIG,
          trailingStateByLotId: new Map(),
        },
      },
    });

    expect(result.guardian?.evaluations).toHaveLength(1);
    expect(result.guardian?.evaluations[0]?.decision).toBe("HOLD");
    expect(result.guardian?.evaluations[0]?.reason.slTpLevels).toBeNull();
    expect(result.guardian?.exitIntents).toHaveLength(0);
    expect(submitSpy).not.toHaveBeenCalled();

    const lotEvents = await harness.lifecycleRepository.listLifecycleEvents(
      requireOrgContext(harness.orgM3),
      {
        entityType: "POSITION_LOT",
        entityId: lotId,
      },
    );
    expect(lotEvents.map((event) => event.phase)).toEqual(["GUARDIAN_EVALUATED"]);
  });
});
