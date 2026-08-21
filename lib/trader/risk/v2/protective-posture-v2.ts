import { compareDecimal, formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import type { RiskReasonCodeV2 } from "./risk-reason-codes-v2";

export const PROTECTIVE_POSTURES_V2 = ["NORMAL", "CLOSE_ONLY", "HALT", "KILLED"] as const;

export type ProtectivePostureV2 = (typeof PROTECTIVE_POSTURES_V2)[number];
export type SpotOrderSideV2 = "BUY" | "SELL";

export type LongOnlyExposureReductionV2 = Readonly<{
  isStrictExposureReduction: boolean;
  currentBaseQuantity: string | null;
  requestedBaseQuantity: string | null;
  projectedBaseQuantity: string | null;
  reason:
    | "STRICT_NON_REVERSING_REDUCTION"
    | "BUY_INCREASES_LONG_ONLY_EXPOSURE"
    | "NO_LONG_EXPOSURE_TO_REDUCE"
    | "QUANTITY_NOT_POSITIVE"
    | "WOULD_REVERSE_OR_OVERSHOOT"
    | "QUANTITY_INVALID";
}>;

export type ProtectivePosturePermissionV2 = Readonly<{
  posture: ProtectivePostureV2;
  mayIssueExposureIncreasingAllowance: boolean;
  mayIssueStrictReductionAllowance: boolean;
  outstandingAllowanceDisposition: "RETAIN" | "REVOKE_IF_NOT_STRICT_REDUCTION" | "REVOKE_ALL";
  consumptionDisposition: "PERMIT" | "REFUSE";
  refusalReasonCode: RiskReasonCodeV2 | null;
  originatesLiquidationAuthority: false;
}>;

const POSTURE_ORDINAL: Readonly<Record<ProtectivePostureV2, number>> = Object.freeze({
  NORMAL: 0,
  CLOSE_ONLY: 1,
  HALT: 2,
  KILLED: 3,
});

function invalidReduction(reason: LongOnlyExposureReductionV2["reason"]): LongOnlyExposureReductionV2 {
  return Object.freeze({
    isStrictExposureReduction: false,
    currentBaseQuantity: null,
    requestedBaseQuantity: null,
    projectedBaseQuantity: null,
    reason,
  });
}

export function evaluateLongOnlyExposureReductionV2(input: {
  side: SpotOrderSideV2;
  currentBaseQuantity: string;
  requestedBaseQuantity: string;
}): LongOnlyExposureReductionV2 {
  let current: bigint;
  let requested: bigint;
  try {
    current = parseDecimal(input.currentBaseQuantity);
    requested = parseDecimal(input.requestedBaseQuantity);
  } catch {
    return invalidReduction("QUANTITY_INVALID");
  }
  const currentBaseQuantity = formatDecimal(current);
  const requestedBaseQuantity = formatDecimal(requested);
  if (requested <= 0n) {
    return Object.freeze({
      ...invalidReduction("QUANTITY_NOT_POSITIVE"),
      currentBaseQuantity,
      requestedBaseQuantity,
    });
  }
  if (current <= 0n) {
    return Object.freeze({
      ...invalidReduction("NO_LONG_EXPOSURE_TO_REDUCE"),
      currentBaseQuantity,
      requestedBaseQuantity,
    });
  }
  if (input.side === "BUY") {
    return Object.freeze({
      ...invalidReduction("BUY_INCREASES_LONG_ONLY_EXPOSURE"),
      currentBaseQuantity,
      requestedBaseQuantity,
    });
  }
  if (compareDecimal(requestedBaseQuantity, currentBaseQuantity) > 0) {
    return Object.freeze({
      ...invalidReduction("WOULD_REVERSE_OR_OVERSHOOT"),
      currentBaseQuantity,
      requestedBaseQuantity,
      projectedBaseQuantity: formatDecimal(current - requested),
    });
  }
  return Object.freeze({
    isStrictExposureReduction: true,
    currentBaseQuantity,
    requestedBaseQuantity,
    projectedBaseQuantity: formatDecimal(current - requested),
    reason: "STRICT_NON_REVERSING_REDUCTION",
  });
}

export function mostRestrictiveProtectivePostureV2(
  postures: readonly ProtectivePostureV2[],
): ProtectivePostureV2 {
  if (postures.length === 0) return "KILLED";
  return postures.reduce((strictest, posture) =>
    POSTURE_ORDINAL[posture] > POSTURE_ORDINAL[strictest] ? posture : strictest,
  );
}

export function evaluateProtectivePosturePermissionV2(input: {
  posture: ProtectivePostureV2;
  actionIsStrictExposureReduction: boolean;
}): ProtectivePosturePermissionV2 {
  if (input.posture === "NORMAL") {
    return Object.freeze({
      posture: input.posture,
      mayIssueExposureIncreasingAllowance: true,
      mayIssueStrictReductionAllowance: true,
      outstandingAllowanceDisposition: "RETAIN",
      consumptionDisposition: "PERMIT",
      refusalReasonCode: null,
      originatesLiquidationAuthority: false,
    });
  }
  if (input.posture === "CLOSE_ONLY") {
    const permitted = input.actionIsStrictExposureReduction;
    return Object.freeze({
      posture: input.posture,
      mayIssueExposureIncreasingAllowance: false,
      mayIssueStrictReductionAllowance: true,
      outstandingAllowanceDisposition: "REVOKE_IF_NOT_STRICT_REDUCTION",
      consumptionDisposition: permitted ? "PERMIT" : "REFUSE",
      refusalReasonCode: permitted ? null : "CURRENT_POSTURE_RESTRICTED",
      originatesLiquidationAuthority: false,
    });
  }
  return Object.freeze({
    posture: input.posture,
    mayIssueExposureIncreasingAllowance: false,
    mayIssueStrictReductionAllowance: false,
    outstandingAllowanceDisposition: "REVOKE_ALL",
    consumptionDisposition: "REFUSE",
    refusalReasonCode: input.posture === "KILLED" ? "KILL_SWITCH_TRIPPED" : "EXECUTION_FAIL_CLOSED",
    originatesLiquidationAuthority: false,
  });
}

export function protectivePostureMayRecoverAutomaticallyV2(input: {
  from: ProtectivePostureV2;
  to: ProtectivePostureV2;
}): boolean {
  if (POSTURE_ORDINAL[input.to] >= POSTURE_ORDINAL[input.from]) return true;
  return input.from !== "KILLED";
}
