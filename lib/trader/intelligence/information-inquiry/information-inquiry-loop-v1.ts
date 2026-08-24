import {
  assertRequiredInformationProfileV2,
  evaluateInformationSufficiencyV2,
  type AggregateQualityEvaluationV2,
  type InformationEvidenceV2,
  type InformationSufficiencyReceiptV2,
  type RequiredInformationProfileV2,
} from "@/lib/trader/intelligence/information-sufficiency";
import {
  computeInquiryContentDigest,
  deepFreezeInquiry,
  inquiryCanonicalJsonString,
  inquiryCanonicalTextCompare,
  mapInformationInquiryPurposeV1,
  sortInquiryUniqueStrings,
  type InformationNeedTerminalStatusV1,
} from "@/lib/trader/intelligence/information-inquiry/contracts-v1";
import {
  assertInformationInquiryPlanningBundleV1,
  type InformationInquiryPlanningBundleV1,
} from "@/lib/trader/intelligence/information-inquiry/information-need-planner-v1";

export const INFORMATION_INQUIRY_LOOP_RECEIPT_V1_SCHEMA_VERSION =
  "information_inquiry_loop_receipt/v1" as const;

export type InformationAcquisitionAttemptInputV1 = Readonly<{
  iterationIndex: number;
  depth: number;
  needId: string;
  requirementId: string;
  providerId: string;
  outcome: "AVAILABLE" | "UNAVAILABLE" | "REJECTED";
  elapsedMsAtCompletion: number;
  evidenceIds: readonly string[];
  reasonCodes: readonly string[];
}>;

export type InformationAcquisitionAttemptV1 = Readonly<{
  id: string;
  iterationIndex: number;
  depth: number;
  needId: string;
  requirementId: string;
  providerId: string;
  costUnits: number;
  outcome: "AVAILABLE" | "UNAVAILABLE" | "REJECTED";
  elapsedMsAtCompletion: number;
  evidenceIds: readonly string[];
  reasonCodes: readonly string[];
  authority: "EVIDENCE_ACQUISITION_ATTEMPT_LINEAGE_ONLY";
  contentDigest: string;
}>;

export type InformationInquiryLoopReceiptV1 = Readonly<{
  schemaVersion: typeof INFORMATION_INQUIRY_LOOP_RECEIPT_V1_SCHEMA_VERSION;
  id: string;
  planId: string;
  planContentDigest: string;
  attempts: readonly InformationAcquisitionAttemptV1[];
  queryCountConsumed: number;
  acquisitionCostUnitsConsumed: number;
  terminalStatus: InformationNeedTerminalStatusV1;
  finalSufficiencyReceipt: InformationSufficiencyReceiptV2;
  reasonCodes: readonly string[];
  authority: "INFORMATION_SUFFICIENCY_REEVALUATION_ONLY";
  createsKnowledgeHypothesisForecastDecisionOrCapitalAuthority: false;
  contentDigest: string;
}>;

function requireNonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`INFORMATION_INQUIRY_LOOP_INVALID:${field}`);
  }
  return value;
}

