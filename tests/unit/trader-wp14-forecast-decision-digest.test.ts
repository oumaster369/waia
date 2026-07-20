import { describe, expect, it } from "vitest";
import { HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import { TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1_DIGEST } from "@/lib/trader/intelligence/matrix/timeframe-evidence-lane-authority-matrix-v1";
import { runWp14EvaluationCycle } from "./wp14-test-helpers";

describe("trader wp14 forecast decision digest", () => {
  it("binds profile and matrix digests", () => {
    const cycle = runWp14EvaluationCycle();
    for (const forecast of cycle.forecastDecisionBundle?.forecasts ?? []) {
      expect(forecast.historicalProfileDigest).toBe(HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST);
      expect(forecast.matrixDigest).toBe(TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1_DIGEST);
      expect(forecast.forecastKeyDigest).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(cycle.forecastDecisionBundle!.decision.contentDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is byte-identical across replay generations", () => {
    const one = runWp14EvaluationCycle();
    const two = runWp14EvaluationCycle();
    expect(one.forecastDecisionBundle).toEqual(two.forecastDecisionBundle);
  });
});
