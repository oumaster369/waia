import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { defineInformationInquiryPolicyV1 } from "@/lib/trader/intelligence/information-inquiry/contracts-v1";
import {
  buildInformationNeedPlanningBundleV1,
  type HypothesisDiscriminatorInputV1,
  type InformationContradictionInputV1,
} from "@/lib/trader/intelligence/information-inquiry/information-need-planner-v1";
import { defineTopDownReconstructionV1 } from "@/lib/trader/intelligence/information-inquiry/top-down-reconstruction-v1";
import {
  defineRequiredInformationProfileV2,
  evaluateInformationSufficiencyV2,
  type InformationEvidenceV2,
  type InformationQuestionRequirementV2,
} from "@/lib/trader/intelligence/information-sufficiency";
import { CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION } from "@/lib/trader/mi/canonical-observation-v1";

const hex = (value: string) => createHash("sha256").update(value).digest("hex");
const PIT = "2026-08-24T12:00:00.000Z";

function requirement(
  overrides: Partial<InformationQuestionRequirementV2> = {},
): InformationQuestionRequirementV2 {
  return {
    id: "why-news",
    questionId: "Q_WHY_HAPPENING",
    classification: "OPTIONAL_ENRICHMENT",
    contextTriggerKey: null,
    satisfiers: [{ evidenceFamily: "news", providerIds: ["news_a"], substitutionRuleId: null }],
    allowedObservationKinds: ["news_headline"],
    allowedObservationSchemaVersions: [CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION],
    allowedMeasurementDefinitionDigests: [],
    maxStalenessMs: 60_000,
    minimumTrustScore: null,
    minimumIndependentGroups: 1,
    contradictionPolicy: "FAIL_UNRESOLVED",
    requirePitQualified: true,
    requireReplayEligible: true,
    inquiryBounds: { maxDepth: 2, maxDurationMs: 1_000, maxProviderFanout: 1 },
    ...overrides,
  };
}

function profile(requirements: readonly InformationQuestionRequirementV2[] = [requirement()]) {
  return defineRequiredInformationProfileV2({
    organizationId: "org-a",
    accountId: "account-a",
    profileVersion: "profile-v1",
    purpose: "NEW_OPPORTUNITY",
    symbol: "BTC/USDT",
    venue: "HTX",
    analyticalTimeframe: "1m",
    horizon: "15m",
    forecastPackageId: null,
    forecastPackageContentDigest: null,
    inputContractContentDigest: null,
    requirements,
    aggregateQualityContract: null,
  });
}

function evidence(overrides: Partial<InformationEvidenceV2> = {}): InformationEvidenceV2 {
  return {
    evidenceId: "news-evidence",
    evidenceFamily: "news",
    providerId: "news_a",
    sourceId: "source-a",
    observationId: "observation-a",
    observationKind: "news_headline",
    observationSchemaVersion: CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION,
    observationContentDigest: hex("observation"),
    trustAsOfReceiptId: hex("trust-as-of"),
    trustRevisionId: "trust-revision-a",
    trustRevisionContentDigest: hex("trust-revision"),
    measurementDefinitionId: null,
    measurementDefinitionContentDigest: null,
    measurementValueId: null,
    measurementValueContentDigest: null,
    availability: "AVAILABLE",
    availableAt: "2026-08-24T11:59:30.000Z",
    trust: "TRUSTED",
    trustScore: 1,
    pitQualified: true,
    replayEligible: true,
    dependenceGroup: "news-group-a",
    contradictionGroup: null,
    contradiction: "NONE",
    epistemicRole: "CAUSAL",
    historyScope: "NOT_HISTORICAL",
    degradationReasonCodes: [],
    ...overrides,
  };
}

function policy(requirementIds: readonly string[] = ["why-news"], maxDepth = 2) {
  return defineInformationInquiryPolicyV1({
    policyVersion: "policy-v1",
    purpose: "NEW_OPPORTUNITY_SEARCH",
    timeframePolicies: ["1d", "4h", "1h", "15m", "1m"].map((timeframe) => ({
      timeframe: timeframe as "1d" | "4h" | "1h" | "15m" | "1m",
      relevantRequirementIds: timeframe === "1h" || timeframe === "1m" ? requirementIds : [],
      maxStalenessMsByRequirement:
        timeframe === "1h" || timeframe === "1m"
          ? requirementIds.map((requirementId) => ({
              requirementId,
              maxStalenessMs: timeframe === "1m" ? 1_000 : 5_000,
            }))
          : [],
    })),
    bounds: {
      maxIterations: 3,
      maxDepth,
      maxDurationMs: 5_000,
      maxProviderFanout: 2,
      maxQueryCount: 3,
      maxHistoricalResults: 4,
      maxAcquisitionCostUnits: 3,
    },
    costPolicy: {
      evaluatorVersion: "caller-cost-v1",
      evaluatorContentDigest: hex("cost-policy"),
      assignments: requirementIds.flatMap((requirementId) =>
        requirementId === "why-news"
          ? [
              { requirementId, providerId: "news_a", costUnits: 2 },
              { requirementId, providerId: "news_b", costUnits: 1 },
            ]
          : [{ requirementId, providerId: "history_a", costUnits: 2 }],
      ),
    },
    contradictionMaterialityPolicyVersion: "materiality-v1",
    contradictionMaterialityPolicyDigest: hex("materiality"),
    schedulingPolicyVersion: "scheduler-v1",
    schedulingPolicyDigest: hex("scheduler"),
    maxNewOpportunityWaitTurns: 2,
  });
}

