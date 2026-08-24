import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  computeInquiryContentDigest,
  defineInformationInquiryPolicyV1,
} from "@/lib/trader/intelligence/information-inquiry/contracts-v1";
import {
  assertInformationInquiryLoopReceiptV1,
  runInformationInquiryLoopV1,
} from "@/lib/trader/intelligence/information-inquiry/information-inquiry-loop-v1";
import {
  buildInformationNeedPlanningBundleV1,
  type BuildInformationNeedPlanV1Input,
  type InformationInquiryPlanningBundleV1,
} from "@/lib/trader/intelligence/information-inquiry/information-need-planner-v1";
import { defineTopDownReconstructionV1 } from "@/lib/trader/intelligence/information-inquiry/top-down-reconstruction-v1";
import {
  defineRequiredInformationProfileV2,
  evaluateInformationSufficiencyV2,
  type InformationEvidenceV2,
} from "@/lib/trader/intelligence/information-sufficiency";
import { CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION } from "@/lib/trader/mi/canonical-observation-v1";

const hex = (value: string) => createHash("sha256").update(value).digest("hex");
const PIT = "2026-08-24T12:00:00.000Z";

function profile(
  inquiryBounds: Readonly<{
    maxDepth: number;
    maxDurationMs: number;
    maxProviderFanout: number;
  }> = { maxDepth: 2, maxDurationMs: 1_000, maxProviderFanout: 1 },
) {
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
    requirements: [
      {
        id: "price-state",
        questionId: "Q_WHAT_HAPPENING",
        classification: "MANDATORY",
        contextTriggerKey: null,
        satisfiers: [
          { evidenceFamily: "price", providerIds: ["htx_spot"], substitutionRuleId: null },
        ],
        allowedObservationKinds: ["ohlcv_bar"],
        allowedObservationSchemaVersions: [CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION],
        allowedMeasurementDefinitionDigests: [],
        maxStalenessMs: 60_000,
        minimumTrustScore: 0.5,
        minimumIndependentGroups: 1,
        contradictionPolicy: "FAIL_UNRESOLVED",
        requirePitQualified: true,
        requireReplayEligible: true,
        inquiryBounds,
      },
    ],
    aggregateQualityContract: null,
  });
}

function evidence(overrides: Partial<InformationEvidenceV2> = {}): InformationEvidenceV2 {
  return {
    evidenceId: "price-evidence",
    evidenceFamily: "price",
    providerId: "htx_spot",
    sourceId: "source-a",
    observationId: "observation-a",
    observationKind: "ohlcv_bar",
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
    dependenceGroup: "price-group-a",
    contradictionGroup: null,
    contradiction: "NONE",
    epistemicRole: "PRICE_STATE",
    historyScope: "NOT_HISTORICAL",
    degradationReasonCodes: [],
    ...overrides,
  };
}

const planningInputs = new WeakMap<
  InformationInquiryPlanningBundleV1,
  BuildInformationNeedPlanV1Input
>();

function planningInputFor(
  selectedBundle: InformationInquiryPlanningBundleV1,
): BuildInformationNeedPlanV1Input {
  const planningInput = planningInputs.get(selectedBundle);
  if (!planningInput) throw new Error("missing planning input fixture");
  return planningInput;
}

