import { describe, expect, it } from "vitest";
import { runWp14EvaluationCycle } from "./wp14-test-helpers";

describe("trader wp14 forecast cardinality", () => {
  it("allows zero or more forecasts per cycle", () => {
    const cycle = runWp14EvaluationCycle();
    const bundle = cycle.forecastDecisionBundle;
    expect(bundle).toBeDefined();
    expect(bundle!.forecasts.length).toBeGreaterThanOrEqual(0);
    expect(bundle!.decision).toBeDefined();
  });

  it("emits exactly one decision per cycle", () => {
    const cycle = runWp14EvaluationCycle();
    expect(cycle.forecastDecisionBundle?.decision.runId).toBe("wp14-run");
    expect(cycle.forecastDecisionBundle?.decision.cycleId).toBe("0");
  });
});
