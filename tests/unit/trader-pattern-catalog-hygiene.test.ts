import { describe, expect, it } from "vitest";

import {
  buildDescriptiveUntestedPatternHypothesis,
  resolvePointInTimeCycle,
  runPatternCatalogPass,
} from "@/lib/trader/mi/pattern-catalog-pass";
import { PATTERN_CATALOG_HYPOTHESIS_STATUS } from "@/lib/trader/mi/pattern-catalog.types";
import type { MiPattern } from "@/lib/trader/mi/pattern.types";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

function cycle(
  evaluatedAt: string,
  features: { zscore: string; dispersion: string; eventRisk: string },
): PaperCycleResult {
  return {
    evaluation: {
      msv: {
        msvId: `msv-${evaluatedAt}`,
        instrumentId: "BTC/USDT",
        evaluatedAt,
        featureSetId: "fs-1",
        physics: {
          close: "100",
          zscoreVsSma20: features.zscore,
          priceDispersion20: features.dispersion,
        },
        liquidity: { spreadBps: "1" },
        crowd: { fearGreedIndex: null, newsSentiment: "neutral" },
        futureContext: { eventRiskScore: features.eventRisk },
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
        features: {
          close: "100",
          zscoreVsSma20: features.zscore,
          priceDispersion20: features.dispersion,
        },
      },
      signals: [],
    },
    strategyExecutions: [],
    submitBlocked: false,
    execution: null,
    reconciliation: null,
    guardianExecutions: [],
  } as unknown as PaperCycleResult;
}

function pattern(): MiPattern {
  return {
    id: "pattern-1",
    organizationId: "org-1",
    patternKind: "recurring_structure",
    patternKey: "range-dip",
    name: "Range dip",
    schemaVersion: "mi-pattern-v1",
    definitionJson: JSON.stringify({
      measurements: [{ measurementKey: "zscore", measurementDefinitionDigest: "ab".repeat(32) }],
      recurrence: {
        description: "Large absolute z-score",
        params: { zscoreAbsMin: 1, volMin: 0.5, eventRiskMax: 0.8 },
      },
    }),
    definitionDigest: "cd".repeat(32),
    structuralSignature: "sig",
    trialBudgetMax: 1,
    versionSeq: 1,
    revisionOf: null,
    authoredBy: "test",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

describe("pattern catalog scientific hygiene", () => {
  it("uses the latest cycle at or before the subject and ignores a closer future cycle", () => {
    const matching = { zscore: "2.5", dispersion: "1.2", eventRisk: "0.2" };
    const quiet = { zscore: "0.1", dispersion: "0.1", eventRisk: "2" };
    const early = cycle("2026-01-01T00:00:00.000Z", matching);
    const later = cycle("2026-01-01T00:10:00.000Z", quiet);
    const subject = new Date("2026-01-01T00:09:00.000Z");
    expect(resolvePointInTimeCycle([later, early], subject)).toBe(early);
    expect(resolvePointInTimeCycle([later], subject)).toBeNull();
  });

  it("emits descriptive untested hypotheses and does not write evidence rows", async () => {
    const matching = { zscore: "2.5", dispersion: "1.2", eventRisk: "0.2" };
    const quiet = { zscore: "0.1", dispersion: "0.1", eventRisk: "2" };
    const early = cycle("2026-01-01T00:00:00.000Z", matching);
    const later = cycle("2026-01-01T00:10:00.000Z", quiet);
    const tradeAt = new Date("2026-01-01T00:09:00.000Z");
    const result = await runPatternCatalogPass({
      context: { organizationId: "org-1" } as OrgContext,
      ex: {} as never,
      patterns: [pattern()],
      cycleResults: [early, later],
      closedTrades: [
        {
          fillId: "fill-1",
          orderId: "order-1",
          symbol: "BTC/USDT",
          executedAt: tradeAt,
          quantity: "1",
          price: "100",
          tradePnl: "1",
        },
      ],
    });

    expect(result.scoreRowsWritten).toBe(0);
    expect(result.explanationRowsWritten).toBe(0);
    expect(result.edgeRowsWritten).toBe(0);
    expect(result.hypotheses).toHaveLength(1);
    expect(result.hypotheses[0]).toEqual({
      status: "candidate",
      dataUse: "used_for_discovery",
      patternKey: "range-dip",
      subjectRef: "close:order:order-1",
      symbol: "BTC/USDT",
      evaluatedAt: tradeAt.toISOString(),
      statement:
        "Candidate hypothesis. Discovery data is used_for_discovery and is not IS evidence.",
    });
    expect(result.hypotheses[0]?.status).toBe(PATTERN_CATALOG_HYPOTHESIS_STATUS);
    expect(result.hypotheses[0]).not.toHaveProperty("confidenceMean");
    expect(result.hypotheses[0]).not.toHaveProperty("edge");

    const lookahead = await runPatternCatalogPass({
      context: { organizationId: "org-1" } as OrgContext,
      ex: {} as never,
      patterns: [pattern()],
      cycleResults: [
        cycle("2026-01-01T00:00:00.000Z", quiet),
        cycle("2026-01-01T00:10:00.000Z", matching),
      ],
      closedTrades: [
        {
          fillId: "fill-2",
          orderId: "order-2",
          symbol: "BTC/USDT",
          executedAt: tradeAt,
          quantity: "1",
          price: "100",
          tradePnl: "-1",
        },
      ],
    });
    expect(lookahead.hypotheses).toEqual([]);

    const built = buildDescriptiveUntestedPatternHypothesis({
      pattern: pattern(),
      subject: {
        kind: "close",
        subjectRef: "close:order:order-1",
        symbol: "BTC/USDT",
        evaluatedAt: tradeAt.toISOString(),
        regime: "RANGE",
        priceMoveUsdt: "1",
        outcomeTag: "supporting",
      },
    });
    expect(built.status).toBe("candidate");
    expect(built.dataUse).toBe("used_for_discovery");
  });
});
