import {
  assertInformationSufficiencyReceiptV2,
  assertRequiredInformationProfileV2,
  INFORMATION_QUESTION_IDS_V2,
  INFORMATION_REQUIREMENT_CLASSES_V2,
  type InformationEvidenceV2,
  type InformationQuestionIdV2,
  type InformationSufficiencyReceiptV2,
  type RequiredInformationProfileV2,
} from "@/lib/trader/intelligence/information-sufficiency";
import {
  assertHistoricalAnalogueQueryV1,
  defineHistoricalAnalogueResultV1,
  type HistoricalAnalogueQueryV1,
  type HistoricalAnalogueResultStatusV1,
  type HistoricalAnalogueResultV1,
} from "@/lib/trader/intelligence/information-inquiry/historical-analogue-contract-v1";
import {
  assertTopDownReconstructionV1,
  type TopDownReconstructionV1,
} from "@/lib/trader/intelligence/information-inquiry/top-down-reconstruction-v1";
import {
  assertInformationInquiryPolicyV1,
  canonicalizeInformationNeedTimeframeRequirementsV1,
  computeInformationContradictionMaterialityEvaluationDigestV1,
  computeInquiryContentDigest,
  deepFreezeInquiry,
  defineInformationAcquisitionSelectionV1,
  inquiryCanonicalJsonString,
  inquiryCanonicalTextCompare,
  mapInformationInquiryPurposeV1,
  requireInquiryDigest,
  requireInquiryNonEmpty,
  requireInquiryTimestamp,
  sortInquiryUniqueStrings,
  INFORMATION_NEED_PLAN_V1_SCHEMA_VERSION,
  type InformationContradictionLineageV1,
  type InformationIgnoredSourceV1,
  type InformationInquiryPolicyV1,
  type InformationNeedPlanV1,
  type InformationNeedV1,
  type InformationPlanEvidenceRefV1,
  type InformationRequestedSourceV1,
} from "@/lib/trader/intelligence/information-inquiry/contracts-v1";
import { CANONICAL_PRIMITIVE_OBSERVATION_KINDS_V1 } from "@/lib/trader/mi/canonical-observation-v1";

export const INFORMATION_INQUIRY_PLANNING_BUNDLE_V1_SCHEMA_VERSION =
  "information_inquiry_planning_bundle/v1" as const;

export type InformationContradictionInputV1 = Readonly<{
  requirementId: string;
  lineage: InformationContradictionLineageV1;
}>;

export type HistoricalAnaloguePlanningV1 = Readonly<{
  requirementId: string;
  questionId: "Q_HISTORICAL_ANALOGUES";
  query: HistoricalAnalogueQueryV1;
  result: HistoricalAnalogueResultV1 | null;
  disposition:
    | "QUERY_REQUIRED"
    | "QUALIFIED_KNOWLEDGE_AVAILABLE"
    | "NO_MATCHING_OCCURRENCE"
    | "ROUTE_RESEARCH_QUESTION_DEE_646"
    | "UNRESOLVED_KNOWLEDGE"
    | "HISTORY_UNAVAILABLE";
  createsKnowledgeAuthority: false;
}>;

export type HypothesisDiscriminatorInputV1 = Readonly<{
  requirementId: string;
  questionId: InformationQuestionIdV2;
  assessmentId: string;
  assessmentContentDigest: string;
  hypothesisRefs: readonly Readonly<{
    hypothesisId: string;
    hypothesisContentDigest: string;
    failureBoundaryContentDigest: string;
  }>[];
  status: "MISSING_DISCRIMINATING_EVIDENCE" | "NO_APPLICABLE_QUALIFIED_HYPOTHESIS";
  missingEvidenceReasonCodes: readonly string[];
}>;

export type HypothesisDiscriminatorPlanningV1 = Readonly<{
  requirementId: string;
  questionId: InformationQuestionIdV2;
  assessmentId: string;
  assessmentContentDigest: string;
  hypothesisRefs: HypothesisDiscriminatorInputV1["hypothesisRefs"];
  status: HypothesisDiscriminatorInputV1["status"];
  missingEvidenceReasonCodes: readonly string[];
  disposition: "REQUEST_PROFILE_AUTHORIZED_EVIDENCE" | "ROUTE_RESEARCH_QUESTION_DEE_646";
  createsOrRanksHypothesis: false;
}>;

export type InformationResearchQuestionRouteV1 = Readonly<{
  requirementId: string;
  questionId: InformationQuestionIdV2;
  destination: "DEE-646";
  reasonCode: "NO_APPLICABLE_QUALIFIED_HYPOTHESIS" | "NO_QUALIFIED_RELATION_KNOWLEDGE";
}>;

export type InformationInquiryPlanningBundleV1 = Readonly<{
  schemaVersion: typeof INFORMATION_INQUIRY_PLANNING_BUNDLE_V1_SCHEMA_VERSION;
  plan: InformationNeedPlanV1;
  contradictions: readonly InformationContradictionInputV1[];
  analoguePlanning: readonly HistoricalAnaloguePlanningV1[];
  hypothesisDiscriminators: readonly HypothesisDiscriminatorPlanningV1[];
  researchQuestionRoutes: readonly InformationResearchQuestionRouteV1[];
  authority: "EVIDENCE_ACQUISITION_PLANNING_ONLY";
  createsKnowledgeHypothesisForecastDecisionOrCapitalAuthority: false;
  contentDigest: string;
}>;

export type BuildInformationNeedPlanV1Input = Readonly<{
  derivationVersion: string;
  profile: RequiredInformationProfileV2;
  receipt: InformationSufficiencyReceiptV2;
  policy: InformationInquiryPolicyV1;
  topDownReconstruction: TopDownReconstructionV1;
  iterationIndex: number;
  queryCountConsumed: number;
  acquisitionCostUnitsConsumed: number;
  availableProviderIds: readonly string[];
  contradictions: readonly InformationContradictionInputV1[];
  analogueRequests: readonly Readonly<{
    requirementId: string;
    query: HistoricalAnalogueQueryV1;
    result: HistoricalAnalogueResultV1 | null;
  }>[];
  hypothesisDiscriminators: readonly HypothesisDiscriminatorInputV1[];
}>;

const UNRESOLVED_TERMINALS = new Set([
  "INSUFFICIENT_NON_BLOCKING",
  "INSUFFICIENT_BLOCKING",
  "UNRESOLVED_CONTRADICTION",
  "UNAVAILABLE",
]);

function assertExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  field: string,
): void {
  const actual = Object.keys(value).sort(inquiryCanonicalTextCompare);
  const canonicalExpected = [...expected].sort(inquiryCanonicalTextCompare);
  if (inquiryCanonicalJsonString(actual) !== inquiryCanonicalJsonString(canonicalExpected)) {
    throw new Error(`INFORMATION_INQUIRY_PLANNER_INVALID:${field}Fields`);
  }
}

function requireNonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`INFORMATION_INQUIRY_PLANNER_INVALID:${field}`);
  }
  return value;
}

function assertScope(input: BuildInformationNeedPlanV1Input): void {
  assertRequiredInformationProfileV2(input.profile);
  assertInformationSufficiencyReceiptV2(input.receipt, input.profile);
  assertInformationInquiryPolicyV1(input.policy);
  assertTopDownReconstructionV1(input.topDownReconstruction);
  if (
    input.policy.profilePurpose !== input.profile.purpose ||
    input.receipt.profileId !== input.profile.id ||
    input.receipt.profileContentDigest !== input.profile.contentDigest ||
    input.receipt.organizationId !== input.profile.organizationId ||
    input.receipt.accountId !== input.profile.accountId ||
    input.receipt.symbol !== input.profile.symbol ||
    input.receipt.venue !== input.profile.venue ||
    input.receipt.analyticalTimeframe !== input.profile.analyticalTimeframe ||
    input.receipt.horizon !== input.profile.horizon ||
    input.receipt.purpose !== mapInformationInquiryPurposeV1(input.policy.purpose) ||
    input.topDownReconstruction.symbol !== input.profile.symbol ||
    input.topDownReconstruction.pitAnchor !== input.receipt.pitAnchor
  ) {
    throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:scopeMismatch");
  }
  requireNonNegativeInteger(input.iterationIndex, "iterationIndex");
  requireNonNegativeInteger(input.queryCountConsumed, "queryCountConsumed");
  requireNonNegativeInteger(input.acquisitionCostUnitsConsumed, "acquisitionCostUnitsConsumed");
  if (
    input.queryCountConsumed > input.policy.bounds.maxQueryCount ||
    input.acquisitionCostUnitsConsumed > input.policy.bounds.maxAcquisitionCostUnits
  ) {
    throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:consumedBounds");
  }
}

