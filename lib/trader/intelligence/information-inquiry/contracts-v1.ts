import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import type {
  InformationAnalysisPurposeV2,
  InformationEvidenceAvailabilityV2,
  InformationQuestionIdV2,
  InformationRequirementClassV2,
} from "@/lib/trader/intelligence/information-sufficiency";
import {
  CANONICAL_PRIMITIVE_OBSERVATION_KINDS_V1,
  type CanonicalPrimitiveObservationKindV1,
} from "@/lib/trader/mi/canonical-observation-v1";

export const INFORMATION_INQUIRY_POLICY_V1_SCHEMA_VERSION =
  "information_inquiry_policy/v1" as const;
export const INFORMATION_NEED_PLAN_V1_SCHEMA_VERSION = "information_need_plan/v1" as const;
export const INFORMATION_ACQUISITION_SELECTION_V1_SCHEMA_VERSION =
  "information_acquisition_selection/v1" as const;

export const INFORMATION_INQUIRY_PURPOSES_V1 = [
  "OPEN_POSITION_REASSESSMENT",
  "NEW_OPPORTUNITY_SEARCH",
  "RESEARCH",
] as const;
export type InformationInquiryPurposeV1 = (typeof INFORMATION_INQUIRY_PURPOSES_V1)[number];

export const INFORMATION_INQUIRY_TIMEFRAMES_V1 = ["1d", "4h", "1h", "15m", "1m"] as const;
export type InformationInquiryTimeframeV1 = (typeof INFORMATION_INQUIRY_TIMEFRAMES_V1)[number];

export const INFORMATION_INQUIRY_TIMEFRAME_ROLES_V1 = [
  "STRATEGIC_CONTEXT",
  "STRUCTURAL_REFINEMENT",
  "OPERATIONAL_STATE",
  "SETUP_CONFIRMATION",
  "EXECUTION_PRECISION",
] as const;
export type InformationInquiryTimeframeRoleV1 =
  (typeof INFORMATION_INQUIRY_TIMEFRAME_ROLES_V1)[number];

export const INFORMATION_NEED_TERMINAL_STATUSES_V1 = [
  "ANSWERED_SUFFICIENTLY",
  "UNRESOLVED",
  "INFORMATION_INSUFFICIENT",
  "UNAVAILABLE",
  "NOT_REQUIRED",
  "NOT_APPLICABLE",
] as const;
export type InformationNeedTerminalStatusV1 =
  (typeof INFORMATION_NEED_TERMINAL_STATUSES_V1)[number];

export type InformationInquiryBoundsV1 = Readonly<{
  maxIterations: number;
  maxDepth: number;
  maxDurationMs: number;
  maxProviderFanout: number;
  maxQueryCount: number;
  maxHistoricalResults: number;
  maxAcquisitionCostUnits: number;
}>;

export type InformationInquiryCostAssignmentV1 = Readonly<{
  requirementId: string;
  providerId: string;
  costUnits: number;
}>;

export type InformationInquiryTimeframePolicyV1 = Readonly<{
  timeframe: InformationInquiryTimeframeV1;
  relevantRequirementIds: readonly string[];
  maxStalenessMsByRequirement: readonly Readonly<{
    requirementId: string;
    maxStalenessMs: number | null;
  }>[];
}>;

export type InformationInquiryPolicyV1 = Readonly<{
  schemaVersion: typeof INFORMATION_INQUIRY_POLICY_V1_SCHEMA_VERSION;
  policyVersion: string;
  purpose: InformationInquiryPurposeV1;
  profilePurpose: InformationAnalysisPurposeV2;
  timeframePolicies: readonly InformationInquiryTimeframePolicyV1[];
  bounds: InformationInquiryBoundsV1;
  costPolicy: Readonly<{
    evaluatorVersion: string;
    evaluatorContentDigest: string;
    assignments: readonly InformationInquiryCostAssignmentV1[];
  }>;
  contradictionMaterialityPolicyVersion: string;
  contradictionMaterialityPolicyDigest: string;
  schedulingPolicyVersion: string;
  schedulingPolicyDigest: string;
  maxNewOpportunityWaitTurns: number;
  authority: "EVIDENCE_ACQUISITION_POLICY_ONLY";
  contentDigest: string;
}>;

