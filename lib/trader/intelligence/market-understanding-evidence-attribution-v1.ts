import { createHash } from "node:crypto";

import {
  assertInformationSufficiencyReceiptV2,
  assertRequiredInformationProfileV2,
  type InformationEvidenceV2,
  type InformationQuestionIdV2,
  type InformationRequirementReceiptV2,
  type InformationSufficiencyReceiptV2,
  type RequiredInformationProfileV2,
} from "@/lib/trader/intelligence/information-sufficiency/information-sufficiency-v2";
import {
  CANONICAL_MARKET_QUESTION_IDS,
  type MarketQuestionId,
} from "@/lib/trader/intelligence/market-understanding.types";
import { canonicalJsonString } from "@/lib/trader/research/digest";

export const UNDERSTANDING_CLAIM_V1_SCHEMA_VERSION = "understanding-claim-v1" as const;
export const MARKET_UNDERSTANDING_ARTIFACT_V1_SCHEMA_VERSION =
  "market-understanding-artifact-v1" as const;
export const MARKET_UNDERSTANDING_DERIVATION_V1_SCHEMA_VERSION =
  "market-understanding-derivation-v1" as const;

export const UNDERSTANDING_CLAIM_STATES_V1 = [
  "SUPPORTED",
  "PARTIALLY_SUPPORTED",
  "CONFLICTED",
  "UNKNOWN",
  "UNAVAILABLE",
  "NOT_REQUIRED",
  "NOT_APPLICABLE",
] as const;
export type UnderstandingClaimStateV1 = (typeof UNDERSTANDING_CLAIM_STATES_V1)[number];

export const UNDERSTANDING_CLAIM_KINDS_V1 = [
  "OBSERVED_FACT",
  "STRUCTURAL_OR_TEMPORAL_ASSOCIATION",
  "EVIDENCE_SUPPORTED_CAUSAL_ATTRIBUTION",
  "UNRESOLVED",
] as const;
export type UnderstandingClaimKindV1 = (typeof UNDERSTANDING_CLAIM_KINDS_V1)[number];

export const UNDERSTANDING_EVIDENCE_ROLES_V1 = [
  "SUPPORTING",
  "CORROBORATING",
  "CONTRADICTING",
  "CONTEXTUAL",
] as const;
export type UnderstandingEvidenceRoleV1 = (typeof UNDERSTANDING_EVIDENCE_ROLES_V1)[number];

export const UNDERSTANDING_COMPUTATION_DISPOSITIONS_V1 = [
  "CONSUMED",
  "IGNORED",
  "IRRELEVANT",
] as const;
export type UnderstandingComputationDispositionV1 =
  (typeof UNDERSTANDING_COMPUTATION_DISPOSITIONS_V1)[number];

export type UnderstandingAuthorityV1 = Readonly<{
  kind: "MARKET_UNDERSTANDING_ONLY";
  createsForecastAuthority: false;
  createsDecisionAuthority: false;
  createsRiskAuthority: false;
  createsExecutionAuthority: false;
  createsCapitalAuthority: false;
}>;

export const MARKET_UNDERSTANDING_ONLY_AUTHORITY_V1: UnderstandingAuthorityV1 = Object.freeze({
  kind: "MARKET_UNDERSTANDING_ONLY",
  createsForecastAuthority: false,
  createsDecisionAuthority: false,
  createsRiskAuthority: false,
  createsExecutionAuthority: false,
  createsCapitalAuthority: false,
});

export type MarketUnderstandingQuestionMappingV1 = Readonly<{
  marketQuestionId: MarketQuestionId;
  informationQuestionId: InformationQuestionIdV2 | null;
}>;

export const MARKET_UNDERSTANDING_QUESTION_MAPPING_V1 = Object.freeze([
  { marketQuestionId: "Q_WHAT_HAPPENING", informationQuestionId: "Q_WHAT_HAPPENING" },
  { marketQuestionId: "Q_WHY_HAPPENING", informationQuestionId: "Q_WHY_HAPPENING" },
  {
    marketQuestionId: "Q_HTF_ALIGNED",
    informationQuestionId: "Q_CROSS_TIMEFRAME_RELATIONSHIP",
  },
  {
    marketQuestionId: "Q_LTF_ALIGNED",
    informationQuestionId: "Q_CROSS_TIMEFRAME_RELATIONSHIP",
  },
  {
    marketQuestionId: "Q_CROSS_VENUE",
    informationQuestionId: "Q_UNKNOWN_OR_CONTRADICTORY",
  },
  { marketQuestionId: "Q_CROWD", informationQuestionId: "Q_UNKNOWN_OR_CONTRADICTORY" },
  { marketQuestionId: "Q_LIQUIDITY", informationQuestionId: "Q_EXECUTION_LIQUIDITY" },
  { marketQuestionId: "Q_DATA_TRUST", informationQuestionId: "Q_UNKNOWN_OR_CONTRADICTORY" },
  { marketQuestionId: "Q_UNKNOWN", informationQuestionId: "Q_UNKNOWN_OR_CONTRADICTORY" },
  {
    marketQuestionId: "Q_HISTORICAL_ANALOGUES",
    informationQuestionId: "Q_HISTORICAL_ANALOGUES",
  },
  { marketQuestionId: "Q_DEPLOY_CAPITAL", informationQuestionId: null },
  { marketQuestionId: "Q_PRESERVE_CAPITAL", informationQuestionId: null },
] as const satisfies readonly MarketUnderstandingQuestionMappingV1[]);