function canonicalAttempts(input: {
  bundle: InformationInquiryPlanningBundleV1;
  attempts: readonly InformationAcquisitionAttemptInputV1[];
  finalEvidence: readonly InformationEvidenceV2[];
}): readonly InformationAcquisitionAttemptV1[] {
  const requestedByKey = new Map(
    input.bundle.plan.requestedSources.map((source) => [
      `${source.needId}\u0000${source.providerId}`,
      source,
    ]),
  );
  const finalEvidenceById = new Map(
    input.finalEvidence.map((evidence) => [evidence.evidenceId, evidence]),
  );
  const attemptedKeys = new Set<string>();
  const attempts = input.attempts.map((attempt) => {
    requireNonNegativeInteger(attempt.iterationIndex, "iterationIndex");
    requireNonNegativeInteger(attempt.depth, "depth");
    requireNonNegativeInteger(attempt.elapsedMsAtCompletion, "elapsedMsAtCompletion");
    if (
      attempt.iterationIndex !== input.bundle.plan.iterationIndex ||
      attempt.iterationIndex >= input.bundle.plan.bounds.maxIterations ||
      attempt.depth > input.bundle.plan.bounds.maxDepth ||
      attempt.elapsedMsAtCompletion > input.bundle.plan.bounds.maxDurationMs
    ) {
      throw new Error("INFORMATION_INQUIRY_LOOP_INVALID:attemptBounds");
    }
    const key = `${attempt.needId}\u0000${attempt.providerId}`;
    const requested = requestedByKey.get(key);
    const need = input.bundle.plan.needs.find((item) => item.id === attempt.needId);
    if (!requested || requested.requirementId !== attempt.requirementId || attemptedKeys.has(key)) {
      throw new Error("INFORMATION_INQUIRY_LOOP_INVALID:attemptNotPlanAuthorized");
    }
    if (
      !need ||
      attempt.depth > need.inquiryBounds.maxDepth ||
      attempt.elapsedMsAtCompletion > need.inquiryBounds.maxDurationMs
    ) {
      throw new Error("INFORMATION_INQUIRY_LOOP_INVALID:attemptNeedBounds");
    }
    attemptedKeys.add(key);
    if (!(["AVAILABLE", "UNAVAILABLE", "REJECTED"] as const).includes(attempt.outcome)) {
      throw new Error("INFORMATION_INQUIRY_LOOP_INVALID:attemptOutcome");
    }
    const evidenceIds = sortInquiryUniqueStrings(attempt.evidenceIds, "attemptEvidenceId");
    if ((attempt.outcome === "AVAILABLE") !== evidenceIds.length > 0) {
      throw new Error("INFORMATION_INQUIRY_LOOP_INVALID:attemptEvidenceAvailability");
    }
    for (const evidenceId of evidenceIds) {
      const evidence = finalEvidenceById.get(evidenceId);
      if (
        !evidence ||
        evidence.providerId !== attempt.providerId ||
        evidence.availability !== "AVAILABLE" ||
        !requested.allowedObservationKinds.includes(evidence.observationKind)
      ) {
        throw new Error("INFORMATION_INQUIRY_LOOP_INVALID:attemptEvidenceLineage");
      }
    }
    const body = {
      iterationIndex: attempt.iterationIndex,
      depth: attempt.depth,
      needId: attempt.needId,
      requirementId: attempt.requirementId,
      providerId: attempt.providerId,
      costUnits: requested.costUnits,
      outcome: attempt.outcome,
      elapsedMsAtCompletion: attempt.elapsedMsAtCompletion,
      evidenceIds,
      reasonCodes: sortInquiryUniqueStrings(attempt.reasonCodes, "attemptReasonCode"),
      authority: "EVIDENCE_ACQUISITION_ATTEMPT_LINEAGE_ONLY" as const,
    };
    const contentDigest = computeInquiryContentDigest(body);
    return deepFreezeInquiry({ ...body, id: `iat_${contentDigest}`, contentDigest });
  });
  for (const need of input.bundle.plan.needs) {
    if (
      attempts.filter((attempt) => attempt.needId === need.id).length >
      Math.min(input.bundle.plan.bounds.maxProviderFanout, need.inquiryBounds.maxProviderFanout)
    ) {
      throw new Error("INFORMATION_INQUIRY_LOOP_INVALID:attemptNeedFanout");
    }
  }
  for (const requirementId of new Set(input.bundle.plan.needs.map((need) => need.requirementId))) {
    const need = input.bundle.plan.needs.find((item) => item.requirementId === requirementId)!;
    if (
      attempts.filter((attempt) => attempt.requirementId === requirementId).length >
      Math.min(input.bundle.plan.bounds.maxProviderFanout, need.inquiryBounds.maxProviderFanout)
    ) {
      throw new Error("INFORMATION_INQUIRY_LOOP_INVALID:attemptNeedFanout");
    }
  }
  return deepFreezeInquiry(
    attempts.sort((left, right) =>
      inquiryCanonicalTextCompare(
        `${left.needId}\u0000${left.providerId}`,
        `${right.needId}\u0000${right.providerId}`,
      ),
    ),
  );
}