function canonicalEvidenceRefs(
  receipt: InformationSufficiencyReceiptV2,
  selectedEvidenceIds: ReadonlySet<string>,
): readonly InformationPlanEvidenceRefV1[] {
  return deepFreezeInquiry(
    receipt.evidenceInventory
      .filter((evidence) => selectedEvidenceIds.has(evidence.evidenceId))
      .map((evidence) => ({
        evidenceId: evidence.evidenceId,
        evidenceFamily: evidence.evidenceFamily,
        providerId: evidence.providerId,
        observationId: evidence.observationId,
        observationContentDigest: evidence.observationContentDigest,
        availability: evidence.availability,
        availableAt: evidence.availableAt,
      }))
      .sort((left, right) => inquiryCanonicalTextCompare(left.evidenceId, right.evidenceId)),
  );
}

function canonicalContradictions(
  input: BuildInformationNeedPlanV1Input,
): ReadonlyMap<string, InformationContradictionLineageV1> {
  const byRequirement = new Map<string, InformationContradictionLineageV1>();
  for (const entry of input.contradictions) {
    const requirementId = requireInquiryNonEmpty(entry.requirementId, "contradictionRequirementId");
    if (byRequirement.has(requirementId)) {
      throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:duplicateContradiction");
    }
    const requirement = input.profile.requirements.find((item) => item.id === requirementId);
    const receipt = input.receipt.requirementReceipts.find(
      (item) => item.requirementId === requirementId,
    );
    if (
      !requirement ||
      !receipt ||
      receipt.terminalStatus !== "UNRESOLVED_CONTRADICTION" ||
      entry.lineage.questionId !== requirement.questionId
    ) {
      throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:contradictionApplicability");
    }
    const observationIds = sortInquiryUniqueStrings(
      entry.lineage.observationIds,
      "contradictionObservationId",
    );
    if (observationIds.length < 2) {
      throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:contradictionObservations");
    }
    const matchedEvidence = receipt.matchedEvidenceIds.map((id) =>
      input.receipt.evidenceInventory.find((item) => item.evidenceId === id),
    );
    const claimId = requireInquiryNonEmpty(entry.lineage.claimId, "contradictionClaimId");
    if (
      matchedEvidence.length === 0 ||
      matchedEvidence.some(
        (item) => !item || item.contradictionGroup === null || item.contradictionGroup !== claimId,
      )
    ) {
      throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:contradictionEvidenceLineage");
    }
    const lineageEvidence = matchedEvidence as readonly InformationEvidenceV2[];
    const exactObservationIds = sortInquiryUniqueStrings(
      lineageEvidence.map((item) => item.observationId),
      "derivedContradictionObservationId",
    );
    const observationContentDigests = [...entry.lineage.observationContentDigests]
      .map((reference) => ({
        observationId: requireInquiryNonEmpty(
          reference.observationId,
          "contradictionObservationDigestId",
        ),
        observationContentDigest: requireInquiryDigest(
          reference.observationContentDigest,
          "contradictionObservationContentDigest",
        ),
      }))
      .sort((left, right) => inquiryCanonicalTextCompare(left.observationId, right.observationId));
    const exactObservationContentDigests = lineageEvidence
      .map((item) => ({
        observationId: item!.observationId,
        observationContentDigest: item!.observationContentDigest,
      }))
      .sort((left, right) => inquiryCanonicalTextCompare(left.observationId, right.observationId));
    const evidenceIds = sortInquiryUniqueStrings(
      entry.lineage.evidenceIds,
      "contradictionEvidenceId",
    );
    const exactEvidenceIds = sortInquiryUniqueStrings(
      lineageEvidence.map((item) => item!.evidenceId),
      "derivedContradictionEvidenceId",
    );
    const observationContradictionStates = [...entry.lineage.observationContradictionStates]
      .map((state) => ({
        observationId: requireInquiryNonEmpty(
          state.observationId,
          "contradictionObservationStateId",
        ),
        contradiction: state.contradiction,
      }))
      .sort((left, right) => inquiryCanonicalTextCompare(left.observationId, right.observationId));
    const exactObservationContradictionStates = lineageEvidence
      .map((item) => ({
        observationId: item!.observationId,
        contradiction: item!.contradiction,
      }))
      .sort((left, right) => inquiryCanonicalTextCompare(left.observationId, right.observationId));
    if (
      inquiryCanonicalJsonString(observationContentDigests) !==
        inquiryCanonicalJsonString(exactObservationContentDigests) ||
      inquiryCanonicalJsonString(observationIds) !==
        inquiryCanonicalJsonString(exactObservationIds) ||
      inquiryCanonicalJsonString(evidenceIds) !== inquiryCanonicalJsonString(exactEvidenceIds) ||
      inquiryCanonicalJsonString(observationContradictionStates) !==
        inquiryCanonicalJsonString(exactObservationContradictionStates)
    ) {
      throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:contradictionObservationIdentity");
    }
    const providerIds = sortInquiryUniqueStrings(
      entry.lineage.providerIds,
      "contradictionProviderId",
    );
    const dependenceGroups = sortInquiryUniqueStrings(
      entry.lineage.dependenceGroups,
      "contradictionDependenceGroup",
    );
    const exactProviders = sortInquiryUniqueStrings(
      [...new Set(lineageEvidence.map((item) => item!.providerId))],
      "derivedContradictionProviderId",
    );
    const exactGroups = sortInquiryUniqueStrings(
      [...new Set(lineageEvidence.map((item) => item!.dependenceGroup))],
      "derivedContradictionDependenceGroup",
    );
    if (
      computeInquiryContentDigest(providerIds) !== computeInquiryContentDigest(exactProviders) ||
      computeInquiryContentDigest(dependenceGroups) !== computeInquiryContentDigest(exactGroups) ||
      entry.lineage.materialityPolicyVersion !==
        input.policy.contradictionMaterialityPolicyVersion ||
      entry.lineage.materialityPolicyContentDigest !==
        input.policy.contradictionMaterialityPolicyDigest
    ) {
      throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:contradictionSourceLineage");
    }
    const materialityEvaluationContentDigest =
      computeInformationContradictionMaterialityEvaluationDigestV1({
        claimId,
        materiality: entry.lineage.materiality,
        evidenceIds,
        observationIds,
        observationContentDigests,
        observationContradictionStates,
        providerIds,
        dependenceGroups,
        materialityPolicyVersion: entry.lineage.materialityPolicyVersion,
        materialityPolicyContentDigest: entry.lineage.materialityPolicyContentDigest,
      });
    if (entry.lineage.materialityEvaluationContentDigest !== materialityEvaluationContentDigest) {
      throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:contradictionMaterialityIdentity");
    }
    const lineage = deepFreezeInquiry({
      questionId: entry.lineage.questionId,
      claimId,
      materiality: entry.lineage.materiality,
      evidenceIds,
      observationIds,
      observationContentDigests,
      observationContradictionStates,
      providerIds,
      dependenceGroups,
      materialityPolicyVersion: entry.lineage.materialityPolicyVersion,
      materialityPolicyContentDigest: entry.lineage.materialityPolicyContentDigest,
      materialityEvaluationContentDigest,
      reasonCodes: sortInquiryUniqueStrings(entry.lineage.reasonCodes, "contradictionReasonCode"),
    });
    if (!(["MATERIAL", "IMMATERIAL", "UNKNOWN"] as const).includes(lineage.materiality)) {
      throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:contradictionMateriality");
    }
    byRequirement.set(requirementId, lineage);
  }
  for (const receipt of input.receipt.requirementReceipts) {
    if (
      receipt.terminalStatus === "UNRESOLVED_CONTRADICTION" &&
      !byRequirement.has(receipt.requirementId)
    ) {
      throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:missingContradictionLineage");
    }
  }
  return byRequirement;
}

function costFor(
  policy: InformationInquiryPolicyV1,
  requirementId: string,
  providerId: string,
): number {
  const assignment = policy.costPolicy.assignments.find(
    (entry) => entry.requirementId === requirementId && entry.providerId === providerId,
  );
  if (!assignment) throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:missingCostAttribution");
  return assignment.costUnits;
}

