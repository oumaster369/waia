import { describe, expect, it } from "vitest";

import { guardianReasonCodes } from "@/lib/trader/guardian";
import { GUARDIAN_REASON_RECORD_SCHEMA_VERSION } from "@/lib/trader/guardian/guardian-reason-record.types";
import type { GuardianReasonRecord } from "@/lib/trader/guardian/guardian-reason-record.types";
import {
  computeAnalyticalScores,
  computeExitPressureScore,
  computeRiskAlignmentScore,
} from "@/lib/trader/intelligence/m5/exit-intelligence-scores";
import type { MsvEnvelope } from "@/lib/trader/intelligence/types";

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
    regime: "RANGE",
    tradingPermission: "ALLOW_TRADING",
    remainingQty: "1",
    avgCost: "100",
    markPrice: "102",
    unrealizedPnlUsdt: "2",
    barsHeld: 3,
    slTpLevels: {
      stopLossPrice: "96",
      takeProfitPrice: "106",
      trailingStopPrice: null,
      atrUsdt: "2",
      trailingPhase: "INACTIVE",
    },
    rMultiple: null,
    invalidation: null,
    patternRefs: [],
    signalRefs: [],
    exitIntelligenceContext: null,
    ...overrides,
  };
}

function makeMsv(overrides?: Partial<MsvEnvelope["derived"]>): MsvEnvelope {
  return {
    msvId: "msv-1",
    instrumentId: "BTC/USDT",
    evaluatedAt: "2026-01-01T00:05:00.000Z",
    featureSetId: "fs-1",
    physics: { close: "102", zscoreVsSma20: "0", realizedVol20: "2" },
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
      ...overrides,
    },
  };
}

describe("exit intelligence scores (M5)", () => {
  it("bounds scores to 0..1", () => {
    const reason = makeReason();
    const msv = makeMsv();
    const regimeContext = {
      currentRegime: reason.regime,
      openingRegime: "RANGE" as const,
      regimeChanged: false,
      tradingPermission: reason.tradingPermission,
      msvReasonCodes: msv.derived.reasonCodes,
      eventRiskScore: msv.futureContext.eventRiskScore,
    };
    const layerSummary = {
      structuralExitTriggered: false,
      m4PriceExitRuleId: null,
      markToStopLossDistanceUsdt: "6",
      markToTakeProfitDistanceUsdt: "4",
      trailingPhase: null,
    };

    const scores = computeAnalyticalScores({
      reason,
      msv,
      regimeContext,
      layerSummary,
    });

    for (const score of Object.values(scores)) {
      expect(Number(score)).toBeGreaterThanOrEqual(0);
      expect(Number(score)).toBeLessThanOrEqual(1);
    }
  });

  it("sets exitPressureScore to 1 on EXIT_FULL", () => {
    const reason = makeReason({
      decision: "EXIT_FULL",
      reasonCode: guardianReasonCodes.closeOnlyPermission,
      ruleId: "CLOSE_ONLY_PERMISSION",
    });
    const score = computeExitPressureScore({
      reason,
      msv: makeMsv(),
      regimeContext: {
        currentRegime: "RANGE",
        openingRegime: "RANGE",
        regimeChanged: false,
        tradingPermission: "ONLY_CLOSE_POSITIONS",
        msvReasonCodes: [],
        eventRiskScore: "0",
      },
    });
    expect(score).toBe("1");
  });

  it("is byte-identical on replay", () => {
    const reason = makeReason();
    const msv = makeMsv();
    const first = computeRiskAlignmentScore({ reason });
    const second = computeRiskAlignmentScore({ reason });
    expect(first).toBe(second);
  });
});
