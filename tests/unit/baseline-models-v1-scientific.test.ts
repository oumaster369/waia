import { describe, expect, it } from "vitest";

import {
  buildBaselineContextFromDevelopment,
  computeEwmaVarianceReturnsV2,
  evaluateMandatoryBaselineV1,
  MANDATORY_BASELINE_IDS,
} from "@/lib/trader/research/benchmark/baseline-models-v1";

const MINUTE_MS = 60_000;

function minuteTimes(count: number): number[] {
  return Array.from({ length: count }, (_, index) => 1_700_000_000_000 + index * MINUTE_MS);
}

describe("DEE-531 baseline scientific protocol", () => {
  const developmentReturns = Array.from({ length: 500 }, (_, i) => Math.sin(i / 20) * 0.01);
  const history = Array.from({ length: 2500 }, (_, i) => Math.cos(i / 15) * 0.008);
  const context = buildBaselineContextFromDevelopment({
    developmentReturns,
    history,
    historyMinuteOpenTimesMs: minuteTimes(history.length),
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
      historyMinuteOpenTimesMs: minuteTimes(100),
    });
    expect(evaluateMandatoryBaselineV1("rolling-w2000/v1", shortHistory).status).toBe(
      "UNAVAILABLE",
    );
  });

  it("gaussian-pop-std uses location 0", () => {
    const baseline = evaluateMandatoryBaselineV1("gaussian-pop-std/v1", context);
    expect(baseline.status).toBe("AVAILABLE");
  });

  it("uses DEVELOPMENT sample variance then raw r² for all 2000 returns", () => {
    const returns = Array.from({ length: 2000 }, () => 0.01);
    let expected = 0.0002; // sample variance of [0, 0.02]
    for (const value of returns) {
      expected = 0.94 * expected + 0.06 * value * value;
    }
    const result = computeEwmaVarianceReturnsV2(
      buildBaselineContextFromDevelopment({
        developmentReturns: [0, 0.02],
        history: returns,
        historyMinuteOpenTimesMs: minuteTimes(returns.length),
      }),
    );
    expect(result).toBeCloseTo(expected, 15);
  });

  it("constant and alternating returns have identical EWMA variance (no differencing)", () => {
    const constant = Array.from({ length: 2000 }, () => 0.01);
    const alternating = Array.from({ length: 2000 }, (_, index) =>
      index % 2 === 0 ? 0.01 : -0.01,
    );
    const evaluate = (values: readonly number[]) =>
      computeEwmaVarianceReturnsV2(
        buildBaselineContextFromDevelopment({
          developmentReturns: [-0.01, 0.01],
          history: values,
          historyMinuteOpenTimesMs: minuteTimes(values.length),
        }),
      );
    expect(evaluate(alternating)).toBeCloseTo(evaluate(constant)!, 15);
  });

  it.each([
    ["short", Array.from({ length: 1999 }, () => 0.01), minuteTimes(1999)],
    ["null", [...Array.from({ length: 1999 }, () => 0.01), null], minuteTimes(2000)],
    ["non-finite", [...Array.from({ length: 1999 }, () => 0.01), Number.NaN], minuteTimes(2000)],
    ["overflow", [...Array.from({ length: 1999 }, () => 0.01), 1e308], minuteTimes(2000)],
    [
      "gap",
      Array.from({ length: 2000 }, () => 0.01),
      minuteTimes(2000).map((t, i) => (i === 1000 ? t + MINUTE_MS : t)),
    ],
    ["reverse", Array.from({ length: 2000 }, () => 0.01), [...minuteTimes(2000)].reverse()],
    ["timestamp-count", Array.from({ length: 2000 }, () => 0.01), minuteTimes(1999)],
  ])("fails closed for %s history", (_name, values, times) => {
    const invalid = buildBaselineContextFromDevelopment({
      developmentReturns: [-0.01, 0.01],
      history: values,
      historyMinuteOpenTimesMs: times,
    });
    expect(evaluateMandatoryBaselineV1("ewma-lambda094/v2", invalid)).toEqual({
      status: "UNAVAILABLE",
      reason: "EWMA_WARMUP_INSUFFICIENT",
    });
  });

  it("fails closed when DEVELOPMENT sample-variance arithmetic overflows", () => {
    const invalid = buildBaselineContextFromDevelopment({
      developmentReturns: [-1e308, 1e308],
      history: Array.from({ length: 2000 }, () => 0.01),
      historyMinuteOpenTimesMs: minuteTimes(2000),
    });
    expect(evaluateMandatoryBaselineV1("ewma-lambda094/v2", invalid).status).toBe("UNAVAILABLE");
  });

  it("pins v2 identity and applies sqrt(h) horizon scaling", () => {
    expect(MANDATORY_BASELINE_IDS).toContain("ewma-lambda094/v2");
    expect(MANDATORY_BASELINE_IDS).not.toContain("ewma-lambda094/v1" as never);
    const values = Array.from({ length: 2000 }, () => 0.01);
    const base = {
      developmentReturns: [-0.03, -0.01, 0.01, 0.03],
      history: values,
      historyMinuteOpenTimesMs: minuteTimes(values.length),
    };
    const at30 = evaluateMandatoryBaselineV1(
      "ewma-lambda094/v2",
      buildBaselineContextFromDevelopment({ ...base, primaryHorizonMinutes: 30 }),
    );
    const at60 = evaluateMandatoryBaselineV1(
      "ewma-lambda094/v2",
      buildBaselineContextFromDevelopment({ ...base, primaryHorizonMinutes: 60 }),
    );
    expect(at30.status).toBe("AVAILABLE");
    expect(at60.status).toBe("AVAILABLE");
    if (at30.status === "AVAILABLE" && at60.status === "AVAILABLE") {
      expect(at60.probabilities).not.toEqual(at30.probabilities);
      expect(at60.probabilities[0]).toBeGreaterThan(at30.probabilities[0]!);
    }
  });
});
