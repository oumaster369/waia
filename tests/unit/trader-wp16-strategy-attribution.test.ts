import { describe, expect, it } from "vitest";

import {
  computeStrategyEquity,
  computeVirtualStrategyAllocations,
  FHV_V0_LSR_ALLOCATION_USDT,
  FHV_V0_MR_ALLOCATION_USDT,
  FHV_V0_TM_ALLOCATION_USDT,
} from "@/lib/trader/risk/strategy-attribution";
import {
  LIQUIDITY_SWEEP_REVERSAL_V0,
  LIQUIDITY_SWEEP_REVERSAL_V0_VERSION,
  MEAN_REVERSION_V0,
  MEAN_REVERSION_V0_VERSION,
  TREND_MOMENTUM_V0,
  TREND_MOMENTUM_V0_VERSION,
} from "@/lib/trader/intelligence/types";

describe("HTR-WP16 strategy attribution", () => {
  it("allocates FHV v0 equally to trade-eligible strategies", () => {
    const allocations = computeVirtualStrategyAllocations();
    expect(
      allocations[`${LIQUIDITY_SWEEP_REVERSAL_V0}@${LIQUIDITY_SWEEP_REVERSAL_V0_VERSION}`],
    ).toBe(FHV_V0_LSR_ALLOCATION_USDT);
    expect(allocations[`${MEAN_REVERSION_V0}@${MEAN_REVERSION_V0_VERSION}`]).toBe(
      FHV_V0_MR_ALLOCATION_USDT,
    );
    expect(allocations[`${TREND_MOMENTUM_V0}@${TREND_MOMENTUM_V0_VERSION}`]).toBe(
      FHV_V0_TM_ALLOCATION_USDT,
    );
  });

  it("computes strategy equity with costs attribution", () => {
    expect(
      computeStrategyEquity({
        allocationUsdt: "50000",
        cumulativeRealizedNetPnlUsdt: "1000",
        pointInTimeUnrealizedNetPnlUsdt: "500",
        attributableCostsUsdt: "200",
      }),
    ).toBe("51300");
  });
});