function reconstruction() {
  const roles = [
    ["1d", "STRATEGIC_CONTEXT"],
    ["4h", "STRUCTURAL_REFINEMENT"],
    ["1h", "OPERATIONAL_STATE"],
    ["15m", "SETUP_CONFIRMATION"],
    ["1m", "EXECUTION_PRECISION"],
  ] as const;
  const pairs = [
    ["1d", "4h"],
    ["4h", "1h"],
    ["1h", "15m"],
    ["15m", "1m"],
  ] as const;
  return defineTopDownReconstructionV1({
    symbol: "BTC/USDT",
    pitAnchor: PIT,
    states: roles.map(([timeframe, role]) => ({
      timeframe,
      role,
      status: "AVAILABLE" as const,
      stateContentDigest: hex(`state-${timeframe}`),
      evidenceIds: [`state-${timeframe}`],
      reasonCodes: ["CALLER_STATE"],
    })),
    relations: pairs.map(([higherTimeframe, lowerTimeframe]) => ({
      higherTimeframe,
      lowerTimeframe,
      relation: "UNCLEAR" as const,
      relationPolicyVersion: "relation-v1",
      relationPolicyContentDigest: hex("relation"),
      evidenceIds: [`state-${higherTimeframe}`, `state-${lowerTimeframe}`],
      reasonCodes: ["CALLER_RELATION"],
    })),
    upwardReevaluationRequests: [],
  });
}

function build(
  selectedProfile = profile(),
  selectedEvidence: readonly InformationEvidenceV2[] = [],
  hypothesisDiscriminators: readonly HypothesisDiscriminatorInputV1[] = [],
  contradictions: readonly InformationContradictionInputV1[] = [],
  progress: Readonly<{
    iterationIndex?: number;
    queryCountConsumed?: number;
    acquisitionCostUnitsConsumed?: number;
    maxDepth?: number;
  }> = {},
) {
  const receipt = evaluateInformationSufficiencyV2({
    profile: selectedProfile,
    organizationId: "org-a",
    accountId: "account-a",
    purpose: "NEW_OPPORTUNITY",
    symbol: "BTC/USDT",
    venue: "HTX",
    analyticalTimeframe: "1m",
    horizon: "15m",
    pitAnchor: PIT,
    activeContextTriggers: [],
    evidence: selectedEvidence,
  });
  return buildInformationNeedPlanningBundleV1({
    derivationVersion: "planner-v1",
    profile: selectedProfile,
    receipt,
    policy: policy(
      selectedProfile.requirements.map((entry) => entry.id),
      progress.maxDepth,
    ),
    topDownReconstruction: reconstruction(),
    iterationIndex: progress.iterationIndex ?? 0,
    queryCountConsumed: progress.queryCountConsumed ?? 0,
    acquisitionCostUnitsConsumed: progress.acquisitionCostUnitsConsumed ?? 0,
    availableProviderIds: ["unlisted_connected", "news_a"],
    contradictions,
    analogueRequests: [],
    hypothesisDiscriminators,
  });
}