export type MarketUnderstandingDerivationDefinitionV1 = Readonly<{
  schemaVersion: typeof MARKET_UNDERSTANDING_DERIVATION_V1_SCHEMA_VERSION;
  algorithmVersion: "exact-question-attribution-v1";
  questionMapping: typeof MARKET_UNDERSTANDING_QUESTION_MAPPING_V1;
  authority: UnderstandingAuthorityV1;
  contentDigest: string;
}>;

export type CanonicalUnderstandingEvidenceRefV1 = Readonly<{
  evidenceId: string;
  evidenceFamily: string;
  providerId: string;
  sourceId: string;
  observationId: string;
  observationKind: InformationEvidenceV2["observationKind"];
  observationSchemaVersion: string;
  observationContentDigest: string;
  trustAsOfReceiptId: string | null;
  trustRevisionId: string | null;
  trustRevisionContentDigest: string | null;
  measurementDefinitionId: string | null;
  measurementDefinitionContentDigest: string | null;
  measurementValueId: string | null;
  measurementValueContentDigest: string | null;
  availability: InformationEvidenceV2["availability"];
  trust: InformationEvidenceV2["trust"];
  trustScore: number | null;
  pitQualified: boolean;
  replayEligible: boolean;
  dependenceGroup: string;
  contradictionGroup: string | null;
  contradiction: InformationEvidenceV2["contradiction"];
  epistemicRole: InformationEvidenceV2["epistemicRole"];
  historyScope: InformationEvidenceV2["historyScope"];
  availableAt: string;
  historicalDatasetTrustAuthority?: InformationEvidenceV2["historicalDatasetTrustAuthority"];
  degradationReasonCodes: readonly string[];
}>;

export type UnderstandingEvidenceDependencyV1 = Readonly<{
  disposition: UnderstandingComputationDispositionV1;
  role: UnderstandingEvidenceRoleV1 | null;
  dependencyPaths: readonly string[];
  evidence: CanonicalUnderstandingEvidenceRefV1;
}>;

export type UnderstandingComputationInputV1 = Readonly<{
  path: string;
  contentDigest: string;
}>;

export type UnderstandingMissingExpectedEvidenceV1 = Readonly<{
  requirementId: string;
  informationQuestionId: InformationQuestionIdV2;
  classification: InformationRequirementReceiptV2["classification"];
  terminalStatus: InformationRequirementReceiptV2["terminalStatus"];
  blocking: boolean;
  matchedEvidenceIds: readonly string[];
  acceptedEvidenceIds: readonly string[];
  reasonCodes: readonly string[];
}>;

export type UnderstandingClaimScopeV1 = Readonly<{
  organizationId: string;
  accountId: string | null;
  purpose: RequiredInformationProfileV2["purpose"];
  symbol: string;
  venue: string;
  analyticalTimeframe: string;
  horizon: string;
  pitAnchor: string;
  profileId: string;
  profileContentDigest: string;
  sufficiencyReceiptId: string;
  sufficiencyReceiptContentDigest: string;
}>;

export type UnderstandingClaimV1 = Readonly<{
  schemaVersion: typeof UNDERSTANDING_CLAIM_V1_SCHEMA_VERSION;
  scope: UnderstandingClaimScopeV1;
  marketQuestionId: MarketQuestionId;
  informationQuestionId: InformationQuestionIdV2 | null;
  claimState: UnderstandingClaimStateV1;
  claimKind: UnderstandingClaimKindV1;
  answerSummary: string;
  computationInputs: readonly UnderstandingComputationInputV1[];
  dependencies: readonly UnderstandingEvidenceDependencyV1[];
  effectiveDependenceGroups: readonly string[];
  missingExpectedEvidence: readonly UnderstandingMissingExpectedEvidenceV1[];
  questionProfileContentDigest: string;
  questionReceiptContentDigest: string;
  derivationDefinitionContentDigest: string;
  causalLineageDigest: string;
  authority: UnderstandingAuthorityV1;
  contentDigest: string;
}>;

