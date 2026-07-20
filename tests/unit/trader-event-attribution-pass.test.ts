import { describe, expect, it } from "vitest";

import { extractEventAttributionSubjects } from "@/lib/trader/events/event-attribution-pass";
import { eventClassificationKinds } from "@/lib/trader/events/event-classification-kinds";
import type { NormalizedEventRecord } from "@/lib/trader/events/event-attribution.types";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";

function makeCycle(overrides?: Partial<PaperCycleResult>): PaperCycleResult {
  return {
    evaluation: {
      msv: {
        msvId: "msv-1",
        instrumentId: "BTC/USDT",
        evaluatedAt: "2026-01-01T12:00:00.000Z",
        featureSetId: "fs-1",
        physics: { close: "100", zscoreVsSma20: "1.2", realizedVol20: "1.5" },
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
      features: {
        features: { close: "100", zscoreVsSma20: "1.2", realizedVol20: "1.5" },
      },
      signals: [],
    },
    strategyExecutions: [],
    submitBlocked: false,
    skipReason: undefined,
    execution: null,
    reconciliation: null,
    guardian: undefined,
    guardianExecutions: [],
    ...overrides,
  } as PaperCycleResult;
}

describe("event attribution pass subjects (M7)", () => {
  it("extracts price window and linked subjects", () => {
    const event: NormalizedEventRecord = {
      eventKey: "evt-vol",
      sourceRef: "fixture:vol",
      eventTime: "2026-01-01T12:00:00.000Z",
      symbolScope: "BTC/USDT",
      payloadJson: JSON.stringify({ metadata: { kindHint: "volatility_spike" } }),
      contentDigest: "digest-vol",
    };

    const cycle = makeCycle({
      strategyExecutions: [
        {
          signal: {
            organizationId: "org-1",
            strategySignalId: "sig-1",
            symbol: "BTC/USDT",
            strategyId: "mean_reversion_v0",
            strategyVersion: "0.1.0",
            outcome: "SIGNAL",
            reasonCodes: [],
            msvId: "msv-1",
            featureSetId: "fs-1",
            evaluatedAt: "2026-01-01T12:00:00.000Z",
          },
          submitBlocked: true,
          skipReason: "no_submit",
          execution: null,
          reconciliation: null,
        },
      ],
    });

    const subjects = extractEventAttributionSubjects({
      event,
      classificationKind: eventClassificationKinds.volatilitySpike,
      cycleResults: [cycle],
      closedTrades: [
        {
          fillId: "fill-1",
          orderId: "order-1",
          symbol: "BTC/USDT",
          executedAt: new Date("2026-01-01T12:00:00.000Z"),
          quantity: "1",
          price: "101",
          tradePnl: "1",
        },
      ],
    });

    expect(subjects.some((s) => s.kind === "price_window")).toBe(true);
    expect(
      subjects.some((s) => s.kind === "rejection" && s.subjectRef === "signal:sig-1:rejected"),
    ).toBe(true);
    expect(
      subjects.every((s) => ["supporting", "contradicting", "neutral"].includes(s.outcomeTag)),
    ).toBe(true);
  });
});
