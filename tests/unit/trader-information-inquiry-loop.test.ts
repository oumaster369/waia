import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  computeInquiryContentDigest,
  INFORMATION_NEED_PLAN_V1_SCHEMA_VERSION,
  type InformationNeedPlanV1,
} from "@/lib/trader/intelligence/information-inquiry/contracts-v1";
import {
  assertInformationInquiryLoopReceiptV1,
  runInformationInquiryLoopV1,
} from "@/lib/trader/intelligence/information-inquiry/information-inquiry-loop-v1";
import {
  INFORMATION_INQUIRY_PLANNING_BUNDLE_V1_SCHEMA_VERSION,
  type InformationInquiryPlanningBundleV1,
} from "@/lib/trader/intelligence/information-inquiry/information-need-planner-v1";
import {
  defineRequiredInformationProfileV2,
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
  const needBody = {
    requirementId: "price-state",
    questionId: "Q_WHAT_HAPPENING" as const,
    classification: "MANDATORY" as const,
    evidenceFamily: "price",
    allowedObservationKinds: ["ohlcv_bar"] as const,
    allowedObservationSchemaVersions: [CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION],
    timeframeRequirements: [{ timeframe: "1m" as const, maxStalenessMs: 60_000 }],
    inquiryBounds: selectedProfile.requirements[0]!.inquiryBounds,
    providerCandidates: [{ providerId: "htx_spot", substitutionRuleId: null, costUnits: 1 }],
    requirePitQualified: true,
    requireReplayEligible: true,
    contradiction: null,
    reasonCodes: ["PRICE_REQUIRED"],
  };
  const need = { ...needBody, id: `need_${computeInquiryContentDigest(needBody)}` };
  const requestedSources = [
    {
      needId: need.id,
      requirementId: "price-state",
      providerId: "htx_spot",
      allowedObservationKinds: ["ohlcv_bar"] as const,
      costUnits: 1,
      reasonCodes: ["PRICE_REQUIRED"],
    },
  ];
  const unresolvedQuestionIds = ["Q_WHAT_HAPPENING"] as const;
  const availableEvidence: [] = [];
  const planPayload: Omit<InformationNeedPlanV1, "id" | "contentDigest"> = {
    schemaVersion: INFORMATION_NEED_PLAN_V1_SCHEMA_VERSION,
    derivationVersion: "planner-v1",
    organizationId: "org-a",
    accountId: "account-a",
    symbol: "BTC/USDT",
    venue: "HTX",
    analyticalTimeframe: selectedProfile.analyticalTimeframe,
    horizon: selectedProfile.horizon,
    pitAnchor: PIT,
    purpose: "NEW_OPPORTUNITY_SEARCH",
    profilePurpose: "NEW_OPPORTUNITY",
    profileId: selectedProfile.id,
    profileContentDigest: selectedProfile.contentDigest,
    policyVersion: "policy-v1",
    policyContentDigest: hex("policy"),
    topDownReconstructionContentDigest: hex("reconstruction"),
    unresolvedQuestionIds,
    availableEvidence,
    needs: [need],
    requestedSources,
    ignoredSources: [],
    bounds: {
      maxIterations: overrides.maxIterations ?? 1,
      maxDepth: overrides.maxDepth ?? 2,
      maxDurationMs: 1_000,
      maxProviderFanout: 1,
      maxQueryCount: overrides.maxQueryCount ?? 1,
      maxHistoricalResults: 1,
      maxAcquisitionCostUnits: overrides.maxAcquisitionCostUnits ?? 1,
    },
    iterationIndex: overrides.iterationIndex ?? 0,
    queryCountConsumedBeforeIteration: overrides.queryCountConsumedBeforeIteration ?? 0,
    acquisitionCostUnitsConsumedBeforeIteration:
      overrides.acquisitionCostUnitsConsumedBeforeIteration ?? 0,
    status: "READY",
    evidenceSelectionDigest: computeInquiryContentDigest({
      unresolvedQuestionIds,
      availableEvidence,
      needs: [need],
      requestedSources,
    }),
    authority: "EVIDENCE_ACQUISITION_ONLY",
  };
  const planContentDigest = computeInquiryContentDigest(planPayload);
  const plan = {
    ...planPayload,
    id: `inp_${planContentDigest}`,
    contentDigest: planContentDigest,
  };
  const payload = {
    schemaVersion: INFORMATION_INQUIRY_PLANNING_BUNDLE_V1_SCHEMA_VERSION,
    plan,
    contradictions: [],
    analoguePlanning: [],
    hypothesisDiscriminators: [],
    researchQuestionRoutes: [],
    authority: "EVIDENCE_ACQUISITION_PLANNING_ONLY" as const,
    createsKnowledgeHypothesisForecastDecisionOrCapitalAuthority: false as const,
  };
  return { ...payload, contentDigest: computeInquiryContentDigest(payload) };
}