function canonicalNeed(input: {
  requirement: RequiredInformationProfileV2["requirements"][number];
  satisfier: RequiredInformationProfileV2["requirements"][number]["satisfiers"][number];
  receipt: InformationSufficiencyReceiptV2["requirementReceipts"][number];
  policy: InformationInquiryPolicyV1;
  contradiction: InformationContradictionLineageV1 | null;
}): InformationNeedV1 | null {
  const rawTimeframeRequirements = input.policy.timeframePolicies.flatMap((timeframePolicy) => {
    if (!timeframePolicy.relevantRequirementIds.includes(input.requirement.id)) return [];
    const freshness = timeframePolicy.maxStalenessMsByRequirement.find(
      (entry) => entry.requirementId === input.requirement.id,
    );
    if (!freshness) {
      throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:missingTimeframeFreshness");
    }
    return [{ timeframe: timeframePolicy.timeframe, maxStalenessMs: freshness.maxStalenessMs }];
  });
  if (rawTimeframeRequirements.length === 0) return null;
  const timeframeRequirements =
    canonicalizeInformationNeedTimeframeRequirementsV1(rawTimeframeRequirements);
  const providerCandidates = input.satisfier.providerIds
    .map((providerId) => ({
      providerId,
      substitutionRuleId: input.satisfier.substitutionRuleId,
      costUnits: costFor(input.policy, input.requirement.id, providerId),
    }))
    .sort((left, right) => inquiryCanonicalTextCompare(left.providerId, right.providerId));
  const reasonCodes = sortInquiryUniqueStrings(
    [
      ...input.receipt.reasonCodes,
      ...(input.requirement.questionId === "Q_WHY_HAPPENING" ? ["CAUSAL_EVIDENCE_REQUIRED"] : []),
      ...(input.requirement.questionId === "Q_HISTORICAL_ANALOGUES"
        ? ["HISTORICAL_ANALOGUE_EVIDENCE_REQUIRED"]
        : []),
    ],
    "needReasonCode",
  );
  const body = {
    requirementId: input.requirement.id,
    questionId: input.requirement.questionId,
    classification: input.requirement.classification,
    evidenceFamily: input.satisfier.evidenceFamily,
    allowedObservationKinds: [...input.requirement.allowedObservationKinds],
    allowedObservationSchemaVersions: [...input.requirement.allowedObservationSchemaVersions],
    timeframeRequirements,
    inquiryBounds: {
      maxDepth: input.requirement.inquiryBounds.maxDepth,
      maxDurationMs: input.requirement.inquiryBounds.maxDurationMs,
      maxProviderFanout: input.requirement.inquiryBounds.maxProviderFanout,
    },
    providerCandidates,
    requirePitQualified: input.requirement.requirePitQualified,
    requireReplayEligible: input.requirement.requireReplayEligible,
    contradiction: input.contradiction,
    reasonCodes,
  };
  return deepFreezeInquiry({ ...body, id: `need_${computeInquiryContentDigest(body)}` });
}

export function classifyHistoricalAnaloguePlanningDispositionV1(
  status: HistoricalAnalogueResultStatusV1 | null,
): HistoricalAnaloguePlanningV1["disposition"] {
  switch (status) {
    case null:
      return "QUERY_REQUIRED";
    case "MATCHED_QUALIFIED_KNOWLEDGE":
      return "QUALIFIED_KNOWLEDGE_AVAILABLE";
    case "NO_MATCHING_OCCURRENCE":
      return "NO_MATCHING_OCCURRENCE";
    case "NO_QUALIFIED_RELATION_KNOWLEDGE":
      return "ROUTE_RESEARCH_QUESTION_DEE_646";
    case "QUALIFIED_KNOWLEDGE_STALE_CONTESTED_OR_OUT_OF_SCOPE":
      return "UNRESOLVED_KNOWLEDGE";
    case "HISTORY_UNAVAILABLE_OR_UNQUALIFIED":
      return "HISTORY_UNAVAILABLE";
  }
}

function canonicalAnaloguePlanning(
  input: BuildInformationNeedPlanV1Input,
): readonly HistoricalAnaloguePlanningV1[] {
  const requirementIds = new Set<string>();
  const planning = input.analogueRequests
    .map((entry) => {
      const requirementId = requireInquiryNonEmpty(entry.requirementId, "analogueRequirementId");
      const requirement = input.profile.requirements.find((item) => item.id === requirementId);
      const applicableReceipts = input.receipt.requirementReceipts.filter(
        (item) =>
          item.requirementId === requirementId && UNRESOLVED_TERMINALS.has(item.terminalStatus),
      );
      if (
        !requirement ||
        requirement.questionId !== "Q_HISTORICAL_ANALOGUES" ||
        applicableReceipts.length !== 1 ||
        requirementIds.has(requirementId)
      ) {
        throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:analogueApplicability");
      }
      requirementIds.add(requirementId);
      const query = assertHistoricalAnalogueQueryV1(entry.query);
      if (
        query.pitAnchor !== input.receipt.pitAnchor ||
        query.maxResults > input.policy.bounds.maxHistoricalResults
      ) {
        throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:analoguePitMismatch");
      }
      const result = (() => {
        if (entry.result === null) return null;
        const expected = defineHistoricalAnalogueResultV1({
          query,
          status: entry.result.status,
          occurrences: entry.result.occurrences,
          knowledgeRefs: entry.result.knowledgeRefs,
          reasonCodes: entry.result.reasonCodes,
        });
        if (inquiryCanonicalJsonString(expected) !== inquiryCanonicalJsonString(entry.result)) {
          throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:analogueResultIdentity");
        }
        if (entry.result.occurrences.length > query.maxResults) {
          throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:analogueResultBound");
        }
        return entry.result;
      })();
      return {
        requirementId,
        questionId: "Q_HISTORICAL_ANALOGUES" as const,
        query,
        result,
        disposition: classifyHistoricalAnaloguePlanningDispositionV1(result?.status ?? null),
        createsKnowledgeAuthority: false as const,
      };
    })
    .sort((left, right) => inquiryCanonicalTextCompare(left.requirementId, right.requirementId));
  const reservedQueries = planning.reduce((sum, entry) => sum + entry.query.maxQueries, 0);
  const reservedResults = planning.reduce((sum, entry) => sum + entry.query.maxResults, 0);
  const reservedCostUnits = planning.reduce((sum, entry) => sum + entry.query.maxCostUnits, 0);
  if (
    input.queryCountConsumed + reservedQueries > input.policy.bounds.maxQueryCount ||
    reservedResults > input.policy.bounds.maxHistoricalResults ||
    input.acquisitionCostUnitsConsumed + reservedCostUnits >
      input.policy.bounds.maxAcquisitionCostUnits
  ) {
    throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:analogueCumulativeBounds");
  }
  return deepFreezeInquiry(planning);
}

function canonicalHypothesisDiscriminators(
  input: BuildInformationNeedPlanV1Input,
): readonly HypothesisDiscriminatorPlanningV1[] {
  return deepFreezeInquiry(
    input.hypothesisDiscriminators
      .map((entry) => {
        const requirementId = requireInquiryNonEmpty(
          entry.requirementId,
          "discriminatorRequirementId",
        );
        const requirement = input.profile.requirements.find((item) => item.id === requirementId);
        const receipt = input.receipt.requirementReceipts.find(
          (item) => item.requirementId === requirementId,
        );
        if (
          !requirement ||
          !receipt ||
          !UNRESOLVED_TERMINALS.has(receipt.terminalStatus) ||
          requirement.questionId !== entry.questionId
        ) {
          throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:discriminatorApplicability");
        }
        requireInquiryNonEmpty(entry.assessmentId, "assessmentId");
        requireInquiryDigest(entry.assessmentContentDigest, "assessmentContentDigest");
        if (
          entry.status !== "MISSING_DISCRIMINATING_EVIDENCE" &&
          entry.status !== "NO_APPLICABLE_QUALIFIED_HYPOTHESIS"
        ) {
          throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:discriminatorStatus");
        }
        const hypothesisRefs = [...entry.hypothesisRefs]
          .map((reference) => ({
            hypothesisId: requireInquiryNonEmpty(reference.hypothesisId, "hypothesisId"),
            hypothesisContentDigest: requireInquiryDigest(
              reference.hypothesisContentDigest,
              "hypothesisContentDigest",
            ),
            failureBoundaryContentDigest: requireInquiryDigest(
              reference.failureBoundaryContentDigest,
              "failureBoundaryContentDigest",
            ),
          }))
          .sort((left, right) =>
            inquiryCanonicalTextCompare(left.hypothesisId, right.hypothesisId),
          );
        if (
          new Set(hypothesisRefs.map((item) => item.hypothesisId)).size !== hypothesisRefs.length ||
          (entry.status === "MISSING_DISCRIMINATING_EVIDENCE" && hypothesisRefs.length === 0) ||
          (entry.status === "NO_APPLICABLE_QUALIFIED_HYPOTHESIS" && hypothesisRefs.length !== 0)
        ) {
          throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:discriminatorHypotheses");
        }
        return {
          requirementId,
          questionId: entry.questionId,
          assessmentId: entry.assessmentId,
          assessmentContentDigest: entry.assessmentContentDigest,
          hypothesisRefs,
          status: entry.status,
          missingEvidenceReasonCodes: sortInquiryUniqueStrings(
            entry.missingEvidenceReasonCodes,
            "discriminatorReasonCode",
          ),
          disposition:
            entry.status === "NO_APPLICABLE_QUALIFIED_HYPOTHESIS"
              ? ("ROUTE_RESEARCH_QUESTION_DEE_646" as const)
              : ("REQUEST_PROFILE_AUTHORIZED_EVIDENCE" as const),
          createsOrRanksHypothesis: false as const,
        };
      })
      .sort((left, right) =>
        inquiryCanonicalTextCompare(
          `${left.requirementId}\u0000${left.assessmentId}`,
          `${right.requirementId}\u0000${right.assessmentId}`,
        ),
      ),
  );
}