export type InformationContradictionLineageV1 = Readonly<{
  questionId: InformationQuestionIdV2;
  claimId: string;
  materiality: "MATERIAL" | "IMMATERIAL" | "UNKNOWN";
  observationIds: readonly string[];
  providerIds: readonly string[];
  dependenceGroups: readonly string[];
  reasonCodes: readonly string[];
}>;

export type InformationNeedTimeframeRequirementV1 = Readonly<{
  timeframe: InformationInquiryTimeframeV1;
  maxStalenessMs: number | null;
}>;

export type InformationNeedV1 = Readonly<{
  id: string;
  requirementId: string;
  questionId: InformationQuestionIdV2;
  classification: InformationRequirementClassV2;
  evidenceFamily: string;
  allowedObservationKinds: readonly CanonicalPrimitiveObservationKindV1[];
  allowedObservationSchemaVersions: readonly string[];
  timeframeRequirements: readonly InformationNeedTimeframeRequirementV1[];
  providerCandidates: readonly Readonly<{
    providerId: string;
    substitutionRuleId: string | null;
    costUnits: number;
  }>[];
  requirePitQualified: boolean;
  requireReplayEligible: boolean;
  contradiction: InformationContradictionLineageV1 | null;
  reasonCodes: readonly string[];
}>;

export type InformationPlanEvidenceRefV1 = Readonly<{
  evidenceId: string;
  evidenceFamily: string;
  providerId: string;
  observationId: string;
  observationContentDigest: string;
  availability: InformationEvidenceAvailabilityV2;
  availableAt: string;
}>;

export type InformationRequestedSourceV1 = Readonly<{
  needId: string;
  requirementId: string;
  providerId: string;
  allowedObservationKinds: readonly CanonicalPrimitiveObservationKindV1[];
  costUnits: number;
  reasonCodes: readonly string[];
}>;

export type InformationIgnoredSourceV1 = Readonly<{
  requirementId: string;
  providerId: string;
  reasonCode:
    | "NOT_RELEVANT_TO_ACTIVE_QUESTION"
    | "NOT_PROFILE_AUTHORIZED"
    | "NOT_REQUIRED"
    | "NOT_APPLICABLE"
    | "QUERY_BUDGET_EXHAUSTED"
    | "COST_BUDGET_EXHAUSTED";
}>;

export type InformationNeedPlanV1 = Readonly<{
  schemaVersion: typeof INFORMATION_NEED_PLAN_V1_SCHEMA_VERSION;
  derivationVersion: string;
  id: string;
  organizationId: string;
  accountId: string | null;
  symbol: string;
  venue: string;
  pitAnchor: string;
  purpose: InformationInquiryPurposeV1;
  profilePurpose: InformationAnalysisPurposeV2;
  profileId: string;
  profileContentDigest: string;
  policyVersion: string;
  policyContentDigest: string;
  topDownReconstructionContentDigest: string;
  unresolvedQuestionIds: readonly InformationQuestionIdV2[];
  availableEvidence: readonly InformationPlanEvidenceRefV1[];
  needs: readonly InformationNeedV1[];
  requestedSources: readonly InformationRequestedSourceV1[];
  ignoredSources: readonly InformationIgnoredSourceV1[];
  bounds: InformationInquiryBoundsV1;
  iterationIndex: number;
  status: "READY" | "NO_ADDITIONAL_EVIDENCE_NEEDED" | "UNRESOLVED";
  evidenceSelectionDigest: string;
  authority: "EVIDENCE_ACQUISITION_ONLY";
  contentDigest: string;
}>;

