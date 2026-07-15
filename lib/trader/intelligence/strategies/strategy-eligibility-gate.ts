import { isResearchOnlyStrategyForProfile } from "@/lib/trader/intelligence/strategies/registry";
import { strategyLifecycleReasonCodes } from "@/lib/trader/intelligence/strategies/strategy-lifecycle-transition-validator";
import { isStrategyLifecycleTradeEligible } from "@/lib/trader/intelligence/strategies/strategy-lifecycle-eligibility";
import type { StrategyLifecycleState } from "@/lib/trader/intelligence/strategies/strategy-lifecycle.types";
import {
  evaluateStrategyTrialEligibility,
  isD2EnabledHistoricalConsumer,
  strategyTrialReasonCodes,
} from "@/lib/trader/intelligence/strategies/strategy-trial-eligibility";
import {
  assertPinnedStrategyVersion,
  StrategyVersionPinError,
} from "@/lib/trader/intelligence/strategies/strategy-version-pin";
import type { HistoricalIntelligenceProfile } from "@/lib/trader/intelligence/historical-profile/historical-profile.types";
import type { StrategySignal } from "@/lib/trader/intelligence/types";

export const strategyEligibilityGateOrder = [
  "version_pin",
  "lifecycle",
  "trial",
  "d2_consumer",
  "entry_purpose_version",
] as const;

export type StrategyEligibilityGateName = (typeof strategyEligibilityGateOrder)[number];

export type StrategyEligibilityResult = {
  eligible: boolean;
  reasonCodes: string[];
  failedGate: StrategyEligibilityGateName | null;
  gateOrder: readonly StrategyEligibilityGateName[];
};

export function evaluateStrategyEligibilityGate(input: {
  signal: StrategySignal;
  lifecycleState: StrategyLifecycleState;
  historicalProfile?: HistoricalIntelligenceProfile;
  entryPurposeStrategyVersion?: string | null;
  skipTrialGate?: boolean;
}): StrategyEligibilityResult {
  const reasonCodes: string[] = [];
  const gateOrder = strategyEligibilityGateOrder;

  try {
    assertPinnedStrategyVersion(input.signal.strategyId, input.signal.strategyVersion);
  } catch (error) {
    const code =
      error instanceof StrategyVersionPinError ? error.code : "STRAT_VERSION_NOT_REGISTERED";
    return {
      eligible: false,
      reasonCodes: [code],
      failedGate: "version_pin",
      gateOrder,
    };
  }

  if (!isStrategyLifecycleTradeEligible(input.lifecycleState)) {
    return {
      eligible: false,
      reasonCodes: [strategyLifecycleReasonCodes.notEligible],
      failedGate: "lifecycle",
      gateOrder,
    };
  }

  if (!input.skipTrialGate) {
    const trial = evaluateStrategyTrialEligibility({
      strategyId: input.signal.strategyId,
      strategyVersion: input.signal.strategyVersion,
      lifecycleState: input.lifecycleState,
      historicalProfile: input.historicalProfile,
    });
    if (!trial.eligible) {
      return {
        eligible: false,
        reasonCodes: [trial.reasonCode],
        failedGate: "trial",
        gateOrder,
      };
    }
  }

  if (
    isResearchOnlyStrategyForProfile(input.signal.strategyId, input.historicalProfile) ||
    !isD2EnabledHistoricalConsumer(input.signal.strategyId, input.historicalProfile)
  ) {
    return {
      eligible: false,
      reasonCodes: ["STRAT_TM_STRATEGY_NOT_ALLOWED"],
      failedGate: "d2_consumer",
      gateOrder,
    };
  }

  if (
    input.entryPurposeStrategyVersion != null &&
    input.entryPurposeStrategyVersion !== input.signal.strategyVersion
  ) {
    return {
      eligible: false,
      reasonCodes: ["STRAT_ENTRY_PURPOSE_VERSION_MISMATCH"],
      failedGate: "entry_purpose_version",
      gateOrder,
    };
  }

  return {
    eligible: true,
    reasonCodes,
    failedGate: null,
    gateOrder,
  };
}

export function projectIneligibleSignal(
  signal: StrategySignal,
  reasonCodes: string[],
): StrategySignal {
  return {
    ...signal,
    researchEvaluationOutcome: signal.researchEvaluationOutcome ?? signal.outcome,
    tradeEligible: false,
    outcome: "NO_SIGNAL",
    reasonCodes: [...(signal.reasonCodes ?? []), ...reasonCodes],
  };
}
