import { describe, expect, it } from "vitest";

import { runGuardianCostCausalScenarioComparison } from "@/lib/trader/research/wp21-g2-guardian-cost-causal-harness";

describe("trader g2 wp21 guardian cost causal", () => {
  it("account threshold no-crossing under parent historical costs", () => {
    const result = runGuardianCostCausalScenarioComparison("B5-GU-01");
    expect(result.observedCausalOutcome).toBe("NO_CAUSAL_CROSSING");
  });

  it("month threshold no-crossing under parent historical costs", () => {
    const result = runGuardianCostCausalScenarioComparison("B5-GU-02");
    expect(result.preCrossingStateParity).toBe("EXACT");
  });

  it("strategy threshold no-crossing under parent historical costs", () => {
    const result = runGuardianCostCausalScenarioComparison("B5-GU-03");
    expect(result.unexplainedPreCrossingDivergenceCount).toBe(0);
  });

  it("account causal crossing under canonical D-5 costs only", () => {
    const result = runGuardianCostCausalScenarioComparison("B5-GU-04");
    expect(result.observedCausalOutcome).toBe("CAUSAL_CROSSING");
    expect(result.observedThresholdType).toBe("ACCOUNT");
  });

  it("month causal crossing under canonical D-5 costs only", () => {
    const result = runGuardianCostCausalScenarioComparison("B5-GU-05");
    expect(result.observedThresholdType).toBe("MONTHLY");
  });

  it("strategy causal crossing under canonical D-5 costs only", () => {
    const result = runGuardianCostCausalScenarioComparison("B5-GU-06");
    expect(result.observedThresholdType).toBe("STRATEGY");
  });

  it("requires exact first divergence cycle", () => {
    const result = runGuardianCostCausalScenarioComparison("B5-GU-07");
    expect(result.firstDivergenceCycle).toBe(1);
  });

  it("requires pre-crossing state parity between A and B sequences", () => {
    const result = runGuardianCostCausalScenarioComparison("B5-GU-08");
    expect(result.preCrossingStateParity).toBe("EXACT");
  });

  it("requires downstream actions trace to guardian reason code", () => {
    const result = runGuardianCostCausalScenarioComparison("B5-GU-09");
    expect(result.downstreamActionsTraceToGuardian).toBe(true);
    expect(result.observedReasonCode).toBeTruthy();
  });

  it("requires zero unexplained pre-crossing divergence", () => {
    const result = runGuardianCostCausalScenarioComparison("B5-GU-10");
    expect(result.unexplainedPreCrossingDivergenceCount).toBe(0);
  });
});
