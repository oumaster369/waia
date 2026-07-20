import { describe, expect, it } from "vitest";
import { ENTRY_PURPOSE_RECORD_SCHEMA_VERSION } from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import { runWp14EvaluationCycle } from "./wp14-test-helpers";

describe("trader wp14 entry purpose", () => {
  it("creates entry purpose only for TRADE or REDUCED_RISK", () => {
    const cycle = runWp14EvaluationCycle();
    const bundle = cycle.forecastDecisionBundle!;
    if (
      bundle.decision.decisionClass === "TRADE" ||
      bundle.decision.decisionClass === "REDUCED_RISK"
    ) {
      expect(bundle.entryPurpose).not.toBeNull();
      expect(bundle.entryPurpose!.schemaVersion).toBe(ENTRY_PURPOSE_RECORD_SCHEMA_VERSION);
      expect(bundle.entryPurpose!.whyNotCashJson).not.toBe("");
    } else {
      expect(bundle.entryPurpose).toBeNull();
    }
  });
});
