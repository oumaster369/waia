import { describe, expect, it } from "vitest";

import {
  computeBrierScore,
  validateProbabilityDomain,
} from "@/lib/trader/intelligence/calibration/brier-score";
import { computeLogLoss } from "@/lib/trader/intelligence/calibration/log-loss";
import {
  EPISTEMIC_LOG_LOSS_EPSILON,
  EPISTEMIC_MIN_CALIBRATION_SAMPLES,
} from "@/lib/trader/intelligence/epistemic/epistemic-scoring-contract";

describe("trader wp21 calibration brier logloss", () => {
  it("computes Brier score for binary outcomes", () => {
    expect(computeBrierScore("0.7000", "1")).toBe("0.0900");
    expect(computeBrierScore("0.7000", "0")).toBe("0.4900");
  });

  it("computes clipped log loss", () => {
    const loss = computeLogLoss("0.7000", "1");
    expect(Number(loss)).toBeGreaterThan(0);
    expect(EPISTEMIC_LOG_LOSS_EPSILON).toBe("0.000000000001");
  });

  it("validates probability domain", () => {
    expect(validateProbabilityDomain("0.5")).toBe(true);
    expect(validateProbabilityDomain("1.5")).toBe(false);
    expect(validateProbabilityDomain("-0.1")).toBe(false);
  });

  it("uses human-approved minimum calibration samples gate", () => {
    expect(EPISTEMIC_MIN_CALIBRATION_SAMPLES).toBe(30);
  });
});
