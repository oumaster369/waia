import { describe, expect, it } from "vitest";
import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import { HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1 } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import { createDeterministicReplayIdFactory } from "@/lib/trader/research/deterministic-replay-id-factory";
import type { Bar } from "@/lib/trader/intelligence/types";

const bars: Bar[] = Array.from({ length: 80 }, (_, i) => ({
  symbol: "BTC/USDT",
  interval: "1m" as const,
  open: "100",
  high: "101",
  low: "99",
  close: "100",
  volume: "1",
  barOpenTime: new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString(),
  barCloseTime: new Date(Date.UTC(2024, 0, 1, 0, i + 1)).toISOString(),
}));

describe("trader wp13 chain integration", () => {
  it("links envelope, hypotheses and conviction in one bundle", () => {
    const cycle = runEvaluationCycle({
      organizationId: "org",
      bars,
      historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
      runId: "run",
      cycleId: "0",
      newId: createDeterministicReplayIdFactory(415_130),
    });
    const bundle = cycle.intelligenceCycleBundle!;
    expect(bundle.envelope.id).toBeTruthy();
    expect(bundle.conviction.cycleEnvelopeId).toBe(bundle.envelope.id);
    for (const hypothesis of bundle.hypotheses) {
      expect(hypothesis.cycleEnvelopeId).toBe(bundle.envelope.id);
    }
  });
});