export function buildInformationNeedPlanningBundleV1(
  input: BuildInformationNeedPlanV1Input,
): InformationInquiryPlanningBundleV1 {
  assertScope(input);
  requireInquiryNonEmpty(input.derivationVersion, "derivationVersion");
  const availableProviderIds = sortInquiryUniqueStrings(
    input.availableProviderIds,
    "availableProviderId",
  );
  const contradictions = canonicalContradictions(input);
  const unresolvedReceipts = input.receipt.requirementReceipts.filter((receipt) =>
    UNRESOLVED_TERMINALS.has(receipt.terminalStatus),
  );
  const unresolvedQuestionIds = sortInquiryUniqueStrings(
    [...new Set(unresolvedReceipts.map((receipt) => receipt.questionId))],
    "unresolvedQuestionId",
  ) as InformationQuestionIdV2[];
  const matchedEvidenceIds = new Set(
    unresolvedReceipts.flatMap((receipt) => receipt.matchedEvidenceIds),
  );
  const availableEvidence = canonicalEvidenceRefs(input.receipt, matchedEvidenceIds);

  const needs = unresolvedReceipts
    .flatMap((receipt) => {
      const requirement = input.profile.requirements.find(
        (candidate) => candidate.id === receipt.requirementId,
      );
      if (!requirement) throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:requirementReceipt");
      return requirement.satisfiers
        .map((satisfier) =>
          canonicalNeed({
            requirement,
            satisfier,
            receipt,
            policy: input.policy,
            contradiction: contradictions.get(requirement.id) ?? null,
          }),
        )
        .filter((need): need is InformationNeedV1 => need !== null);
    })
    .sort((left, right) => {
      const leftSubstitution = left.providerCandidates[0]?.substitutionRuleId;
      const rightSubstitution = right.providerCandidates[0]?.substitutionRuleId;
      const leftPriority = leftSubstitution === null ? "0" : leftSubstitution ? "1" : "2";
      const rightPriority = rightSubstitution === null ? "0" : rightSubstitution ? "1" : "2";
      return inquiryCanonicalTextCompare(
        `${left.requirementId}\u0000${leftPriority}\u0000${left.evidenceFamily}\u0000${left.id}`,
        `${right.requirementId}\u0000${rightPriority}\u0000${right.evidenceFamily}\u0000${right.id}`,
      );
    });

  const analoguePlanning = canonicalAnaloguePlanning(input);
  const analogueReservedQueries = analoguePlanning.reduce(
    (sum, entry) => sum + entry.query.maxQueries,
    0,
  );
  const analogueReservedCostUnits = analoguePlanning.reduce(
    (sum, entry) => sum + entry.query.maxCostUnits,
    0,
  );

  const requestedSources: InformationRequestedSourceV1[] = [];
  const ignoredSources: InformationIgnoredSourceV1[] = [];
  const requestedKeys = new Set<string>();
  let remainingQueries = input.policy.bounds.maxQueryCount - input.queryCountConsumed;
  let remainingCost =
    input.policy.bounds.maxAcquisitionCostUnits - input.acquisitionCostUnitsConsumed;
  remainingQueries -= analogueReservedQueries;
  remainingCost -= analogueReservedCostUnits;
  const iterationOrDepthExhausted =
    input.iterationIndex >= input.policy.bounds.maxIterations || input.policy.bounds.maxDepth === 0;
  const budgetReasonByRequirementProvider = new Map<
    string,
    InformationIgnoredSourceV1["reasonCode"]
  >();
  const selectedFanoutByRequirement = new Map<string, number>();
  for (const need of needs) {
    const requirement = input.profile.requirements.find((item) => item.id === need.requirementId)!;
    const fanout = Math.min(
      input.policy.bounds.maxProviderFanout,
      requirement.inquiryBounds.maxProviderFanout,
    );
    const candidates = need.providerCandidates.filter(
      (candidate) => !requestedKeys.has(`${need.requirementId}\u0000${candidate.providerId}`),
    );
    const selectedForRequirement = selectedFanoutByRequirement.get(need.requirementId) ?? 0;
    const groupCost = candidates.reduce((sum, candidate) => sum + candidate.costUnits, 0);
    const queryBounded =
      iterationOrDepthExhausted ||
      need.inquiryBounds.maxDepth === 0 ||
      need.inquiryBounds.maxDurationMs === 0 ||
      candidates.length > remainingQueries ||
      selectedForRequirement + candidates.length > fanout;
    const costBounded = groupCost > remainingCost;
    if (queryBounded || costBounded) {
      for (const candidate of candidates) {
        budgetReasonByRequirementProvider.set(
          `${need.requirementId}\u0000${candidate.providerId}`,
          queryBounded ? "QUERY_BUDGET_EXHAUSTED" : "COST_BUDGET_EXHAUSTED",
        );
      }
      continue;
    }
    for (const candidate of candidates) {
      const key = `${need.requirementId}\u0000${candidate.providerId}`;
      requestedSources.push({
        needId: need.id,
        requirementId: need.requirementId,
        providerId: candidate.providerId,
        allowedObservationKinds: [...need.allowedObservationKinds],
        costUnits: candidate.costUnits,
        reasonCodes: [...need.reasonCodes],
      });
      requestedKeys.add(key);
      remainingQueries -= 1;
      remainingCost -= candidate.costUnits;
    }
    selectedFanoutByRequirement.set(need.requirementId, selectedForRequirement + candidates.length);
  }

  for (const requirement of input.profile.requirements) {
    const receipt = input.receipt.requirementReceipts.find(
      (item) => item.requirementId === requirement.id,
    )!;
    const authorizedProviders = new Set(requirement.satisfiers.flatMap((item) => item.providerIds));
    for (const providerId of availableProviderIds) {
      const key = `${requirement.id}\u0000${providerId}`;
      if (requestedKeys.has(key)) continue;
      const reasonCode: InformationIgnoredSourceV1["reasonCode"] =
        receipt.terminalStatus === "NOT_REQUIRED"
          ? "NOT_REQUIRED"
          : receipt.terminalStatus === "NOT_APPLICABLE"
            ? "NOT_APPLICABLE"
            : !unresolvedReceipts.includes(receipt) ||
                !input.policy.timeframePolicies.some((entry) =>
                  entry.relevantRequirementIds.includes(requirement.id),
                )
              ? "NOT_RELEVANT_TO_ACTIVE_QUESTION"
              : !authorizedProviders.has(providerId)
                ? "NOT_PROFILE_AUTHORIZED"
                : (budgetReasonByRequirementProvider.get(key) ?? "NOT_RELEVANT_TO_ACTIVE_QUESTION");
      ignoredSources.push({ requirementId: requirement.id, providerId, reasonCode });
    }
  }
  requestedSources.sort((left, right) =>
    inquiryCanonicalTextCompare(
      `${left.needId}\u0000${left.providerId}`,
      `${right.needId}\u0000${right.providerId}`,
    ),
  );
  ignoredSources.sort((left, right) =>
    inquiryCanonicalTextCompare(
      `${left.requirementId}\u0000${left.providerId}`,
      `${right.requirementId}\u0000${right.providerId}`,
    ),
  );
  const evidenceSelectionDigest = computeInquiryContentDigest({
    unresolvedQuestionIds,
    availableEvidence,
    needs,
    requestedSources,
  });
  const planPayload = {
    schemaVersion: INFORMATION_NEED_PLAN_V1_SCHEMA_VERSION,
    derivationVersion: input.derivationVersion,
    organizationId: input.profile.organizationId,
    accountId: input.profile.accountId,
    symbol: input.profile.symbol,
    venue: input.profile.venue,
    analyticalTimeframe: input.profile.analyticalTimeframe,
    horizon: input.profile.horizon,
    pitAnchor: input.receipt.pitAnchor,
    purpose: input.policy.purpose,
    profilePurpose: input.policy.profilePurpose,
    profileId: input.profile.id,
    profileContentDigest: input.profile.contentDigest,
    policyVersion: input.policy.policyVersion,
    policyContentDigest: input.policy.contentDigest,
    topDownReconstructionContentDigest: input.topDownReconstruction.contentDigest,
    unresolvedQuestionIds,
    availableEvidence,
    needs,
    requestedSources,
    ignoredSources,
    bounds: {
      maxIterations: input.policy.bounds.maxIterations,
      maxDepth: input.policy.bounds.maxDepth,
      maxDurationMs: input.policy.bounds.maxDurationMs,
      maxProviderFanout: input.policy.bounds.maxProviderFanout,
      maxQueryCount: input.policy.bounds.maxQueryCount,
      maxHistoricalResults: input.policy.bounds.maxHistoricalResults,
      maxAcquisitionCostUnits: input.policy.bounds.maxAcquisitionCostUnits,
    },
    iterationIndex: input.iterationIndex,
    queryCountConsumedBeforeIteration: input.queryCountConsumed,
    acquisitionCostUnitsConsumedBeforeIteration: input.acquisitionCostUnitsConsumed,
    status:
      unresolvedQuestionIds.length === 0
        ? ("NO_ADDITIONAL_EVIDENCE_NEEDED" as const)
        : requestedSources.length > 0
          ? ("READY" as const)
          : ("UNRESOLVED" as const),
    evidenceSelectionDigest,
    authority: "EVIDENCE_ACQUISITION_ONLY" as const,
  };
  const planContentDigest = computeInquiryContentDigest(planPayload);
  const plan = deepFreezeInquiry({
    ...planPayload,
    id: `inp_${planContentDigest}`,
    contentDigest: planContentDigest,
  });
  const hypothesisDiscriminators = canonicalHypothesisDiscriminators(input);
  const contradictionLineage = deepFreezeInquiry(
    [...contradictions.entries()]
      .map(([requirementId, lineage]) => ({ requirementId, lineage }))
      .sort((left, right) => inquiryCanonicalTextCompare(left.requirementId, right.requirementId)),
  );
  const researchQuestionRoutes = deepFreezeInquiry(
    [
      ...analoguePlanning
        .filter((item) => item.disposition === "ROUTE_RESEARCH_QUESTION_DEE_646")
        .map((item) => ({
          requirementId: item.requirementId,
          questionId: item.questionId,
          destination: "DEE-646" as const,
          reasonCode: "NO_QUALIFIED_RELATION_KNOWLEDGE" as const,
        })),
      ...hypothesisDiscriminators
        .filter((item) => item.disposition === "ROUTE_RESEARCH_QUESTION_DEE_646")
        .map((item) => ({
          requirementId: item.requirementId,
          questionId: item.questionId,
          destination: "DEE-646" as const,
          reasonCode: "NO_APPLICABLE_QUALIFIED_HYPOTHESIS" as const,
        })),
    ].sort((left, right) =>
      inquiryCanonicalTextCompare(
        `${left.requirementId}\u0000${left.reasonCode}`,
        `${right.requirementId}\u0000${right.reasonCode}`,
      ),
    ),
  );
  const bundlePayload = {
    schemaVersion: INFORMATION_INQUIRY_PLANNING_BUNDLE_V1_SCHEMA_VERSION,
    plan,
    contradictions: contradictionLineage,
    analoguePlanning,
    hypothesisDiscriminators,
    researchQuestionRoutes,
    authority: "EVIDENCE_ACQUISITION_PLANNING_ONLY" as const,
    createsKnowledgeHypothesisForecastDecisionOrCapitalAuthority: false as const,
  };
  return deepFreezeInquiry({
    ...bundlePayload,
    contentDigest: computeInquiryContentDigest(bundlePayload),
  });
}

