import { describe, expect, it } from "vitest";

import {
  STRATEGY_LIFECYCLE_TRANSITIONS,
  validateStrategyLifecycleTransition,
} from "@/lib/trader/intelligence/strategies/strategy-lifecycle-transition-validator";

describe("HTR-WP16 lifecycle transitions", () => {
  it("allows machine DRAFT origin", () => {
    expect(
      validateStrategyLifecycleTransition({
        fromState: null,
        toState: "DRAFT",
        actor: "MACHINE",
      }).ok,
    ).toBe(true);
  });

  it("requires human approval for PAPER promotion", () => {
    expect(
      validateStrategyLifecycleTransition({
        fromState: "RESEARCHING",
        toState: "PAPER",
        actor: "HUMAN",
        approvalRef: "svg-1",
      }).ok,
    ).toBe(true);
    expect(
      validateStrategyLifecycleTransition({
        fromState: "RESEARCHING",
        toState: "PAPER",
        actor: "MACHINE",
      }).ok,
    ).toBe(false);
  });

  it("rejects exit from RETIRED terminal state", () => {
    expect(
      validateStrategyLifecycleTransition({
        fromState: "RETIRED",
        toState: "PAPER",
        actor: "HUMAN",
        approvalRef: "svg-1",
      }).ok,
    ).toBe(false);
    expect(STRATEGY_LIFECYCLE_TRANSITIONS.length).toBeGreaterThan(0);
  });
});
