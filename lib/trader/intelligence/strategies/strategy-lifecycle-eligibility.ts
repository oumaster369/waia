import { isStrategyLifecycleTradeEligible as isLifecycleStateTradeEligible } from "@/lib/trader/intelligence/strategies/strategy-lifecycle-transition-validator";
import type { StrategyLifecycleState } from "@/lib/trader/intelligence/strategies/strategy-lifecycle.types";

export function isStrategyLifecycleTradeEligible(state: StrategyLifecycleState): boolean {
  return isLifecycleStateTradeEligible(state);
}
