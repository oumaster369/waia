import { isHistoricalProfileActive } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import type { HistoricalIntelligenceProfile } from "@/lib/trader/intelligence/historical-profile/historical-profile.types";
import { isStrategyLifecycleTradeEligible } from "@/lib/trader/intelligence/strategies/strategy-lifecycle-eligibility";
import type { StrategyLifecycleState } from "@/lib/trader/intelligence/strategies/strategy-lifecycle.types";
import { assertPinnedStrategyVersion } from "@/lib/trader/intelligence/strategies/strategy-version-pin";

export const strategyTrialReasonCodes = {
  notEligible: "STRAT_TRIAL_NOT_ELIGIBLE",
} as const;

export type StrategyTrialEligibilityResult =
  | { eligible: true }
  | { eligible: false; reasonCode: typeof strategyTrialReasonCodes.notEligible };

export function isD2EnabledHistoricalConsumer(
  strategyId: string,
  profile?: HistoricalIntelligenceProfile,
): boolean {
  if (!profile || !isHistoricalProfileActive(profile)) {
    return true;
  }
  const enabled = profile.strategyConsumerPolicy.enabledHistoricalConsumers as readonly string[];
  return enabled.includes(strategyId);
}

export function evaluateStrategyTrialEligibility(input: {
  strategyId: string;
  strategyVersion: string;
  lifecycleState: StrategyLifecycleState;
  historicalProfile?: HistoricalIntelligenceProfile;
}): StrategyTrialEligibilityResult {
  try {
    assertPinnedStrategyVersion(input.strategyId, input.strategyVersion);
  } catch {
    return { eligible: false, reasonCode: strategyTrialReasonCodes.notEligible };
  }

  if (!isStrategyLifecycleTradeEligible(input.lifecycleState)) {
    return { eligible: false, reasonCode: strategyTrialReasonCodes.notEligible };
  }

  if (!isD2EnabledHistoricalConsumer(input.strategyId, input.historicalProfile)) {
    return { eligible: false, reasonCode: strategyTrialReasonCodes.notEligible };
  }

  return { eligible: true };
}
