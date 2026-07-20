import { describe, expect, it } from "vitest";
import { evaluateRegisteredStrategies } from "@/lib/trader/intelligence/strategies/registry";
import { HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1 } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import { TREND_MOMENTUM_V0 } from "@/lib/trader/intelligence/types";
import { buildMsvEnvelope } from "@/lib/trader/intelligence/cde-v0";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import { createDeterministicReplayIdFactory } from "@/lib/trader/research/deterministic-replay-id-factory";
import type { Bar } from "@/lib/trader/intelligence/types";

const bars: Bar[] = Array.from({ length: 80 }, (_, i) => ({
  symbol: "BTC/USDT",
  interval: "1m" as const,
  open: "100",
  high: "101",
  low: "99",
  close: String(100 + i * 0.1),
  volume: "1",
  barOpenTime: new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString(),
  barCloseTime: new Date(Date.UTC(2024, 0, 1, 0, i + 1)).toISOString(),
}));

describe("trader wp13 research trade eligibility", () => {
  it("preserves research evaluation separately from trade eligibility", () => {
    const newId = createDeterministicReplayIdFactory(415_131);
    const features = computeFeatureSnapshot({
      bars,
      evaluatedAt: bars.at(-1)!.barCloseTime,
      newId,
    });
    const msv = buildMsvEnvelope({ features, miCoreEnabled: true, newId });
    const signals = evaluateRegisteredStrategies(msv, features, {
      organizationId: "org",
      bars,
      newId,
      historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
    });
    const trendMomentum = signals.find((signal) => signal.strategyId === TREND_MOMENTUM_V0);
    expect(trendMomentum).toBeDefined();
    expect(trendMomentum?.tradeEligible).toBe(false);
    expect(trendMomentum?.outcome).toBe("NO_SIGNAL");
    expect(trendMomentum?.researchEvaluationOutcome).toBeDefined();
    expect(trendMomentum?.reasonCodes.length).toBeGreaterThan(0);
  });
});