export type InformationAcquisitionSelectionV1 = Readonly<{
  schemaVersion: typeof INFORMATION_ACQUISITION_SELECTION_V1_SCHEMA_VERSION;
  planId: string;
  planContentDigest: string;
  organizationId: string;
  accountId: string | null;
  symbol: string;
  pitAnchor: string;
  purpose: InformationInquiryPurposeV1;
  mode: "LIVE" | "HISTORICAL";
  requestedSources: readonly InformationRequestedSourceV1[];
  authority: "EVIDENCE_ACQUISITION_ONLY";
  contentDigest: string;
}>;

const HEX_64 = /^[0-9a-f]{64}$/;

export function inquiryCanonicalTextCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function inquiryCanonicalJsonString(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("INFORMATION_INQUIRY_INVALID:canonicalNumber");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(inquiryCanonicalJsonString).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Readonly<Record<string, unknown>>).sort(
      ([left], [right]) => inquiryCanonicalTextCompare(left, right),
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${inquiryCanonicalJsonString(entry)}`)
      .join(",")}}`;
  }
  throw new Error("INFORMATION_INQUIRY_INVALID:canonicalValue");
}

export function computeInquiryContentDigest(value: unknown): string {
  return createHash("sha256").update(inquiryCanonicalJsonString(value), "utf8").digest("hex");
}

export function deepFreezeInquiry<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Readonly<Record<string, unknown>>)) {
      deepFreezeInquiry(nested);
    }
    Object.freeze(value);
  }
  return value;
}

function assertExactInquiryIdentity(actual: unknown, expected: unknown, field: string): void {
  if (inquiryCanonicalJsonString(actual) !== inquiryCanonicalJsonString(expected)) {
    throw new Error(`INFORMATION_INQUIRY_INVALID:${field}`);
  }
}

export function requireInquiryNonEmpty(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`INFORMATION_INQUIRY_INVALID:${field}`);
  }
  return value;
}

export function requireInquiryDigest(value: string, field: string): string {
  if (!HEX_64.test(value)) throw new Error(`INFORMATION_INQUIRY_INVALID:${field}`);
  return value;
}

export function requireInquiryTimestamp(value: string, field: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`INFORMATION_INQUIRY_INVALID:${field}`);
  return value;
}

export function sortInquiryUniqueStrings(values: readonly string[], field: string): string[] {
  const sorted = values
    .map((value) => requireInquiryNonEmpty(value, field))
    .sort(inquiryCanonicalTextCompare);
  if (new Set(sorted).size !== sorted.length) {
    throw new Error(`INFORMATION_INQUIRY_INVALID:duplicate_${field}`);
  }
  return sorted;
}

function requireNonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`INFORMATION_INQUIRY_INVALID:${field}`);
  }
  return value;
}

export function canonicalizeInformationNeedTimeframeRequirementsV1(
  values: readonly InformationNeedTimeframeRequirementV1[],
): readonly InformationNeedTimeframeRequirementV1[] {
  if (values.length === 0) {
    throw new Error("INFORMATION_INQUIRY_INVALID:needTimeframeRequirements");
  }
  const canonical = values
    .map((entry) => {
      if (!INFORMATION_INQUIRY_TIMEFRAMES_V1.includes(entry.timeframe)) {
        throw new Error("INFORMATION_INQUIRY_INVALID:needTimeframe");
      }
      if (entry.maxStalenessMs !== null) {
        requireNonNegativeInteger(entry.maxStalenessMs, "needMaxStalenessMs");
      }
      return {
        timeframe: entry.timeframe,
        maxStalenessMs: entry.maxStalenessMs,
      };
    })
    .sort(
      (left, right) =>
        INFORMATION_INQUIRY_TIMEFRAMES_V1.indexOf(left.timeframe) -
        INFORMATION_INQUIRY_TIMEFRAMES_V1.indexOf(right.timeframe),
    );
  if (new Set(canonical.map((entry) => entry.timeframe)).size !== canonical.length) {
    throw new Error("INFORMATION_INQUIRY_INVALID:duplicateNeedTimeframe");
  }
  return deepFreezeInquiry(canonical);
}

