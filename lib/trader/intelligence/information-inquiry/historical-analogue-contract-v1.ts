import {
  inquiryCanonicalTextCompare,
  requireInquiryDigest,
  requireInquiryNonEmpty,
  requireInquiryTimestamp,
  sortInquiryUniqueStrings,
  type InformationInquiryTimeframeV1,
} from "@/lib/trader/intelligence/information-inquiry/contracts-v1";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

export const HISTORICAL_ANALOGUE_QUERY_V1_SCHEMA_VERSION =
  "historical_analogue_query/v1" as const;
export const HISTORICAL_ANALOGUE_RESULT_V1_SCHEMA_VERSION =
  "historical_analogue_result/v1" as const;

export const HISTORICAL_PATTERN_FORMS_V1 = [
  "STATIC",
  "TRAJECTORY",
  "MULTISCALE_TRANSITION",
] as const;
export type HistoricalPatternFormV1 = (typeof HISTORICAL_PATTERN_FORMS_V1)[number];

export const HISTORICAL_ANALOGUE_SAMPLING_MEMBERSHIPS_V1 = [
  "POSITIVE",
  "NEGATIVE",
  "FLAT",
  "CONTRADICTORY",
  "UNRESOLVED",
  "FAILURE_CASE",
] as const;
export type HistoricalAnalogueSamplingMembershipV1 =
  (typeof HISTORICAL_ANALOGUE_SAMPLING_MEMBERSHIPS_V1)[number];

export const HISTORICAL_ANALOGUE_RESULT_STATUSES_V1 = [
  "MATCHED_QUALIFIED_KNOWLEDGE",
  "NO_MATCHING_OCCURRENCE",
  "NO_QUALIFIED_RELATION_KNOWLEDGE",
  "QUALIFIED_KNOWLEDGE_STALE_CONTESTED_OR_OUT_OF_SCOPE",
  "HISTORY_UNAVAILABLE_OR_UNQUALIFIED",
] as const;
export type HistoricalAnalogueResultStatusV1 =
  (typeof HISTORICAL_ANALOGUE_RESULT_STATUSES_V1)[number];

export type HistoricalAnalogueQueryV1 = Readonly<{
  schemaVersion: typeof HISTORICAL_ANALOGUE_QUERY_V1_SCHEMA_VERSION;
  id: string;
  pitAnchor: string;
  stateRepresentationSpecVersion: string;
  stateRepresentationSpecContentDigest: string;
  dynamicStateContentDigest: string;
  requestedPatternForms: readonly HistoricalPatternFormV1[];
  similarityPolicyVersion: string;
  similarityPolicyContentDigest: string;
  timeframeFilters: readonly InformationInquiryTimeframeV1[];
  regimeFilters: readonly string[];
  contextFilterContentDigests: readonly string[];
  retrievalPolicyVersion: string;
  retrievalPolicyContentDigest: string;
  samplingPolicyVersion: string;
  samplingPolicyContentDigest: string;
  maxQueries: number;
  maxResults: number;
  maxCostUnits: number;
  blindHoldoutAccessible: false;
  usesFutureOutcomeForSelection: false;
  authority: "HISTORICAL_EVIDENCE_QUERY_ONLY";
  contentDigest: string;
}>;

export type HistoricalPatternOccurrenceMatchV1 = Readonly<{
  patternDefinitionId: string;
  patternDefinitionContentDigest: string;
  patternOccurrenceId: string;
  patternOccurrenceContentDigest: string;
  patternForm: HistoricalPatternFormV1;
  occurredAt: string;
  availableAt: string;
  timeframe: InformationInquiryTimeframeV1;
  regime: string;
  contextContentDigests: readonly string[];
  matchComponents: readonly Readonly<{
    componentId: string;
    valueContentDigest: string;
    distanceContentDigest: string;
  }>[];
  totalDistanceContentDigest: string;
  samplingMemberships: readonly HistoricalAnalogueSamplingMembershipV1[];
}>;

export type HistoricalKnowledgeRefV1 = Readonly<{
  knowledgeId: string;
  knowledgeContentDigest: string;
  status: "QUALIFIED" | "STALE" | "CONTESTED" | "OUT_OF_SCOPE";
  failureBoundaryContentDigest: string | null;
}>;

