import { describe, expect, it } from "vitest";

import {
  createInitialPatternConfidenceState,
  updatePatternConfidenceState,
} from "@/lib/trader/mi/pattern-catalog-confidence";
import { compareDecimal } from "@/lib/trader/risk/numeric";

describe("pattern catalog confidence (M6)", () => {
  it("updates descriptive consistency without treating confidence as success probability", () => {
    const initial = createInitialPatternConfidenceState();
    const updated = updatePatternConfidenceState({
      state: initial,
      outcomeTag: "supporting",
    });

    expect(updated.rationale).toContain("descriptive_consistency_not_success_probability");
    expect(compareDecimal(updated.confidenceMean, "0")).toBeGreaterThanOrEqual(0);
    expect(compareDecimal(updated.confidenceMean, "1")).toBeLessThanOrEqual(0);
    expect(updated.state.priorHits).toBeGreaterThan(initial.priorHits);
  });

  it("is deterministic for fixed inputs", () => {
    const state = createInitialPatternConfidenceState();
    const input = { state, outcomeTag: "contradicting" as const };
    expect(updatePatternConfidenceState(input)).toEqual(updatePatternConfidenceState(input));
  });
});