export function mapInformationInquiryPurposeV1(
  purpose: InformationInquiryPurposeV1,
): InformationAnalysisPurposeV2 {
  switch (purpose) {
    case "OPEN_POSITION_REASSESSMENT":
      return "OPEN_POSITION_REASSESSMENT";
    case "NEW_OPPORTUNITY_SEARCH":
      return "NEW_OPPORTUNITY";
    case "RESEARCH":
      return "RESEARCH_NON_CAPITAL";
    default:
      throw new Error("INFORMATION_INQUIRY_INVALID:purpose");
  }
}

export function defineInformationInquiryPolicyV1(
  input: Omit<
    InformationInquiryPolicyV1,
    "schemaVersion" | "profilePurpose" | "authority" | "contentDigest"
  >,
): InformationInquiryPolicyV1 {
  requireInquiryNonEmpty(input.policyVersion, "policyVersion");
  const profilePurpose = mapInformationInquiryPurposeV1(input.purpose);
  requireNonNegativeInteger(input.bounds.maxIterations, "bounds.maxIterations");
  requireNonNegativeInteger(input.bounds.maxDepth, "bounds.maxDepth");
  requireNonNegativeInteger(input.bounds.maxDurationMs, "bounds.maxDurationMs");
  requireNonNegativeInteger(input.bounds.maxProviderFanout, "bounds.maxProviderFanout");
  requireNonNegativeInteger(input.bounds.maxQueryCount, "bounds.maxQueryCount");
  requireNonNegativeInteger(input.bounds.maxHistoricalResults, "bounds.maxHistoricalResults");
  requireNonNegativeInteger(input.bounds.maxAcquisitionCostUnits, "bounds.maxAcquisitionCostUnits");
  if (input.bounds.maxIterations === 0 || input.bounds.maxDurationMs === 0) {
    throw new Error("INFORMATION_INQUIRY_INVALID:nonOperationalBounds");
  }
  requireNonNegativeInteger(input.maxNewOpportunityWaitTurns, "maxNewOpportunityWaitTurns");
  if (input.maxNewOpportunityWaitTurns === 0) {
    throw new Error("INFORMATION_INQUIRY_INVALID:maxNewOpportunityWaitTurns");
  }

  const timeframePolicies = INFORMATION_INQUIRY_TIMEFRAMES_V1.map((timeframe) => {
    const matches = input.timeframePolicies.filter((entry) => entry.timeframe === timeframe);
    if (matches.length !== 1) {
      throw new Error(`INFORMATION_INQUIRY_INVALID:timeframePolicy.${timeframe}`);
    }
    const entry = matches[0]!;
    const relevantRequirementIds = sortInquiryUniqueStrings(
      entry.relevantRequirementIds,
      `relevantRequirementId.${timeframe}`,
    );
    const maxStalenessMsByRequirement = [...entry.maxStalenessMsByRequirement]
      .map((item) => {
        const requirementId = requireInquiryNonEmpty(item.requirementId, "stalenessRequirementId");
        if (item.maxStalenessMs !== null) {
          requireNonNegativeInteger(item.maxStalenessMs, "maxStalenessMs");
        }
        return { requirementId, maxStalenessMs: item.maxStalenessMs };
      })
      .sort((left, right) => inquiryCanonicalTextCompare(left.requirementId, right.requirementId));
    if (
      new Set(maxStalenessMsByRequirement.map((entry) => entry.requirementId)).size !==
      maxStalenessMsByRequirement.length
    ) {
      throw new Error("INFORMATION_INQUIRY_INVALID:duplicate_stalenessRequirementId");
    }
    if (
      maxStalenessMsByRequirement.length !== relevantRequirementIds.length ||
      maxStalenessMsByRequirement.some(
        (item, index) => item.requirementId !== relevantRequirementIds[index],
      )
    ) {
      throw new Error("INFORMATION_INQUIRY_INVALID:incompleteStalenessRequirements");
    }
    return { timeframe, relevantRequirementIds, maxStalenessMsByRequirement };
  });

  requireInquiryNonEmpty(input.costPolicy.evaluatorVersion, "costEvaluatorVersion");
  requireInquiryDigest(input.costPolicy.evaluatorContentDigest, "costEvaluatorContentDigest");
  const assignments = [...input.costPolicy.assignments]
    .map((assignment) => ({
      requirementId: requireInquiryNonEmpty(assignment.requirementId, "costRequirementId"),
      providerId: requireInquiryNonEmpty(assignment.providerId, "costProviderId"),
      costUnits: requireNonNegativeInteger(assignment.costUnits, "costUnits"),
    }))
    .sort((left, right) =>
      inquiryCanonicalTextCompare(
        `${left.requirementId}\u0000${left.providerId}`,
        `${right.requirementId}\u0000${right.providerId}`,
      ),
    );
  if (
    new Set(assignments.map((entry) => `${entry.requirementId}\u0000${entry.providerId}`)).size !==
    assignments.length
  ) {
    throw new Error("INFORMATION_INQUIRY_INVALID:duplicate_costAssignment");
  }
  requireInquiryNonEmpty(
    input.contradictionMaterialityPolicyVersion,
    "contradictionMaterialityPolicyVersion",
  );
  requireInquiryDigest(
    input.contradictionMaterialityPolicyDigest,
    "contradictionMaterialityPolicyDigest",
  );
  requireInquiryNonEmpty(input.schedulingPolicyVersion, "schedulingPolicyVersion");
  requireInquiryDigest(input.schedulingPolicyDigest, "schedulingPolicyDigest");

  const payload = {
    schemaVersion: INFORMATION_INQUIRY_POLICY_V1_SCHEMA_VERSION,
    policyVersion: input.policyVersion,
    purpose: input.purpose,
    profilePurpose,
    timeframePolicies,
    bounds: {
      maxIterations: input.bounds.maxIterations,
      maxDepth: input.bounds.maxDepth,
      maxDurationMs: input.bounds.maxDurationMs,
      maxProviderFanout: input.bounds.maxProviderFanout,
      maxQueryCount: input.bounds.maxQueryCount,
      maxHistoricalResults: input.bounds.maxHistoricalResults,
      maxAcquisitionCostUnits: input.bounds.maxAcquisitionCostUnits,
    },
    costPolicy: {
      evaluatorVersion: input.costPolicy.evaluatorVersion,
      evaluatorContentDigest: input.costPolicy.evaluatorContentDigest,
      assignments,
    },
    contradictionMaterialityPolicyVersion: input.contradictionMaterialityPolicyVersion,
    contradictionMaterialityPolicyDigest: input.contradictionMaterialityPolicyDigest,
    schedulingPolicyVersion: input.schedulingPolicyVersion,
    schedulingPolicyDigest: input.schedulingPolicyDigest,
    maxNewOpportunityWaitTurns: input.maxNewOpportunityWaitTurns,
    authority: "EVIDENCE_ACQUISITION_POLICY_ONLY" as const,
  };
  return deepFreezeInquiry({ ...payload, contentDigest: computeInquiryContentDigest(payload) });
}

