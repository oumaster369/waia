import { describe, expect, it } from "vitest";

import { evaluateStrategyEligibilityGate } from "@/lib/trader/intelligence/strategies/strategy-eligibility-gate";
import {
  MEAN_REVERSION_V0,
  MEAN_REVERSION_V0_VERSION,
  type StrategySignal,
} from "@/lib/trader/intelligence/types";

describe("HTR-WP16 entry-purpose version", () => {
  it("rejects entry-purpose version mismatch", () => {
    const signal: StrategySignal = {
      strategySignalId: "sig",
      strategyId: MEAN_REVERSION_V0,
      strategyVersion: MEAN_REVERSION_V0_VERSION,
      organizationId: "org",
      symbol: "BTC/USDT",
      outcome: "SIGNAL",
      side: "buy",
      msvId: "msv",
      featureSetId: "fs",
      reasonCodes: [],
      evaluatedAt: "2026-01-01T00:00:00.000Z",
    };
    const result = evaluateStrategyEligibilityGate({
      signal,
      lifecycleState: "PAPER",
      entryPurposeStrategyVersion: "9.9.9",
      skipTrialGate: true,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasonCodes).toContain("STRAT_ENTRY_PURPOSE_VERSION_MISMATCH");
  });
});
