import { guardianReasonCodes, guardianRuleIds } from "@/lib/trader/guardian/guardian-reason-codes";
import type {
  GuardianRuleInput,
  GuardianRuleOutcome,
  GuardianRuleProvider,
} from "@/lib/trader/guardian/guardian-rule-provider.types";
import type { GuardianDecision } from "@/lib/trader/guardian/guardian.types";
import type { TradingPermission } from "@/lib/trader/intelligence/types";

export type DecideGuardianActionInput = {
  tradingPermission: TradingPermission;
  allowedStrategyIds: readonly string[];
  tradeStrategyId: string;
  barsHeld: number;
  maxHoldBars?: number;
  ruleProviders?: readonly GuardianRuleProvider[];
  ruleInput?: GuardianRuleInput;
};

export type DecideGuardianActionResult = {
  decision: GuardianDecision;
  reasonCode: string;
  ruleId: string;
  partialExitFraction?: string;
};

export function decideGuardianAction(input: DecideGuardianActionInput): DecideGuardianActionResult {
  const { tradingPermission, allowedStrategyIds, tradeStrategyId, barsHeld, maxHoldBars } = input;

  if (tradingPermission === "ONLY_CLOSE_POSITIONS") {
    return {
      decision: "EXIT_FULL",
      reasonCode: guardianReasonCodes.closeOnlyPermission,
      ruleId: guardianRuleIds.closeOnlyPermission,
    };
  }

  if (tradingPermission === "STOP_TRADING") {
    return {
      decision: "EXIT_FULL",
      reasonCode: guardianReasonCodes.stopTradingFlat,
      ruleId: guardianRuleIds.stopTradingWithOpenRisk,
    };
  }

  if (!allowedStrategyIds.includes(tradeStrategyId)) {
    return {
      decision: "EXIT_FULL",
      reasonCode: guardianReasonCodes.strategyDisallowed,
      ruleId: guardianRuleIds.strategyDisallowed,
    };
  }

  if (maxHoldBars !== undefined && maxHoldBars > 0 && barsHeld >= maxHoldBars) {
    return {
      decision: "EXIT_FULL",
      reasonCode: guardianReasonCodes.maxHoldBars,
      ruleId: guardianRuleIds.maxHoldBars,
    };
  }

  const providers = input.ruleProviders ?? [];
  if (input.ruleInput) {
    for (const provider of providers) {
      const outcome = provider.evaluate(input.ruleInput);
      if (outcome) {
        return {
          decision: outcome.decision,
          reasonCode: outcome.reasonCode,
          ruleId: outcome.ruleId,
          partialExitFraction: outcome.partialExitFraction,
        };
      }
    }
  }

  return {
    decision: "HOLD",
    reasonCode: guardianReasonCodes.hold,
    ruleId: guardianRuleIds.defaultHold,
  };
}

export function isGuardianRuleOutcome(value: GuardianRuleOutcome): value is GuardianRuleOutcome {
  return (
    value.decision === "HOLD" || value.decision === "EXIT_PARTIAL" || value.decision === "EXIT_FULL"
  );
}
