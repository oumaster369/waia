import { describe, expect, it } from "vitest";

import { evaluatePositionGuardian } from "@/lib/trader/guardian";
import { guardianReasonCodes } from "@/lib/trader/guardian/guardian-reason-codes";
import { DEFAULT_EXIT_INTELLIGENCE_RUN_CONFIG } from "@/lib/trader/intelligence/m5/exit-intelligence-types";
import type { EvaluationCycleResult } from "@/lib/trader/intelligence/types";
import type { PositionLotRow, TradeRow } from "@/lib/trader/lifecycle/trade-lifecycle.types";
import type { MarketSnapshot } from "@/lib/trader/market-data/types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORG = "00000000-0000-4000-8000-0000000380";

function mockEvaluation(): EvaluationCycleResult {
  return {
    features: {
      featureSetId: "fs-380",
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
      msvId: "msv-380",
      instrumentId: "BTC/USDT",
      evaluatedAt: "2026-01-01T00:05:00.000Z",
      featureSetId: "fs-380",
      physics: { close: "65000", zscoreVsSma20: "0", realizedVol20: "300" },
      liquidity: { spreadBps: "1" },
      crowd: { fearGreedIndex: null, newsSentiment: "neutral" },
      futureContext: { eventRiskScore: "0.1" },
      derived: {
        regime: "RANGE",
        tradingPermission: "ALLOW_TRADING",
        allowedStrategyIds: ["mean_reversion_v0"],
        riskMultiplier: "1",
        dataQualityScore: 0.9,
        reasonCodes: [],
      },
    },
    signals: [],
    signal: {
      strategySignalId: "signal-380-none",
      strategyId: "mean_reversion_v0",
      strategyVersion: "0.1.0",
      organizationId: ORG,
      symbol: "BTC/USDT",
      outcome: "NO_SIGNAL",
      reasonCodes: [],
      msvId: "msv-380",
      featureSetId: "fs-380",
      evaluatedAt: "2026-01-01T00:05:00.000Z",
    },
  };
}

function mockLot(): PositionLotRow {
  return {
    id: "lot-380",
    organizationId: ORG,
    symbol: "BTC/USDT",
    venue: "mock",
    accountKey: "paper",
    positionSide: "LONG",
    instrumentKind: "SPOT",
    strategySignalId: "signal-380",
    state: "OPEN",
    openQty: "0.01",
    remainingQty: "0.01",
    avgCost: "64000",
    openedAt: new Date("2026-01-01T00:00:00.000Z"),
    closedAt: null,
    tradeId: "trade-380",
    hedgeGroupId: null,
    targetLotId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function mockTrade(): TradeRow {
  return {
    id: "trade-380",
    organizationId: ORG,
    symbol: "BTC/USDT",
    venue: "mock",
    accountKey: "paper",
    positionSide: "LONG",
    instrumentKind: "SPOT",
    strategySignalId: "signal-380",
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
    riskDecisionId: "risk-380",
    allocationDecisionId: null,
    reasoningSessionId: null,
    signalConfidence: null,
    openingRegime: "RANGE",
    openingMsvId: "msv-380",
    openingFeatureSetId: "fs-380",
    closingMsvId: null,
    closingFeatureSetId: null,
    closingRegime: null,
    frozenAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

const snapshot: MarketSnapshot = {
  cycleId: "cycle-380",
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

describe("evaluatePositionGuardian + M5 exit intelligence", () => {
  it("leaves decision unchanged when M5 enabled", () => {
    const baseInput = {
      context: requireOrgContext(ORG),
      snapshot,
      evaluation: mockEvaluation(),
      openLots: [mockLot()],
      tradesById: new Map([[mockTrade().id, mockTrade()]]),
      runConfig: { enabled: true, maxHoldBars: 0, barIntervalMs: 60_000 },
      accountKey: "paper",
      markPrice: "65000",
    };

    const withoutM5 = evaluatePositionGuardian(baseInput);
    const withM5 = evaluatePositionGuardian({
      ...baseInput,
      exitIntelligence: {
        runConfig: { ...DEFAULT_EXIT_INTELLIGENCE_RUN_CONFIG, enabled: true },
      },
    });

    expect(withM5.evaluations[0]?.decision).toBe(withoutM5.evaluations[0]?.decision);
    expect(withM5.evaluations[0]?.reason.reasonCode).toBe(
      withoutM5.evaluations[0]?.reason.reasonCode,
    );
    expect(withM5.evaluations[0]?.reason.ruleId).toBe(withoutM5.evaluations[0]?.reason.ruleId);
    expect(withM5.exitIntents).toHaveLength(withoutM5.exitIntents.length);
  });

  it("attaches exitIntelligenceContext when enabled", () => {
    const result = evaluatePositionGuardian({
      context: requireOrgContext(ORG),
      snapshot,
      evaluation: mockEvaluation(),
      openLots: [mockLot()],
      tradesById: new Map([[mockTrade().id, mockTrade()]]),
      runConfig: { enabled: true, maxHoldBars: 0, barIntervalMs: 60_000 },
      accountKey: "paper",
      markPrice: "65000",
      exitIntelligence: {
        runConfig: { ...DEFAULT_EXIT_INTELLIGENCE_RUN_CONFIG, enabled: true },
      },
    });

    expect(result.evaluations[0]?.reason.exitIntelligenceContext).not.toBeNull();
    expect(result.evaluations[0]?.reason.exitIntelligenceContext?.guardianOutcome.reasonCode).toBe(
      guardianReasonCodes.hold,
    );
  });

  it("keeps exitIntelligenceContext null when disabled", () => {
    const result = evaluatePositionGuardian({
      context: requireOrgContext(ORG),
      snapshot,
      evaluation: mockEvaluation(),
      openLots: [mockLot()],
      tradesById: new Map([[mockTrade().id, mockTrade()]]),
      runConfig: { enabled: true, maxHoldBars: 0, barIntervalMs: 60_000 },
      accountKey: "paper",
      markPrice: "65000",
    });

    expect(result.evaluations[0]?.reason.exitIntelligenceContext).toBeNull();
  });
});
