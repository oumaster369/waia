import { describe, expect, it } from "vitest";

import {
  createInitialEventAttributionConfidenceState,
  updateEventAttributionConfidenceState,
} from "@/lib/trader/events/event-attribution-confidence";

describe("event attribution confidence (M7)", () => {
  it("updates posterior with descriptive co-occurrence tags", () => {
    const initial = createInitialEventAttributionConfidenceState();
    const updated = updateEventAttributionConfidenceState({
      state: initial,
      outcomeTag: "supporting",
    });
    expect(updated.state.priorSupporting).toBeGreaterThan(initial.priorSupporting);
    expect(updated.rationale.some((r) => r.includes("descriptive_attribution"))).toBe(true);
  });

  it("does not claim success probability", () => {
    const updated = updateEventAttributionConfidenceState({
      state: createInitialEventAttributionConfidenceState(),
      outcomeTag: "neutral",
    });
    expect(updated.rationale).not.toContain("profit");
    expect(updated.rationale).toContain("descriptive_attribution_not_success_probability");
  });
});
