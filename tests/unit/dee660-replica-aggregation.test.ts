import { describe, expect, it } from "vitest";

import {
  aggregateDecisionReplicaPayoffsV1,
  DecisionReplicaAggregationError,
} from "@/lib/trader/intelligence/decision-economics/dee660-replica-aggregation-v1";

describe("DEE-660 exact replica aggregation", () => {
  it("computes exact replica means and Type-7 Q10/Q50/Q90 deterministically", () => {
    const input = {
      baseReplicaPayoffsScale8: [
        ["0", "2"],
        ["2", "4"],
      ],
      lowerReplicaPayoffsScale8: [
        ["-0.5", "1.5"],
        ["1.5", "3.5"],
      ],
    } as const;
    const first = aggregateDecisionReplicaPayoffsV1(input);
    const replay = aggregateDecisionReplicaPayoffsV1(input);

    expect(replay).toEqual(first);
    expect(first.muBaseReplicasScale8).toEqual(["1.00000000", "3.00000000"]);
    expect(first.muLowerReplicasScale8).toEqual(["0.50000000", "2.50000000"]);
    expect(first.evLowerScale8).toBe("0.70000000");
    expect(first.evBaseScale8).toBe("2.00000000");
    expect(first.evUpperScale8).toBe("2.80000000");
    expect(first.rangeValid).toBe(true);
    expect(first.evLowerPositive).toBe(true);
  });

  it("keeps the CASH threshold exact below display-scale resolution", () => {
    const result = aggregateDecisionReplicaPayoffsV1({
      baseReplicaPayoffsScale8: [["0.00000001", "0"]],
      lowerReplicaPayoffsScale8: [["0.00000001", "0"]],
    });
    expect(result.evLowerScale8).toBe("0.00000000");
    expect(result.evLowerExact).toEqual({ numeratorScale8: "1", denominator: "2" });
    expect(result.evLowerPositive).toBe(true);
  });

  it("preserves negative economics and reports a valid ordered range", () => {
    const result = aggregateDecisionReplicaPayoffsV1({
      baseReplicaPayoffsScale8: [
        ["-3", "-1"],
        ["-2", "0"],
      ],
      lowerReplicaPayoffsScale8: [
        ["-4", "-2"],
        ["-3", "-1"],
      ],
    });
    expect(result.evLower).toBeLessThan(0);
    expect(result.evLower).toBeLessThanOrEqual(result.evBase);
    expect(result.evBase).toBeLessThanOrEqual(result.evUpper);
    expect(result.evLowerPositive).toBe(false);
    expect(result.rangeValid).toBe(true);
  });

  it("rejects lower payoff above base and incomplete replica matrices", () => {
    expect(() =>
      aggregateDecisionReplicaPayoffsV1({
        baseReplicaPayoffsScale8: [["1"]],
        lowerReplicaPayoffsScale8: [["2"]],
      }),
    ).toThrow(DecisionReplicaAggregationError);
    expect(() =>
      aggregateDecisionReplicaPayoffsV1({
        baseReplicaPayoffsScale8: [["1", "2"]],
        lowerReplicaPayoffsScale8: [["1"]],
      }),
    ).toThrow(/sample count mismatch/);
    expect(() =>
      aggregateDecisionReplicaPayoffsV1({
        baseReplicaPayoffsScale8: [["1"], ["1", "2"]],
        lowerReplicaPayoffsScale8: [["0"], ["0", "1"]],
      }),
    ).toThrow(/sample count mismatch/);
    expect(() =>
      aggregateDecisionReplicaPayoffsV1({
        baseReplicaPayoffsScale8: [],
        lowerReplicaPayoffsScale8: [],
      }),
    ).toThrow(/replica count mismatch/);
  });

  it("rejects malformed and non-scale-8 payoff values", () => {
    expect(() =>
      aggregateDecisionReplicaPayoffsV1({
        baseReplicaPayoffsScale8: [["not-a-number"]],
        lowerReplicaPayoffsScale8: [["0"]],
      }),
    ).toThrow(/invalid payoff/);
    expect(() =>
      aggregateDecisionReplicaPayoffsV1({
        baseReplicaPayoffsScale8: [["0.000000001"]],
        lowerReplicaPayoffsScale8: [["0"]],
      }),
    ).toThrow(/invalid payoff/);
  });
});
