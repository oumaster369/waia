import { describe, expect, it } from "vitest";

import {
  assertScientificControlReplayV2TwoRunParity,
  runScientificControlReplayV2Ceremony,
} from "@/lib/trader/observability/control-replay-scientific-v2-driver-v1";
import { CONTROL_REPLAY_AUTHORITY_IDENTITY } from "@/lib/trader/observability/control-replay-test-authority";
import {
  AUTHORITY_CHAIN_STAGES,
  AuthorityChainViolationError,
  RiskImprovementForbiddenError,
  assertAuthorityChainStageCompleteness,
  clampRiskProposalDownwardOnly,
  V2_CAPITAL_AUTHORITY_PATH,
} from "@/lib/trader/risk/authority-chain";

describe("control-replay-scientific-v2-driver-v1 (DEE-518 Closure V)", () => {
  it("1–4: authoritative CR entrypoint Forecast→Decision→desired-size→Portfolio→Risk→Execution", async () => {
    const result = await runScientificControlReplayV2Ceremony();
    expect([...result.completedStages]).toEqual([...AUTHORITY_CHAIN_STAGES]);
    expect(result.packageContentDigestHex).toMatch(/^[a-f0-9]{64}$/);
    expect(result.distributionSemanticDigestExec).toMatch(/^[a-f0-9]{64}$/);
    expect(result.capitalAuthorityPath).toBe(V2_CAPITAL_AUTHORITY_PATH);
    expect(result.desiredQuantity).not.toBe("0.01");
    expect(Number(result.desiredQuantity)).toBeGreaterThan(0);
    if (result.decisionActionable) {
      expect(result.orderId).toBeTruthy();
      expect(Number(result.executionQuantity)).toBeGreaterThan(0);
    }
    expect(result.authority).toEqual(CONTROL_REPLAY_AUTHORITY_IDENTITY);
  }, 120_000);

  it("5–7: StrategySignal confidence/expectedEdge/maxRisk have zero V2 economic/sizing effect", async () => {
    const base = await runScientificControlReplayV2Ceremony();
    const mutated = await runScientificControlReplayV2Ceremony({
      legacyStrategySignalPatch: {
        confidence: "0.0001",
        expectedEdge: "0",
        maxRisk: "0.0000001",
      },
    });
    expect(mutated.evLowerScale8).toBe(base.evLowerScale8);
    expect(mutated.evBaseScale8).toBe(base.evBaseScale8);
    expect(mutated.evUpperScale8).toBe(base.evUpperScale8);
    expect(mutated.decisionActionable).toBe(base.decisionActionable);
    expect(mutated.desiredQuantity).toBe(base.desiredQuantity);
    expect(mutated.executionQuantity).toBe(base.executionQuantity);
    expect(mutated.legacyStrategyDiagnostics.legacyDiagnosticConfidence).toBe("0.0001");
    expect(mutated.legacyStrategyDiagnostics.legacyDiagnosticExpectedEdge).toBe("0");
    expect(mutated.legacyStrategyDiagnostics.legacyDiagnosticMaxRisk).toBe("0.0000001");
  }, 180_000);

  it("8: Hypothesis conviction mutation cannot become Forecast probability/EV", async () => {
    const base = await runScientificControlReplayV2Ceremony();
    const mutated = await runScientificControlReplayV2Ceremony({ convictionValue: 0.999 });
    expect(mutated.packageContentDigestHex).toBe(base.packageContentDigestHex);
    expect(mutated.evBaseScale8).toBe(base.evBaseScale8);
    expect(mutated.decisionActionable).toBe(base.decisionActionable);
  }, 180_000);

  it("9–10: missing/mismatched scientific admission fails closed", async () => {
    await expect(
      runScientificControlReplayV2Ceremony({
        scientificAdmissionReceiptDigestOverride: null,
      }),
    ).rejects.toBeInstanceOf(AuthorityChainViolationError);

    await expect(
      runScientificControlReplayV2Ceremony({
        scientificAdmissionReceiptDigestOverride: "a".repeat(64),
      }),
    ).rejects.toBeInstanceOf(AuthorityChainViolationError);
  }, 180_000);

  it("11–12: EV_lower≤EV_base≤EV_upper; EV_lower≤0 → NON_ACTIONABLE", async () => {
    const result = await runScientificControlReplayV2Ceremony();
    expect(Number(result.evLowerScale8)).toBeLessThanOrEqual(Number(result.evBaseScale8));
    expect(Number(result.evBaseScale8)).toBeLessThanOrEqual(Number(result.evUpperScale8));
    if (Number(result.evLowerScale8) <= 0) {
      expect(result.decisionActionable).toBe(false);
    }
  }, 120_000);

  it("13: Risk cannot increase proposal", () => {
    expect(() =>
      clampRiskProposalDownwardOnly({
        proposedQuantity: "1",
        riskApprovedQuantity: "2",
      }),
    ).toThrow(RiskImprovementForbiddenError);
    expect(
      clampRiskProposalDownwardOnly({
        proposedQuantity: "2",
        riskApprovedQuantity: "1",
      }),
    ).toBe("1");
  });

  it("14–17: omit Forecast/Decision/Risk/Execution fails closed", async () => {
    for (const stage of ["FORECAST", "DECISION", "RISK", "EXECUTION"] as const) {
      await expect(
        runScientificControlReplayV2Ceremony({ omitStages: [stage] }),
      ).rejects.toMatchObject({
        code: "AUTHORITY_CHAIN_VIOLATION",
        message: expect.stringContaining(stage),
      });
    }
    expect(() => assertAuthorityChainStageCompleteness(["FORECAST", "DECISION"])).toThrow(
      AuthorityChainViolationError,
    );
  }, 240_000);

  it("18–19: TEST_ONLY Control Replay cannot escape; capitalEligible=false", async () => {
    const result = await runScientificControlReplayV2Ceremony();
    expect(result.authority.capitalEligible).toBe(false);
    expect(result.authority.executionPurpose).toBe("CONTROL_REPLAY");
    expect(result.authority.executionMode).toBe("mock");
    expect(result.authority.authorityClass).toBe("TEST_ONLY");
  }, 120_000);

  it("20: replay/parity identity remains deterministic", async () => {
    await assertScientificControlReplayV2TwoRunParity();
  }, 180_000);
});
