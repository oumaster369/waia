import { describe, expect, it } from "vitest";

import type { GuardianReasonRecord } from "@/lib/trader/guardian/guardian-reason-record.types";
import { GUARDIAN_REASON_RECORD_SCHEMA_VERSION } from "@/lib/trader/guardian/guardian-reason-record.types";
import type { GuardianCycleResult } from "@/lib/trader/guardian/guardian.types";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";
import { buildM9GuardianReasonSampleExport } from "@/lib/trader/research/m9-guardian-sample-export";

function sampleReason(cycleId: string): GuardianReasonRecord {
  return {
    schemaVersion: GUARDIAN_REASON_RECORD_SCHEMA_VERSION,
    decision: "HOLD",
    reasonCode: "GUARDIAN_HOLD",
    ruleId: "default_hold",
    cycleId,
    evaluatedAt: "2026-01-01T00:00:00.000Z",
    symbol: "BTC/USDT",
    positionLotId: "lot-1",
    tradeId: "trade-1",
    strategyId: "mean_reversion_v0",
    openingStrategySignalId: "mean_reversion_v0",
    regime: "RANGE",
    tradingPermission: "ALLOW_TRADING",
    remainingQty: "0.01",
    avgCost: "65000",
    markPrice: "65000",
    unrealizedPnlUsdt: "0",
    barsHeld: 1,
    slTpLevels: {
      stopLossPrice: "64000",
      takeProfitPrice: "67000",
      trailingStopPrice: null,
      atrUsdt: "100",
      trailingPhase: "INACTIVE",
    },
    rMultiple: null,
    invalidation: null,
    patternRefs: [],
    signalRefs: [],
    exitIntelligenceContext: null,
  };
}

function cycleWithGuardian(cycleId: string): PaperCycleResult {
  const guardian: GuardianCycleResult = {
    evaluations: [
      {
        evaluationId: "eval-1",
        positionLotId: "lot-1",
        tradeId: "trade-1",
        symbol: "BTC/USDT",
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.0",
        openingStrategySignalId: "mean_reversion_v0",
        decision: "HOLD",
        reason: sampleReason(cycleId),
        occurredAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    exitIntents: [],
  };

  return {
    evaluation: {
      msv: {
        evaluatedAt: "2026-01-01T00:00:00.000Z",
        derived: { regime: "RANGE", tradingPermission: "ALLOW_TRADING" },
      },
      features: {},
      signals: [],
      signal: null,
    } as unknown as PaperCycleResult["evaluation"],
    strategyExecutions: [],
    submitBlocked: false,
    execution: null,
    reconciliation: null,
    guardian,
  };
}

describe("M9 guardian reason sample export", () => {
  it("collects capped reason records from validation cycles", () => {
    const exportDoc = buildM9GuardianReasonSampleExport({
      organizationId: "org-1",
      strategyId: "mean_reversion_v0",
      strategyVersion: "0.1.0",
      cycleResults: [cycleWithGuardian("cycle-1"), cycleWithGuardian("cycle-2")],
      maxSamples: 1,
    });

    expect(exportDoc.sampleCount).toBe(1);
    expect(exportDoc.cyclesWithGuardian).toBe(2);
    expect(exportDoc.cyclesWithSlTpLevels).toBe(2);
    expect(exportDoc.reasonRecords[0]?.slTpLevels?.stopLossPrice).toBe("64000");
  });
});
