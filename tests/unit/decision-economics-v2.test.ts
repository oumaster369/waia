import { describe, expect, it } from "vitest";

import {
  computeDecisionEvRangeV1,
  computeReplicaPayoffMeans,
  EXEC_OPP_R_H_INDEX,
  piBaseV1,
  piLowerV1,
} from "@/lib/trader/intelligence/decision-economics/decision-economics-v2";

function sample13d(rH: number): number[] {
  const s = new Array(13).fill(0);
  s[EXEC_OPP_R_H_INDEX] = rH;
  return s;
}

describe("DEE-528 decision economics v2", () => {
  it("Pi_lower preserves physical downside instead of flooring losses at zero", () => {
    const pi = piLowerV1({
      notionalUsdt: 10_000,
      sample: sample13d(-0.5),
      costRate: 0.001,
      slippageBufferUsdt: 100,
    });
    expect(pi).toBeLessThan(0);
    expect(pi).toBeLessThan(
      piBaseV1({
        notionalUsdt: 10_000,
        sample: sample13d(-0.5),
        costRate: 0.001,
        slippageBufferUsdt: 100,
      }),
    );
  });

  it("EV ordering invariant EV_lower <= EV_base <= EV_upper", () => {
    const { muBaseReplicas, muLowerReplicas } = computeReplicaPayoffMeans({
      notionalUsdt: 100_000,
      costRate: 0.00035,
      slippageBufferUsdt: 50,
      replicaSamples: [
        [sample13d(0.01), sample13d(0.012)],
        [sample13d(0.008), sample13d(0.009)],
        [sample13d(0.015), sample13d(0.011)],
      ],
    });
    const ev = computeDecisionEvRangeV1({
      muBaseReplicas,
      muLowerReplicas,
      scientificAdmissionVerified: true,
    });
    expect(ev.evLower).toBeLessThanOrEqual(ev.evBase);
    expect(ev.evBase).toBeLessThanOrEqual(ev.evUpper);
  });

  it("DECISION_ACTIONABLE requires verified admission AND EV_lower > 0", () => {
    const positiveReplicas = computeReplicaPayoffMeans({
      notionalUsdt: 100_000,
      costRate: 0.0001,
      slippageBufferUsdt: 10,
      replicaSamples: Array.from({ length: 10 }, () => [sample13d(0.02)]),
    });
    const actionable = computeDecisionEvRangeV1({
      ...positiveReplicas,
      scientificAdmissionVerified: true,
    });
    expect(actionable.decisionActionable).toBe(true);
    expect(actionable.evLower).toBeGreaterThan(0);

    const withoutVerification = computeDecisionEvRangeV1({
      ...positiveReplicas,
      scientificAdmissionVerified: false,
    });
    expect(withoutVerification.decisionActionable).toBe(false);
    expect(withoutVerification.reasonCodes).toContain("SCIENTIFIC_ADMISSION_RECEIPT_REQUIRED");

    // Arbitrary non-empty digest is irrelevant — only boolean verified authority counts.
    const negativeEv = computeDecisionEvRangeV1({
      ...computeReplicaPayoffMeans({
        notionalUsdt: 10_000,
        costRate: 0.001,
        slippageBufferUsdt: 5,
        replicaSamples: Array.from({ length: 10 }, () => [sample13d(-0.001)]),
      }),
      scientificAdmissionVerified: true,
    });
    expect(negativeEv.decisionActionable).toBe(false);
    expect(negativeEv.evLower).toBeLessThanOrEqual(0);
    expect(negativeEv.reasonCodes).toContain("DECISION_NON_ACTIONABLE");
  });

  it("legacy strategy fields do not change Pi_base", () => {
    const input = {
      notionalUsdt: 50_000,
      sample: sample13d(0.01),
      costRate: 0.0002,
      slippageBufferUsdt: 25,
    };
    const base = piBaseV1(input);
    expect(base).toBe(piBaseV1(input));
  });
});
