import { describe, expect, it } from "vitest";
import { runWp14EvaluationCycle } from "./wp14-test-helpers";

describe("trader wp14 why not cash", () => {
  it("requires whyNotCash for TRADE and REDUCED_RISK", () => {
    const cycle = runWp14EvaluationCycle();
    const decision = cycle.forecastDecisionBundle!.decision;
    if (decision.decisionClass === "TRADE" || decision.decisionClass === "REDUCED_RISK") {
      expect(decision.whyNotCashJson).not.toBeNull();
      expect(decision.whyCashOrAbstainJson).toBeNull();
    }
  });
});