export type HistoricalAnalogueResultV1 = Readonly<{
  schemaVersion: typeof HISTORICAL_ANALOGUE_RESULT_V1_SCHEMA_VERSION;
  id: string;
  queryId: string;
  queryContentDigest: string;
  pitAnchor: string;
  status: HistoricalAnalogueResultStatusV1;
  occurrences: readonly HistoricalPatternOccurrenceMatchV1[];
  knowledgeRefs: readonly HistoricalKnowledgeRefV1[];
  reasonCodes: readonly string[];
  authority: "HISTORICAL_EVIDENCE_ONLY";
  createsForecastOrCapitalAuthority: false;
  contentDigest: string;
}>;

function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`INFORMATION_INQUIRY_INVALID:${field}`);
  }
  return value;
}

function canonicalPatternForms(forms: readonly HistoricalPatternFormV1[]): HistoricalPatternFormV1[] {
  const ordered = HISTORICAL_PATTERN_FORMS_V1.filter((form) => forms.includes(form));
  if (ordered.length === 0 || ordered.length !== forms.length) {
    throw new Error("INFORMATION_INQUIRY_INVALID:patternForms");
  }
  return ordered;
}

export function defineHistoricalAnalogueQueryV1(input: Omit<
  HistoricalAnalogueQueryV1,
  "schemaVersion" | "id" | "authority" | "contentDigest"
>): HistoricalAnalogueQueryV1 {
  requireInquiryTimestamp(input.pitAnchor, "analogueQuery.pitAnchor");
  requireInquiryNonEmpty(input.stateRepresentationSpecVersion, "stateRepresentationSpecVersion");
  requireInquiryDigest(
    input.stateRepresentationSpecContentDigest,
    "stateRepresentationSpecContentDigest",
  );
  requireInquiryDigest(input.dynamicStateContentDigest, "dynamicStateContentDigest");
  requireInquiryNonEmpty(input.similarityPolicyVersion, "similarityPolicyVersion");
  requireInquiryDigest(input.similarityPolicyContentDigest, "similarityPolicyContentDigest");
  requireInquiryNonEmpty(input.retrievalPolicyVersion, "retrievalPolicyVersion");
  requireInquiryDigest(input.retrievalPolicyContentDigest, "retrievalPolicyContentDigest");
  requireInquiryNonEmpty(input.samplingPolicyVersion, "samplingPolicyVersion");
  requireInquiryDigest(input.samplingPolicyContentDigest, "samplingPolicyContentDigest");
  if (input.blindHoldoutAccessible !== false || input.usesFutureOutcomeForSelection !== false) {
    throw new Error("INFORMATION_INQUIRY_INVALID:analogueForbiddenAuthority");
  }
  const timeframeFilters = INFORMATION_INQUIRY_TIMEFRAME_ORDER.filter((timeframe) =>
    input.timeframeFilters.includes(timeframe),
  );
  if (timeframeFilters.length === 0 || timeframeFilters.length !== input.timeframeFilters.length) {
    throw new Error("INFORMATION_INQUIRY_INVALID:analogueTimeframeFilters");
  }
  const payload = {
    schemaVersion: HISTORICAL_ANALOGUE_QUERY_V1_SCHEMA_VERSION,
    pitAnchor: input.pitAnchor,
    stateRepresentationSpecVersion: input.stateRepresentationSpecVersion,
    stateRepresentationSpecContentDigest: input.stateRepresentationSpecContentDigest,
    dynamicStateContentDigest: input.dynamicStateContentDigest,
    requestedPatternForms: canonicalPatternForms(input.requestedPatternForms),
    similarityPolicyVersion: input.similarityPolicyVersion,
    similarityPolicyContentDigest: input.similarityPolicyContentDigest,
    timeframeFilters,
    regimeFilters: sortInquiryUniqueStrings(input.regimeFilters, "analogueRegimeFilter"),
    contextFilterContentDigests: sortInquiryUniqueStrings(
      input.contextFilterContentDigests,
      "analogueContextFilterDigest",
    ).map((digest) => requireInquiryDigest(digest, "analogueContextFilterDigest")),
    retrievalPolicyVersion: input.retrievalPolicyVersion,
    retrievalPolicyContentDigest: input.retrievalPolicyContentDigest,
    samplingPolicyVersion: input.samplingPolicyVersion,
    samplingPolicyContentDigest: input.samplingPolicyContentDigest,
    maxQueries: requirePositiveInteger(input.maxQueries, "analogueMaxQueries"),
    maxResults: requirePositiveInteger(input.maxResults, "analogueMaxResults"),
    maxCostUnits: requirePositiveInteger(input.maxCostUnits, "analogueMaxCostUnits"),
    blindHoldoutAccessible: false as const,
    usesFutureOutcomeForSelection: false as const,
    authority: "HISTORICAL_EVIDENCE_QUERY_ONLY" as const,
  };
  const contentDigest = computeStableJsonDigest(payload);
  return Object.freeze({ ...payload, id: `hiq_${contentDigest}`, contentDigest });
}