function bundle(
  selectedProfile: ReturnType<typeof profile>,
  overrides: Readonly<{
    iterationIndex?: number;
    maxIterations?: number;
    maxDepth?: number;
    maxQueryCount?: number;
    maxAcquisitionCostUnits?: number;
    queryCountConsumedBeforeIteration?: number;
    acquisitionCostUnitsConsumedBeforeIteration?: number;
  }> = {},
): InformationInquiryPlanningBundleV1 {
  const initialReceipt = evaluateInformationSufficiencyV2({
    profile: selectedProfile,
    organizationId: selectedProfile.organizationId,
    accountId: selectedProfile.accountId,
    purpose: selectedProfile.purpose,
    symbol: selectedProfile.symbol,
    venue: selectedProfile.venue,
    analyticalTimeframe: selectedProfile.analyticalTimeframe,
    horizon: selectedProfile.horizon,
    pitAnchor: PIT,
    activeContextTriggers: [],
    evidence: [],
  });
  const policy = defineInformationInquiryPolicyV1({
    policyVersion: "policy-v1",
    purpose: "NEW_OPPORTUNITY_SEARCH",
    timeframePolicies: ["1d", "4h", "1h", "15m", "1m"].map((timeframe) => ({
      timeframe: timeframe as "1d" | "4h" | "1h" | "15m" | "1m",
      relevantRequirementIds: timeframe === "1m" ? ["price-state"] : [],
      maxStalenessMsByRequirement:
        timeframe === "1m" ? [{ requirementId: "price-state", maxStalenessMs: 60_000 }] : [],
    })),
    bounds: {
      maxIterations: overrides.maxIterations ?? 1,
      maxDepth: overrides.maxDepth ?? 2,
      maxDurationMs: 1_000,
      maxProviderFanout: 1,
      maxQueryCount: overrides.maxQueryCount ?? 1,
      maxHistoricalResults: 1,
      maxAcquisitionCostUnits: overrides.maxAcquisitionCostUnits ?? 1,
    },
    costPolicy: {
      evaluatorVersion: "caller-cost-v1",
      evaluatorContentDigest: hex("cost-policy"),
      assignments: [{ requirementId: "price-state", providerId: "htx_spot", costUnits: 1 }],
    },
    contradictionMaterialityPolicyVersion: "materiality-v1",
    contradictionMaterialityPolicyDigest: hex("materiality-policy"),
    schedulingPolicyVersion: "scheduler-v1",
    schedulingPolicyDigest: hex("scheduler-policy"),
    maxNewOpportunityWaitTurns: 2,
  });
  const topDownReconstruction = defineTopDownReconstructionV1({
    symbol: selectedProfile.symbol,
    pitAnchor: PIT,
    states: [
      ["1d", "STRATEGIC_CONTEXT"],
      ["4h", "STRUCTURAL_REFINEMENT"],
      ["1h", "OPERATIONAL_STATE"],
      ["15m", "SETUP_CONFIRMATION"],
      ["1m", "EXECUTION_PRECISION"],
    ].map(([timeframe, role]) => ({
      timeframe: timeframe as "1d" | "4h" | "1h" | "15m" | "1m",
      role: role as
        | "STRATEGIC_CONTEXT"
        | "STRUCTURAL_REFINEMENT"
        | "OPERATIONAL_STATE"
        | "SETUP_CONFIRMATION"
        | "EXECUTION_PRECISION",
      status: "AVAILABLE" as const,
      stateContentDigest: hex(`state-${timeframe}`),
      evidenceIds: [`state-${timeframe}`],
      reasonCodes: ["CALLER_STATE"],
    })),
    relations: [
      ["1d", "4h"],
      ["4h", "1h"],
      ["1h", "15m"],
      ["15m", "1m"],
    ].map(([higherTimeframe, lowerTimeframe]) => ({
      higherTimeframe: higherTimeframe as "1d" | "4h" | "1h" | "15m",
      lowerTimeframe: lowerTimeframe as "4h" | "1h" | "15m" | "1m",
      relation: "UNCLEAR" as const,
      relationPolicyVersion: "relation-v1",
      relationPolicyContentDigest: hex("relation-policy"),
      evidenceIds: [`state-${higherTimeframe}`, `state-${lowerTimeframe}`],
      reasonCodes: ["CALLER_RELATION"],
    })),
    upwardReevaluationRequests: [],
  });
  const planningInput: BuildInformationNeedPlanV1Input = {
    derivationVersion: "planner-v1",
    profile: selectedProfile,
    receipt: initialReceipt,
    policy,
    topDownReconstruction,
    iterationIndex: overrides.iterationIndex ?? 0,
    queryCountConsumed: overrides.queryCountConsumedBeforeIteration ?? 0,
    acquisitionCostUnitsConsumed: overrides.acquisitionCostUnitsConsumedBeforeIteration ?? 0,
    availableProviderIds: ["htx_spot"],
    contradictions: [],
    analogueRequests: [],
    hypothesisDiscriminators: [],
  };
  const selectedBundle = buildInformationNeedPlanningBundleV1(planningInput);
  planningInputs.set(selectedBundle, planningInput);
  return selectedBundle;
}

