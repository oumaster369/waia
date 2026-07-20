import { describe, expect, it } from "vitest";
import { runWp14EvaluationCycle } from "./wp14-test-helpers";

describe("trader wp14 decision forecast links", () => {
  it("uses PRIMARY and SUPPORTING roles with ordinals", () => {
    const cycle = runWp14EvaluationCycle();
    const bundle = cycle.forecastDecisionBundle!;
    if (bundle.decision.decisionClass === "NO_TRADE") {
      expect(bundle.links).toHaveLength(0);
      return;
    }
    expect(bundle.links.length).toBeGreaterThan(0);
    const primary = bundle.links.filter((link) => link.linkRole === "PRIMARY");
    expect(primary).toHaveLength(1);
    expect(bundle.links[0]?.ordinal).toBe(0);
  });
});
