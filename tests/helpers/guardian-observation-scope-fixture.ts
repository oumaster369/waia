import type { EvaluationCycleResult } from "@/lib/trader/intelligence/types";
import type { PositionLotRow, TradeRow } from "@/lib/trader/lifecycle/trade-lifecycle.types";
import type { PaperCycleInput } from "@/lib/trader/paper/paper-cycle.types";

export const GUARDIAN_SCOPE_ORG = "00000000-0000-4000-8000-0000001119";
export const GUARDIAN_SCOPE_AT = "2026-01-01T00:25:00.000Z";

export function guardianScopeFixture(organizationId = GUARDIAN_SCOPE_ORG) {
  const input: PaperCycleInput = {
    context: { organizationId }, accountKey: "account-a", defaultQuantity: "1",
    accountState: { positions: [], openOrderCount: 0, dailyPnl: "0", drawdown: "0", quoteExposureByCurrency: {} },
    executionMode: "mock",
    guardian: { runConfig: { enabled: true, maxHoldBars: 0 } },
    snapshot: {
      cycleId: "guardian-scope", cycleIndex: 25, evaluatedAt: GUARDIAN_SCOPE_AT,
      quote: { symbol: "BTC/USDT", bid: "64999", ask: "65001", last: "65000", timestamp: GUARDIAN_SCOPE_AT },
      bars: Array.from({ length: 25 }, (_, i) => ({
        symbol: "BTC/USDT", interval: "1m", open: "64900", high: "65100", low: "64800", close: "65000", volume: "1",
        barOpenTime: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
        barCloseTime: new Date(Date.UTC(2026, 0, 1, 0, i + 1)).toISOString(),
      })),
    },
  };
  const signal: EvaluationCycleResult["signal"] = {
    strategySignalId: "scope-signal", strategyId: "mean_reversion_v0", strategyVersion: "0.1.0",
    organizationId, symbol: "BTC/USDT", outcome: "SIGNAL", side: "buy", confidence: "1", expectedEdge: "1",
    horizon: "1h", maxRisk: "1", reasonCodes: [], msvId: "scope-msv", featureSetId: "scope-features", evaluatedAt: GUARDIAN_SCOPE_AT,
  };
  const evaluation: EvaluationCycleResult = {
    features: {
      featureSetId: "scope-features", instrumentId: "BTC/USDT", evaluatedAt: GUARDIAN_SCOPE_AT,
      features: { close: "65000", sma20: "65000", zscoreVsSma20: "0", priceDispersion20: "300", spreadBps: "1" },
      dataQualityScore: 1, inputs: { barCount: 25 },
    },
    msv: {
      msvId: "scope-msv", instrumentId: "BTC/USDT", featureSetId: "scope-features", evaluatedAt: GUARDIAN_SCOPE_AT,
      physics: { close: "65000", zscoreVsSma20: "0", priceDispersion20: "300" }, liquidity: { spreadBps: "1" },
      crowd: { fearGreedIndex: null, newsSentiment: "neutral" }, futureContext: { eventRiskScore: "0" },
      derived: { regime: "RANGE", tradingPermission: "ONLY_CLOSE_POSITIONS", allowedStrategyIds: ["mean_reversion_v0"], riskMultiplier: "1", dataQualityScore: 1, reasonCodes: [] },
    },
    signal, signals: [signal],
  };
  const openedAt = new Date("2026-01-01T00:00:00.000Z");
  const trade: TradeRow = {
    id: "scope-trade", organizationId, symbol: "BTC/USDT", venue: "mock", accountKey: "account-a",
    positionSide: "LONG", instrumentKind: "SPOT", strategySignalId: "scope-opening", strategyId: "mean_reversion_v0", strategyVersion: "0.1.0",
    state: "OPEN", semanticsVersion: "waia.trader.trade-lifecycle.v2", openedAt, closedAt: null,
    realizedPnl: "0", markedPnl: "0", hypothesisId: null, patternId: null, riskDecisionId: "scope-risk", allocationDecisionId: null,
    reasoningSessionId: null, signalConfidence: null, openingRegime: "RANGE", openingMsvId: "scope-opening-msv", openingFeatureSetId: "scope-opening-features",
    closingMsvId: null, closingFeatureSetId: null, closingRegime: null, frozenAt: null, createdAt: openedAt, updatedAt: openedAt,
  };
  const lot: PositionLotRow = {
    id: "scope-lot", organizationId, symbol: "BTC/USDT", venue: "mock", accountKey: "account-a", positionSide: "LONG", instrumentKind: "SPOT",
    strategySignalId: "scope-opening", state: "OPEN", openQty: "1", remainingQty: "1", avgCost: "64000", openedAt, closedAt: null,
    tradeId: trade.id, hedgeGroupId: null, targetLotId: null, createdAt: openedAt, updatedAt: openedAt,
  };
  return { input, evaluation, lot, trade };
}