export function assertInformationInquiryPolicyV1(
  policy: InformationInquiryPolicyV1,
): InformationInquiryPolicyV1 {
  const expected = defineInformationInquiryPolicyV1({
    policyVersion: policy.policyVersion,
    purpose: policy.purpose,
    timeframePolicies: policy.timeframePolicies,
    bounds: policy.bounds,
    costPolicy: policy.costPolicy,
    contradictionMaterialityPolicyVersion: policy.contradictionMaterialityPolicyVersion,
    contradictionMaterialityPolicyDigest: policy.contradictionMaterialityPolicyDigest,
    schedulingPolicyVersion: policy.schedulingPolicyVersion,
    schedulingPolicyDigest: policy.schedulingPolicyDigest,
    maxNewOpportunityWaitTurns: policy.maxNewOpportunityWaitTurns,
  });
  assertExactInquiryIdentity(policy, expected, "policyIdentity");
  return policy;
}

function canonicalRequestedSources(
  sources: readonly InformationRequestedSourceV1[],
): InformationRequestedSourceV1[] {
  const canonical = [...sources]
    .map((source) => ({
      needId: requireInquiryNonEmpty(source.needId, "needId"),
      requirementId: requireInquiryNonEmpty(source.requirementId, "requirementId"),
      providerId: requireInquiryNonEmpty(source.providerId, "providerId"),
      allowedObservationKinds: (() => {
        const kinds = [...source.allowedObservationKinds].sort(inquiryCanonicalTextCompare);
        if (
          kinds.length === 0 ||
          new Set(kinds).size !== kinds.length ||
          kinds.some(
            (kind) =>
              !CANONICAL_PRIMITIVE_OBSERVATION_KINDS_V1.includes(
                kind as CanonicalPrimitiveObservationKindV1,
              ),
          )
        ) {
          throw new Error("INFORMATION_INQUIRY_INVALID:allowedObservationKinds");
        }
        return kinds;
      })(),
      costUnits: requireNonNegativeInteger(source.costUnits, "costUnits"),
      reasonCodes: sortInquiryUniqueStrings(source.reasonCodes, "requestReasonCode"),
    }))
    .sort((left, right) =>
      inquiryCanonicalTextCompare(
        `${left.needId}\u0000${left.providerId}`,
        `${right.needId}\u0000${right.providerId}`,
      ),
    );
  if (
    new Set(canonical.map((source) => `${source.needId}\u0000${source.providerId}`)).size !==
    canonical.length
  ) {
    throw new Error("INFORMATION_INQUIRY_INVALID:duplicateRequestedSource");
  }
  return canonical;
}

