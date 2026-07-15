import { describe, expect, it } from "vitest";
import { runWp14EvaluationCycle } from "./wp14-test-helpers";

describe("trader wp14 no trade", () => {
  it("allows NO_TRADE with zero links and no entry purpose", () => {
    const cycle = runWp14EvaluationCycle();
    const bundle = cycle.forecastDecisionBundle!;
    if (bundle.decision.decisionClass !== "NO_TRADE") {
      return;
    }
    expect(bundle.links).toHaveLength(0);
    expect(bundle.entryPurpose).toBeNull();
    expect(bundle.decision.whyCashOrAbstainJson).not.toBeNull();
  });
});