export type MarketUnderstandingArtifactV1 = Readonly<{
  schemaVersion: typeof MARKET_UNDERSTANDING_ARTIFACT_V1_SCHEMA_VERSION;
  authenticatedProfile: RequiredInformationProfileV2;
  authenticatedSufficiencyReceipt: InformationSufficiencyReceiptV2;
  scope: UnderstandingClaimScopeV1;
  evaluatedAt: string;
  derivationDefinition: MarketUnderstandingDerivationDefinitionV1;
  claims: readonly UnderstandingClaimV1[];
  evidenceUsed: readonly CanonicalUnderstandingEvidenceRefV1[];
  evidenceIgnored: readonly CanonicalUnderstandingEvidenceRefV1[];
  authority: UnderstandingAuthorityV1;
  contentDigest: string;
}>;

type ConsumedEvidenceInputV1 = Readonly<{
  evidenceId: string;
  role: UnderstandingEvidenceRoleV1;
  dependencyPaths: readonly string[];
}>;

const HEX_64 = /^[0-9a-f]{64}$/;

function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJsonString(value), "utf8").digest("hex");
}

function requireNonEmpty(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:${field}`);
  }
  return value;
}

function requireDigest(value: string, field: string): string {
  if (!HEX_64.test(value)) {
    throw new Error(`MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:${field}`);
  }
  return value;
}

function requireOptionalDigest(value: string | null, field: string): string | null {
  if (value !== null) requireDigest(value, field);
  return value;
}

function canonicalTextCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function sortedUniqueStrings(values: readonly string[], field: string): string[] {
  const sorted = [...values].map((value) => requireNonEmpty(value, field)).sort(canonicalTextCompare);
  if (new Set(sorted).size !== sorted.length) {
    throw new Error(`MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:duplicate_${field}`);
  }
  return sorted;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value) as Readonly<T>;
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
    return Object.freeze(value) as Readonly<T>;
  }
  return value as Readonly<T>;
}

function assertPlainEnumerableData(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object") {
    throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:runtimeValueShape");
  }
  if (seen.has(value)) {
    throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:cyclicRuntimeShape");
  }
  seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) {
      throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:runtimePrototype");
    }
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.some((key) => typeof key !== "string") ||
      ownKeys.length !== value.length + 1 ||
      ownKeys.at(-1) !== "length"
    ) {
      throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:runtimeArrayShape");
    }
    for (let index = 0; index < value.length; index += 1) {
      if (ownKeys[index] !== String(index)) {
        throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:runtimeArrayShape");
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:runtimeFieldShape");
      }
      assertPlainEnumerableData(descriptor.value, seen);
    }
  } else {
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:runtimePrototype");
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:runtimeFieldShape");
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:runtimeFieldShape");
      }
      assertPlainEnumerableData(descriptor.value, seen);
    }
  }
  seen.delete(value);
}

function evidenceIdentityKey(evidence: CanonicalUnderstandingEvidenceRefV1): string {
  return [
    evidence.evidenceId,
    evidence.observationId,
    evidence.observationContentDigest,
    evidence.trustRevisionContentDigest ?? "",
    evidence.measurementValueContentDigest ?? "",
  ].join(":");
}

function canonicalEvidenceRef(evidence: InformationEvidenceV2): CanonicalUnderstandingEvidenceRefV1 {
  requireNonEmpty(evidence.evidenceId, "evidenceId");
  requireNonEmpty(evidence.sourceId, "sourceId");
  requireNonEmpty(evidence.observationId, "observationId");
  requireDigest(evidence.observationContentDigest, "observationContentDigest");
  requireOptionalDigest(evidence.trustAsOfReceiptId, "trustAsOfReceiptId");
  requireOptionalDigest(evidence.trustRevisionContentDigest, "trustRevisionContentDigest");
  requireOptionalDigest(
    evidence.measurementDefinitionContentDigest,
    "measurementDefinitionContentDigest",
  );
  requireOptionalDigest(evidence.measurementValueContentDigest, "measurementValueContentDigest");
  return {
    evidenceId: evidence.evidenceId,
    evidenceFamily: evidence.evidenceFamily,
    providerId: evidence.providerId,
    sourceId: evidence.sourceId,
    observationId: evidence.observationId,
    observationKind: evidence.observationKind,
    observationSchemaVersion: evidence.observationSchemaVersion,
    observationContentDigest: evidence.observationContentDigest,
    trustAsOfReceiptId: evidence.trustAsOfReceiptId,
    trustRevisionId: evidence.trustRevisionId,
    trustRevisionContentDigest: evidence.trustRevisionContentDigest,
    measurementDefinitionId: evidence.measurementDefinitionId,
    measurementDefinitionContentDigest: evidence.measurementDefinitionContentDigest,
    measurementValueId: evidence.measurementValueId,
    measurementValueContentDigest: evidence.measurementValueContentDigest,
    availability: evidence.availability,
    trust: evidence.trust,
    trustScore: evidence.trustScore,
    pitQualified: evidence.pitQualified,
    replayEligible: evidence.replayEligible,
    dependenceGroup: evidence.dependenceGroup,
    contradictionGroup: evidence.contradictionGroup,
    contradiction: evidence.contradiction,
    epistemicRole: evidence.epistemicRole,
    historyScope: evidence.historyScope,
    availableAt: evidence.availableAt,
    ...(evidence.historicalDatasetTrustAuthority === undefined
      ? {}
      : { historicalDatasetTrustAuthority: evidence.historicalDatasetTrustAuthority }),
    degradationReasonCodes: sortedUniqueStrings(
      evidence.degradationReasonCodes,
      "degradationReasonCode",
    ),
  };
}

function mappingFor(questionId: MarketQuestionId): MarketUnderstandingQuestionMappingV1 {
  const mapping = MARKET_UNDERSTANDING_QUESTION_MAPPING_V1.find(
    (candidate) => candidate.marketQuestionId === questionId,
  );
  if (!mapping) throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:questionMapping");
  return mapping;
}

function validateRole(evidence: InformationEvidenceV2, role: UnderstandingEvidenceRoleV1): void {
  if (
    (evidence.contradiction === "CONTRADICTS" || evidence.contradiction === "UNRESOLVED") !==
    (role === "CONTRADICTING")
  ) {
    throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:contradictionRole");
  }
  if (role === "CORROBORATING" && evidence.epistemicRole !== "CORROBORATING") {
    throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:corroboratingRole");
  }
}

function buildDerivationDefinition(): MarketUnderstandingDerivationDefinitionV1 {
  const body = {
    schemaVersion: MARKET_UNDERSTANDING_DERIVATION_V1_SCHEMA_VERSION,
    algorithmVersion: "exact-question-attribution-v1" as const,
    questionMapping: MARKET_UNDERSTANDING_QUESTION_MAPPING_V1,
    authority: MARKET_UNDERSTANDING_ONLY_AUTHORITY_V1,
  };
  return deepFreeze({ ...body, contentDigest: sha256Canonical(body) });
}

export const MARKET_UNDERSTANDING_DERIVATION_DEFINITION_V1 = buildDerivationDefinition();

export function defineUnderstandingClaimV1(input: {
  profile: RequiredInformationProfileV2;
  receipt: InformationSufficiencyReceiptV2;
  computationInputs: readonly UnderstandingComputationInputV1[];
  marketQuestionId: MarketQuestionId;
  claimState: UnderstandingClaimStateV1;
  claimKind: UnderstandingClaimKindV1;
  answerSummary: string;
  consumedEvidence: readonly ConsumedEvidenceInputV1[];
  irrelevantEvidenceIds?: readonly string[];
}): UnderstandingClaimV1 {
  assertPlainEnumerableData(input);
  const profile = assertRequiredInformationProfileV2(input.profile);
  const receipt = assertInformationSufficiencyReceiptV2(input.receipt, profile);
  requireNonEmpty(input.answerSummary, "answerSummary");
  if (!(UNDERSTANDING_CLAIM_STATES_V1 as readonly string[]).includes(input.claimState)) {
    throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:claimState");
  }
  if (!(UNDERSTANDING_CLAIM_KINDS_V1 as readonly string[]).includes(input.claimKind)) {
    throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:claimKind");
  }

  const mapping = mappingFor(input.marketQuestionId);
  if (mapping.informationQuestionId === null) {
    if (
      input.claimState !== "NOT_APPLICABLE" ||
      input.claimKind !== "UNRESOLVED" ||
      input.consumedEvidence.length > 0
    ) {
      throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:capitalQuestionAuthority");
    }
  } else if (input.claimState === "NOT_APPLICABLE") {
    throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:questionApplicability");
  }

  const relevantRequirements = mapping.informationQuestionId
    ? receipt.requirementReceipts.filter(
        (requirement) => requirement.questionId === mapping.informationQuestionId,
      )
    : [];
  const relevantProfileRequirements = mapping.informationQuestionId
    ? profile.requirements
        .filter((requirement) => requirement.questionId === mapping.informationQuestionId)
        .sort((left, right) => canonicalTextCompare(left.id, right.id))
    : [];
  const acceptedIds = new Set(relevantRequirements.flatMap((entry) => entry.acceptedEvidenceIds));
  const matchedIds = new Set(relevantRequirements.flatMap((entry) => entry.matchedEvidenceIds));
  const evidenceById = new Map(receipt.evidenceInventory.map((entry) => [entry.evidenceId, entry]));
  const consumedIds = new Set<string>();
  const dependencies: UnderstandingEvidenceDependencyV1[] = [];
  const computationInputs = [...input.computationInputs]
    .map((entry) => ({
      path: requireNonEmpty(entry.path, "computationInput.path"),
      contentDigest: requireDigest(entry.contentDigest, "computationInput.contentDigest"),
    }))
    .sort((left, right) => canonicalTextCompare(left.path, right.path));
  if (
    new Set(computationInputs.map((entry) => entry.path)).size !== computationInputs.length ||
    computationInputs.length === 0
  ) {
    throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:computationInputs");
  }
  const computationInputPaths = new Set(computationInputs.map((entry) => entry.path));
  for (const consumed of input.consumedEvidence) {
    if (!(UNDERSTANDING_EVIDENCE_ROLES_V1 as readonly string[]).includes(consumed.role)) {
      throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:evidenceRole");
    }
    const contradictionMatched =
      consumed.role === "CONTRADICTING" && matchedIds.has(consumed.evidenceId);
    if (
      consumedIds.has(consumed.evidenceId) ||
      (!acceptedIds.has(consumed.evidenceId) && !contradictionMatched)
    ) {
      throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:consumedEvidenceClosure");
    }
    const evidence = evidenceById.get(consumed.evidenceId);
    if (!evidence) {
      throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:evidenceInventoryClosure");
    }
    validateRole(evidence, consumed.role);
    if (
      evidence.availability !== "AVAILABLE" ||
      !evidence.pitQualified ||
      !evidence.replayEligible
    ) {
      throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:canonicalPitReplayEvidence");
    }
    if (
      input.marketQuestionId === "Q_WHY_HAPPENING" &&
      consumed.role === "SUPPORTING" &&
      evidence.epistemicRole !== "CAUSAL"
    ) {
      throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:whyRequiresCausalEvidence");
    }
    consumedIds.add(consumed.evidenceId);
    const dependencyPaths = sortedUniqueStrings(consumed.dependencyPaths, "dependencyPath");
    if (
      dependencyPaths.length === 0 ||
      dependencyPaths.some((path) => !computationInputPaths.has(path))
    ) {
      throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:computationDependencyClosure");
    }
    dependencies.push({
      disposition: "CONSUMED",
      role: consumed.role,
      dependencyPaths,
      evidence: canonicalEvidenceRef(evidence),
    });
  }

  const irrelevantIds = new Set(
    sortedUniqueStrings(input.irrelevantEvidenceIds ?? [], "irrelevantEvidenceId"),
  );
  for (const evidenceId of irrelevantIds) {
    if (consumedIds.has(evidenceId)) {
      throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:dependencyPartitionOverlap");
    }
    const evidence = evidenceById.get(evidenceId);
    if (!evidence) {
      throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:evidenceInventoryClosure");
    }
    dependencies.push({
      disposition: "IRRELEVANT",
      role: null,
      dependencyPaths: [],
      evidence: canonicalEvidenceRef(evidence),
    });
  }
  for (const evidence of receipt.evidenceInventory) {
    if (consumedIds.has(evidence.evidenceId) || irrelevantIds.has(evidence.evidenceId)) continue;
    dependencies.push({
      disposition: "IGNORED",
      role: null,
      dependencyPaths: [],
      evidence: canonicalEvidenceRef(evidence),
    });
  }
  dependencies.sort((left, right) =>
    canonicalTextCompare(evidenceIdentityKey(left.evidence), evidenceIdentityKey(right.evidence)),
  );

  const observationKeys = dependencies
    .filter((entry) => entry.disposition === "CONSUMED")
    .map(
      (entry) =>
        `${entry.evidence.observationId}:${entry.evidence.observationContentDigest}:${entry.evidence.measurementValueContentDigest ?? ""}`,
    );
  if (new Set(observationKeys).size !== observationKeys.length) {
    throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:duplicateObservationDependency");
  }

  const blockingUnresolved = relevantRequirements.some(
    (requirement) =>
      requirement.blocking && requirement.terminalStatus !== "ANSWERED_SUFFICIENTLY",
  );
  const consumedDependencies = dependencies.filter(
    (entry) => entry.disposition === "CONSUMED",
  );
  const hasAnsweredRequirement = relevantRequirements.some(
    (requirement) => requirement.terminalStatus === "ANSWERED_SUFFICIENTLY",
  );
  const hasContradiction = consumedDependencies.some(
    (entry) => entry.role === "CONTRADICTING",
  );
  const activeRequiredReceipts = relevantRequirements.filter(
    (requirement) => requirement.active && requirement.classification !== "OPTIONAL_ENRICHMENT",
  );
  const allActiveRequirementsAnswered =
    activeRequiredReceipts.length > 0 &&
    activeRequiredReceipts.every(
      (requirement) => requirement.terminalStatus === "ANSWERED_SUFFICIENTLY",
    );
  const assertConsumedIndependenceFloor = (): void => {
    const profileRequirementsById = new Map(
      relevantProfileRequirements.map((requirement) => [requirement.id, requirement]),
    );
    for (const requirement of activeRequiredReceipts) {
      if (requirement.terminalStatus !== "ANSWERED_SUFFICIENTLY") continue;
      const definition = profileRequirementsById.get(requirement.requirementId);
      if (!definition) {
        throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:requirementDefinitionClosure");
      }
      const acceptedByRequirement = new Set(requirement.acceptedEvidenceIds);
      const consumedGroups = new Set(
        consumedDependencies
          .filter((dependency) => acceptedByRequirement.has(dependency.evidence.evidenceId))
          .map((dependency) => dependency.evidence.dependenceGroup),
      );
      if (consumedGroups.size < definition.minimumIndependentGroups) {
        throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:independenceFloor");
      }
    }
  };
  if (
    input.claimState === "SUPPORTED" &&
    (blockingUnresolved ||
      !hasAnsweredRequirement ||
      consumedDependencies.length === 0 ||
      hasContradiction ||
      input.claimKind === "UNRESOLVED")
  ) {
    throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:blockingRequirementUnresolved");
  }
  if (input.claimState === "SUPPORTED") {
    assertConsumedIndependenceFloor();
  }
  if (
    input.claimState === "PARTIALLY_SUPPORTED" &&
    (relevantRequirements.length === 0 ||
      consumedDependencies.length === 0 ||
      input.claimKind === "UNRESOLVED")
  ) {
    throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:partialClaimUnsupported");
  }
  if (
    input.claimState === "CONFLICTED" &&
    (!hasContradiction || consumedDependencies.length === 0 || input.claimKind === "UNRESOLVED")
  ) {
    throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:conflictedClaimUnsupported");
  }
  if (
    (input.claimState === "UNAVAILABLE" ||
      input.claimState === "NOT_REQUIRED" ||
      input.claimState === "NOT_APPLICABLE") &&
    (consumedDependencies.length > 0 || input.claimKind !== "UNRESOLVED")
  ) {
    throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:unresolvedClaimDependencies");
  }
  if (input.claimState === "UNKNOWN") {
    if (input.claimKind !== "UNRESOLVED") {
      throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:unknownClaimKind");
    }
    if (allActiveRequirementsAnswered) {
      if (consumedDependencies.length === 0) {
        throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:unknownClaimEvidence");
      }
      assertConsumedIndependenceFloor();
    } else if (consumedDependencies.length > 0) {
      throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:unknownClaimReceiptState");
    }
  }
  if (
    input.claimState === "NOT_REQUIRED" &&
    (relevantRequirements.length === 0 ||
      relevantRequirements.some((requirement) => requirement.terminalStatus !== "NOT_REQUIRED"))
  ) {
    throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:notRequiredState");
  }
  if (
    input.claimState === "UNAVAILABLE" &&
    relevantRequirements.length > 0 &&
    relevantRequirements.every((requirement) => requirement.terminalStatus !== "UNAVAILABLE")
  ) {
    throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:unavailableState");
  }
  if (
    input.claimKind === "EVIDENCE_SUPPORTED_CAUSAL_ATTRIBUTION" &&
    !dependencies.some(
      (entry) =>
        entry.disposition === "CONSUMED" &&
        entry.role === "SUPPORTING" &&
        evidenceById.get(entry.evidence.evidenceId)?.epistemicRole === "CAUSAL",
    )
  ) {
    throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:causalClaimUnsupported");
  }
  if (
    input.marketQuestionId === "Q_WHY_HAPPENING" &&
    input.claimState !== "UNKNOWN" &&
    input.claimState !== "UNAVAILABLE" &&
    input.claimState !== "NOT_REQUIRED" &&
    input.claimKind !== "EVIDENCE_SUPPORTED_CAUSAL_ATTRIBUTION"
  ) {
    throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:whyRequiresCausalClaim");
  }

  const missingExpectedEvidence = relevantRequirements
    .filter((requirement) => requirement.terminalStatus !== "ANSWERED_SUFFICIENTLY")
    .map((requirement) => ({
      requirementId: requirement.requirementId,
      informationQuestionId: requirement.questionId,
      classification: requirement.classification,
      terminalStatus: requirement.terminalStatus,
      blocking: requirement.blocking,
      matchedEvidenceIds: sortedUniqueStrings(
        requirement.matchedEvidenceIds,
        "matchedEvidenceId",
      ),
      acceptedEvidenceIds: sortedUniqueStrings(
        requirement.acceptedEvidenceIds,
        "acceptedEvidenceId",
      ),
      reasonCodes: sortedUniqueStrings(requirement.reasonCodes, "requirementReasonCode"),
    }))
    .sort((left, right) => canonicalTextCompare(left.requirementId, right.requirementId));

  const scope: UnderstandingClaimScopeV1 = {
    organizationId: profile.organizationId,
    accountId: profile.accountId,
    purpose: profile.purpose,
    symbol: profile.symbol,
    venue: profile.venue,
    analyticalTimeframe: profile.analyticalTimeframe,
    horizon: profile.horizon,
    pitAnchor: receipt.pitAnchor,
    profileId: profile.id,
    profileContentDigest: profile.contentDigest,
    sufficiencyReceiptId: receipt.id,
    sufficiencyReceiptContentDigest: receipt.contentDigest,
  };
  const lineageScope = {
    organizationId: scope.organizationId,
    accountId: scope.accountId,
    purpose: scope.purpose,
    symbol: scope.symbol,
    venue: scope.venue,
    analyticalTimeframe: scope.analyticalTimeframe,
    horizon: scope.horizon,
    pitAnchor: scope.pitAnchor,
  };
  const effectiveDependenceGroups = [...new Set(
    consumedDependencies.map((entry) => entry.evidence.dependenceGroup),
  )].sort(canonicalTextCompare);
  const questionProfileContentDigest = sha256Canonical(relevantProfileRequirements);
  const questionReceiptContentDigest = sha256Canonical(relevantRequirements);
  const lineageBody = {
    scope: lineageScope,
    marketQuestionId: input.marketQuestionId,
    informationQuestionId: mapping.informationQuestionId,
    claimState: input.claimState,
    claimKind: input.claimKind,
    answerSummary: input.answerSummary,
    computationInputs,
    dependencies: consumedDependencies,
    effectiveDependenceGroups,
    missingExpectedEvidence,
    questionProfileContentDigest,
    derivationDefinitionContentDigest:
      MARKET_UNDERSTANDING_DERIVATION_DEFINITION_V1.contentDigest,
  };
  const causalLineageDigest = sha256Canonical(lineageBody);
  const body = {
    schemaVersion: UNDERSTANDING_CLAIM_V1_SCHEMA_VERSION,
    scope,
    marketQuestionId: input.marketQuestionId,
    informationQuestionId: mapping.informationQuestionId,
    claimState: input.claimState,
    claimKind: input.claimKind,
    answerSummary: input.answerSummary,
    computationInputs,
    dependencies,
    effectiveDependenceGroups,
    missingExpectedEvidence,
    questionProfileContentDigest,
    questionReceiptContentDigest,
    derivationDefinitionContentDigest:
      MARKET_UNDERSTANDING_DERIVATION_DEFINITION_V1.contentDigest,
    causalLineageDigest,
    authority: MARKET_UNDERSTANDING_ONLY_AUTHORITY_V1,
  };
  return deepFreeze({ ...body, contentDigest: sha256Canonical(body) });
}

export function assertUnderstandingClaimV1(
  claim: UnderstandingClaimV1,
  profile: RequiredInformationProfileV2,
  receipt: InformationSufficiencyReceiptV2,
): UnderstandingClaimV1 {
  try {
    assertPlainEnumerableData(claim);
    const expected = defineUnderstandingClaimV1({
      profile,
      receipt,
      computationInputs: claim.computationInputs,
      marketQuestionId: claim.marketQuestionId,
      claimState: claim.claimState,
      claimKind: claim.claimKind,
      answerSummary: claim.answerSummary,
      consumedEvidence: claim.dependencies
        .filter((dependency) => dependency.disposition === "CONSUMED")
        .map((dependency) => ({
          evidenceId: dependency.evidence.evidenceId,
          role: dependency.role as UnderstandingEvidenceRoleV1,
          dependencyPaths: dependency.dependencyPaths,
        })),
      irrelevantEvidenceIds: claim.dependencies
        .filter((dependency) => dependency.disposition === "IRRELEVANT")
        .map((dependency) => dependency.evidence.evidenceId),
    });
    if (canonicalJsonString(expected) !== canonicalJsonString(claim)) {
      throw new Error("identity mismatch");
    }
    return claim;
  } catch {
    throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:claimIdentity");
  }
}

export function defineMarketUnderstandingArtifactV1(input: {
  profile: RequiredInformationProfileV2;
  receipt: InformationSufficiencyReceiptV2;
  evaluatedAt: string;
  claims: readonly UnderstandingClaimV1[];
}): MarketUnderstandingArtifactV1 {
  assertPlainEnumerableData(input);
  const profile = assertRequiredInformationProfileV2(input.profile);
  const receipt = assertInformationSufficiencyReceiptV2(input.receipt, profile);
  if (!Number.isFinite(Date.parse(input.evaluatedAt))) {
    throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:evaluatedAt");
  }
  const evaluatedAt = new Date(input.evaluatedAt).toISOString();
  if (evaluatedAt !== receipt.pitAnchor) {
    throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:evaluatedAtPitMismatch");
  }
  const claims = input.claims
    .map((claim) => assertUnderstandingClaimV1(claim, profile, receipt))
    .sort((left, right) => canonicalTextCompare(left.marketQuestionId, right.marketQuestionId));
  if (
    claims.length !== CANONICAL_MARKET_QUESTION_IDS.length ||
    canonicalJsonString(claims.map((claim) => claim.marketQuestionId).sort(canonicalTextCompare)) !==
      canonicalJsonString([...CANONICAL_MARKET_QUESTION_IDS].sort(canonicalTextCompare))
  ) {
    throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:questionClaimCoverage");
  }
  const scope = claims[0]!.scope;
  for (const claim of claims) {
    if (
      claim.scope.organizationId !== profile.organizationId ||
      claim.scope.profileId !== profile.id ||
      claim.scope.profileContentDigest !== profile.contentDigest ||
      claim.scope.sufficiencyReceiptId !== receipt.id ||
      claim.scope.sufficiencyReceiptContentDigest !== receipt.contentDigest ||
      canonicalJsonString(claim.scope) !== canonicalJsonString(scope) ||
      claim.derivationDefinitionContentDigest !==
        MARKET_UNDERSTANDING_DERIVATION_DEFINITION_V1.contentDigest ||
      claim.authority.kind !== "MARKET_UNDERSTANDING_ONLY"
    ) {
      throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:claimScope");
    }
  }
  const evidenceById = new Map(
    receipt.evidenceInventory.map((evidence) => [evidence.evidenceId, canonicalEvidenceRef(evidence)]),
  );
  const usedIds = new Set(
    claims.flatMap((claim) =>
      claim.dependencies
        .filter((dependency) => dependency.disposition === "CONSUMED")
        .map((dependency) => dependency.evidence.evidenceId),
    ),
  );
  const evidenceUsed = [...usedIds]
    .map((evidenceId) => evidenceById.get(evidenceId)!)
    .sort((left, right) => canonicalTextCompare(evidenceIdentityKey(left), evidenceIdentityKey(right)));
  const evidenceIgnored = [...evidenceById.values()]
    .filter((evidence) => !usedIds.has(evidence.evidenceId))
    .sort((left, right) => canonicalTextCompare(evidenceIdentityKey(left), evidenceIdentityKey(right)));
  const body = {
    schemaVersion: MARKET_UNDERSTANDING_ARTIFACT_V1_SCHEMA_VERSION,
    authenticatedProfile: profile,
    authenticatedSufficiencyReceipt: receipt,
    scope,
    evaluatedAt,
    derivationDefinition: MARKET_UNDERSTANDING_DERIVATION_DEFINITION_V1,
    claims,
    evidenceUsed,
    evidenceIgnored,
    authority: MARKET_UNDERSTANDING_ONLY_AUTHORITY_V1,
  };
  return deepFreeze({ ...body, contentDigest: sha256Canonical(body) });
}

export function assertMarketUnderstandingArtifactV1(
  artifact: MarketUnderstandingArtifactV1,
  profile?: RequiredInformationProfileV2,
  receipt?: InformationSufficiencyReceiptV2,
): MarketUnderstandingArtifactV1 {
  try {
    assertMarketUnderstandingArtifactRuntimeShapeV1(artifact);
    const authenticatedProfile = profile ?? artifact.authenticatedProfile;
    const authenticatedReceipt = receipt ?? artifact.authenticatedSufficiencyReceipt;
    assertPlainEnumerableData(authenticatedProfile);
    assertPlainEnumerableData(authenticatedReceipt);
    const expected = defineMarketUnderstandingArtifactV1({
      profile: authenticatedProfile,
      receipt: authenticatedReceipt,
      evaluatedAt: artifact.evaluatedAt,
      claims: artifact.claims,
    });
    if (canonicalJsonString(expected) !== canonicalJsonString(artifact)) {
      throw new Error("identity mismatch");
    }
    return artifact;
  } catch {
    throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:artifactIdentity");
  }
}

export function assertMarketUnderstandingArtifactRuntimeShapeV1(
  artifact: MarketUnderstandingArtifactV1,
): void {
  assertPlainEnumerableData(artifact);
}
