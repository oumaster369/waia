import { describe, expect, it } from "vitest";

import { DEFAULT_DISCOVERY_RUN_CONFIG } from "@/lib/trader/discovery/discovery.types";
import { NoReinforcementGuardError } from "@/lib/trader/discovery/no-reinforcement-guard";
import {
  qualifyFutureCycleEpistemicEffectV2,
  type KnowledgeNavigatorCandidateV2,
  type SelectKnowledgeForQuestionV2Input,
} from "@/lib/trader/knowledge/navigator";
import {
  admitHumanResearchCandidateAssignmentV2,
  assertResearchJobCannotClaimCapitalRuntimeV2,
  assignStrategyCandidateToAccountV2,
  buildClosedTradeOutcomeEvidencePackageV2,
  completeResearchJobV2,
  deriveStrategyEvolutionGenerationV2,
  discardLosingOutcomesFromEvidencePackageV2,
  enqueueResearchJobV2,
  filterResearchMemoryByProfitabilityV2,
  FORBIDDEN_RESEARCH_TEMPLATE_STRATEGY_ID_V2,
  generateStrategyEvolutionCandidateV2,
  mergeHumanResearchAssignmentsV2,
  promoteStrategyCandidateV2,
  queryBlindHoldoutAsIterativeFitnessV2,
  recordQualificationV2,
  rerecordRejectedCandidateAsPromotedV2,
  runStrategyEvolutionResearchPassV2,
  StrategyEvolutionResearchError,
  type ClosedTradeOutcomeInputV2,
  type QualificationEvaluationV2,
  type RunStrategyEvolutionResearchPassV2Input,
  type StrategyParentRefV2,
} from "@/lib/trader/research-v2";

const DIGEST = {
  a: "a".repeat(64),
  b: "b".repeat(64),
  c: "c".repeat(64),
  d: "d".repeat(64),
  e: "e".repeat(64),
};
const PIT = "2026-02-01T12:00:00.000Z";
const PRIOR_PIT = "2026-01-31T12:00:00.000Z";
const CUTOFF = "2026-02-01T11:00:00.000Z";

function outcome(
  overrides: Partial<ClosedTradeOutcomeInputV2> & Pick<ClosedTradeOutcomeInputV2, "outcomeId">,
): ClosedTradeOutcomeInputV2 {
  return {
    closedTradeRef: `trade-${overrides.outcomeId}`,
    observedAtUtc: CUTOFF,
    netEconomicResult: "1",
    causalContextDigestHex: DIGEST.a,
    ...overrides,
  };
}

function parent(id: string, digest: string): StrategyParentRefV2 {
  return {
    strategyId: id,
    strategyVersion: "1.0.0",
    params: { lookbackBars: "20", holdBars: "4" },
    artifactDigestHex: digest,
  };
}

function evaluation(overrides: Partial<QualificationEvaluationV2> = {}): QualificationEvaluationV2 {
  return {
    netEconomicResult: "2.5",
    maxDrawdown: "-1.0",
    tailEventCount: 1,
    sampleSize: 12,
    incumbentComparisonDigestHex: DIGEST.b,
    ...overrides,
  };
}

function walkForwardEvaluation(): QualificationEvaluationV2 {
  return evaluation({
    netEconomicResult: "1.25",
    maxDrawdown: "-1.5",
    tailEventCount: 2,
    sampleSize: 8,
    incumbentComparisonDigestHex: DIGEST.a,
  });
}

function navigatorCandidate(
  overrides: Partial<KnowledgeNavigatorCandidateV2> = {},
): KnowledgeNavigatorCandidateV2 {
  return {
    knowledgeEdgeId: "edge-1",
    version: 1,
    contentDigestHex: DIGEST.c,
    organizationId: "org-646",
    symbol: "BTCUSDT",
    questionId: "WHAT_HAPPENING",
    pitEventAt: "2026-01-31T11:00:00.000Z",
    lifecycleState: "ACTIVE",
    verified: true,
    fromRef: "btc-regime",
    toRef: "btc-move",
    relationKind: "EXPLAINS",
    ...overrides,
  };
}

