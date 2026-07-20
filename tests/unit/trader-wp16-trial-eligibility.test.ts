import { describe, expect, it } from "vitest";

import { evaluateStrategyTrialEligibility } from "@/lib/trader/intelligence/strategies/strategy-trial-eligibility";
import { HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1 } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import {
  MEAN_REVERSION_V0,
  MEAN_REVERSION_V0_VERSION,
  TREND_MOMENTUM_V0,
  TREND_MOMENTUM_V0_VERSION,
} from "@/lib/trader/intelligence/types";

describe("HTR-WP16 trial eligibility", () => {
  it("allows PAPER lifecycle for D-2 enabled consumer", () => {
    expect(
      evaluateStrategyTrialEligibility({
        strategyId: MEAN_REVERSION_V0,
        strategyVersion: MEAN_REVERSION_V0_VERSION,
        lifecycleState: "PAPER",
        historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
      }).eligible,
    ).toBe(true);
  });

  it("rejects RESEARCHING lifecycle", () => {
    const result = evaluateStrategyTrialEligibility({
      strategyId: TREND_MOMENTUM_V0,
      strategyVersion: TREND_MOMENTUM_V0_VERSION,
      lifecycleState: "RESEARCHING",
      historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
    });
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reasonCode).toBe("STRAT_TRIAL_NOT_ELIGIBLE");
    }
  });
});