export function defineInformationAcquisitionSelectionV1(
  input: Omit<InformationAcquisitionSelectionV1, "schemaVersion" | "authority" | "contentDigest">,
): InformationAcquisitionSelectionV1 {
  requireInquiryNonEmpty(input.planId, "planId");
  requireInquiryDigest(input.planContentDigest, "planContentDigest");
  requireInquiryNonEmpty(input.organizationId, "organizationId");
  if (input.accountId !== null) requireInquiryNonEmpty(input.accountId, "accountId");
  requireInquiryNonEmpty(input.symbol, "symbol");
  requireInquiryTimestamp(input.pitAnchor, "pitAnchor");
  mapInformationInquiryPurposeV1(input.purpose);
  if (input.mode !== "LIVE" && input.mode !== "HISTORICAL") {
    throw new Error("INFORMATION_INQUIRY_INVALID:selectionMode");
  }
  const payload = {
    schemaVersion: INFORMATION_ACQUISITION_SELECTION_V1_SCHEMA_VERSION,
    planId: input.planId,
    planContentDigest: input.planContentDigest,
    organizationId: input.organizationId,
    accountId: input.accountId,
    symbol: input.symbol,
    pitAnchor: input.pitAnchor,
    purpose: input.purpose,
    mode: input.mode,
    requestedSources: canonicalRequestedSources(input.requestedSources),
    authority: "EVIDENCE_ACQUISITION_ONLY" as const,
  };
  return deepFreezeInquiry({ ...payload, contentDigest: computeInquiryContentDigest(payload) });
}

export function assertInformationAcquisitionSelectionV1(
  selection: InformationAcquisitionSelectionV1,
): InformationAcquisitionSelectionV1 {
  const expected = defineInformationAcquisitionSelectionV1({
    planId: selection.planId,
    planContentDigest: selection.planContentDigest,
    organizationId: selection.organizationId,
    accountId: selection.accountId,
    symbol: selection.symbol,
    pitAnchor: selection.pitAnchor,
    purpose: selection.purpose,
    mode: selection.mode,
    requestedSources: selection.requestedSources,
  });
  assertExactInquiryIdentity(selection, expected, "selectionIdentity");
  return selection;
}
