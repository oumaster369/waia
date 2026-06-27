import type { PlaceOrderInput } from "@/lib/trader/connectors/types";

import {
  buildRiskSnapshot,
  closeOnlyDecision,
  rejectDecision,
  stopAccountDecision,
} from "@/lib/trader/risk/decision";
import type { EffectiveKillSwitchState } from "@/lib/trader/risk/kill-switch/types";
import { killSwitchReasonCodes } from "@/lib/trader/risk/reason-codes";
import type { RiskDecision } from "@/lib/trader/risk/types";

export type KillSwitchEnforcementResult = {
  enforced: boolean;
  decision?: RiskDecision;
};

export function mapEffectiveStateToDecision(
  effective: EffectiveKillSwitchState,
  order: PlaceOrderInput,
  evaluatedAt: string,
): KillSwitchEnforcementResult {
  const snapshot = buildRiskSnapshot({ order, checksApplied: [] });

  if (effective.resolutionStatus === "fail_closed") {
    return {
      enforced: true,
      decision: stopAccountDecision(
        [killSwitchReasonCodes.killSwitchUnavailable],
        snapshot,
        evaluatedAt,
      ),
    };
  }

  if (!effective.blocked) {
    return { enforced: false };
  }

  const reasonCodes = [killSwitchReasonCodes.killSwitchActive];

  switch (effective.enforcementMode) {
    case "REJECT":
      return {
        enforced: true,
        decision: rejectDecision(reasonCodes, snapshot, evaluatedAt),
      };
    case "CLOSE_ONLY":
      return {
        enforced: true,
        decision: closeOnlyDecision(reasonCodes, snapshot, evaluatedAt),
      };
    case "STOP_ACCOUNT":
      return {
        enforced: true,
        decision: stopAccountDecision(reasonCodes, snapshot, evaluatedAt),
      };
    default:
      return {
        enforced: true,
        decision: stopAccountDecision(
          [killSwitchReasonCodes.killSwitchUnavailable],
          snapshot,
          evaluatedAt,
        ),
      };
  }
}

export function buildKillSwitchAuditMetadata(
  effective: EffectiveKillSwitchState,
): Record<string, unknown> {
  return {
    blocked: effective.blocked,
    enforcementMode: effective.enforcementMode,
    bindingState: effective.bindingState,
    resolutionStatus: effective.resolutionStatus,
    contributors: effective.contributors.map((contributor) => ({
      killSwitchId: contributor.killSwitchId,
      scopeType: contributor.scopeType,
      scopeRef: contributor.scopeRef,
      switchType: contributor.switchType,
      enforcementMode: contributor.enforcementMode,
      state: contributor.state,
      stateVersion: contributor.stateVersion,
    })),
  };
}
