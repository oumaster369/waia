import type { PlaceOrderInput } from "@/lib/trader/connectors/types";

import type { RiskReasonCode } from "@/lib/trader/risk/reason-codes";
import type {
  RiskCheckName,
  RiskDecision,
  RiskDecisionOutcome,
  RiskResizeHint,
  RiskSnapshot,
} from "@/lib/trader/risk/types";

export type BuildRiskSnapshotInput = {
  order: PlaceOrderInput;
  effectivePrice?: string;
  computedNotional?: string;
  checksApplied: RiskCheckName[];
};

export function buildRiskSnapshot(input: BuildRiskSnapshotInput): RiskSnapshot {
  return {
    symbol: input.order.symbol,
    side: input.order.side,
    orderType: input.order.type,
    requestedQuantity: input.order.quantity,
    effectivePrice: input.effectivePrice,
    computedNotional: input.computedNotional,
    checksApplied: [...input.checksApplied],
  };
}

export function approveDecision(snapshot: RiskSnapshot, evaluatedAt: string): RiskDecision {
  return {
    outcome: "APPROVE",
    reasonCodes: [],
    snapshot,
    evaluatedAt,
  };
}

export function rejectDecision(
  reasonCodes: RiskReasonCode[],
  snapshot: RiskSnapshot,
  evaluatedAt: string,
): RiskDecision {
  return {
    outcome: "REJECT",
    reasonCodes: [...reasonCodes],
    snapshot,
    evaluatedAt,
  };
}

export function resizeDecision(
  reasonCodes: RiskReasonCode[],
  snapshot: RiskSnapshot,
  resize: RiskResizeHint,
  evaluatedAt: string,
): RiskDecision {
  return {
    outcome: "RESIZE",
    reasonCodes: [...reasonCodes],
    snapshot,
    resize,
    evaluatedAt,
  };
}

export function closeOnlyDecision(
  reasonCodes: RiskReasonCode[],
  snapshot: RiskSnapshot,
  evaluatedAt: string,
): RiskDecision {
  return {
    outcome: "CLOSE_ONLY",
    reasonCodes: [...reasonCodes],
    snapshot,
    evaluatedAt,
  };
}

export function stopAccountDecision(
  reasonCodes: RiskReasonCode[],
  snapshot: RiskSnapshot,
  evaluatedAt: string,
): RiskDecision {
  return {
    outcome: "STOP_ACCOUNT",
    reasonCodes: [...reasonCodes],
    snapshot,
    evaluatedAt,
  };
}

export function isTerminalReject(outcome: RiskDecisionOutcome): boolean {
  return outcome === "REJECT" || outcome === "CLOSE_ONLY" || outcome === "STOP_ACCOUNT";
}

export function mergeReasonCodes(...groups: RiskReasonCode[][]): RiskReasonCode[] {
  const seen = new Set<RiskReasonCode>();
  const merged: RiskReasonCode[] = [];
  for (const group of groups) {
    for (const code of group) {
      if (!seen.has(code)) {
        seen.add(code);
        merged.push(code);
      }
    }
  }
  return merged;
}
