import { describe, expect, it } from "vitest";

import {
  createEmptyWp21CheckpointState,
  mergeWp21CheckpointState,
} from "@/lib/trader/intelligence/outcome-resolution/wp21-checkpoint-state";

describe("trader wp21 checkpoint resume parity", () => {
  it("merges resolved forecast ids without duplication semantics loss", () => {
    const base = createEmptyWp21CheckpointState();
    const merged = mergeWp21CheckpointState(base, {
      resolvedForecastOutcomeIds: ["id-1", "id-2"],
      lastEligibleResolutionTime: "2024-01-01T01:00:00.000Z",
    });
    expect(merged.resolvedForecastOutcomeIds).toEqual(["id-1", "id-2"]);
    expect(merged.lastEligibleResolutionTime).toBe("2024-01-01T01:00:00.000Z");
  });

  it("preserves prior checkpoint fields on partial merge", () => {
    const prior = mergeWp21CheckpointState(undefined, {
      processedAbstentionDecisionIds: ["decision-1"],
    });
    const merged = mergeWp21CheckpointState(prior, {
      resolvedHypothesisOutcomeIds: ["hyp-1"],
    });
    expect(merged.processedAbstentionDecisionIds).toEqual(["decision-1"]);
    expect(merged.resolvedHypothesisOutcomeIds).toEqual(["hyp-1"]);
  });
});
