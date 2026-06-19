import type { PromotionGovernanceState } from "@/lib/trader/validation-gate/strategy-promotion-record.types";
import { StrategyPromotionValidationError } from "@/lib/trader/validation-gate/strategy-promotion-record.errors";

const allowedTransitions: Record<PromotionGovernanceState, readonly PromotionGovernanceState[]> = {
  DRAFT: ["PENDING_CONFIRM", "CANCELLED"],
  PENDING_CONFIRM: ["COOLING_OFF", "CANCELLED"],
  COOLING_OFF: ["EFFECTIVE", "CANCELLED"],
  EFFECTIVE: ["REVOKED"],
  CANCELLED: [],
  REVOKED: [],
};

export function assertAllowedPromotionTransition(
  from: PromotionGovernanceState,
  to: PromotionGovernanceState,
): void {
  if (!allowedTransitions[from].includes(to)) {
    throw new StrategyPromotionValidationError(
      "STRATEGY_PROMOTION_INVALID_TRANSITION",
      `Cannot transition promotion from ${from} to ${to}`,
    );
  }
}