export function runInformationInquiryLoopV1(
  input: Readonly<{
    bundle: InformationInquiryPlanningBundleV1;
    profile: RequiredInformationProfileV2;
    attempts: readonly InformationAcquisitionAttemptInputV1[];
    finalEvidence: readonly InformationEvidenceV2[];
    activeContextTriggers: readonly string[];
    aggregateQualityEvaluation?: AggregateQualityEvaluationV2 | null;
  }>,
): InformationInquiryLoopReceiptV1 {
  const bundle = assertInformationInquiryPlanningBundleV1(input.bundle);
  const profile = assertRequiredInformationProfileV2(input.profile);
  if (
    bundle.plan.profileId !== profile.id ||
    bundle.plan.profileContentDigest !== profile.contentDigest ||
    bundle.plan.organizationId !== profile.organizationId ||
    bundle.plan.accountId !== profile.accountId ||
    bundle.plan.symbol !== profile.symbol ||
    bundle.plan.venue !== profile.venue ||
    bundle.plan.analyticalTimeframe !== profile.analyticalTimeframe ||
    bundle.plan.horizon !== profile.horizon ||
    bundle.plan.profilePurpose !== profile.purpose
  ) {
    throw new Error("INFORMATION_INQUIRY_LOOP_INVALID:profileScope");
  }
  for (const need of bundle.plan.needs) {
    const requirement = profile.requirements.find((item) => item.id === need.requirementId);
    const satisfier = requirement?.satisfiers.find(
      (item) => item.evidenceFamily === need.evidenceFamily,
    );
    if (
      !requirement ||
      !satisfier ||
      requirement.questionId !== need.questionId ||
      requirement.classification !== need.classification ||
      requirement.requirePitQualified !== need.requirePitQualified ||
      requirement.requireReplayEligible !== need.requireReplayEligible ||
      inquiryCanonicalJsonString(requirement.allowedObservationKinds) !==
        inquiryCanonicalJsonString(need.allowedObservationKinds) ||
      inquiryCanonicalJsonString(requirement.allowedObservationSchemaVersions) !==
        inquiryCanonicalJsonString(need.allowedObservationSchemaVersions) ||
      inquiryCanonicalJsonString(requirement.inquiryBounds) !==
        inquiryCanonicalJsonString(need.inquiryBounds) ||
      need.providerCandidates.some(
        (candidate) =>
          !satisfier.providerIds.includes(candidate.providerId) ||
          candidate.substitutionRuleId !== satisfier.substitutionRuleId,
      )
    ) {
      throw new Error("INFORMATION_INQUIRY_LOOP_INVALID:needProfileAuthorization");
    }
  }
  const attempts = canonicalAttempts({
    bundle,
    attempts: input.attempts,
    finalEvidence: input.finalEvidence,
  });
  const currentQueryCount = attempts.length;
  const currentAcquisitionCostUnits = attempts.reduce((sum, attempt) => sum + attempt.costUnits, 0);
  const queryCountConsumed = bundle.plan.queryCountConsumedBeforeIteration + currentQueryCount;
  const acquisitionCostUnitsConsumed =
    bundle.plan.acquisitionCostUnitsConsumedBeforeIteration + currentAcquisitionCostUnits;
  requireNonNegativeInteger(queryCountConsumed, "cumulativeQueryCount");
  requireNonNegativeInteger(acquisitionCostUnitsConsumed, "cumulativeCostUnits");
  if (
    queryCountConsumed > bundle.plan.bounds.maxQueryCount ||
    acquisitionCostUnitsConsumed > bundle.plan.bounds.maxAcquisitionCostUnits
  ) {
    throw new Error("INFORMATION_INQUIRY_LOOP_INVALID:attemptBudget");
  }
  const finalSufficiencyReceipt = evaluateInformationSufficiencyV2({
    profile,
    organizationId: bundle.plan.organizationId,
    accountId: bundle.plan.accountId,
    purpose: mapInformationInquiryPurposeV1(bundle.plan.purpose),
    symbol: bundle.plan.symbol,
    venue: bundle.plan.venue,
    analyticalTimeframe: profile.analyticalTimeframe,
    horizon: profile.horizon,
    pitAnchor: bundle.plan.pitAnchor,
    activeContextTriggers: input.activeContextTriggers,
    evidence: input.finalEvidence,
    aggregateQualityEvaluation: input.aggregateQualityEvaluation,
  });
  const allAttempted = attempts.length === bundle.plan.requestedSources.length;
  const allUnavailable =
    attempts.length > 0 && attempts.every((attempt) => attempt.outcome !== "AVAILABLE");
  const exhausted =
    bundle.plan.status === "UNRESOLVED" ||
    bundle.plan.iterationIndex + 1 >= bundle.plan.bounds.maxIterations ||
    bundle.plan.bounds.maxDepth === 0 ||
    attempts.some((attempt) => attempt.depth >= bundle.plan.bounds.maxDepth) ||
    attempts.some((attempt) => {
      const need = bundle.plan.needs.find((item) => item.id === attempt.needId)!;
      return (
        attempt.depth >= need.inquiryBounds.maxDepth ||
        attempt.elapsedMsAtCompletion >= need.inquiryBounds.maxDurationMs
      );
    }) ||
    attempts.some((attempt) => attempt.elapsedMsAtCompletion >= bundle.plan.bounds.maxDurationMs) ||
    queryCountConsumed >= bundle.plan.bounds.maxQueryCount ||
    acquisitionCostUnitsConsumed >= bundle.plan.bounds.maxAcquisitionCostUnits;
  const terminalStatus: InformationNeedTerminalStatusV1 =
    finalSufficiencyReceipt.status === "SUFFICIENT"
      ? "ANSWERED_SUFFICIENTLY"
      : allUnavailable && finalSufficiencyReceipt.status === "UNAVAILABLE"
        ? "UNAVAILABLE"
        : exhausted && allAttempted
          ? "INFORMATION_INSUFFICIENT"
          : "UNRESOLVED";
  const reasonCodes = sortInquiryUniqueStrings(
    [
      ...finalSufficiencyReceipt.reasonCodes,
      ...(terminalStatus === "INFORMATION_INSUFFICIENT" ? ["INQUIRY_BOUNDS_EXHAUSTED"] : []),
      ...(terminalStatus === "UNAVAILABLE" ? ["REQUESTED_EVIDENCE_UNAVAILABLE"] : []),
      ...(terminalStatus === "UNRESOLVED" ? ["INQUIRY_REMAINS_UNRESOLVED"] : []),
    ],
    "loopReasonCode",
  );
  const body = {
    schemaVersion: INFORMATION_INQUIRY_LOOP_RECEIPT_V1_SCHEMA_VERSION,
    planId: bundle.plan.id,
    planContentDigest: bundle.plan.contentDigest,
    attempts,
    queryCountConsumed,
    acquisitionCostUnitsConsumed,
    terminalStatus,
    finalSufficiencyReceipt,
    reasonCodes,
    authority: "INFORMATION_SUFFICIENCY_REEVALUATION_ONLY" as const,
    createsKnowledgeHypothesisForecastDecisionOrCapitalAuthority: false as const,
  };
  const contentDigest = computeInquiryContentDigest(body);
  return deepFreezeInquiry({ ...body, id: `iil_${contentDigest}`, contentDigest });
}

