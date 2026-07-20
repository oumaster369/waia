import { describe, expect, it } from "vitest";

import { evaluatePositionGuardian, type GuardianCycleResult } from "@/lib/trader/guardian";
import type { EvaluationCycleResult } from "@/lib/trader/intelligence/types";
import type { PositionLotRow, TradeRow } from "@/lib/trader/lifecycle/trade-lifecycle.types";
import type { MarketSnapshot } from "@/lib/trader/market-data/types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORG = "00000000-0000-4000-8000-0000000378";

function mockEvaluation(
  tradingPermission: EvaluationCycleResult["msv"]["derived"]["tradingPermission"],
  allowedStrategyIds: string[] = ["mean_reversion_v0"],
): EvaluationCycleResult {
  return {
    features: {
      featureSetId: "fs-378",
      instrumentId: "BTC/USDT",
      evaluatedAt: "2026-01-01T00:05:00.000Z",
      features: {
        close: "65000",
        sma20: "64000",
        zscoreVsSma20: "0",
        realizedVol20: "300",
        spreadBps: "1",
      },
      dataQualityScore: 0.9,
      inputs: { barCount: 25 },
    },
    msv: {
      msvId: "msv-378",
      instrumentId: "BTC/USDT",
      evaluatedAt: "2026-01-01T00:05:00.000Z",
      featureSetId: "fs-378",
      physics: { close: "65000", zscoreVsSma20: "0", realizedVol20: "300" },
      liquidity: { spreadBps: "1" },
      crowd: { fearGreedIndex: null, newsSentiment: "neutral" },
      futureContext: { eventRiskScore: "0" },
      derived: {
        regime: "RANGE",
        tradingPermission,
        allowedStrategyIds,
        riskMultiplier: "1",
        dataQualityScore: 0.9,
        reasonCodes: [],
      },
    },
    signals: [],
    signal: {
      strategySignalId: "signal-378-none",
      strategyId: "mean_reversion_v0",
      strategyVersion: "0.1.0",
      organizationId: ORG,
      symbol: "BTC/USDT",
      outcome: "NO_SIGNAL",
      side: undefined,
      confidence: "0",
      expectedEdge: "0",
      horizon: "1h",
      maxRisk: "0",
      reasonCodes: [],
      msvId: "msv-378",
      featureSetId: "fs-378",
      evaluatedAt: "2026-01-01T00:05:00.000Z",
    },
  };
}

