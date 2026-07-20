import { describe, expect, it } from "vitest";
import { DECISION_RECORD_SCHEMA_VERSION } from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import { runWp14EvaluationCycle } from "./wp14-test-helpers";

describe("trader wp14 decision record", () => {
  it("persists one LD-7 decision with schema version", () => {
    const cycle = runWp14EvaluationCycle();
    const decision = cycle.forecastDecisionBundle!.decision;
    expect(decision.schemaVersion).toBe(DECISION_RECORD_SCHEMA_VERSION);
    expect(decision.contentDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(["TRADE", "REDUCED_RISK", "NO_TRADE"]).toContain(decision.decisionClass);
  });
});
