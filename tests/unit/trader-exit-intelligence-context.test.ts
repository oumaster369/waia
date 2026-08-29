import { describe, expect, it } from "vitest";

import { guardianReasonCodes } from "@/lib/trader/guardian";
import { GUARDIAN_REASON_RECORD_SCHEMA_VERSION } from "@/lib/trader/guardian/guardian-reason-record.types";
import type { GuardianReasonRecord } from "@/lib/trader/guardian/guardian-reason-record.types";
import { buildExitIntelligenceContext } from "@/lib/trader/intelligence/m5/exit-intelligence-context";
import { EXIT_INTELLIGENCE_CONTEXT_SCHEMA_VERSION } from "@/lib/trader/intelligence/m5/exit-intelligence-types";
import type { MsvEnvelope } from "@/lib/trader/intelligence/types";
import type { TradeRow } from "@/lib/trader/lifecycle/trade-lifecycle.types";
import { TRADE_LIFECYCLE_SEMANTICS_VERSION_V2 } from "@/lib/trader/lifecycle/trade-lifecycle-semantics";

function makeReason(overrides?: Partial<GuardianReasonRecord>): GuardianReasonRecord {
  return {
    schemaVersion: GUARDIAN_REASON_RECORD_SCHEMA_VERSION,
    decision: "HOLD",
    reasonCode: guardianReasonCodes.hold,
    ruleId: "DEFAULT_HOLD",
    cycleId: "cycle-1",
    evaluatedAt: "2026-01-01T00:05:00.000Z",
    symbol: "BTC/USDT",
    positionLotId: "lot-1",
    tradeId: "trade-1",
    strategyId: "mean_reversion_v0",
    openingStrategySignalId: "signal-1",
    regime: "TREND_BULL",
    tradingPermission: "ALLOW_TRADING",
    remainingQty: "1",
    avgCost: "100",
    markPrice: "102",
    unrealizedPnlUsdt: "2",
    barsHeld: 3,
    slTpLevels: null,
    rMultiple: null,
    invalidation: null,
    patternRefs: [],
    signalRefs: [],
    exitIntelligenceContext: null,
    ...overrides,
  };
}

function makeTrade(): TradeRow {
  return {
    id: "trade-1",
    organizationId: "org-1",
    symbol: "BTC/USDT",
    venue: "mock",
    accountKey: "paper",
    positionSide: "LONG",
    instrumentKind: "SPOT",
    strategySignalId: "signal-1",
    strategyId: "mean_reversion_v0",
    strategyVersion: "0.1.0",
    state: "OPEN",
    semanticsVersion: TRADE_LIFECYCLE_SEMANTICS_VERSION_V2,
    openedAt: new Date("2026-01-01T00:00:00.000Z"),
    closedAt: null,
    realizedPnl: "0",
    markedPnl: "0",
    hypothesisId: null,
    patternId: null,
    riskDecisionId: "risk-1",
    allocationDecisionId: null,
    reasoningSessionId: null,
    signalConfidence: null,
    openingRegime: "RANGE",
    openingMsvId: "msv-1",
    openingFeatureSetId: "fs-1",
    closingMsvId: null,
    closingFeatureSetId: null,
    closingRegime: null,
    frozenAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function makeMsv(): MsvEnvelope {
  return {
    msvId: "msv-1",
    instrumentId: "BTC/USDT",
    evaluatedAt: "2026-01-01T00:05:00.000Z",
    featureSetId: "fs-1",
    physics: { close: "102", zscoreVsSma20: "0", priceDispersion20: "2" },
    liquidity: { spreadBps: "1" },
    crowd: { fearGreedIndex: null, newsSentiment: "neutral" },
    futureContext: { eventRiskScore: "0.2" },
    derived: {
      regime: "TREND_BULL",
      tradingPermission: "ALLOW_TRADING",
      allowedStrategyIds: ["mean_reversion_v0"],
      riskMultiplier: "1",
      dataQualityScore: 0.9,
      reasonCodes: ["CDE_REGIME_RANGE"],
    },
  };
}

describe("buildExitIntelligenceContext (M5)", () => {
  it("builds deterministic context from assembled reason record", () => {
    const reason = makeReason();
    const input = {
      reason,
      trade: makeTrade(),
      msv: makeMsv(),
      signals: [],
    };

    expect(buildExitIntelligenceContext(input)).toEqual(buildExitIntelligenceContext(input));
  });

  it("copies guardian outcome and M4 levels without recomputation", () => {
    const reason = makeReason({
      slTpLevels: {
        stopLossPrice: "96",
        takeProfitPrice: "106",
        trailingStopPrice: "100",
        atrUsdt: "2",
        trailingPhase: "ARMED",
      },
    });

    const context = buildExitIntelligenceContext({
      reason,
      trade: makeTrade(),
      msv: makeMsv(),
    });

    expect(context.schemaVersion).toBe(EXIT_INTELLIGENCE_CONTEXT_SCHEMA_VERSION);
    expect(context.guardianOutcome).toEqual({
      decision: "HOLD",
      reasonCode: guardianReasonCodes.hold,
      ruleId: "DEFAULT_HOLD",
    });
    expect(context.m4Levels).toEqual(reason.slTpLevels);
    expect(context.regimeContext.regimeChanged).toBe(true);
  });

  it("uses non-imperative explanation text", () => {
    const context = buildExitIntelligenceContext({
      reason: makeReason(),
      trade: makeTrade(),
      msv: makeMsv(),
    });

    expect(context.explanation.toLowerCase()).not.toContain("should exit");
    expect(context.explanation.toLowerCase()).not.toContain("must exit");
    expect(context.explanation).toContain("exitPressure=");
  });
});