describe("DEE-697 deterministic information need planner", () => {
  it("requests only profile-authorized relevant providers and preserves ignored sources", () => {
    const bundle = build();
    expect(bundle.plan.status).toBe("READY");
    expect(bundle.plan.needs).toHaveLength(1);
    expect(bundle.plan.needs[0]?.timeframeRequirements).toEqual([
      { timeframe: "1h", maxStalenessMs: 5_000 },
      { timeframe: "1m", maxStalenessMs: 1_000 },
    ]);
    expect(bundle.plan.requestedSources.map((item) => item.providerId)).toEqual(["news_a"]);
    expect(bundle.plan.ignoredSources).toContainEqual({
      requirementId: "why-news",
      providerId: "unlisted_connected",
      reasonCode: "NOT_PROFILE_AUTHORIZED",
    });
    expect(bundle.plan.needs[0]?.reasonCodes).toContain("CAUSAL_EVIDENCE_REQUIRED");
    expect(bundle.createsKnowledgeHypothesisForecastDecisionOrCapitalAuthority).toBe(false);
    expect(Object.isFrozen(bundle.plan.needs[0]?.timeframeRequirements)).toBe(true);
  });

  it("is order-independent and excludes unrelated evidence data from causal selection", () => {
    const unrelated = evidence({
      evidenceId: "unrelated",
      evidenceFamily: "price",
      providerId: "htx_spot",
      observationId: "unrelated-observation",
      observationKind: "ohlcv_bar",
      epistemicRole: "PRICE_STATE",
    });
    const left = build(profile(), [unrelated]);
    const right = build(profile(), []);
    expect(left.plan.evidenceSelectionDigest).toBe(right.plan.evidenceSelectionDigest);
    expect(left.plan.requestedSources).toEqual(right.plan.requestedSources);
    expect(left.plan.needs).toEqual(right.plan.needs);
  });

  it("enforces requirement-global fan-out and primary satisfier priority over substitution", () => {
    const selectedProfile = profile([
      requirement({
        satisfiers: [
          { evidenceFamily: "news", providerIds: ["news_a"], substitutionRuleId: null },
          {
            evidenceFamily: "news_substitute",
            providerIds: ["news_b"],
            substitutionRuleId: "qualified-news-substitution-v1",
          },
        ],
        inquiryBounds: { maxDepth: 2, maxDurationMs: 1_000, maxProviderFanout: 1 },
      }),
    ]);
    const bundle = build(selectedProfile);
    expect(bundle.plan.requestedSources).toHaveLength(1);
    expect(bundle.plan.requestedSources[0]?.providerId).toBe("news_a");
  });

  it("fails unresolved instead of inventing provider priority inside an oversized satisfier", () => {
    const selectedProfile = profile([
      requirement({
        satisfiers: [
          {
            evidenceFamily: "news",
            providerIds: ["news_b", "news_a"],
            substitutionRuleId: null,
          },
        ],
        inquiryBounds: { maxDepth: 2, maxDurationMs: 1_000, maxProviderFanout: 1 },
      }),
    ]);
    const bundle = build(selectedProfile);
    expect(bundle.plan.requestedSources).toEqual([]);
    expect(bundle.plan.status).toBe("UNRESOLVED");
    expect(bundle.plan.ignoredSources).toContainEqual({
      requirementId: "why-news",
      providerId: "news_a",
      reasonCode: "QUERY_BUDGET_EXHAUSTED",
    });
  });

  it("does not create false needs for NOT_REQUIRED or NOT_APPLICABLE receipts", () => {
    const context = requirement({
      id: "context-liquidity",
      questionId: "Q_EXECUTION_LIQUIDITY",
      classification: "CONTEXT_TRIGGERED",
      contextTriggerKey: "EXECUTION_NEAR",
      satisfiers: [
        { evidenceFamily: "liquidity", providerIds: ["history_a"], substitutionRuleId: null },
      ],
      allowedObservationKinds: ["order_book_snapshot"],
    });
    const bundle = build(profile([context]));
    expect(bundle.plan.needs).toEqual([]);
    expect(bundle.plan.unresolvedQuestionIds).toEqual([]);
    expect(bundle.plan.status).toBe("NO_ADDITIONAL_EVIDENCE_NEEDED");
    expect(bundle.plan.ignoredSources).toContainEqual({
      requirementId: "context-liquidity",
      providerId: "news_a",
      reasonCode: "NOT_REQUIRED",
    });
  });

  it("fails closed when exact provider cost attribution is missing", () => {
    const selectedProfile = profile();
    const receipt = evaluateInformationSufficiencyV2({
      profile: selectedProfile,
      organizationId: "org-a",
      accountId: "account-a",
      purpose: "NEW_OPPORTUNITY",
      symbol: "BTC/USDT",
      venue: "HTX",
      analyticalTimeframe: "1m",
      horizon: "15m",
      pitAnchor: PIT,
      activeContextTriggers: [],
      evidence: [],
    });
    const selectedPolicy = policy();
    const forgedPolicy = {
      ...selectedPolicy,
      costPolicy: { ...selectedPolicy.costPolicy, assignments: [] },
    };
    expect(() =>
      buildInformationNeedPlanningBundleV1({
        derivationVersion: "planner-v1",
        profile: selectedProfile,
        receipt,
        policy: forgedPolicy,
        topDownReconstruction: reconstruction(),
        iterationIndex: 0,
        queryCountConsumed: 0,
        acquisitionCostUnitsConsumed: 0,
        availableProviderIds: ["news_a"],
        contradictions: [],
        analogueRequests: [],
        hypothesisDiscriminators: [],
      }),
    ).toThrow(/policyIdentity|missingCostAttribution/);
  });

  it("keeps iteration and depth bounds distinct and fails closed at maxDepth zero", () => {
    const laterIteration = build(profile(), [], [], [], {
      iterationIndex: 1,
      queryCountConsumed: 1,
      acquisitionCostUnitsConsumed: 1,
      maxDepth: 2,
    });
    expect(laterIteration.plan.status).toBe("READY");
    expect(laterIteration.plan.queryCountConsumedBeforeIteration).toBe(1);
    expect(laterIteration.plan.acquisitionCostUnitsConsumedBeforeIteration).toBe(1);

    const noDepthAuthority = build(profile(), [], [], [], { maxDepth: 0 });
    expect(noDepthAuthority.plan.requestedSources).toEqual([]);
    expect(noDepthAuthority.plan.status).toBe("UNRESOLVED");
  });

  it("preserves discriminator identities and routes no applicable Hypothesis only to DEE-646", () => {
    const bundle = build(
      profile(),
      [],
      [
        {
          requirementId: "why-news",
          questionId: "Q_WHY_HAPPENING",
          assessmentId: "assessment-a",
          assessmentContentDigest: hex("assessment"),
          hypothesisRefs: [],
          status: "NO_APPLICABLE_QUALIFIED_HYPOTHESIS",
          missingEvidenceReasonCodes: ["NO_QUALIFIED_HYPOTHESIS"],
        },
      ],
    );
    expect(bundle.hypothesisDiscriminators[0]).toMatchObject({
      assessmentId: "assessment-a",
      disposition: "ROUTE_RESEARCH_QUESTION_DEE_646",
      createsOrRanksHypothesis: false,
    });
    expect(bundle.researchQuestionRoutes).toEqual([
      {
        requirementId: "why-news",
        questionId: "Q_WHY_HAPPENING",
        destination: "DEE-646",
        reasonCode: "NO_APPLICABLE_QUALIFIED_HYPOTHESIS",
      },
    ]);

    const competing = build(
      profile(),
      [],
      [
        {
          requirementId: "why-news",
          questionId: "Q_WHY_HAPPENING",
          assessmentId: "assessment-b",
          assessmentContentDigest: hex("assessment-b"),
          hypothesisRefs: [
            {
              hypothesisId: "hypothesis-a",
              hypothesisContentDigest: hex("hypothesis-a"),
              failureBoundaryContentDigest: hex("failure-a"),
            },
            {
              hypothesisId: "hypothesis-b",
              hypothesisContentDigest: hex("hypothesis-b"),
              failureBoundaryContentDigest: hex("failure-b"),
            },
          ],
          status: "MISSING_DISCRIMINATING_EVIDENCE",
          missingEvidenceReasonCodes: ["DISCRIMINATOR_MISSING"],
        },
      ],
    );
    expect(competing.hypothesisDiscriminators[0]).toMatchObject({
      assessmentId: "assessment-b",
      disposition: "REQUEST_PROFILE_AUTHORIZED_EVIDENCE",
      createsOrRanksHypothesis: false,
    });
    expect(competing.researchQuestionRoutes).toEqual([]);
  });

  it("retains exact contradiction claim, materiality, observations, providers, and dependence groups", () => {
    const first = evidence({
      evidenceId: "news-a",
      observationId: "observation-a",
      observationContentDigest: hex("observation-a"),
      dependenceGroup: "group-a",
      contradictionGroup: "claim-a",
      contradiction: "UNRESOLVED",
    });
    const second = evidence({
      evidenceId: "news-b",
      observationId: "observation-b",
      observationContentDigest: hex("observation-b"),
      dependenceGroup: "group-b",
      contradictionGroup: "claim-a",
      contradiction: "UNRESOLVED",
    });
    const lineage = {
      questionId: "Q_WHY_HAPPENING" as const,
      claimId: "claim-a",
      materiality: "MATERIAL" as const,
      observationIds: ["observation-b", "observation-a"],
      providerIds: ["news_a"],
      dependenceGroups: ["group-b", "group-a"],
      reasonCodes: ["POLICY_MATERIAL_CONTRADICTION"],
    };
    const bundle = build(profile(), [second, first], [], [{ requirementId: "why-news", lineage }]);
    expect(bundle.contradictions).toEqual([
      {
        requirementId: "why-news",
        lineage: {
          ...lineage,
          observationIds: ["observation-a", "observation-b"],
          dependenceGroups: ["group-a", "group-b"],
        },
      },
    ]);
    expect(bundle.plan.needs[0]?.contradiction).toEqual(bundle.contradictions[0]?.lineage);
  });
});
