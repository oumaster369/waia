import { describe, expect, it } from "vitest";
import { runWp14EvaluationCycle } from "./wp14-test-helpers";

describe("trader wp14 forecast seal", () => {
  it("seals evidence cutoff at or before issuance", () => {
    const cycle = runWp14EvaluationCycle();
    for (const forecast of cycle.forecastDecisionBundle?.forecasts ?? []) {
      expect(new Date(forecast.evidenceCutoffAt).getTime()).toBeLessThanOrEqual(
        new Date(forecast.issuedAt).getTime(),
      );
      expect(new Date(forecast.issuedAt).getTime()).toBeLessThanOrEqual(
        new Date(forecast.targetWindowStartAt).getTime(),
      );
      expect(new Date(forecast.targetWindowStartAt).getTime()).toBeLessThan(
        new Date(forecast.targetWindowEndAt).getTime(),
      );
    }
  });
});