export function assertInformationInquiryLoopReceiptV1(
  receipt: InformationInquiryLoopReceiptV1,
  bundle: InformationInquiryPlanningBundleV1,
  profile: RequiredInformationProfileV2,
): InformationInquiryLoopReceiptV1 {
  const expected = runInformationInquiryLoopV1({
    bundle,
    profile,
    attempts: receipt.attempts.map((attempt) => ({
      iterationIndex: attempt.iterationIndex,
      depth: attempt.depth,
      needId: attempt.needId,
      requirementId: attempt.requirementId,
      providerId: attempt.providerId,
      outcome: attempt.outcome,
      elapsedMsAtCompletion: attempt.elapsedMsAtCompletion,
      evidenceIds: attempt.evidenceIds,
      reasonCodes: attempt.reasonCodes,
    })),
    finalEvidence: receipt.finalSufficiencyReceipt.evidenceInventory,
    activeContextTriggers: receipt.finalSufficiencyReceipt.activeContextTriggers,
    aggregateQualityEvaluation: receipt.finalSufficiencyReceipt.aggregateQualityEvaluation,
  });
  if (inquiryCanonicalJsonString(expected) !== inquiryCanonicalJsonString(receipt)) {
    throw new Error("INFORMATION_INQUIRY_LOOP_INVALID:receiptIdentity");
  }
  return receipt;
}
