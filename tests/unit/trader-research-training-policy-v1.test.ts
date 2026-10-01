import { describe, expect, it } from "vitest";

import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import {
  deriveCurrentResearchTrainingPolicyV1,
  resolveResearchTrainingPolicyV1,
} from "@/lib/trader/research/research-training-policy-v1";
import { buildResearchExperimentProposalV1 } from "@/tests/helpers/research-experiment-fixture";

function canonicalProposal() {
  const current = deriveCurrentResearchTrainingPolicyV1();
  const proposal = buildResearchExperimentProposalV1(
    "00000000-0000-4000-8000-000000001159", "training-policy",
  );
  proposal.replay.portfolio = {
    startingBalanceUsdt: current.portfolio.runConfig.startingBalanceUsdt,
    maxRiskPerTradePct: current.portfolio.limits.maxRiskPerTradePct,
    maxPortfolioRiskPct: current.portfolio.limits.maxPortfolioRiskPct,
    maxConcurrentPositions: current.portfolio.limits.maxConcurrentPositions,
    maxNotional: current.portfolio.limits.maxNotional,
    defaultStopDistancePct: null,
  };
  proposal.replay.guardian.enabled = true;
  proposal.replay.guardian.resolvedPolicySha256 = current.guardianResolvedPolicySha256;
  proposal.replay.historicalExecutionModelSha256 = current.historicalExecutionModelSha256;
  return proposal;
}

describe("DEE-1159 closed research training policy resolution", () => {
  it("derives the effective HTR/D5/D20 identities from current code and freezes the output", () => {
    const current = deriveCurrentResearchTrainingPolicyV1();
    const accepted = resolveResearchTrainingPolicyV1(canonicalProposal());
    expect(accepted).toMatchObject({
      authority: "POLICY_CONSISTENCY_ONLY",
      capitalEligible: false,
      scientificQualified: false,
      declaredQuantityCap: "0.01",
      portfolio: { runConfig: { startingBalanceUsdt: "100000.00",
        defaultStopDistancePct: "0.02" }, limits: { maxRiskPerTradePct: "0.10",
        maxPortfolioRiskPct: "0.50", maxConcurrentPositions: 10, maxNotional: "100000.00" } },
      guardian: { drawdownPolicyVersion: "htr-wp16-d20-drawdown/v1",
        runConfig: { enabled: true, maxHoldBars: 0, barIntervalMs: 60_000 } },
      historicalExecutionModelSha256: computeStableJsonDigest(createHistoricalExecutionModelV1()),
      guardianResolvedPolicySha256: current.guardianResolvedPolicySha256,
    });
    for (const value of [accepted, accepted.portfolio, accepted.portfolio.runConfig,
      accepted.portfolio.limits, accepted.guardian, accepted.guardian.runConfig,
      accepted.guardian.drawdownPolicy, accepted.costAuthority]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    expect(accepted.requestedExecutableSourceSha256).toBe("c".repeat(64));
    expect("observedExecutableSourceSha256" in accepted).toBe(false);
    expect("executionAuthorized" in accepted).toBe(false);
  });

  it("normalizes the declared null stop default and the exact effective 2% value", () => {
    const explicit = canonicalProposal();
    (explicit.replay.portfolio as { defaultStopDistancePct: string | null }).defaultStopDistancePct = "0.02";
    const implicit = resolveResearchTrainingPolicyV1(canonicalProposal());
    const resolved = resolveResearchTrainingPolicyV1(explicit);
    expect(resolved.guardianResolvedPolicySha256).toBe(implicit.guardianResolvedPolicySha256);
    expect(resolved.portfolio.runConfig).toEqual(implicit.portfolio.runConfig);
  });

  it("keeps requested default quantity as a cap, outside the approved policy digest", () => {
    const changed = canonicalProposal();
    changed.replay.defaultQuantity = "0.02";
    const accepted = resolveResearchTrainingPolicyV1(changed);
    expect(accepted.declaredQuantityCap).toBe("0.02");
    expect(accepted.guardianResolvedPolicySha256).toBe(
      resolveResearchTrainingPolicyV1(canonicalProposal()).guardianResolvedPolicySha256,
    );
    expect("approvedQuantity" in accepted).toBe(false);
  });

  it.each([
    ["starting balance", (value: ReturnType<typeof canonicalProposal>) => { value.replay.portfolio.startingBalanceUsdt = "99999"; }],
    ["risk fraction", (value: ReturnType<typeof canonicalProposal>) => { value.replay.portfolio.maxRiskPerTradePct = "0.11"; }],
    ["portfolio fraction", (value: ReturnType<typeof canonicalProposal>) => { value.replay.portfolio.maxPortfolioRiskPct = "0.51"; }],
    ["position count", (value: ReturnType<typeof canonicalProposal>) => { value.replay.portfolio.maxConcurrentPositions = 11; }],
    ["notional cap", (value: ReturnType<typeof canonicalProposal>) => { value.replay.portfolio.maxNotional = "99999"; }],
    ["stop default", (value: ReturnType<typeof canonicalProposal>) => {
      (value.replay.portfolio as { defaultStopDistancePct: string | null }).defaultStopDistancePct = "0.03";
    }],
  ])("refuses unsupported portfolio %s", (_name, mutate) => {
    const value = canonicalProposal();
    mutate(value);
    expect(() => resolveResearchTrainingPolicyV1(value)).toThrow(/UNSUPPORTED_PORTFOLIO/);
  });

  it.each([
    ["disabled", (value: ReturnType<typeof canonicalProposal>) => { value.replay.guardian.enabled = false; }],
    ["hold limit", (value: ReturnType<typeof canonicalProposal>) => { value.replay.guardian.maxHoldBars = 5; }],
    ["interval", (value: ReturnType<typeof canonicalProposal>) => { value.replay.guardian.barIntervalMs = 900_000; }],
    ["exit engine", (value: ReturnType<typeof canonicalProposal>) => { value.replay.guardian.enableExitEngine = true; }],
    ["not authoritative", (value: ReturnType<typeof canonicalProposal>) => { value.replay.guardian.htrAuthoritative = false; }],
  ])("refuses unsupported Guardian %s", (_name, mutate) => {
    const value = canonicalProposal();
    mutate(value);
    expect(() => resolveResearchTrainingPolicyV1(value)).toThrow(/UNSUPPORTED_GUARDIAN/);
  });

  it("refuses fused context, model drift, cost drift and requested policy drift", () => {
    const cases = [
      [(value: ReturnType<typeof canonicalProposal>) => { value.replay.enableReplayFusedContext = true; },
        /UNSUPPORTED_INTELLIGENCE_PROFILE/],
      [(value: ReturnType<typeof canonicalProposal>) => { value.replay.historicalExecutionModelSha256 = "6".repeat(64); },
        /HISTORICAL_MODEL_MISMATCH/],
      [(value: ReturnType<typeof canonicalProposal>) => { value.costs.feeBps = "21" as "20"; },
        /feeBps|literal|invalid/i],
      [(value: ReturnType<typeof canonicalProposal>) => { value.replay.guardian.resolvedPolicySha256 = "8".repeat(64); },
        /GUARDIAN_POLICY_MISMATCH/],
    ] as const;
    for (const [mutate, refusal] of cases) {
      const value = canonicalProposal();
      mutate(value);
      expect(() => resolveResearchTrainingPolicyV1(value)).toThrow(refusal);
    }
  });
});