describe("DEE-697 bounded information inquiry loop", () => {
  it("records an exact available attempt and re-evaluates through the DEE-621 hard floor", () => {
    const selectedProfile = profile();
    const selectedEvidence = evidence();
    const selectedBundle = bundle(selectedProfile);
    const receipt = runInformationInquiryLoopV1({
      bundle: selectedBundle,
      planningInput: planningInputFor(selectedBundle),
      attempts: [
        {
          iterationIndex: 0,
          depth: 1,
          needId: selectedBundle.plan.needs[0]!.id,
          requirementId: "price-state",
          providerId: "htx_spot",
          outcome: "AVAILABLE",
          elapsedMsAtCompletion: 100,
          evidenceIds: [selectedEvidence.evidenceId],
          reasonCodes: ["SOURCE_AVAILABLE"],
        },
      ],
      finalEvidence: [selectedEvidence],
      activeContextTriggers: [],
    });
    expect(receipt.terminalStatus).toBe("ANSWERED_SUFFICIENTLY");
    expect(receipt.finalSufficiencyReceipt.status).toBe("SUFFICIENT");
    expect(receipt.attempts[0]).toMatchObject({ costUnits: 1, outcome: "AVAILABLE" });
    expect(receipt.createsKnowledgeHypothesisForecastDecisionOrCapitalAuthority).toBe(false);
    expect(
      assertInformationInquiryLoopReceiptV1(
        receipt,
        selectedBundle,
        planningInputFor(selectedBundle),
      ),
    ).toBe(receipt);
  });

  it("terminates honestly on unavailable evidence without zero or synthetic fallback", () => {
    const selectedProfile = profile();
    const selectedBundle = bundle(selectedProfile);
    const receipt = runInformationInquiryLoopV1({
      bundle: selectedBundle,
      planningInput: planningInputFor(selectedBundle),
      attempts: [
        {
          iterationIndex: 0,
          depth: 1,
          needId: selectedBundle.plan.needs[0]!.id,
          requirementId: "price-state",
          providerId: "htx_spot",
          outcome: "UNAVAILABLE",
          elapsedMsAtCompletion: 100,
          evidenceIds: [],
          reasonCodes: ["SOURCE_UNAVAILABLE"],
        },
      ],
      finalEvidence: [],
      activeContextTriggers: [],
    });
    expect(receipt.terminalStatus).toBe("UNAVAILABLE");
    expect(receipt.finalSufficiencyReceipt.status).toBe("UNAVAILABLE");
    expect(receipt).not.toHaveProperty("fallbackValue");
  });

  it("fails closed on unplanned attempts and bound exhaustion", () => {
    const selectedProfile = profile();
    const selectedBundle = bundle(selectedProfile);
    expect(() =>
      runInformationInquiryLoopV1({
        bundle: selectedBundle,
        planningInput: planningInputFor(selectedBundle),
        attempts: [
          {
            iterationIndex: 0,
            depth: 1,
            needId: selectedBundle.plan.needs[0]!.id,
            requirementId: "price-state",
            providerId: "connected_but_unrequested",
            outcome: "REJECTED",
            elapsedMsAtCompletion: 100,
            evidenceIds: [],
            reasonCodes: ["NOT_SELECTED"],
          },
        ],
        finalEvidence: [],
        activeContextTriggers: [],
      }),
    ).toThrow("attemptNotPlanAuthorized");

    const insufficient = runInformationInquiryLoopV1({
      bundle: selectedBundle,
      planningInput: planningInputFor(selectedBundle),
      attempts: [
        {
          iterationIndex: 0,
          depth: 1,
          needId: selectedBundle.plan.needs[0]!.id,
          requirementId: "price-state",
          providerId: "htx_spot",
          outcome: "AVAILABLE",
          elapsedMsAtCompletion: 100,
          evidenceIds: ["price-evidence"],
          reasonCodes: ["SOURCE_AVAILABLE_BUT_UNTRUSTED"],
        },
      ],
      finalEvidence: [evidence({ trust: "UNTRUSTED" })],
      activeContextTriggers: [],
    });
    expect(insufficient.terminalStatus).toBe("INFORMATION_INSUFFICIENT");
    expect(insufficient.reasonCodes).toContain("INQUIRY_BOUNDS_EXHAUSTED");
  });

  it("reports cumulative multi-iteration budgets and exhausts on actual depth, not iteration", () => {
    const selectedProfile = profile();
    const selectedBundle = bundle(selectedProfile, {
      iterationIndex: 1,
      maxIterations: 3,
      maxDepth: 2,
      maxQueryCount: 3,
      maxAcquisitionCostUnits: 3,
      queryCountConsumedBeforeIteration: 1,
      acquisitionCostUnitsConsumedBeforeIteration: 1,
    });
    const selectedEvidence = evidence({ trust: "UNTRUSTED" });
    const attempt = {
      iterationIndex: 1,
      depth: 1,
      needId: selectedBundle.plan.needs[0]!.id,
      requirementId: "price-state",
      providerId: "htx_spot",
      outcome: "AVAILABLE" as const,
      elapsedMsAtCompletion: 100,
      evidenceIds: [selectedEvidence.evidenceId],
      reasonCodes: ["SOURCE_AVAILABLE_BUT_UNTRUSTED"],
    };
    const unresolved = runInformationInquiryLoopV1({
      bundle: selectedBundle,
      planningInput: planningInputFor(selectedBundle),
      attempts: [attempt],
      finalEvidence: [selectedEvidence],
      activeContextTriggers: [],
    });
    expect(unresolved.queryCountConsumed).toBe(2);
    expect(unresolved.acquisitionCostUnitsConsumed).toBe(2);
    expect(unresolved.terminalStatus).toBe("UNRESOLVED");

    const depthExhausted = runInformationInquiryLoopV1({
      bundle: selectedBundle,
      planningInput: planningInputFor(selectedBundle),
      attempts: [{ ...attempt, depth: 2 }],
      finalEvidence: [selectedEvidence],
      activeContextTriggers: [],
    });
    expect(depthExhausted.terminalStatus).toBe("INFORMATION_INSUFFICIENT");
  });

  it("rejects a hash-correct current selection that exceeds trusted cumulative lineage", () => {
    const selectedProfile = profile();
    const overdrawn = bundle(selectedProfile, {
      maxIterations: 3,
      maxQueryCount: 1,
      maxAcquisitionCostUnits: 1,
      queryCountConsumedBeforeIteration: 1,
    });
    const forgedSelection = bundle(selectedProfile, {
      maxIterations: 3,
      maxQueryCount: 1,
      maxAcquisitionCostUnits: 1,
    });
    expect(() =>
      runInformationInquiryLoopV1({
        bundle: forgedSelection,
        planningInput: planningInputFor(overdrawn),
        attempts: [],
        finalEvidence: [],
        activeContextTriggers: [],
      }),
    ).toThrow("planningProvenance");
  });

  it("rejects hash-correct altered policy identity, costs, and bounds", () => {
    const selectedBundle = bundle(profile(), { maxIterations: 3, maxQueryCount: 3 });
    const trustedInput = planningInputFor(selectedBundle);
    const redefinePolicy = (
      overrides: Readonly<{
        policyVersion?: string;
        bounds?: typeof trustedInput.policy.bounds;
        costPolicy?: typeof trustedInput.policy.costPolicy;
      }>,
    ) =>
      defineInformationInquiryPolicyV1({
        policyVersion: overrides.policyVersion ?? trustedInput.policy.policyVersion,
        purpose: trustedInput.policy.purpose,
        timeframePolicies: trustedInput.policy.timeframePolicies,
        bounds: overrides.bounds ?? trustedInput.policy.bounds,
        costPolicy: overrides.costPolicy ?? trustedInput.policy.costPolicy,
        contradictionMaterialityPolicyVersion:
          trustedInput.policy.contradictionMaterialityPolicyVersion,
        contradictionMaterialityPolicyDigest:
          trustedInput.policy.contradictionMaterialityPolicyDigest,
        schedulingPolicyVersion: trustedInput.policy.schedulingPolicyVersion,
        schedulingPolicyDigest: trustedInput.policy.schedulingPolicyDigest,
        maxNewOpportunityWaitTurns: trustedInput.policy.maxNewOpportunityWaitTurns,
      });
    const forgedPolicies = [
      redefinePolicy({ policyVersion: "forged-policy-v2" }),
      redefinePolicy({
        costPolicy: {
          ...trustedInput.policy.costPolicy,
          evaluatorContentDigest: hex("forged-cost-policy"),
          assignments: trustedInput.policy.costPolicy.assignments.map((assignment) => ({
            ...assignment,
            costUnits: 0,
          })),
        },
      }),
      redefinePolicy({
        bounds: { ...trustedInput.policy.bounds, maxIterations: 2 },
      }),
    ];
    const forgedBundles = forgedPolicies.map((policy) =>
      buildInformationNeedPlanningBundleV1({ ...trustedInput, policy }),
    );
    for (const forgedBundle of forgedBundles) {
      expect(() =>
        runInformationInquiryLoopV1({
          bundle: forgedBundle,
          planningInput: trustedInput,
          attempts: [],
          finalEvidence: [],
          activeContextTriggers: [],
        }),
      ).toThrow("planningProvenance");
    }

    const trustedReceipt = runInformationInquiryLoopV1({
      bundle: selectedBundle,
      planningInput: trustedInput,
      attempts: [],
      finalEvidence: [],
      activeContextTriggers: [],
    });
    expect(() =>
      assertInformationInquiryLoopReceiptV1(trustedReceipt, forgedBundles[0]!, trustedInput),
    ).toThrow("planningProvenance");
  });

  it("enforces exact per-need depth and duration independently of global bounds", () => {
    const depthProfile = profile({ maxDepth: 1, maxDurationMs: 1_000, maxProviderFanout: 1 });
    const depthBundle = bundle(depthProfile, { maxDepth: 2 });
    expect(() =>
      runInformationInquiryLoopV1({
        bundle: depthBundle,
        planningInput: planningInputFor(depthBundle),
        attempts: [
          {
            iterationIndex: 0,
            depth: 2,
            needId: depthBundle.plan.needs[0]!.id,
            requirementId: "price-state",
            providerId: "htx_spot",
            outcome: "UNAVAILABLE",
            elapsedMsAtCompletion: 10,
            evidenceIds: [],
            reasonCodes: ["SOURCE_UNAVAILABLE"],
          },
        ],
        finalEvidence: [],
        activeContextTriggers: [],
      }),
    ).toThrow("attemptNeedBounds");

    const durationProfile = profile({ maxDepth: 2, maxDurationMs: 50, maxProviderFanout: 1 });
    const durationBundle = bundle(durationProfile, { maxDepth: 2 });
    expect(() =>
      runInformationInquiryLoopV1({
        bundle: durationBundle,
        planningInput: planningInputFor(durationBundle),
        attempts: [
          {
            iterationIndex: 0,
            depth: 1,
            needId: durationBundle.plan.needs[0]!.id,
            requirementId: "price-state",
            providerId: "htx_spot",
            outcome: "UNAVAILABLE",
            elapsedMsAtCompletion: 51,
            evidenceIds: [],
            reasonCodes: ["SOURCE_UNAVAILABLE"],
          },
        ],
        finalEvidence: [],
        activeContextTriggers: [],
      }),
    ).toThrow("attemptNeedBounds");

    const zeroFanoutProfile = profile({ maxDepth: 2, maxDurationMs: 1_000, maxProviderFanout: 0 });
    const zeroFanoutBundle = bundle(zeroFanoutProfile, { maxDepth: 2 });
    const forgedFanoutBundle = bundle(profile(), { maxDepth: 2 });
    expect(() =>
      runInformationInquiryLoopV1({
        bundle: forgedFanoutBundle,
        planningInput: planningInputFor(zeroFanoutBundle),
        attempts: [],
        finalEvidence: [],
        activeContextTriggers: [],
      }),
    ).toThrow("planningProvenance");
  });

  it("rejects exact-scope and self-consistent receipt forgeries by reconstruction", () => {
    const selectedProfile = profile();
    const selectedBundle = bundle(selectedProfile);
    const selectedEvidence = evidence();
    const receipt = runInformationInquiryLoopV1({
      bundle: selectedBundle,
      planningInput: planningInputFor(selectedBundle),
      attempts: [
        {
          iterationIndex: 0,
          depth: 1,
          needId: selectedBundle.plan.needs[0]!.id,
          requirementId: "price-state",
          providerId: "htx_spot",
          outcome: "AVAILABLE",
          elapsedMsAtCompletion: 100,
          evidenceIds: [selectedEvidence.evidenceId],
          reasonCodes: ["SOURCE_AVAILABLE"],
        },
      ],
      finalEvidence: [selectedEvidence],
      activeContextTriggers: [],
    });
    const receiptBody = Object.fromEntries(
      Object.entries(receipt).filter(([key]) => key !== "id" && key !== "contentDigest"),
    ) as Omit<typeof receipt, "id" | "contentDigest">;
    const forgedBody = {
      ...receiptBody,
      queryCountConsumed: receipt.queryCountConsumed + 1,
      terminalStatus: "ANSWERED_SUFFICIENTLY" as const,
      reasonCodes: ["FORGED_REASON"],
    };
    const forgedDigest = computeInquiryContentDigest(forgedBody);
    const forgedReceipt = {
      ...forgedBody,
      id: `iil_${forgedDigest}`,
      contentDigest: forgedDigest,
    };
    expect(() =>
      assertInformationInquiryLoopReceiptV1(
        forgedReceipt,
        selectedBundle,
        planningInputFor(selectedBundle),
      ),
    ).toThrow("receiptIdentity");

    const attemptBody = Object.fromEntries(
      Object.entries(receipt.attempts[0]!).filter(
        ([key]) => key !== "id" && key !== "contentDigest",
      ),
    ) as Omit<(typeof receipt.attempts)[number], "id" | "contentDigest">;
    const forgedAttemptBody = { ...attemptBody, costUnits: attemptBody.costUnits + 1 };
    const forgedAttemptDigest = computeInquiryContentDigest(forgedAttemptBody);
    const forgedAttempt = {
      ...forgedAttemptBody,
      id: `iat_${forgedAttemptDigest}`,
      contentDigest: forgedAttemptDigest,
    };
    const forgedAttemptReceiptBody = { ...receiptBody, attempts: [forgedAttempt] };
    const forgedAttemptReceiptDigest = computeInquiryContentDigest(forgedAttemptReceiptBody);
    const forgedAttemptReceipt = {
      ...forgedAttemptReceiptBody,
      id: `iil_${forgedAttemptReceiptDigest}`,
      contentDigest: forgedAttemptReceiptDigest,
    };
    expect(() =>
      assertInformationInquiryLoopReceiptV1(
        forgedAttemptReceipt,
        selectedBundle,
        planningInputFor(selectedBundle),
      ),
    ).toThrow("receiptIdentity");

    const planBody = Object.fromEntries(
      Object.entries(selectedBundle.plan).filter(
        ([key]) => key !== "id" && key !== "contentDigest",
      ),
    ) as Omit<typeof selectedBundle.plan, "id" | "contentDigest">;
    const mismatchedPlanBody = { ...planBody, horizon: "30m" };
    const mismatchedPlanDigest = computeInquiryContentDigest(mismatchedPlanBody);
    const mismatchedPlan = {
      ...mismatchedPlanBody,
      id: `inp_${mismatchedPlanDigest}`,
      contentDigest: mismatchedPlanDigest,
    };
    const bundleBody = Object.fromEntries(
      Object.entries(selectedBundle).filter(([key]) => key !== "contentDigest"),
    ) as Omit<typeof selectedBundle, "contentDigest">;
    const mismatchedBundleBody = { ...bundleBody, plan: mismatchedPlan };
    const mismatchedBundle = {
      ...mismatchedBundleBody,
      contentDigest: computeInquiryContentDigest(mismatchedBundleBody),
    };
    expect(() =>
      runInformationInquiryLoopV1({
        bundle: mismatchedBundle,
        planningInput: planningInputFor(selectedBundle),
        attempts: [],
        finalEvidence: [],
        activeContextTriggers: [],
      }),
    ).toThrow("planningProvenance");
  });
});
