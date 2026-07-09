import type { HypothesisType } from "@/lib/trader/intelligence/hypothesis/hypothesis.types";

/**
 * Strategy-agnostic mapping from market hypothesis types to eligible strategy families.
 * No import of concrete strategy implementations (LSR-v1 is only one future consumer).
 */
export const STRATEGY_FAMILY_BY_HYPOTHESIS: Readonly<Record<HypothesisType, readonly string[]>> = {
  trend_continuation: ["trend_momentum", "breakout_follow"],
  reversal: ["reversal", "liquidity_sweep_reversal"],
  accumulation: ["range_accumulation", "mean_reversion"],
  distribution: ["range_distribution", "mean_reversion"],
  breakout: ["breakout_follow", "trend_momentum"],
  false_breakout: ["mean_reversion", "liquidity_sweep_reversal"],
  liquidity_sweep: ["liquidity_sweep_reversal", "reversal"],
  mean_reversion: ["mean_reversion", "range_reversion"],
};

export function resolveEligibleStrategyFamilies(hypothesisType: HypothesisType): readonly string[] {
  return STRATEGY_FAMILY_BY_HYPOTHESIS[hypothesisType];
}