function mockLot(overrides: Partial<PositionLotRow> = {}): PositionLotRow {
  return {
    id: "lot-378",
    organizationId: ORG,
    symbol: "BTC/USDT",
    venue: "mock",
    accountKey: "paper",
    positionSide: "LONG",
    instrumentKind: "SPOT",
    strategySignalId: "signal-378",
    state: "OPEN",
    openQty: "0.01",
    remainingQty: "0.01",
    avgCost: "64000",
    openedAt: new Date("2026-01-01T00:00:00.000Z"),
    closedAt: null,
    tradeId: "trade-378",
    hedgeGroupId: null,
    targetLotId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function mockTrade(overrides: Partial<TradeRow> = {}): TradeRow {
  return {
    id: "trade-378",
    organizationId: ORG,
    symbol: "BTC/USDT",
    venue: "mock",
    accountKey: "paper",
    positionSide: "LONG",
    instrumentKind: "SPOT",
    strategySignalId: "signal-378",
    strategyId: "mean_reversion_v0",
    strategyVersion: "0.1.0",
    state: "OPEN",
    semanticsVersion: "waia.trader.trade-lifecycle.v2",
    openedAt: new Date("2026-01-01T00:00:00.000Z"),
    closedAt: null,
    realizedPnl: "0",
    markedPnl: "0",
    hypothesisId: null,
    patternId: null,
    riskDecisionId: "risk-378",
    allocationDecisionId: null,
    reasoningSessionId: null,
    signalConfidence: null,
    openingRegime: "RANGE",
    openingMsvId: "msv-378",
    openingFeatureSetId: "fs-378",
    closingMsvId: null,
    closingFeatureSetId: null,
    closingRegime: null,
    frozenAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function runGuardian(
  tradingPermission: EvaluationCycleResult["msv"]["derived"]["tradingPermission"],
  lots: PositionLotRow[] = [mockLot()],
): GuardianCycleResult {
  const snapshot: MarketSnapshot = {
    cycleId: "cycle-378",
    cycleIndex: 0,
    evaluatedAt: "2026-01-01T00:05:00.000Z",
    bars: [],
    quote: {
      symbol: "BTC/USDT",
      bid: "64999",
      ask: "65001",
      last: "65000",
      timestamp: "2026-01-01T00:05:00.000Z",
    },
  };

  const trade = mockTrade();
  return evaluatePositionGuardian({
    context: requireOrgContext(ORG),
    snapshot,
    evaluation: mockEvaluation(tradingPermission),
    openLots: lots,
    tradesById: new Map([[trade.id, trade]]),
    runConfig: { enabled: true, maxHoldBars: 0, barIntervalMs: 60_000 },
    accountKey: "paper",
    markPrice: "65000",
  });
}

describe("evaluatePositionGuardian (M3)", () => {
  it("returns empty when disabled", () => {
    const result = evaluatePositionGuardian({
      context: requireOrgContext(ORG),
      snapshot: {
        cycleId: "c1",
        cycleIndex: 0,
        evaluatedAt: "2026-01-01T00:05:00.000Z",
        bars: [],
        quote: {
          symbol: "BTC/USDT",
          bid: "1",
          ask: "1",
          last: "1",
          timestamp: "2026-01-01T00:05:00.000Z",
        },
      },
      evaluation: mockEvaluation("ALLOW_TRADING"),
      openLots: [mockLot()],
      tradesById: new Map([[mockTrade().id, mockTrade()]]),
      runConfig: { enabled: false },
      accountKey: "paper",
      markPrice: "65000",
    });
    expect(result).toEqual({ evaluations: [], exitIntents: [] });
  });

  it("produces one evaluation per open lot on HOLD", () => {
    const result = runGuardian("ALLOW_TRADING");
    expect(result.evaluations).toHaveLength(1);
    expect(result.evaluations[0]?.decision).toBe("HOLD");
    expect(result.exitIntents).toHaveLength(0);
  });

  it("produces EXIT_FULL intent with remaining qty on close-only permission", () => {
    const result = runGuardian("ONLY_CLOSE_POSITIONS");
    expect(result.exitIntents).toHaveLength(1);
    expect(result.exitIntents[0]?.quantity).toBe("0.01");
    expect(result.exitIntents[0]?.openingStrategySignalId).toBe("signal-378");
  });

  it("sorts lots deterministically and evaluates each", () => {
    const lotB = mockLot({
      id: "lot-b",
      symbol: "ETH/USDT",
      tradeId: "trade-b",
      strategySignalId: "signal-b",
    });
    const lotA = mockLot({ id: "lot-a" });
    const tradeA = mockTrade();
    const tradeB = mockTrade({
      id: "trade-b",
      strategySignalId: "signal-b",
    });

    const result = evaluatePositionGuardian({
      context: requireOrgContext(ORG),
      snapshot: {
        cycleId: "cycle-multi",
        cycleIndex: 0,
        evaluatedAt: "2026-01-01T00:05:00.000Z",
        bars: [],
        quote: {
          symbol: "BTC/USDT",
          bid: "1",
          ask: "1",
          last: "65000",
          timestamp: "2026-01-01T00:05:00.000Z",
        },
      },
      evaluation: mockEvaluation("ALLOW_TRADING"),
      openLots: [lotB, lotA],
      tradesById: new Map([
        [tradeA.id, tradeA],
        [tradeB.id, tradeB],
      ]),
      runConfig: { enabled: true, maxHoldBars: 0 },
      accountKey: "paper",
      markPrice: "65000",
    });

    expect(result.evaluations).toHaveLength(2);
    expect(result.evaluations.map((e) => e.positionLotId)).toEqual(["lot-a", "lot-b"]);
  });

  it("produces byte-identical ExitIntent on replay", () => {
    const first = runGuardian("ONLY_CLOSE_POSITIONS");
    const second = runGuardian("ONLY_CLOSE_POSITIONS");
    expect(JSON.stringify(first.exitIntents)).toBe(JSON.stringify(second.exitIntents));
  });

  it("emits EXIT_PARTIAL with inventory cap fields when canonical inventory is constrained (PR2)", () => {
    const lot1 = mockLot({
      id: "lot-1",
      tradeId: "trade-1",
      remainingQty: "0.005",
      openQty: "0.005",
    });
    const lot2 = mockLot({
      id: "lot-2",
      tradeId: "trade-2",
      remainingQty: "0.005",
      openQty: "0.005",
      openedAt: new Date("2026-01-01T00:01:00.000Z"),
    });
    const trade1 = mockTrade({ id: "trade-1" });
    const trade2 = mockTrade({ id: "trade-2" });

    const result = evaluatePositionGuardian({
      context: requireOrgContext(ORG),
      snapshot: {
        cycleId: "cycle-partial",
        cycleIndex: 0,
        evaluatedAt: "2026-01-01T00:05:00.000Z",
        bars: [],
        quote: {
          symbol: "BTC/USDT",
          bid: "64999",
          ask: "65001",
          last: "65000",
          timestamp: "2026-01-01T00:05:00.000Z",
        },
      },
      evaluation: mockEvaluation("ONLY_CLOSE_POSITIONS"),
      openLots: [lot1, lot2],
      tradesById: new Map([
        [trade1.id, trade1],
        [trade2.id, trade2],
      ]),
      runConfig: { enabled: true, maxHoldBars: 1, barIntervalMs: 60_000 },
      accountKey: "paper",
      markPrice: "65000",
      canonicalInventory: { openQtyBySymbol: new Map([["BTC/USDT", "0.00731991"]]) },
    });

    const partialEval = result.evaluations.find((entry) => entry.decision === "EXIT_PARTIAL");
    expect(partialEval).toBeDefined();
    expect(partialEval?.reason.inventoryCapApplied).toBe(true);
    expect(partialEval?.reason.requestedExitQty).toBe("0.005");
    expect(partialEval?.reason.approvedExitQty).toBe("0.00231991");
    expect(result.exitIntents.some((intent) => intent.kind === "REDUCE_LONG")).toBe(true);
  });
});