const INFORMATION_INQUIRY_TIMEFRAME_ORDER: readonly InformationInquiryTimeframeV1[] = [
  "1d",
  "4h",
  "1h",
  "15m",
  "1m",
];

function canonicalOccurrence(
  occurrence: HistoricalPatternOccurrenceMatchV1,
): HistoricalPatternOccurrenceMatchV1 {
  requireInquiryNonEmpty(occurrence.patternDefinitionId, "patternDefinitionId");
  requireInquiryDigest(occurrence.patternDefinitionContentDigest, "patternDefinitionContentDigest");
  requireInquiryNonEmpty(occurrence.patternOccurrenceId, "patternOccurrenceId");
  requireInquiryDigest(occurrence.patternOccurrenceContentDigest, "patternOccurrenceContentDigest");
  if (!HISTORICAL_PATTERN_FORMS_V1.includes(occurrence.patternForm)) {
    throw new Error("INFORMATION_INQUIRY_INVALID:occurrencePatternForm");
  }
  requireInquiryTimestamp(occurrence.occurredAt, "occurrence.occurredAt");
  requireInquiryTimestamp(occurrence.availableAt, "occurrence.availableAt");
  if (!INFORMATION_INQUIRY_TIMEFRAME_ORDER.includes(occurrence.timeframe)) {
    throw new Error("INFORMATION_INQUIRY_INVALID:occurrenceTimeframe");
  }
  requireInquiryNonEmpty(occurrence.regime, "occurrenceRegime");
  const matchComponents = [...occurrence.matchComponents]
    .map((component) => ({
      componentId: requireInquiryNonEmpty(component.componentId, "matchComponentId"),
      valueContentDigest: requireInquiryDigest(component.valueContentDigest, "matchValueDigest"),
      distanceContentDigest: requireInquiryDigest(
        component.distanceContentDigest,
        "matchDistanceDigest",
      ),
    }))
    .sort((left, right) => inquiryCanonicalTextCompare(left.componentId, right.componentId));
  if (
    matchComponents.length === 0 ||
    new Set(matchComponents.map((component) => component.componentId)).size !==
      matchComponents.length
  ) {
    throw new Error("INFORMATION_INQUIRY_INVALID:matchComponents");
  }
  const samplingMemberships = HISTORICAL_ANALOGUE_SAMPLING_MEMBERSHIPS_V1.filter((membership) =>
    occurrence.samplingMemberships.includes(membership),
  );
  if (
    samplingMemberships.length === 0 ||
    samplingMemberships.length !== occurrence.samplingMemberships.length
  ) {
    throw new Error("INFORMATION_INQUIRY_INVALID:samplingMemberships");
  }
  return {
    ...occurrence,
    contextContentDigests: sortInquiryUniqueStrings(
      occurrence.contextContentDigests,
      "occurrenceContextDigest",
    ).map((digest) => requireInquiryDigest(digest, "occurrenceContextDigest")),
    matchComponents,
    totalDistanceContentDigest: requireInquiryDigest(
      occurrence.totalDistanceContentDigest,
      "totalDistanceContentDigest",
    ),
    samplingMemberships,
  };
}

