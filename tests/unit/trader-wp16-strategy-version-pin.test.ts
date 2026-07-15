import { describe, expect, it } from "vitest";

import {
  assertPinnedStrategyVersion,
  PINNED_STRATEGY_VERSIONS,
  resolvePinnedStrategyVersion,
  StrategyVersionPinError,
} from "@/lib/trader/intelligence/strategies/strategy-version-pin";
import {
  LIQUIDITY_SWEEP_REVERSAL_V0,
  LIQUIDITY_SWEEP_REVERSAL_V0_VERSION,
} from "@/lib/trader/intelligence/types";

describe("HTR-WP16 strategy version pin", () => {
  it("resolves exact registered versions", () => {
    expect(
      resolvePinnedStrategyVersion(
        LIQUIDITY_SWEEP_REVERSAL_V0,
        LIQUIDITY_SWEEP_REVERSAL_V0_VERSION,
      ),
    ).toEqual({
      strategyId: LIQUIDITY_SWEEP_REVERSAL_V0,
      strategyVersion: LIQUIDITY_SWEEP_REVERSAL_V0_VERSION,
    });
    expect(() =>
      assertPinnedStrategyVersion(LIQUIDITY_SWEEP_REVERSAL_V0, LIQUIDITY_SWEEP_REVERSAL_V0_VERSION),
    ).not.toThrow();
  });

  it("rejects unregistered version without alias fallback", () => {
    expect(() => resolvePinnedStrategyVersion(LIQUIDITY_SWEEP_REVERSAL_V0, "9.9.9")).toThrow(
      StrategyVersionPinError,
    );
    expect(PINNED_STRATEGY_VERSIONS).toHaveLength(3);
  });
});