function navigatorSelect(
  overrides: Partial<SelectKnowledgeForQuestionV2Input> = {},
): SelectKnowledgeForQuestionV2Input {
  return {
    organizationId: "org-646",
    runId: "run-1",
    symbol: "BTCUSDT",
    purpose: "strategy-evolution-research",
    questionId: "WHAT_HAPPENING",
    pitAnchor: PIT,
    informationNeedPlanDigestHex: DIGEST.a,
    evidenceBudget: 2,
    maxStalenessMs: 48 * 60 * 60 * 1000,
    candidates: [navigatorCandidate()],
    ...overrides,
  };
}

function futureCycle() {
  return qualifyFutureCycleEpistemicEffectV2({
    evidenceClass: "SEALED_FORECAST_OUTCOME_CALIBRATION",
    effectKind: "SUPPORT",
    producedByReceiptDigestHex: DIGEST.d,
    prior: navigatorSelect({ pitAnchor: PRIOR_PIT, runId: "run-0" }),
    future: navigatorSelect({ pitAnchor: PIT, runId: "run-1" }),
  });
}

function defaultGeneration() {
  return {
    kind: "PARAMETER_MUTATION" as const,
    candidateId: "cand-646",
    strategyId: "mean_reversion_research",
    strategyVersion: "1.1.0",
    parents: [parent("mean_reversion_research", DIGEST.e)],
    params: { lookbackBars: "24", holdBars: "4" },
  };
}

function passInput(
  overrides: Partial<RunStrategyEvolutionResearchPassV2Input> = {},
): RunStrategyEvolutionResearchPassV2Input {
  return {
    organizationId: "org-646",
    campaignId: "camp-646",
    symbol: "BTCUSDT",
    evidenceCutoffUtc: CUTOFF,
    researchCodeIdentity: "research-code/v2",
    costModelIdentity: "cost-model/v2",
    outcomes: [
      outcome({ outcomeId: "win-1", netEconomicResult: "12.5" }),
      outcome({ outcomeId: "loss-1", netEconomicResult: "-8.25" }),
    ],
    navigatorSelect: navigatorSelect(),
    predictiveAdmissionVerdict: "ADMITTED",
    futureCycleEffect: futureCycle(),
    generation: defaultGeneration(),
    development: evaluation(),
    walkForward: walkForwardEvaluation(),
    qualificationVerdict: "QUALIFIED",
    ...overrides,
  };
}

