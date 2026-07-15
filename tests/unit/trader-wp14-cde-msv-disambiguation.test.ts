import { describe, expect, it } from "vitest";
import { runWp14EvaluationCycle } from "./wp14-test-helpers";

describe("trader wp14 cde msv disambiguation", () => {
  it("stores CDE/MSV as permission snapshot only", () => {
    const cycle = runWp14EvaluationCycle();
    const snapshot = cycle.forecastDecisionBundle!.decision.cdeMsvPermissionSnapshotJson;
    expect(snapshot).toContain("CDE_MSV_PERMISSION_ONLY_NOT_LD7_DECISION");
    expect(snapshot).toContain("trading_permission");
    expect(snapshot).not.toContain("decision_class");
  });
});
