import { describe, expect, it } from "vitest";

import { decideGuardianAction, guardianReasonCodes, guardianRuleIds } from "@/lib/trader/guardian";

describe("decideGuardianAction (M3)", () => {
  const base = {
    tradingPermission: "ALLOW_TRADING" as const,
    allowedStrategyIds: ["mean_reversion_v0"],
    tradeStrategyId: "mean_reversion_v0",
    barsHeld: 1,
    maxHoldBars: 0,
  };

  it("exits on ONLY_CLOSE_POSITIONS", () => {
    const result = decideGuardianAction({
      ...base,
      tradingPermission: "ONLY_CLOSE_POSITIONS",
    });
    expect(result).toEqual({
      decision: "EXIT_FULL",
      reasonCode: guardianReasonCodes.closeOnlyPermission,
      ruleId: guardianRuleIds.closeOnlyPermission,
    });
  });

  it("exits on STOP_TRADING", () => {
    const result = decideGuardianAction({
      ...base,
      tradingPermission: "STOP_TRADING",
    });
    expect(result).toEqual({
      decision: "EXIT_FULL",
      reasonCode: guardianReasonCodes.stopTradingFlat,
      ruleId: guardianRuleIds.stopTradingWithOpenRisk,
    });
  });

  it("exits when strategy is disallowed", () => {
    const result = decideGuardianAction({
      ...base,
      allowedStrategyIds: ["trend_momentum_v0"],
    });
    expect(result).toEqual({
      decision: "EXIT_FULL",
      reasonCode: guardianReasonCodes.strategyDisallowed,
      ruleId: guardianRuleIds.strategyDisallowed,
    });
  });

  it("exits when max hold bars reached", () => {
    const result = decideGuardianAction({
      ...base,
      maxHoldBars: 5,
      barsHeld: 5,
    });
    expect(result).toEqual({
      decision: "EXIT_FULL",
      reasonCode: guardianReasonCodes.maxHoldBars,
      ruleId: guardianRuleIds.maxHoldBars,
    });
  });

  it("holds by default", () => {
    const result = decideGuardianAction(base);
    expect(result).toEqual({
      decision: "HOLD",
      reasonCode: guardianReasonCodes.hold,
      ruleId: guardianRuleIds.defaultHold,
    });
  });

  it("respects rule priority — close-only beats disallowed strategy", () => {
    const result = decideGuardianAction({
      ...base,
      tradingPermission: "ONLY_CLOSE_POSITIONS",
      allowedStrategyIds: [],
    });
    expect(result.ruleId).toBe(guardianRuleIds.closeOnlyPermission);
  });
});