describe("DEE-646 strategy evolution research-v2 spine", () => {
  it("keeps the legacy discovery orchestrator default-off", () => {
    expect(DEFAULT_DISCOVERY_RUN_CONFIG.enabled).toBe(false);
  });

  it("runs a fail-closed research pass to a Human-only pending proposal", () => {
    const first = runStrategyEvolutionResearchPassV2(passInput());
    const second = runStrategyEvolutionResearchPassV2(passInput());
    expect(first.status).toBe("HUMAN_PROPOSAL_PENDING");
    expect(first.capitalAuthority).toBe("RESEARCH_ONLY");
    expect(first.venueWriteAuthority).toBe("NONE");
    expect(first.candidate.capitalAuthority).toBe("RESEARCH_ONLY");
    expect(first.candidate.assignedAccountIds).toEqual([]);
    expect(first.proposal?.approvalAuthority).toBe("HUMAN_ONLY");
    expect(first.proposal?.disposition).toBe("pending");
    expect(first.proposal?.humanApprovalRequired).toBe(true);
    expect(first.proposal?.humanOnlyApprovalStatement).toMatch(/Human-only/);
    expect(first.proposal?.positiveEvidence.length).toBeGreaterThan(0);
    expect(first.proposal?.negativeEvidence.length).toBeGreaterThan(0);
    expect(first.development.partition).toBe("DEVELOPMENT");
    expect(first.walkForward.partition).toBe("WALK_FORWARD");
    expect(first.walkForward.fittingAllowed).toBe(false);
    expect(first.contentDigestHex).toBe(second.contentDigestHex);
  });

  it("persists losing outcomes and refuses survivorship discard", () => {
    const result = runStrategyEvolutionResearchPassV2(passInput());
    const polarities = result.evidencePackage.records.map((record) => record.polarity).sort();
    expect(polarities).toEqual(["LOSS", "PROFIT"]);
    expect(result.memory.contradictingCount).toBe(1);
    expect(result.memory.records.some((record) => record.outcomeId === "loss-1")).toBe(true);

    expect(() =>
      buildClosedTradeOutcomeEvidencePackageV2({
        organizationId: "org-646",
        campaignId: "camp-646",
        symbol: "BTCUSDT",
        evidenceCutoffUtc: CUTOFF,
        outcomes: [
          outcome({ outcomeId: "win-1", netEconomicResult: "12.5" }),
          outcome({ outcomeId: "loss-1", netEconomicResult: "-8.25" }),
        ],
        omitPolarities: ["LOSS"],
      }),
    ).toThrow(/SURVIVORSHIP_DISCARD_FORBIDDEN/);
    expect(() => discardLosingOutcomesFromEvidencePackageV2(result.evidencePackage)).toThrow(
      /SURVIVORSHIP_DISCARD_FORBIDDEN/,
    );
    expect(() => filterResearchMemoryByProfitabilityV2(result.memory, "PROFIT")).toThrow(
      /SURVIVORSHIP_DISCARD_FORBIDDEN/,
    );
  });

  it("refuses direct PnL/winRate/reward/profitable discovery fitness", () => {
    expect(() =>
      runStrategyEvolutionResearchPassV2(
        passInput({
          generation: {
            ...defaultGeneration(),
            params: { lookbackBars: "24", winRate: "0.9" },
          },
        }),
      ),
    ).toThrow(NoReinforcementGuardError);
    expect(() =>
      generateStrategyEvolutionCandidateV2({
        candidateId: "cand-bad",
        strategyId: "s",
        strategyVersion: "1",
        kind: "PARAMETER_MUTATION",
        parents: [parent("s", DIGEST.e)],
        params: { pnl: "1", reward: "2", profitable: "true" },
        hypothesis: runStrategyEvolutionResearchPassV2(passInput()).hypothesis,
        evidenceCutoffUtc: CUTOFF,
        researchCodeIdentity: "code",
        costModelIdentity: "cost",
      }),
    ).toThrow(NoReinforcementGuardError);
  });

  it("refuses candidate self-promotion and account assignment", () => {
    const result = runStrategyEvolutionResearchPassV2(passInput());
    expect(() => promoteStrategyCandidateV2(result.candidate)).toThrow(
      /CANDIDATE_SELF_PROMOTION_FORBIDDEN/,
    );
    expect(() => assignStrategyCandidateToAccountV2(result.candidate, "acct-1")).toThrow(
      /CANDIDATE_ACCOUNT_ASSIGNMENT_FORBIDDEN/,
    );
    expect(() =>
      generateStrategyEvolutionCandidateV2({
        candidateId: "cand-assign",
        strategyId: "s",
        strategyVersion: "1",
        kind: "PARAMETER_MUTATION",
        parents: [parent("s", DIGEST.e)],
        params: { lookbackBars: "8" },
        hypothesis: result.hypothesis,
        evidenceCutoffUtc: CUTOFF,
        researchCodeIdentity: "code",
        costModelIdentity: "cost",
        assignedAccountId: "acct-1",
      }),
    ).toThrow(/CANDIDATE_ACCOUNT_ASSIGNMENT_FORBIDDEN/);
    expect(result.proposal?.proposedAccountAssignments).toEqual([]);
    expect(result.proposal?.accountAssignmentAuthority).toBe("NONE");
    expect(result.proposal?.promotionAuthority).toBe("NONE");
  });

  it("keeps RESEARCH_ONLY on the research plane and fails closed on missing Navigator, raw MKB and unqualified future-cycle feedback", () => {
    const researchOnly = runStrategyEvolutionResearchPassV2(
      passInput({ predictiveAdmissionVerdict: "RESEARCH_ONLY" }),
    );
    expect(researchOnly.status).toBe("HUMAN_PROPOSAL_PENDING");
    expect(researchOnly.knowledge.status).toBe("ADMITTED");
    expect(researchOnly.capitalAuthority).toBe("RESEARCH_ONLY");
    expect(
      runStrategyEvolutionResearchPassV2(passInput({ predictiveAdmissionVerdict: "NOT_ADMITTED" }))
        .knowledge.reasonCodes,
    ).toContain("PREDICTIVE_ADMISSION_NOT_ADMITTED");
    expect(
      runStrategyEvolutionResearchPassV2(passInput({ navigatorSelect: null })).knowledge
        .reasonCodes,
    ).toContain("NAVIGATOR_RECEIPT_MISSING");
    expect(
      runStrategyEvolutionResearchPassV2(passInput({ mkbInjectionAttempted: true })).knowledge
        .reasonCodes,
    ).toContain("RAW_MKB_INJECTION_FORBIDDEN");

    const unqualified = qualifyFutureCycleEpistemicEffectV2({
      evidenceClass: "PNL_ONLY",
      effectKind: "SUPPORT",
      producedByReceiptDigestHex: DIGEST.d,
      prior: navigatorSelect({ pitAnchor: PRIOR_PIT, runId: "run-0" }),
      future: navigatorSelect({ pitAnchor: PIT, runId: "run-1" }),
    });
    const unqualifiedPass = runStrategyEvolutionResearchPassV2(
      passInput({ futureCycleEffect: unqualified }),
    );
    expect(unqualifiedPass.knowledge.reasonCodes).toContain("UNQUALIFIED_FEEDBACK_FORBIDDEN");
    expect(unqualifiedPass.status).toBe("FAIL_CLOSED");
    expect(unqualifiedPass.proposal).toBeNull();
    expect(unqualifiedPass.capitalAuthority).toBe("NONE");

    const zeroEffect = qualifyFutureCycleEpistemicEffectV2({
      evidenceClass: "SEALED_FORECAST_OUTCOME_CALIBRATION",
      effectKind: "SUPPORT",
      producedByReceiptDigestHex: DIGEST.d,
      prior: navigatorSelect({ pitAnchor: PRIOR_PIT, runId: "run-0" }),
      future: navigatorSelect({ pitAnchor: PRIOR_PIT, runId: "run-1" }),
    });
    expect(zeroEffect.effectKind).toBe("ZERO_EFFECT");
    const zeroPass = runStrategyEvolutionResearchPassV2(
      passInput({ futureCycleEffect: zeroEffect }),
    );
    expect(zeroPass.knowledge.reasonCodes).toContain("UNQUALIFIED_FEEDBACK_FORBIDDEN");
    expect(zeroPass.status).toBe("FAIL_CLOSED");
    expect(zeroPass.proposal).toBeNull();
  });

  it("explicitly refuses blind holdout as iterative fitness", () => {
    expect(() => queryBlindHoldoutAsIterativeFitnessV2()).toThrow(
      /BLIND_HOLDOUT_ITERATIVE_FITNESS_FORBIDDEN/,
    );
    expect(() =>
      runStrategyEvolutionResearchPassV2(passInput({ holdoutQueryAttempted: true })),
    ).toThrow(/BLIND_HOLDOUT_ITERATIVE_FITNESS_FORBIDDEN/);
    const result = runStrategyEvolutionResearchPassV2(passInput());
    expect(() =>
      recordQualificationV2({
        candidate: result.candidate,
        partition: "BLIND_HOLDOUT",
        evaluation: evaluation(),
        verdict: "QUALIFIED",
      }),
    ).toThrow(/BLIND_HOLDOUT_ITERATIVE_FITNESS_FORBIDDEN/);
  });

  it("records a failed candidate as REJECTED and keeps it rejected", () => {
    const result = runStrategyEvolutionResearchPassV2(
      passInput({
        qualificationVerdict: "REJECTED",
        failureReasons: ["WALK_FORWARD_DID_NOT_BEAT_INCUMBENT"],
      }),
    );
    expect(result.status).toBe("REJECTED");
    expect(result.proposal).toBeNull();
    expect(result.rejectedRecord?.status).toBe("REJECTED");
    expect(result.rejectedRecord?.recorded).toBe(true);
    expect(result.walkForward.verdict).toBe("REJECTED");
    const rejectedRecord = result.rejectedRecord;
    expect(rejectedRecord).not.toBeNull();
    if (!rejectedRecord) {
      throw new Error("expected rejected record");
    }
    expect(() => rerecordRejectedCandidateAsPromotedV2(rejectedRecord)).toThrow(
      /CANDIDATE_SELF_PROMOTION_FORBIDDEN/,
    );
    expect(result.retirementProposal?.approvalAuthority).toBe("HUMAN_ONLY");
    expect(result.retirementProposal?.capitalAuthority).toBe("NONE");
    expect(result.retirementProposal?.liveDemotionAuthority).toBe("NONE");
    expect(result.retirementProposal?.disposition).toBe("pending");
    expect(result.retirementProposal?.rejectedRecordDigestHex).toBe(
      rejectedRecord.contentDigestHex,
    );
  });

  it("includes positive and negative evidence and states Human-only approval", () => {
    const result = runStrategyEvolutionResearchPassV2(passInput());
    expect(result.proposal?.positiveEvidence.map((row) => row.outcomeId)).toContain("win-1");
    expect(result.proposal?.negativeEvidence.map((row) => row.outcomeId)).toContain("loss-1");
    expect(result.proposal?.approvalAuthority).toBe("HUMAN_ONLY");
    expect(result.proposal?.disposition).toBe("pending");
  });

  it("generates parameter-mutation and multi-parent combination lineage", () => {
    const mutated = runStrategyEvolutionResearchPassV2(passInput());
    expect(mutated.candidate.lineage.generationKind).toBe("PARAMETER_MUTATION");
    expect(mutated.candidate.lineage.parents).toHaveLength(1);
    expect(mutated.candidate.params.lookbackBars).toBe("24");

    const combined = runStrategyEvolutionResearchPassV2(
      passInput({
        generation: {
          kind: "MULTI_PARENT_COMBINATION",
          candidateId: "cand-combine",
          strategyId: "combined_research",
          strategyVersion: "0.2.0",
          parents: [
            parent("mean_reversion_research", DIGEST.e),
            parent("breakout_research", DIGEST.d),
          ],
          params: { lookbackBars: "16", breakoutBars: "8" },
        },
      }),
    );
    expect(combined.candidate.lineage.generationKind).toBe("MULTI_PARENT_COMBINATION");
    expect(combined.candidate.lineage.parents.map((row) => row.strategyId).sort()).toEqual([
      "breakout_research",
      "mean_reversion_research",
    ]);
    expect(combined.hypothesis.falsificationConditions.length).toBeGreaterThan(0);
  });

  it("is a StrategyEvolutionResearchError for lineage and survivorship codes", () => {
    const error = new StrategyEvolutionResearchError("SURVIVORSHIP_DISCARD_FORBIDDEN");
    expect(error.code).toBe("SURVIVORSHIP_DISCARD_FORBIDDEN");
  });

  it("derives PARAMETER_MUTATION from one parent without reading outcome PnL", () => {
    const derived = deriveStrategyEvolutionGenerationV2({
      candidateId: "cand-derived",
      parents: [parent("mean_reversion_research", DIGEST.e)],
      researchCodeIdentity: "research-code/v2",
    });
    expect(derived.kind).toBe("PARAMETER_MUTATION");
    expect(derived.strategyId).toBe("mean_reversion_research");
    expect(derived.strategyVersion).toBe("1.0.1");
    expect(derived.params.holdBars).toBe("5");
    expect(derived.params.lookbackBars).toBe("20");
    expect(derived.params).not.toEqual(parent("mean_reversion_research", DIGEST.e).params);

    const result = runStrategyEvolutionResearchPassV2(
      passInput({
        generation: undefined,
        parentStrategies: [parent("mean_reversion_research", DIGEST.e)],
      }),
    );
    expect(result.candidate.lineage.generationKind).toBe("PARAMETER_MUTATION");
    expect(result.candidate.params.holdBars).toBe("5");
    expect(result.status).toBe("HUMAN_PROPOSAL_PENDING");
  });

  it("derives MULTI_PARENT_COMBINATION from two distinct parents", () => {
    const second: StrategyParentRefV2 = {
      ...parent("breakout_research", DIGEST.d),
      params: { lookbackBars: "16", breakoutBars: "8" },
    };
    const derived = deriveStrategyEvolutionGenerationV2({
      candidateId: "cand-combo",
      parents: [parent("mean_reversion_research", DIGEST.e), second],
      researchCodeIdentity: "research-code/v2",
    });
    expect(derived.kind).toBe("MULTI_PARENT_COMBINATION");
    expect(derived.strategyId).toBe("combination/breakout_research+mean_reversion_research");
    expect(derived.params.breakoutBars).toBe("8");
    expect(derived.params.lookbackBars).toBe("16");

    const result = runStrategyEvolutionResearchPassV2(
      passInput({
        generation: undefined,
        parentStrategies: [parent("mean_reversion_research", DIGEST.e), second],
      }),
    );
    expect(result.candidate.lineage.generationKind).toBe("MULTI_PARENT_COMBINATION");
    expect(result.candidate.lineage.parents).toHaveLength(2);
  });

  it("refuses the default template identity and incomplete generation", () => {
    expect(FORBIDDEN_RESEARCH_TEMPLATE_STRATEGY_ID_V2).toBe("mean_reversion_v0");
    expect(() =>
      deriveStrategyEvolutionGenerationV2({
        candidateId: "cand-template",
        parents: [parent(FORBIDDEN_RESEARCH_TEMPLATE_STRATEGY_ID_V2, DIGEST.e)],
        researchCodeIdentity: "research-code/v2",
      }),
    ).toThrow(/FORBIDDEN_TEMPLATE_STRATEGY_IDENTITY/);
    expect(() => runStrategyEvolutionResearchPassV2(passInput({ generation: undefined }))).toThrow(
      /GENERATION_INCOMPLETE/,
    );
  });

  it("refuses identical DEVELOPMENT and walk-forward evaluations", () => {
    expect(() =>
      runStrategyEvolutionResearchPassV2(
        passInput({
          walkForward: evaluation(),
        }),
      ),
    ).toThrow(/QUALIFICATION_PARTITIONS_NOT_INDEPENDENT/);
  });

  it("resumes campaign memory without dropping a prior LOSS", () => {
    const first = runStrategyEvolutionResearchPassV2(passInput());
    expect(first.memory.records.some((record) => record.outcomeId === "loss-1")).toBe(true);

    const second = runStrategyEvolutionResearchPassV2(
      passInput({
        priorMemory: first.memory,
        outcomes: [
          outcome({ outcomeId: "win-1", netEconomicResult: "12.5" }),
          outcome({ outcomeId: "loss-1", netEconomicResult: "-8.25" }),
          outcome({ outcomeId: "loss-2", netEconomicResult: "-3.5" }),
        ],
      }),
    );
    expect(second.memory.records.map((record) => record.outcomeId).sort()).toEqual([
      "loss-1",
      "loss-2",
      "win-1",
    ]);
    expect(second.memory.contradictingCount).toBe(2);
    expect(second.proposal?.negativeEvidence.map((row) => row.outcomeId).sort()).toEqual([
      "loss-1",
      "loss-2",
    ]);
  });

  it("admits Human RESEARCH assignment of one strategy to many accounts and one account to many strategies", () => {
    const first = runStrategyEvolutionResearchPassV2(passInput());
    const firstProposal = first.proposal;
    expect(firstProposal).not.toBeNull();
    if (!firstProposal) {
      throw new Error("expected promotion proposal");
    }
    expect(first.retirementProposal).toBeNull();

    const firstAssignment = admitHumanResearchCandidateAssignmentV2({
      organizationId: "org-646",
      proposal: firstProposal,
      candidate: first.candidate,
      humanActorId: "human-adamar",
      operatorAttestationDigestHex: DIGEST.a,
      lifecycle: "RESEARCH",
      accounts: [
        { organizationId: "org-646", accountId: "acct-a" },
        { organizationId: "org-646", accountId: "acct-b" },
      ],
    });
    expect(firstAssignment.assignmentAuthority).toBe("HUMAN_ONLY");
    expect(firstAssignment.liveAuthority).toBe("NONE");
    expect(firstAssignment.capitalAuthority).toBe("NONE");
    expect(firstAssignment.accountIds).toEqual(["acct-a", "acct-b"]);
    expect(firstAssignment.strategyId).toBe(first.candidate.strategyId);

    const second = runStrategyEvolutionResearchPassV2(
      passInput({
        generation: {
          kind: "PARAMETER_MUTATION",
          candidateId: "cand-breakout",
          strategyId: "breakout_research",
          strategyVersion: "1.1.0",
          parents: [parent("breakout_research", DIGEST.d)],
          params: { lookbackBars: "16", holdBars: "5" },
        },
      }),
    );
    expect(second.proposal).not.toBeNull();
    if (!second.proposal) {
      throw new Error("expected second promotion proposal");
    }

    const secondAssignment = admitHumanResearchCandidateAssignmentV2({
      organizationId: "org-646",
      proposal: second.proposal,
      candidate: second.candidate,
      humanActorId: "human-adamar",
      operatorAttestationDigestHex: DIGEST.a,
      lifecycle: "PAPER",
      accounts: [{ organizationId: "org-646", accountId: "acct-a" }],
    });
    expect(secondAssignment.strategyId).toBe("breakout_research");
    expect(secondAssignment.accountIds).toEqual(["acct-a"]);

    const merged = mergeHumanResearchAssignmentsV2(firstAssignment, secondAssignment);
    expect(merged).toHaveLength(2);
    expect(merged.map((row) => row.strategyId).sort()).toEqual([
      "breakout_research",
      first.candidate.strategyId,
    ]);

    expect(() =>
      admitHumanResearchCandidateAssignmentV2({
        organizationId: "org-646",
        proposal: firstProposal,
        candidate: first.candidate,
        humanActorId: "human-adamar",
        operatorAttestationDigestHex: DIGEST.a,
        lifecycle: "RESEARCH",
        accounts: [{ organizationId: "org-foreign", accountId: "acct-a" }],
      }),
    ).toThrow(/HUMAN_ASSIGNMENT_TENANT_ISOLATION/);

    expect(() =>
      admitHumanResearchCandidateAssignmentV2({
        organizationId: "org-646",
        proposal: firstProposal,
        candidate: first.candidate,
        humanActorId: "human-adamar",
        operatorAttestationDigestHex: DIGEST.a,
        lifecycle: "LIVE",
        accounts: [{ organizationId: "org-646", accountId: "acct-a" }],
      }),
    ).toThrow(/LIVE_ASSIGNMENT_FORBIDDEN/);

    expect(() =>
      admitHumanResearchCandidateAssignmentV2({
        organizationId: "org-646",
        proposal: firstProposal,
        candidate: first.candidate,
        humanActorId: "human-adamar",
        operatorAttestationDigestHex: DIGEST.a,
        lifecycle: "RESEARCH",
        accounts: [{ organizationId: "org-646", accountId: "acct-a" }],
        candidateSelfAssignAttempted: true,
      }),
    ).toThrow(/CANDIDATE_ACCOUNT_ASSIGNMENT_FORBIDDEN/);
  });

  it("isolates research jobs from capital runtime classes and yields when capital is active", () => {
    expect(() => assertResearchJobCannotClaimCapitalRuntimeV2("GUARDIAN")).toThrow(
      /RESEARCH_CANNOT_CLAIM_CAPITAL_RUNTIME/,
    );
    expect(() =>
      enqueueResearchJobV2({
        jobId: "job-1",
        organizationId: "org-646",
        campaignId: "camp-646",
        budgetMs: 1,
        claimedRuntimeClass: "EXECUTION",
      }),
    ).toThrow(/RESEARCH_CANNOT_CLAIM_CAPITAL_RUNTIME/);
    expect(() =>
      enqueueResearchJobV2({
        jobId: "job-1",
        organizationId: "org-646",
        campaignId: "camp-646",
        budgetMs: 1,
        mutateAssignmentAttempted: true,
      }),
    ).toThrow(/RESEARCH_CANNOT_MUTATE_ASSIGNMENT/);
    expect(() =>
      enqueueResearchJobV2({
        jobId: "job-1",
        organizationId: "org-646",
        campaignId: "camp-646",
        budgetMs: 1,
        holdoutQueryAttempted: true,
      }),
    ).toThrow(/BLIND_HOLDOUT_ITERATIVE_FITNESS_FORBIDDEN/);

    const yielded = enqueueResearchJobV2({
      jobId: "job-yield",
      organizationId: "org-646",
      campaignId: "camp-646",
      budgetMs: 25,
      capitalRuntimeActive: true,
    });
    expect(yielded.status).toBe("YIELDED");
    expect(yielded.yieldReason).toBe("CAPITAL_RUNTIME_ACTIVE");
    expect(yielded.jobClass).toBe("RESEARCH_BACKGROUND");
    expect(yielded.capitalAuthority).toBe("NONE");
    expect(() => completeResearchJobV2(yielded)).toThrow(/RESEARCH_JOB_YIELDED_TO_CAPITAL_RUNTIME/);

    const queued = enqueueResearchJobV2({
      jobId: "job-ok",
      organizationId: "org-646",
      campaignId: "camp-646",
      budgetMs: 25,
    });
    expect(queued.status).toBe("QUEUED");
    expect(completeResearchJobV2(queued).status).toBe("COMPLETED");
  });
});
