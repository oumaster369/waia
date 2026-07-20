import { describe, expect, it } from "vitest";
import { runWp14EvaluationCycle } from "./wp14-test-helpers";

describe("trader wp14 lineage", () => {
  it("links forecasts to WP13 envelope, hypothesis, and conviction records", () => {
    const cycle = runWp14EvaluationCycle();
    const wp13 = cycle.intelligenceCycleBundle!;
    const wp14 = cycle.forecastDecisionBundle!;
    expect(wp14.decision.cycleEnvelopeId).toBe(wp13.envelope.id);
    expect(wp14.decision.convictionRecordId).toBe(wp13.conviction.id);
    for (const forecast of wp14.forecasts) {
      expect(forecast.cycleEnvelopeId).toBe(wp13.envelope.id);
      expect(forecast.convictionRecordId).toBe(wp13.conviction.id);
      expect(wp13.hypotheses.some((row) => row.id === forecast.hypothesisRecordId)).toBe(true);
    }
  });
});