export function assertInformationInquiryPlanningBundleV1(
  bundle: InformationInquiryPlanningBundleV1,
): InformationInquiryPlanningBundleV1 {
  assertExactKeys(
    bundle as unknown as Readonly<Record<string, unknown>>,
    [
      "schemaVersion",
      "plan",
      "contradictions",
      "analoguePlanning",
      "hypothesisDiscriminators",
      "researchQuestionRoutes",
      "authority",
      "createsKnowledgeHypothesisForecastDecisionOrCapitalAuthority",
      "contentDigest",
    ],
    "bundle",
  );
  requireInquiryDigest(bundle.contentDigest, "planningBundleContentDigest");
  assertExactKeys(
    bundle.plan as unknown as Readonly<Record<string, unknown>>,
    [
      "schemaVersion",
      "derivationVersion",
      "id",
      "organizationId",
      "accountId",
      "symbol",
      "venue",
      "analyticalTimeframe",
      "horizon",
      "pitAnchor",
      "purpose",
      "profilePurpose",
      "profileId",
      "profileContentDigest",
      "policyVersion",
      "policyContentDigest",
      "topDownReconstructionContentDigest",
      "unresolvedQuestionIds",
      "availableEvidence",
      "needs",
      "requestedSources",
      "ignoredSources",
      "bounds",
      "iterationIndex",
      "queryCountConsumedBeforeIteration",
      "acquisitionCostUnitsConsumedBeforeIteration",
      "status",
      "evidenceSelectionDigest",
      "authority",
      "contentDigest",
    ],
    "plan",
  );
  requireInquiryNonEmpty(bundle.plan.derivationVersion, "planDerivationVersion");
  requireInquiryNonEmpty(bundle.plan.organizationId, "planOrganizationId");
  if (bundle.plan.accountId !== null)
    requireInquiryNonEmpty(bundle.plan.accountId, "planAccountId");
  requireInquiryNonEmpty(bundle.plan.symbol, "planSymbol");
  requireInquiryNonEmpty(bundle.plan.venue, "planVenue");
  requireInquiryNonEmpty(bundle.plan.analyticalTimeframe, "planAnalyticalTimeframe");
  requireInquiryNonEmpty(bundle.plan.horizon, "planHorizon");
  requireInquiryTimestamp(bundle.plan.pitAnchor, "planPitAnchor");
  requireInquiryDigest(bundle.plan.profileId, "planProfileId");
  requireInquiryDigest(bundle.plan.profileContentDigest, "planProfileContentDigest");
  requireInquiryNonEmpty(bundle.plan.policyVersion, "planPolicyVersion");
  requireInquiryDigest(bundle.plan.policyContentDigest, "planPolicyContentDigest");
  requireInquiryDigest(
    bundle.plan.topDownReconstructionContentDigest,
    "planTopDownReconstructionContentDigest",
  );
  requireInquiryDigest(bundle.plan.evidenceSelectionDigest, "planEvidenceSelectionDigest");
  if (bundle.plan.profilePurpose !== mapInformationInquiryPurposeV1(bundle.plan.purpose)) {
    throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:planPurposeMapping");
  }
  const unresolvedQuestionIds = sortInquiryUniqueStrings(
    bundle.plan.unresolvedQuestionIds,
    "planUnresolvedQuestionId",
  );
  if (
    unresolvedQuestionIds.some(
      (questionId) => !INFORMATION_QUESTION_IDS_V2.includes(questionId as InformationQuestionIdV2),
    ) ||
    inquiryCanonicalJsonString(unresolvedQuestionIds) !==
      inquiryCanonicalJsonString(bundle.plan.unresolvedQuestionIds)
  ) {
    throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:planUnresolvedQuestions");
  }
  assertExactKeys(
    bundle.plan.bounds as unknown as Readonly<Record<string, unknown>>,
    [
      "maxIterations",
      "maxDepth",
      "maxDurationMs",
      "maxProviderFanout",
      "maxQueryCount",
      "maxHistoricalResults",
      "maxAcquisitionCostUnits",
    ],
    "planBounds",
  );
  for (const [field, value] of Object.entries(bundle.plan.bounds)) {
    requireNonNegativeInteger(value, `planBounds.${field}`);
  }
  requireNonNegativeInteger(bundle.plan.iterationIndex, "planIterationIndex");
  requireNonNegativeInteger(
    bundle.plan.queryCountConsumedBeforeIteration,
    "planQueryCountConsumedBeforeIteration",
  );
  requireNonNegativeInteger(
    bundle.plan.acquisitionCostUnitsConsumedBeforeIteration,
    "planAcquisitionCostUnitsConsumedBeforeIteration",
  );
  if (
    bundle.plan.queryCountConsumedBeforeIteration > bundle.plan.bounds.maxQueryCount ||
    bundle.plan.acquisitionCostUnitsConsumedBeforeIteration >
      bundle.plan.bounds.maxAcquisitionCostUnits
  ) {
    throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:planConsumedBounds");
  }

  const canonicalNeeds = bundle.plan.needs
    .map((need) => {
      assertExactKeys(
        need as unknown as Readonly<Record<string, unknown>>,
        [
          "id",
          "requirementId",
          "questionId",
          "classification",
          "evidenceFamily",
          "allowedObservationKinds",
          "allowedObservationSchemaVersions",
          "timeframeRequirements",
          "inquiryBounds",
          "providerCandidates",
          "requirePitQualified",
          "requireReplayEligible",
          "contradiction",
          "reasonCodes",
        ],
        "need",
      );
      requireInquiryNonEmpty(need.requirementId, "needRequirementId");
      requireInquiryNonEmpty(need.evidenceFamily, "needEvidenceFamily");
      if (!INFORMATION_QUESTION_IDS_V2.includes(need.questionId)) {
        throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:needQuestionId");
      }
      if (!INFORMATION_REQUIREMENT_CLASSES_V2.includes(need.classification)) {
        throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:needClassification");
      }
      const timeframeRequirements = canonicalizeInformationNeedTimeframeRequirementsV1(
        need.timeframeRequirements,
      );
      assertExactKeys(
        need.inquiryBounds as unknown as Readonly<Record<string, unknown>>,
        ["maxDepth", "maxDurationMs", "maxProviderFanout"],
        "needInquiryBounds",
      );
      for (const [field, value] of Object.entries(need.inquiryBounds)) {
        requireNonNegativeInteger(value, `needInquiryBounds.${field}`);
      }
      if (
        typeof need.requirePitQualified !== "boolean" ||
        typeof need.requireReplayEligible !== "boolean" ||
        need.allowedObservationKinds.length === 0 ||
        new Set(need.allowedObservationKinds).size !== need.allowedObservationKinds.length ||
        need.allowedObservationKinds.some(
          (kind) => !CANONICAL_PRIMITIVE_OBSERVATION_KINDS_V1.includes(kind),
        )
      ) {
        throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:needHardFloor");
      }
      const allowedObservationKinds = [...need.allowedObservationKinds].sort(
        inquiryCanonicalTextCompare,
      );
      if (
        inquiryCanonicalJsonString(allowedObservationKinds) !==
        inquiryCanonicalJsonString(need.allowedObservationKinds)
      ) {
        throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:needObservationKindOrder");
      }
      const allowedObservationSchemaVersions = sortInquiryUniqueStrings(
        need.allowedObservationSchemaVersions,
        "needObservationSchemaVersion",
      );
      const providerCandidates = [...need.providerCandidates]
        .map((candidate) => {
          assertExactKeys(
            candidate as unknown as Readonly<Record<string, unknown>>,
            ["providerId", "substitutionRuleId", "costUnits"],
            "needProviderCandidate",
          );
          requireInquiryNonEmpty(candidate.providerId, "needProviderId");
          if (candidate.substitutionRuleId !== null) {
            requireInquiryNonEmpty(candidate.substitutionRuleId, "needSubstitutionRuleId");
          }
          requireNonNegativeInteger(candidate.costUnits, "needCostUnits");
          return {
            providerId: candidate.providerId,
            substitutionRuleId: candidate.substitutionRuleId,
            costUnits: candidate.costUnits,
          };
        })
        .sort((left, right) => inquiryCanonicalTextCompare(left.providerId, right.providerId));
      if (
        new Set(providerCandidates.map((candidate) => candidate.providerId)).size !==
        providerCandidates.length
      ) {
        throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:duplicateNeedProvider");
      }
      let contradiction: InformationContradictionLineageV1 | null = null;
      if (need.contradiction !== null) {
        assertExactKeys(
          need.contradiction as unknown as Readonly<Record<string, unknown>>,
          [
            "questionId",
            "claimId",
            "materiality",
            "evidenceIds",
            "observationIds",
            "observationContentDigests",
            "observationContradictionStates",
            "providerIds",
            "dependenceGroups",
            "materialityPolicyVersion",
            "materialityPolicyContentDigest",
            "materialityEvaluationContentDigest",
            "reasonCodes",
          ],
          "needContradiction",
        );
        if (
          need.contradiction.questionId !== need.questionId ||
          !(["MATERIAL", "IMMATERIAL", "UNKNOWN"] as const).includes(need.contradiction.materiality)
        ) {
          throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:needContradictionIdentity");
        }
        const observationIds = sortInquiryUniqueStrings(
          need.contradiction.observationIds,
          "needContradictionObservationId",
        );
        const evidenceIds = sortInquiryUniqueStrings(
          need.contradiction.evidenceIds,
          "needContradictionEvidenceId",
        );
        const observationContentDigests = [...need.contradiction.observationContentDigests]
          .map((reference) => ({
            observationId: requireInquiryNonEmpty(
              reference.observationId,
              "needContradictionObservationDigestId",
            ),
            observationContentDigest: requireInquiryDigest(
              reference.observationContentDigest,
              "needContradictionObservationContentDigest",
            ),
          }))
          .sort((left, right) =>
            inquiryCanonicalTextCompare(left.observationId, right.observationId),
          );
        const providerIds = sortInquiryUniqueStrings(
          need.contradiction.providerIds,
          "needContradictionProviderId",
        );
        const observationContradictionStates = [
          ...need.contradiction.observationContradictionStates,
        ]
          .map((state) => ({
            observationId: requireInquiryNonEmpty(
              state.observationId,
              "needContradictionObservationStateId",
            ),
            contradiction: state.contradiction,
          }))
          .sort((left, right) =>
            inquiryCanonicalTextCompare(left.observationId, right.observationId),
          );
        const dependenceGroups = sortInquiryUniqueStrings(
          need.contradiction.dependenceGroups,
          "needContradictionDependenceGroup",
        );
        const materialityPolicyVersion = requireInquiryNonEmpty(
          need.contradiction.materialityPolicyVersion,
          "needContradictionMaterialityPolicyVersion",
        );
        const materialityPolicyContentDigest = requireInquiryDigest(
          need.contradiction.materialityPolicyContentDigest,
          "needContradictionMaterialityPolicyContentDigest",
        );
        const materialityEvaluationContentDigest =
          computeInformationContradictionMaterialityEvaluationDigestV1({
            claimId: need.contradiction.claimId,
            materiality: need.contradiction.materiality,
            evidenceIds,
            observationIds,
            observationContentDigests,
            observationContradictionStates,
            providerIds,
            dependenceGroups,
            materialityPolicyVersion,
            materialityPolicyContentDigest,
          });
        if (
          need.contradiction.materialityEvaluationContentDigest !==
          materialityEvaluationContentDigest
        ) {
          throw new Error(
            "INFORMATION_INQUIRY_PLANNER_INVALID:needContradictionMaterialityIdentity",
          );
        }
        contradiction = {
          questionId: need.contradiction.questionId,
          claimId: requireInquiryNonEmpty(need.contradiction.claimId, "needContradictionClaimId"),
          materiality: need.contradiction.materiality,
          evidenceIds,
          observationIds,
          observationContentDigests,
          observationContradictionStates,
          providerIds,
          dependenceGroups,
          materialityPolicyVersion,
          materialityPolicyContentDigest,
          materialityEvaluationContentDigest,
          reasonCodes: sortInquiryUniqueStrings(
            need.contradiction.reasonCodes,
            "needContradictionReasonCode",
          ),
        };
      }
      const body = {
        requirementId: need.requirementId,
        questionId: need.questionId,
        classification: need.classification,
        evidenceFamily: need.evidenceFamily,
        allowedObservationKinds,
        allowedObservationSchemaVersions,
        timeframeRequirements,
        inquiryBounds: {
          maxDepth: need.inquiryBounds.maxDepth,
          maxDurationMs: need.inquiryBounds.maxDurationMs,
          maxProviderFanout: need.inquiryBounds.maxProviderFanout,
        },
        providerCandidates,
        requirePitQualified: need.requirePitQualified,
        requireReplayEligible: need.requireReplayEligible,
        contradiction,
        reasonCodes: sortInquiryUniqueStrings(need.reasonCodes, "needReasonCode"),
      };
      const expectedId = `need_${computeInquiryContentDigest(body)}`;
      if (
        need.id !== expectedId ||
        inquiryCanonicalJsonString({ ...body, id: expectedId }) !== inquiryCanonicalJsonString(need)
      ) {
        throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:needIdentity");
      }
      return need;
    })
    .sort((left, right) => {
      const leftSubstitution = left.providerCandidates[0]?.substitutionRuleId;
      const rightSubstitution = right.providerCandidates[0]?.substitutionRuleId;
      const leftPriority = leftSubstitution === null ? "0" : leftSubstitution ? "1" : "2";
      const rightPriority = rightSubstitution === null ? "0" : rightSubstitution ? "1" : "2";
      return inquiryCanonicalTextCompare(
        `${left.requirementId}\u0000${leftPriority}\u0000${left.evidenceFamily}\u0000${left.id}`,
        `${right.requirementId}\u0000${rightPriority}\u0000${right.evidenceFamily}\u0000${right.id}`,
      );
    });
  if (
    new Set(canonicalNeeds.map((need) => need.id)).size !== canonicalNeeds.length ||
    inquiryCanonicalJsonString(canonicalNeeds) !== inquiryCanonicalJsonString(bundle.plan.needs)
  ) {
    throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:planNeeds");
  }

  let priorEvidenceId: string | null = null;
  for (const evidence of bundle.plan.availableEvidence) {
    assertExactKeys(
      evidence as unknown as Readonly<Record<string, unknown>>,
      [
        "evidenceId",
        "evidenceFamily",
        "providerId",
        "observationId",
        "observationContentDigest",
        "availability",
        "availableAt",
      ],
      "planEvidenceRef",
    );
    requireInquiryNonEmpty(evidence.evidenceId, "planEvidenceId");
    requireInquiryNonEmpty(evidence.evidenceFamily, "planEvidenceFamily");
    requireInquiryNonEmpty(evidence.providerId, "planEvidenceProviderId");
    requireInquiryNonEmpty(evidence.observationId, "planObservationId");
    requireInquiryDigest(evidence.observationContentDigest, "planObservationContentDigest");
    requireInquiryTimestamp(evidence.availableAt, "planEvidenceAvailableAt");
    if (
      !(["AVAILABLE", "UNAVAILABLE", "REJECTED"] as const).includes(evidence.availability) ||
      (priorEvidenceId !== null &&
        inquiryCanonicalTextCompare(priorEvidenceId, evidence.evidenceId) >= 0)
    ) {
      throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:planEvidenceRefs");
    }
    priorEvidenceId = evidence.evidenceId;
  }

  const selection = defineInformationAcquisitionSelectionV1({
    planId: bundle.plan.id,
    planContentDigest: bundle.plan.contentDigest,
    organizationId: bundle.plan.organizationId,
    accountId: bundle.plan.accountId,
    symbol: bundle.plan.symbol,
    pitAnchor: bundle.plan.pitAnchor,
    purpose: bundle.plan.purpose,
    mode: "LIVE",
    requestedSources: bundle.plan.requestedSources,
  });
  if (
    inquiryCanonicalJsonString(selection.requestedSources) !==
    inquiryCanonicalJsonString(bundle.plan.requestedSources)
  ) {
    throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:planRequestedSources");
  }
  for (const source of bundle.plan.requestedSources) {
    const need = bundle.plan.needs.find((item) => item.id === source.needId);
    const candidate = need?.providerCandidates.find(
      (item) => item.providerId === source.providerId,
    );
    if (
      !need ||
      need.requirementId !== source.requirementId ||
      !candidate ||
      candidate.costUnits !== source.costUnits
    ) {
      throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:planRequestNeedLineage");
    }
  }
  const requestedCostUnits = bundle.plan.requestedSources.reduce(
    (sum, source) => sum + source.costUnits,
    0,
  );
  for (const need of bundle.plan.needs) {
    const requestedForNeed = bundle.plan.requestedSources.filter(
      (source) => source.needId === need.id,
    );
    if (
      requestedForNeed.length > need.inquiryBounds.maxProviderFanout ||
      requestedForNeed.length > bundle.plan.bounds.maxProviderFanout ||
      ((need.inquiryBounds.maxDepth === 0 || need.inquiryBounds.maxDurationMs === 0) &&
        requestedForNeed.length > 0)
    ) {
      throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:planNeedSelectionBounds");
    }
  }
  if (
    bundle.plan.queryCountConsumedBeforeIteration + bundle.plan.requestedSources.length >
      bundle.plan.bounds.maxQueryCount ||
    bundle.plan.acquisitionCostUnitsConsumedBeforeIteration + requestedCostUnits >
      bundle.plan.bounds.maxAcquisitionCostUnits ||
    ((bundle.plan.iterationIndex >= bundle.plan.bounds.maxIterations ||
      bundle.plan.bounds.maxDepth === 0) &&
      bundle.plan.requestedSources.length > 0)
  ) {
    throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:planSelectionBounds");
  }
  let priorIgnoredKey: string | null = null;
  for (const ignored of bundle.plan.ignoredSources) {
    assertExactKeys(
      ignored as unknown as Readonly<Record<string, unknown>>,
      ["requirementId", "providerId", "reasonCode"],
      "ignoredSource",
    );
    requireInquiryNonEmpty(ignored.requirementId, "ignoredRequirementId");
    requireInquiryNonEmpty(ignored.providerId, "ignoredProviderId");
    if (
      !(
        [
          "NOT_RELEVANT_TO_ACTIVE_QUESTION",
          "NOT_PROFILE_AUTHORIZED",
          "NOT_REQUIRED",
          "NOT_APPLICABLE",
          "QUERY_BUDGET_EXHAUSTED",
          "COST_BUDGET_EXHAUSTED",
        ] as const
      ).includes(ignored.reasonCode)
    ) {
      throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:ignoredReasonCode");
    }
    const key = `${ignored.requirementId}\u0000${ignored.providerId}`;
    if (priorIgnoredKey !== null && inquiryCanonicalTextCompare(priorIgnoredKey, key) >= 0) {
      throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:ignoredSourceOrder");
    }
    priorIgnoredKey = key;
  }
  const expectedStatus =
    unresolvedQuestionIds.length === 0
      ? "NO_ADDITIONAL_EVIDENCE_NEEDED"
      : bundle.plan.requestedSources.length > 0
        ? "READY"
        : "UNRESOLVED";
  if (bundle.plan.status !== expectedStatus) {
    throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:planStatus");
  }
  const expectedSelectionDigest = computeInquiryContentDigest({
    unresolvedQuestionIds: bundle.plan.unresolvedQuestionIds,
    availableEvidence: bundle.plan.availableEvidence,
    needs: bundle.plan.needs,
    requestedSources: bundle.plan.requestedSources,
  });
  if (bundle.plan.evidenceSelectionDigest !== expectedSelectionDigest) {
    throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:evidenceSelectionIdentity");
  }
  let priorContradictionRequirementId: string | null = null;
  for (const contradiction of bundle.contradictions) {
    assertExactKeys(
      contradiction as unknown as Readonly<Record<string, unknown>>,
      ["requirementId", "lineage"],
      "bundleContradiction",
    );
    requireInquiryNonEmpty(contradiction.requirementId, "bundleContradictionRequirementId");
    assertExactKeys(
      contradiction.lineage as unknown as Readonly<Record<string, unknown>>,
      [
        "questionId",
        "claimId",
        "materiality",
        "evidenceIds",
        "observationIds",
        "observationContentDigests",
        "observationContradictionStates",
        "providerIds",
        "dependenceGroups",
        "materialityPolicyVersion",
        "materialityPolicyContentDigest",
        "materialityEvaluationContentDigest",
        "reasonCodes",
      ],
      "bundleContradictionLineage",
    );
    const claimId = requireInquiryNonEmpty(
      contradiction.lineage.claimId,
      "bundleContradictionClaimId",
    );
    const materialityPolicyVersion = requireInquiryNonEmpty(
      contradiction.lineage.materialityPolicyVersion,
      "bundleContradictionMaterialityPolicyVersion",
    );
    const materialityPolicyContentDigest = requireInquiryDigest(
      contradiction.lineage.materialityPolicyContentDigest,
      "bundleContradictionMaterialityPolicyContentDigest",
    );
    const materialityEvaluationContentDigest =
      computeInformationContradictionMaterialityEvaluationDigestV1({
        claimId,
        materiality: contradiction.lineage.materiality,
        evidenceIds: contradiction.lineage.evidenceIds,
        observationIds: contradiction.lineage.observationIds,
        observationContentDigests: contradiction.lineage.observationContentDigests,
        observationContradictionStates: contradiction.lineage.observationContradictionStates,
        providerIds: contradiction.lineage.providerIds,
        dependenceGroups: contradiction.lineage.dependenceGroups,
        materialityPolicyVersion,
        materialityPolicyContentDigest,
      });
    if (
      !INFORMATION_QUESTION_IDS_V2.includes(contradiction.lineage.questionId) ||
      !(["MATERIAL", "IMMATERIAL", "UNKNOWN"] as const).includes(
        contradiction.lineage.materiality,
      ) ||
      (priorContradictionRequirementId !== null &&
        inquiryCanonicalTextCompare(priorContradictionRequirementId, contradiction.requirementId) >=
          0) ||
      inquiryCanonicalJsonString(
        sortInquiryUniqueStrings(
          contradiction.lineage.evidenceIds,
          "bundleContradictionEvidenceId",
        ),
      ) !== inquiryCanonicalJsonString(contradiction.lineage.evidenceIds) ||
      inquiryCanonicalJsonString(
        sortInquiryUniqueStrings(
          contradiction.lineage.observationIds,
          "bundleContradictionObservationId",
        ),
      ) !== inquiryCanonicalJsonString(contradiction.lineage.observationIds) ||
      inquiryCanonicalJsonString(
        [...contradiction.lineage.observationContentDigests].sort((left, right) =>
          inquiryCanonicalTextCompare(left.observationId, right.observationId),
        ),
      ) !== inquiryCanonicalJsonString(contradiction.lineage.observationContentDigests) ||
      inquiryCanonicalJsonString(
        [...contradiction.lineage.observationContradictionStates].sort((left, right) =>
          inquiryCanonicalTextCompare(left.observationId, right.observationId),
        ),
      ) !== inquiryCanonicalJsonString(contradiction.lineage.observationContradictionStates) ||
      inquiryCanonicalJsonString(
        sortInquiryUniqueStrings(
          contradiction.lineage.providerIds,
          "bundleContradictionProviderId",
        ),
      ) !== inquiryCanonicalJsonString(contradiction.lineage.providerIds) ||
      inquiryCanonicalJsonString(
        sortInquiryUniqueStrings(
          contradiction.lineage.dependenceGroups,
          "bundleContradictionDependenceGroup",
        ),
      ) !== inquiryCanonicalJsonString(contradiction.lineage.dependenceGroups) ||
      inquiryCanonicalJsonString(
        sortInquiryUniqueStrings(
          contradiction.lineage.reasonCodes,
          "bundleContradictionReasonCode",
        ),
      ) !== inquiryCanonicalJsonString(contradiction.lineage.reasonCodes) ||
      contradiction.lineage.materialityEvaluationContentDigest !==
        materialityEvaluationContentDigest
    ) {
      throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:bundleContradictionIdentity");
    }
    for (const need of bundle.plan.needs.filter(
      (item) => item.requirementId === contradiction.requirementId,
    )) {
      if (
        need.contradiction !== null &&
        inquiryCanonicalJsonString(need.contradiction) !==
          inquiryCanonicalJsonString(contradiction.lineage)
      ) {
        throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:bundleContradictionNeedMismatch");
      }
    }
    priorContradictionRequirementId = contradiction.requirementId;
  }
  for (const need of bundle.plan.needs.filter((item) => item.contradiction !== null)) {
    const contradiction = bundle.contradictions.find(
      (item) => item.requirementId === need.requirementId,
    );
    if (
      !contradiction ||
      inquiryCanonicalJsonString(contradiction.lineage) !==
        inquiryCanonicalJsonString(need.contradiction)
    ) {
      throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:needContradictionBundleMismatch");
    }
  }
  let priorAnalogueRequirementId: string | null = null;
  let analogueReservedQueries = 0;
  let analogueReservedCostUnits = 0;
  for (const analogue of bundle.analoguePlanning) {
    assertExactKeys(
      analogue as unknown as Readonly<Record<string, unknown>>,
      [
        "requirementId",
        "questionId",
        "query",
        "result",
        "disposition",
        "createsKnowledgeAuthority",
      ],
      "analoguePlanning",
    );
    requireInquiryNonEmpty(analogue.requirementId, "analoguePlanRequirementId");
    const query = assertHistoricalAnalogueQueryV1(analogue.query);
    if (
      analogue.questionId !== "Q_HISTORICAL_ANALOGUES" ||
      analogue.createsKnowledgeAuthority !== false ||
      query.pitAnchor !== bundle.plan.pitAnchor ||
      query.maxResults > bundle.plan.bounds.maxHistoricalResults ||
      (priorAnalogueRequirementId !== null &&
        inquiryCanonicalTextCompare(priorAnalogueRequirementId, analogue.requirementId) >= 0)
    ) {
      throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:analoguePlanScope");
    }
    let resultStatus: HistoricalAnalogueResultStatusV1 | null = null;
    if (analogue.result !== null) {
      const expectedResult = defineHistoricalAnalogueResultV1({
        query,
        status: analogue.result.status,
        occurrences: analogue.result.occurrences,
        knowledgeRefs: analogue.result.knowledgeRefs,
        reasonCodes: analogue.result.reasonCodes,
      });
      if (
        inquiryCanonicalJsonString(expectedResult) !== inquiryCanonicalJsonString(analogue.result)
      ) {
        throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:analoguePlanResultIdentity");
      }
      if (analogue.result.occurrences.length > query.maxResults) {
        throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:analoguePlanResultBound");
      }
      resultStatus = analogue.result.status;
    }
    if (analogue.disposition !== classifyHistoricalAnaloguePlanningDispositionV1(resultStatus)) {
      throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:analoguePlanDisposition");
    }
    analogueReservedQueries += query.maxQueries;
    analogueReservedCostUnits += query.maxCostUnits;
    priorAnalogueRequirementId = analogue.requirementId;
  }
  if (
    bundle.plan.queryCountConsumedBeforeIteration +
      bundle.plan.requestedSources.length +
      analogueReservedQueries >
      bundle.plan.bounds.maxQueryCount ||
    bundle.plan.acquisitionCostUnitsConsumedBeforeIteration +
      requestedCostUnits +
      analogueReservedCostUnits >
      bundle.plan.bounds.maxAcquisitionCostUnits
  ) {
    throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:analoguePlanCumulativeBounds");
  }
  for (const discriminator of bundle.hypothesisDiscriminators) {
    assertExactKeys(
      discriminator as unknown as Readonly<Record<string, unknown>>,
      [
        "requirementId",
        "questionId",
        "assessmentId",
        "assessmentContentDigest",
        "hypothesisRefs",
        "status",
        "missingEvidenceReasonCodes",
        "disposition",
        "createsOrRanksHypothesis",
      ],
      "hypothesisDiscriminator",
    );
    requireInquiryNonEmpty(discriminator.requirementId, "discriminatorPlanRequirementId");
    requireInquiryNonEmpty(discriminator.assessmentId, "discriminatorPlanAssessmentId");
    requireInquiryDigest(
      discriminator.assessmentContentDigest,
      "discriminatorPlanAssessmentDigest",
    );
    if (
      !INFORMATION_QUESTION_IDS_V2.includes(discriminator.questionId) ||
      discriminator.createsOrRanksHypothesis !== false ||
      (discriminator.status !== "MISSING_DISCRIMINATING_EVIDENCE" &&
        discriminator.status !== "NO_APPLICABLE_QUALIFIED_HYPOTHESIS") ||
      discriminator.disposition !==
        (discriminator.status === "NO_APPLICABLE_QUALIFIED_HYPOTHESIS"
          ? "ROUTE_RESEARCH_QUESTION_DEE_646"
          : "REQUEST_PROFILE_AUTHORIZED_EVIDENCE")
    ) {
      throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:discriminatorPlanVocabulary");
    }
    let priorHypothesisId: string | null = null;
    for (const reference of discriminator.hypothesisRefs) {
      assertExactKeys(
        reference as unknown as Readonly<Record<string, unknown>>,
        ["hypothesisId", "hypothesisContentDigest", "failureBoundaryContentDigest"],
        "hypothesisRef",
      );
      requireInquiryNonEmpty(reference.hypothesisId, "discriminatorPlanHypothesisId");
      requireInquiryDigest(reference.hypothesisContentDigest, "discriminatorPlanHypothesisDigest");
      requireInquiryDigest(
        reference.failureBoundaryContentDigest,
        "discriminatorPlanFailureBoundaryDigest",
      );
      if (
        priorHypothesisId !== null &&
        inquiryCanonicalTextCompare(priorHypothesisId, reference.hypothesisId) >= 0
      ) {
        throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:hypothesisRefOrder");
      }
      priorHypothesisId = reference.hypothesisId;
    }
    if (
      (discriminator.status === "MISSING_DISCRIMINATING_EVIDENCE" &&
        discriminator.hypothesisRefs.length === 0) ||
      (discriminator.status === "NO_APPLICABLE_QUALIFIED_HYPOTHESIS" &&
        discriminator.hypothesisRefs.length !== 0) ||
      inquiryCanonicalJsonString(
        sortInquiryUniqueStrings(
          discriminator.missingEvidenceReasonCodes,
          "discriminatorPlanReasonCode",
        ),
      ) !== inquiryCanonicalJsonString(discriminator.missingEvidenceReasonCodes)
    ) {
      throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:discriminatorPlanIdentity");
    }
  }
  const expectedResearchRoutes = [
    ...bundle.analoguePlanning
      .filter((item) => item.disposition === "ROUTE_RESEARCH_QUESTION_DEE_646")
      .map((item) => ({
        requirementId: item.requirementId,
        questionId: item.questionId,
        destination: "DEE-646" as const,
        reasonCode: "NO_QUALIFIED_RELATION_KNOWLEDGE" as const,
      })),
    ...bundle.hypothesisDiscriminators
      .filter((item) => item.disposition === "ROUTE_RESEARCH_QUESTION_DEE_646")
      .map((item) => ({
        requirementId: item.requirementId,
        questionId: item.questionId,
        destination: "DEE-646" as const,
        reasonCode: "NO_APPLICABLE_QUALIFIED_HYPOTHESIS" as const,
      })),
  ].sort((left, right) =>
    inquiryCanonicalTextCompare(
      `${left.requirementId}\u0000${left.reasonCode}`,
      `${right.requirementId}\u0000${right.reasonCode}`,
    ),
  );
  if (
    inquiryCanonicalJsonString(expectedResearchRoutes) !==
    inquiryCanonicalJsonString(bundle.researchQuestionRoutes)
  ) {
    throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:researchRouteIdentity");
  }
  const { id: planId, contentDigest: planContentDigest, ...planPayload } = bundle.plan;
  const expectedPlanDigest = computeInquiryContentDigest(planPayload);
  const payload = {
    schemaVersion: bundle.schemaVersion,
    plan: bundle.plan,
    contradictions: bundle.contradictions,
    analoguePlanning: bundle.analoguePlanning,
    hypothesisDiscriminators: bundle.hypothesisDiscriminators,
    researchQuestionRoutes: bundle.researchQuestionRoutes,
    authority: bundle.authority,
    createsKnowledgeHypothesisForecastDecisionOrCapitalAuthority:
      bundle.createsKnowledgeHypothesisForecastDecisionOrCapitalAuthority,
  };
  if (
    bundle.schemaVersion !== INFORMATION_INQUIRY_PLANNING_BUNDLE_V1_SCHEMA_VERSION ||
    bundle.authority !== "EVIDENCE_ACQUISITION_PLANNING_ONLY" ||
    bundle.createsKnowledgeHypothesisForecastDecisionOrCapitalAuthority !== false ||
    computeInquiryContentDigest(payload) !== bundle.contentDigest ||
    bundle.plan.schemaVersion !== INFORMATION_NEED_PLAN_V1_SCHEMA_VERSION ||
    bundle.plan.authority !== "EVIDENCE_ACQUISITION_ONLY" ||
    planContentDigest !== expectedPlanDigest ||
    planId !== `inp_${expectedPlanDigest}`
  ) {
    throw new Error("INFORMATION_INQUIRY_PLANNER_INVALID:bundleIdentity");
  }
  return bundle;
}

export function evidenceByIdV1(
  receipt: InformationSufficiencyReceiptV2,
  evidenceId: string,
): InformationEvidenceV2 | undefined {
  return receipt.evidenceInventory.find((item) => item.evidenceId === evidenceId);
}