export function defineHistoricalAnalogueResultV1(input: Omit<
  HistoricalAnalogueResultV1,
  "schemaVersion" | "id" | "authority" | "createsForecastOrCapitalAuthority" | "contentDigest"
>): HistoricalAnalogueResultV1 {
  requireInquiryNonEmpty(input.queryId, "analogueResult.queryId");
  requireInquiryDigest(input.queryContentDigest, "analogueResult.queryContentDigest");
  requireInquiryTimestamp(input.pitAnchor, "analogueResult.pitAnchor");
  if (!HISTORICAL_ANALOGUE_RESULT_STATUSES_V1.includes(input.status)) {
    throw new Error("INFORMATION_INQUIRY_INVALID:analogueResultStatus");
  }
  const occurrences = [...input.occurrences]
    .map(canonicalOccurrence)
    .sort((left, right) =>
      inquiryCanonicalTextCompare(left.patternOccurrenceId, right.patternOccurrenceId),
    );
  if (
    new Set(occurrences.map((occurrence) => occurrence.patternOccurrenceId)).size !==
    occurrences.length
  ) {
    throw new Error("INFORMATION_INQUIRY_INVALID:duplicatePatternOccurrence");
  }
  const knowledgeRefs = [...input.knowledgeRefs]
    .map((knowledge) => ({
      ...knowledge,
      knowledgeId: requireInquiryNonEmpty(knowledge.knowledgeId, "knowledgeId"),
      knowledgeContentDigest: requireInquiryDigest(
        knowledge.knowledgeContentDigest,
        "knowledgeContentDigest",
      ),
      failureBoundaryContentDigest:
        knowledge.failureBoundaryContentDigest === null
          ? null
          : requireInquiryDigest(
              knowledge.failureBoundaryContentDigest,
              "failureBoundaryContentDigest",
            ),
    }))
    .sort((left, right) => inquiryCanonicalTextCompare(left.knowledgeId, right.knowledgeId));
  if (new Set(knowledgeRefs.map((knowledge) => knowledge.knowledgeId)).size !== knowledgeRefs.length) {
    throw new Error("INFORMATION_INQUIRY_INVALID:duplicateKnowledgeRef");
  }
  if (input.status === "NO_MATCHING_OCCURRENCE" && occurrences.length !== 0) {
    throw new Error("INFORMATION_INQUIRY_INVALID:noMatchHasOccurrences");
  }
  if (
    input.status === "MATCHED_QUALIFIED_KNOWLEDGE" &&
    (occurrences.length === 0 || !knowledgeRefs.some((knowledge) => knowledge.status === "QUALIFIED"))
  ) {
    throw new Error("INFORMATION_INQUIRY_INVALID:qualifiedKnowledgeMissing");
  }
  if (
    input.status === "NO_QUALIFIED_RELATION_KNOWLEDGE" &&
    (occurrences.length === 0 || knowledgeRefs.some((knowledge) => knowledge.status === "QUALIFIED"))
  ) {
    throw new Error("INFORMATION_INQUIRY_INVALID:noQualifiedKnowledgeInvalid");
  }
  if (
    input.status === "QUALIFIED_KNOWLEDGE_STALE_CONTESTED_OR_OUT_OF_SCOPE" &&
    (occurrences.length === 0 ||
      knowledgeRefs.length === 0 ||
      knowledgeRefs.every((knowledge) => knowledge.status === "QUALIFIED"))
  ) {
    throw new Error("INFORMATION_INQUIRY_INVALID:qualifiedKnowledgeScopeStatus");
  }
  if (
    input.status === "HISTORY_UNAVAILABLE_OR_UNQUALIFIED" &&
    (occurrences.length !== 0 || knowledgeRefs.length !== 0)
  ) {
    throw new Error("INFORMATION_INQUIRY_INVALID:unavailableHistoryHasResults");
  }
  const payload = {
    schemaVersion: HISTORICAL_ANALOGUE_RESULT_V1_SCHEMA_VERSION,
    queryId: input.queryId,
    queryContentDigest: input.queryContentDigest,
    pitAnchor: input.pitAnchor,
    status: input.status,
    occurrences,
    knowledgeRefs,
    reasonCodes: sortInquiryUniqueStrings(input.reasonCodes, "analogueResultReasonCode"),
    authority: "HISTORICAL_EVIDENCE_ONLY" as const,
    createsForecastOrCapitalAuthority: false as const,
  };
  const contentDigest = computeStableJsonDigest(payload);
  return Object.freeze({ ...payload, id: `hir_${contentDigest}`, contentDigest });
}
