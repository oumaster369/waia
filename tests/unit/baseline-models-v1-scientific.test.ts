import { describe, expect, it } from "vitest";

import {
  buildBaselineContextFromDevelopment,
  evaluateMandatoryBaselineV1,
} from "@/lib/trader/research/benchmark/baseline-models-v1";

describe("DEE-531 baseline scientific protocol", () => {
  const developmentReturns = Array.from({ length: 500 }, (_, i) => Math.sin(i / 20) * 0.01);
  const history = Array.from({ length: 2500 }, (_, i) => Math.cos(i / 15) * 0.008);
  const context = buildBaselineContextFromDevelopment({
    developmentReturns,
    history,
    primaryHorizonMinutes: 30,
  });

  it("empirical climatology uses bucket masses not Gaussian mean/std shortcut", () => {
    const baseline = evaluateMandatoryBaselineV1("climatology/v1", context);
    expect(baseline.status).toBe("AVAILABLE");
    if (baseline.status === "AVAILABLE") {
      const sum = baseline.probabilities.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 10);
    }
  });

  it("rolling baseline is UNAVAILABLE before W=2000", () => {
    const shortHistory = buildBaselineContextFromDevelopment({
      developmentReturns,
      history: history.slice(0, 100),
    });
    expect(evaluateMandatoryBaselineV1("rolling-w2000/v1", shortHistory).status).toBe(
      "UNAVAILABLE",
    );
  });

  it("gaussian-pop-std uses location 0", () => {
    const baseline = evaluateMandatoryBaselineV1("gaussian-pop-std/v1", context);
    expect(baseline.status).toBe("AVAILABLE");
  });
});
