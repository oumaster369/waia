import { describe, expect, it } from "vitest";

import { classifyAbstentionOutcome } from "@/lib/trader/intelligence/outcome-resolution/score-abstention-outcome";
import { DECISION_RECORD_SCHEMA_VERSION } from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import type { TraderIntelligenceDecisionRecord } from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import { wp21Bars } from "./wp21-test-helpers";

function noTradeDecision(
  partial: Partial<TraderIntelligenceDecisionRecord> = {},
): TraderIntelligenceDecisionRecord {
  return {
    id: "00000000-0000-4000-8021-000000000040",
    organizationId: "org",
    cycleEnvelopeId: "00000000-0000-4000-8021-000000000041",
    convictionRecordId: "00000000-0000-4000-8021-000000000042",
    runId: "run",
    cycleId: "0",
    symbol: "BTC/USDT",
    evaluatedAt: "2024-01-01T00:00:00.000Z",
    issuedAt: "2024-01-01T00:00:00.000Z",
    decisionClass: "NO_TRADE",
    universalTerminalReasonCode: "NO_TRADE",
    whyNotCashJson: null,
    whyCashOrAbstainJson: "{}",
    grossExpectedReward: null,
    expectedFees: null,
    expectedSlippage: null,
    expectedOtherCosts: null,
    expectedRewardAfterCosts: null,
    costModelId: null,
    costModelVersion: null,
    costEvidenceState: "AVAILABLE",
    cdeMsvPermissionSnapshotJson: JSON.stringify({ regime: "TREND" }),
    reasonCodesJson: "[]",
    strategyId: null,
    strategyVersion: null,
    contentDigest: "a".repeat(64),
    schemaVersion: DECISION_RECORD_SCHEMA_VERSION,
    ...partial,
  };
}

describe("trader wp21 abstention scoring", () => {
  it("never penalizes safety-mandated abstentions", () => {
    const bars = wp21Bars({ count: 90, step: 1 });
    const result = classifyAbstentionOutcome({
      decision: noTradeDecision({
        reasonCodesJson: '["GUARDIAN_BLOCK"]',
        universalTerminalReasonCode: "GUARDIAN_HALT",
      }),
      forecastOutcome: null,
      pitWindow: {
        bars,
        asOf: bars.at(-1)!.barCloseTime,
        evidenceCutoffAt: bars.at(-1)!.barCloseTime,
      },
      scenarioSetJson: JSON.stringify({ expected_path: "continuation_higher" }),
      targetWindowStartAt: bars[0]!.barOpenTime,
      targetWindowEndAt: bars.at(-1)!.barCloseTime,
    });
    expect(result).toBe("SAFETY_MANDATED");
  });

  it("records missing net economics as fail-closed correct", () => {
    const bars = wp21Bars({ count: 10, step: 0 });
    const result = classifyAbstentionOutcome({
      decision: noTradeDecision({ costEvidenceState: "UNAVAILABLE" }),
      forecastOutcome: null,
      pitWindow: {
        bars,
        asOf: bars.at(-1)!.barCloseTime,
        evidenceCutoffAt: bars.at(-1)!.barCloseTime,
      },
      scenarioSetJson: JSON.stringify({ expected_path: "continuation_higher" }),
      targetWindowStartAt: bars[0]!.barOpenTime,
      targetWindowEndAt: bars.at(-1)!.barCloseTime,
    });
    expect(result).toBe("MISSING_NET_ECONOMICS");
  });
});