describe("DEE-697 bounded information inquiry loop", () => {
  it("records an exact available attempt and re-evaluates through the DEE-621 hard floor", () => {
    const selectedProfile = profile();
    const selectedEvidence = evidence();
    const selectedBundle = bundle(selectedProfile);
    const receipt = runInformationInquiryLoopV1({
      bundle: selectedBundle,
      profile: selectedProfile,
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
    expect(assertInformationInquiryLoopReceiptV1(receipt, selectedBundle, selectedProfile)).toBe(
      receipt,
    );
  });

  it("terminates honestly on unavailable evidence without zero or synthetic fallback", () => {
    const selectedProfile = profile();
    const selectedBundle = bundle(selectedProfile);
    const receipt = runInformationInquiryLoopV1({
      bundle: selectedBundle,
      profile: selectedProfile,
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
        profile: selectedProfile,
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
      profile: selectedProfile,
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
      profile: selectedProfile,
      attempts: [attempt],
      finalEvidence: [selectedEvidence],
      activeContextTriggers: [],
    });
    expect(unresolved.queryCountConsumed).toBe(2);
    expect(unresolved.acquisitionCostUnitsConsumed).toBe(2);
    expect(unresolved.terminalStatus).toBe("UNRESOLVED");

    const depthExhausted = runInformationInquiryLoopV1({
      bundle: selectedBundle,
      profile: selectedProfile,
      attempts: [{ ...attempt, depth: 2 }],
      finalEvidence: [selectedEvidence],
      activeContextTriggers: [],
    });
    expect(depthExhausted.terminalStatus).toBe("INFORMATION_INSUFFICIENT");
  });

  it("rejects a plan whose cumulative prior plus current selection exceeds a bound", () => {
    const selectedProfile = profile();
    const overdrawn = bundle(selectedProfile, {
      maxIterations: 3,
      maxQueryCount: 1,
      maxAcquisitionCostUnits: 1,
      queryCountConsumedBeforeIteration: 1,
    });
    expect(() =>
      runInformationInquiryLoopV1({
        bundle: overdrawn,
        profile: selectedProfile,
        attempts: [],
        finalEvidence: [],
        activeContextTriggers: [],
      }),
    ).toThrow("planSelectionBounds");
  });

  it("enforces exact per-need depth and duration independently of global bounds", () => {
    const depthProfile = profile({ maxDepth: 1, maxDurationMs: 1_000, maxProviderFanout: 1 });
    const depthBundle = bundle(depthProfile, { maxDepth: 2 });
    expect(() =>
      runInformationInquiryLoopV1({
        bundle: depthBundle,
        profile: depthProfile,
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
        profile: durationProfile,
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
    expect(() =>
      runInformationInquiryLoopV1({
        bundle: zeroFanoutBundle,
        profile: zeroFanoutProfile,
        attempts: [],
        finalEvidence: [],
        activeContextTriggers: [],
      }),
    ).toThrow("planNeedSelectionBounds");
  });

  it("rejects exact-scope and self-consistent receipt forgeries by reconstruction", () => {
    const selectedProfile = profile();
    const selectedBundle = bundle(selectedProfile);
    const selectedEvidence = evidence();
    const receipt = runInformationInquiryLoopV1({
      bundle: selectedBundle,
      profile: selectedProfile,
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
      assertInformationInquiryLoopReceiptV1(forgedReceipt, selectedBundle, selectedProfile),
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
      assertInformationInquiryLoopReceiptV1(forgedAttemptReceipt, selectedBundle, selectedProfile),
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
        profile: selectedProfile,
        attempts: [],
        finalEvidence: [],
        activeContextTriggers: [],
      }),
    ).toThrow("profileScope");
  });
});
