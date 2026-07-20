import { describe, expect, it } from "vitest";

import {
  evaluateStrategyEligibilityGate,
  strategyEligibilityGateOrder,
} from "@/lib/trader/intelligence/strategies/strategy-eligibility-gate";
import { HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1 } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import {
  LIQUIDITY_SWEEP_REVERSAL_V0,
  LIQUIDITY_SWEEP_REVERSAL_V0_VERSION,
  TREND_MOMENTUM_V0,
  TREND_MOMENTUM_V0_VERSION,
  type StrategySignal,
} from "@/lib/trader/intelligence/types";

function signal(strategyId: string, strategyVersion: string): StrategySignal {
  return {
    strategySignalId: "sig-1",
    strategyId: strategyId as StrategySignal["strategyId"],
    strategyVersion,
    organizationId: "org",
    symbol: "BTC/USDT",
    outcome: "SIGNAL",
    side: "buy",
    msvId: "msv",
    featureSetId: "fs",
    reasonCodes: [],
    evaluatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("HTR-WP16 eligibility gate order", () => {
  it("enforces gate order version_pin before lifecycle", () => {
    expect(strategyEligibilityGateOrder[0]).toBe("version_pin");
    expect(strategyEligibilityGateOrder[1]).toBe("lifecycle");
    const result = evaluateStrategyEligibilityGate({
      signal: signal(LIQUIDITY_SWEEP_REVERSAL_V0, "9.9.9"),
      lifecycleState: "PAPER",
      historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
    });
    expect(result.eligible).toBe(false);
    expect(result.failedGate).toBe("version_pin");
  });

  it("blocks research-only TM at D-2 consumer gate", () => {
    const result = evaluateStrategyEligibilityGate({
      signal: signal(TREND_MOMENTUM_V0, TREND_MOMENTUM_V0_VERSION),
      lifecycleState: "RESEARCHING",
      historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
      skipTrialGate: true,
    });
    expect(result.eligible).toBe(false);
    expect(result.failedGate).toBe("lifecycle");
  });

  it("passes LSR at exact registered version in PAPER", () => {
    const result = evaluateStrategyEligibilityGate({
      signal: signal(LIQUIDITY_SWEEP_REVERSAL_V0, LIQUIDITY_SWEEP_REVERSAL_V0_VERSION),
      lifecycleState: "PAPER",
      historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
      skipTrialGate: true,
    });
    expect(result.eligible).toBe(true);
  });
});
