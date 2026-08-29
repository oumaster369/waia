import { describe, expect, it } from "vitest";

import { buildMsvEnvelope, classifyRegime } from "@/lib/trader/intelligence/cde-v0";
import { evaluateTrendMomentumV0 } from "@/lib/trader/intelligence/strategies/trend-momentum-v0";
import {
  MEAN_REVERSION_V0,
  TREND_MOMENTUM_V0,
  trendMomentumReasonCodes,
  type FeatureSnapshot,
} from "@/lib/trader/intelligence/types";

function featureSnapshot(zscore: string): FeatureSnapshot {
  return {
    featureSetId: "fs-1",
    instrumentId: "BTC/USDT",
    evaluatedAt: "2026-01-01T00:00:00.000Z",
    dataQualityScore: 0.95,
    features: {
      close: "50000",
      sma20: "49000",
      zscoreVsSma20: zscore,
      priceDispersion20: "0.03",
      spreadBps: "5",
    },
    inputs: {
      barCount: 25,
      latestQuoteAgeMs: 100,
    },
  };
}

describe("trend momentum v0", () => {
  it("emits buy on positive momentum in bull regime", () => {
    const features = featureSnapshot("2.5");
    const msv = buildMsvEnvelope({ features, newId: () => "msv-1" });
    const signal = evaluateTrendMomentumV0(msv, features, {
      organizationId: "org-1",
      newId: () => "sig-1",
    });
    expect(signal.outcome).toBe("SIGNAL");
    expect(signal.side).toBe("buy");
    expect(signal.reasonCodes).toContain(trendMomentumReasonCodes.momentumEntry);
  });

  it("stays flat in bear regime", () => {
    const features = featureSnapshot("-2.5");
    expect(classifyRegime(features)).toBe("TREND_BEAR");
    const msv = buildMsvEnvelope({ features, newId: () => "msv-2" });
    expect(msv.derived.allowedStrategyIds).not.toContain(TREND_MOMENTUM_V0);
    const signal = evaluateTrendMomentumV0(msv, features, {
      organizationId: "org-1",
      newId: () => "sig-2",
    });
    expect(signal.outcome).toBe("NO_SIGNAL");
  });

  it("regime-gates mean reversion out of bull trend", () => {
    const features = featureSnapshot("2.5");
    const msv = buildMsvEnvelope({ features, newId: () => "msv-3" });
    expect(msv.derived.allowedStrategyIds).toContain(TREND_MOMENTUM_V0);
    expect(msv.derived.allowedStrategyIds).not.toContain(MEAN_REVERSION_V0);
  });
});
