import { describe, expect, it } from "vitest";

import {
  evaluateLongOnlyExposureReductionV2,
  evaluateProtectivePosturePermissionV2,
  mostRestrictiveProtectivePostureV2,
  protectivePostureMayRecoverAutomaticallyV2,
} from "@/lib/trader/risk/v2/protective-posture-v2";
import {
  isRiskReasonCodeV2,
  riskLayerForReasonCodeV2,
  validateRiskReasonsForLayersV2,
} from "@/lib/trader/risk/v2/risk-reason-codes-v2";

describe("Risk V2 protective posture", () => {
  it("permits only strict, non-reversing SELL reductions in CLOSE_ONLY", () => {
    expect(
      evaluateLongOnlyExposureReductionV2({
        side: "SELL",
        currentBaseQuantity: "2",
        requestedBaseQuantity: "0.5",
      }),
    ).toMatchObject({
      isStrictExposureReduction: true,
      currentBaseQuantity: "2",
      requestedBaseQuantity: "0.5",
      projectedBaseQuantity: "1.5",
    });
    expect(
      evaluateLongOnlyExposureReductionV2({
        side: "SELL",
        currentBaseQuantity: "2",
        requestedBaseQuantity: "2",
      }).isStrictExposureReduction,
    ).toBe(true);
    expect(
      evaluateLongOnlyExposureReductionV2({
        side: "BUY",
        currentBaseQuantity: "2",
        requestedBaseQuantity: "0.1",
      }).reason,
    ).toBe("BUY_INCREASES_LONG_ONLY_EXPOSURE");
    expect(
      evaluateLongOnlyExposureReductionV2({
        side: "SELL",
        currentBaseQuantity: "2",
        requestedBaseQuantity: "2.00000001",
      }).reason,
    ).toBe("WOULD_REVERSE_OR_OVERSHOOT");
  });

  it("fails closed for zero, negative, malformed, or absent long exposure", () => {
    expect(
      evaluateLongOnlyExposureReductionV2({ side: "SELL", currentBaseQuantity: "0", requestedBaseQuantity: "1" })
        .reason,
    ).toBe("NO_LONG_EXPOSURE_TO_REDUCE");
    expect(
      evaluateLongOnlyExposureReductionV2({ side: "SELL", currentBaseQuantity: "1", requestedBaseQuantity: "0" })
        .reason,
    ).toBe("QUANTITY_NOT_POSITIVE");
    expect(
      evaluateLongOnlyExposureReductionV2({ side: "SELL", currentBaseQuantity: "bad", requestedBaseQuantity: "1" })
        .reason,
    ).toBe("QUANTITY_INVALID");
  });

  it("revokes non-reducing allowances and refuses non-reducing consumption in CLOSE_ONLY", () => {
    expect(
      evaluateProtectivePosturePermissionV2({
        posture: "CLOSE_ONLY",
        actionIsStrictExposureReduction: false,
      }),
    ).toMatchObject({
      mayIssueExposureIncreasingAllowance: false,
      outstandingAllowanceDisposition: "REVOKE_IF_NOT_STRICT_REDUCTION",
      consumptionDisposition: "REFUSE",
      refusalReasonCode: "CURRENT_POSTURE_RESTRICTED",
      originatesLiquidationAuthority: false,
    });
    expect(
      evaluateProtectivePosturePermissionV2({
        posture: "CLOSE_ONLY",
        actionIsStrictExposureReduction: true,
      }).consumptionDisposition,
    ).toBe("PERMIT");
  });

  it("HALT and KILLED revoke and refuse without originating liquidation authority", () => {
    for (const posture of ["HALT", "KILLED"] as const) {
      expect(
        evaluateProtectivePosturePermissionV2({ posture, actionIsStrictExposureReduction: true }),
      ).toMatchObject({
        mayIssueExposureIncreasingAllowance: false,
        mayIssueStrictReductionAllowance: false,
        outstandingAllowanceDisposition: "REVOKE_ALL",
        consumptionDisposition: "REFUSE",
        originatesLiquidationAuthority: false,
      });
    }
  });

  it("joins posture restrictively and requires Human recovery from KILLED", () => {
    expect(mostRestrictiveProtectivePostureV2(["NORMAL", "HALT", "CLOSE_ONLY"])).toBe("HALT");
    expect(mostRestrictiveProtectivePostureV2([])).toBe("KILLED");
    expect(protectivePostureMayRecoverAutomaticallyV2({ from: "KILLED", to: "HALT" })).toBe(false);
    expect(protectivePostureMayRecoverAutomaticallyV2({ from: "HALT", to: "NORMAL" })).toBe(true);
    expect(protectivePostureMayRecoverAutomaticallyV2({ from: "NORMAL", to: "CLOSE_ONLY" })).toBe(true);
  });

  it("keeps reason codes closed and attributable to L0-L6", () => {
    expect(isRiskReasonCodeV2("KILL_SWITCH_TRIPPED")).toBe(true);
    expect(riskLayerForReasonCodeV2("KILL_SWITCH_TRIPPED")).toBe("L4");
    expect(
      validateRiskReasonsForLayersV2({
        bindingLayers: ["L4", "L6"],
        reasonCodes: ["KILL_SWITCH_TRIPPED", "RECONCILIATION_DIVERGENCE"],
      }),
    ).toBe(true);
    expect(
      validateRiskReasonsForLayersV2({
        bindingLayers: ["L5"],
        reasonCodes: ["KILL_SWITCH_TRIPPED"],
      }),
    ).toBe(false);
    expect(isRiskReasonCodeV2("ECONOMIC_OPINION")).toBe(false);
  });
});
