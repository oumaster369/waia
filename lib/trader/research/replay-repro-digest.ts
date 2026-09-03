import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import {
  MARKET_UNDERSTANDING_ARTIFACT_V1_SCHEMA_VERSION,
  MARKET_UNDERSTANDING_DERIVATION_DEFINITION_V1,
  MARKET_UNDERSTANDING_ONLY_AUTHORITY_V1,
  MARKET_UNDERSTANDING_QUESTION_MAPPING_V1,
  UNDERSTANDING_CLAIM_KINDS_V1,
  UNDERSTANDING_CLAIM_STATES_V1,
  UNDERSTANDING_CLAIM_V1_SCHEMA_VERSION,
  UNDERSTANDING_COMPUTATION_DISPOSITIONS_V1,
  UNDERSTANDING_EVIDENCE_ROLES_V1,
  assertMarketUnderstandingArtifactV1,
  assertMarketUnderstandingArtifactRuntimeShapeV1,
  type MarketUnderstandingArtifactV1,
  type UnderstandingEvidenceDependencyV1,
} from "@/lib/trader/intelligence/market-understanding-evidence-attribution-v1";
import { CANONICAL_MARKET_QUESTION_IDS } from "@/lib/trader/intelligence/market-understanding.types";
import {
  INFORMATION_ANALYSIS_PURPOSES_V2,
  INFORMATION_QUESTION_IDS_V2,
  INFORMATION_REQUIREMENT_CLASSES_V2,
  INFORMATION_REQUIREMENT_TERMINAL_STATUSES_V2,
} from "@/lib/trader/intelligence/information-sufficiency/information-sufficiency-v2";
import { CANONICAL_PRIMITIVE_OBSERVATION_KINDS_V1 } from "@/lib/trader/mi/canonical-observation-v1";
import type { FusedMarketContext } from "@/lib/trader/market-data/observation-types";
import type { MsvEnvelope } from "@/lib/trader/intelligence/types";
import type { MarketUnderstandingSnapshot } from "@/lib/trader/intelligence/market-understanding.types";

export const MARKET_UNDERSTANDING_REPLAY_IDENTITY_V1_SCHEMA_VERSION =
  "market-understanding-replay-identity-v1" as const;

export type MarketUnderstandingQuestionReplayIdentityV1 = Readonly<{
  marketQuestionId: MarketUnderstandingArtifactV1["claims"][number]["marketQuestionId"];
  informationQuestionId: MarketUnderstandingArtifactV1["claims"][number]["informationQuestionId"];
  claimState: MarketUnderstandingArtifactV1["claims"][number]["claimState"];
  claimKind: MarketUnderstandingArtifactV1["claims"][number]["claimKind"];
  claimContentDigest: string;
  causalLineageDigest: string;
  questionProfileContentDigest: string;
  questionReceiptContentDigest: string;
  evidenceDependencies: readonly UnderstandingEvidenceDependencyV1[];
}>;

export type MarketUnderstandingReplayIdentityV1 = Readonly<{
  schemaVersion: typeof MARKET_UNDERSTANDING_REPLAY_IDENTITY_V1_SCHEMA_VERSION;
  artifactSchemaVersion: MarketUnderstandingArtifactV1["schemaVersion"];
  understandingContentDigest: string;
  causalReproDigest: string;
  derivationDefinitionSchemaVersion: MarketUnderstandingArtifactV1["derivationDefinition"]["schemaVersion"];
  derivationDefinitionContentDigest: string;
  profileId: string;
  profileContentDigest: string;
  sufficiencyReceiptId: string;
  sufficiencyReceiptContentDigest: string;
  evaluatedAt: string;
  questionLineage: readonly MarketUnderstandingQuestionReplayIdentityV1[];
  authority: MarketUnderstandingArtifactV1["authority"];
}>;

const STRIP_KEYS = new Set(["msvId", "generatedAt", "campaignId"]);

function stripVolatile(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripVolatile);
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (STRIP_KEYS.has(key)) {
        continue;
      }
      output[key] = stripVolatile(nested);
    }
    return output;
  }
  return value;
}

export function computeReplayReproContentDigest(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJsonString(stripVolatile(value)), "utf8")
    .digest("hex");
}

function computeExactContentDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJsonString(value), "utf8").digest("hex");
}

function canonicalTextCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

const EXACT_DIGEST = /^[0-9a-f]{64}$/;

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalDigest(value: unknown): boolean {
  return value === null || (typeof value === "string" && EXACT_DIGEST.test(value));
}

function isCanonicalStringList(values: readonly string[]): boolean {
  return (
    values.every(isNonEmpty) &&
    new Set(values).size === values.length &&
    canonicalJsonString(values) === canonicalJsonString([...values].sort(canonicalTextCompare))
  );
}

function evidenceIdentityKey(
  evidence: MarketUnderstandingArtifactV1["evidenceUsed"][number],
): string {
  return [
    evidence.evidenceId,
    evidence.observationId,
    evidence.observationContentDigest,
    evidence.trustRevisionContentDigest ?? "",
    evidence.measurementValueContentDigest ?? "",
  ].join(":");
}

function assertCanonicalEvidenceRef(
  evidence: MarketUnderstandingArtifactV1["evidenceUsed"][number],
): void {
  const measurementIdentity = [
    evidence.measurementDefinitionId,
    evidence.measurementDefinitionContentDigest,
    evidence.measurementValueId,
    evidence.measurementValueContentDigest,
  ];
  const trustIdentity = [
    evidence.trustAsOfReceiptId,
    evidence.trustRevisionId,
    evidence.trustRevisionContentDigest,
  ];
  if (
    !isNonEmpty(evidence.evidenceId) ||
    !isNonEmpty(evidence.evidenceFamily) ||
    !isNonEmpty(evidence.providerId) ||
    !isNonEmpty(evidence.sourceId) ||
    !isNonEmpty(evidence.observationId) ||
    !isNonEmpty(evidence.observationSchemaVersion) ||
    !EXACT_DIGEST.test(evidence.observationContentDigest) ||
    !isOptionalDigest(evidence.trustAsOfReceiptId) ||
    !isOptionalDigest(evidence.trustRevisionContentDigest) ||
    !isOptionalDigest(evidence.measurementDefinitionContentDigest) ||
    !isOptionalDigest(evidence.measurementValueContentDigest) ||
    !isNonEmpty(evidence.dependenceGroup) ||
    !(CANONICAL_PRIMITIVE_OBSERVATION_KINDS_V1 as readonly string[]).includes(
      evidence.observationKind,
    ) ||
    !(["AVAILABLE", "UNAVAILABLE", "REJECTED"] as readonly string[]).includes(
      evidence.availability,
    ) ||
    !( ["TRUSTED", "UNTRUSTED", "UNKNOWN"] as readonly string[]).includes(evidence.trust) ||
    !(
      [
        "PRICE_STATE",
        "CAUSAL",
        "CORROBORATING",
        "EXECUTION_LIQUIDITY",
        "HISTORICAL_ANALOGUE",
      ] as readonly string[]
    ).includes(evidence.epistemicRole) ||
    !(
      ["NOT_HISTORICAL", "DEVELOPMENT", "WALK_FORWARD_PREDICTIVE",
        "ADMISSIBLE_PATTERN_KNOWLEDGE"] as readonly string[]
    ).includes(evidence.historyScope) ||
    !(["NONE", "SUPPORTS", "CONTRADICTS", "UNRESOLVED"] as readonly string[]).includes(
      evidence.contradiction,
    ) ||
    typeof evidence.pitQualified !== "boolean" ||
    typeof evidence.replayEligible !== "boolean" ||
    !Number.isFinite(Date.parse(evidence.availableAt)) ||
    new Date(evidence.availableAt).toISOString() !== evidence.availableAt ||
    (evidence.trustScore !== null &&
      (!Number.isFinite(evidence.trustScore) || evidence.trustScore < 0 || evidence.trustScore > 1)) ||
    !isCanonicalStringList(evidence.degradationReasonCodes) ||
    (evidence.observationKind === "msv_envelope"
      ? trustIdentity.some((value) => value !== null)
      : trustIdentity.some((value) => value === null) || !isNonEmpty(evidence.trustRevisionId)) ||
    (measurementIdentity.some((value) => value !== null) &&
      measurementIdentity.some((value) => value === null)) ||
    (evidence.measurementDefinitionId !== null &&
      (!isNonEmpty(evidence.measurementDefinitionId) || !isNonEmpty(evidence.measurementValueId)))
  ) {
    throw new Error("MARKET_UNDERSTANDING_REPLAY_IDENTITY_INVALID:evidenceIdentity");
  }
}

function isSortedByEvidenceIdentity<T>(
  values: readonly T[],
  resolve: (value: T) => MarketUnderstandingArtifactV1["evidenceUsed"][number],
): boolean {
  return values.every(
    (value, index) =>
      index === 0 ||
      canonicalTextCompare(evidenceIdentityKey(resolve(values[index - 1]!)), evidenceIdentityKey(resolve(value))) <= 0,
  );
}

function computeClaimCausalLineageDigest(
  claim: MarketUnderstandingArtifactV1["claims"][number],
): string {
  const lineageScope = {
    organizationId: claim.scope.organizationId,
    accountId: claim.scope.accountId,
    purpose: claim.scope.purpose,
    symbol: claim.scope.symbol,
    venue: claim.scope.venue,
    analyticalTimeframe: claim.scope.analyticalTimeframe,
    horizon: claim.scope.horizon,
    pitAnchor: claim.scope.pitAnchor,
  };
  return computeExactContentDigest({
    scope: lineageScope,
    marketQuestionId: claim.marketQuestionId,
    informationQuestionId: claim.informationQuestionId,
    claimState: claim.claimState,
    claimKind: claim.claimKind,
    answerSummary: claim.answerSummary,
    computationInputs: claim.computationInputs,
    dependencies: claim.dependencies.filter(
      (dependency) => dependency.disposition === "CONSUMED",
    ),
    effectiveDependenceGroups: claim.effectiveDependenceGroups,
    missingExpectedEvidence: claim.missingExpectedEvidence,
    questionProfileContentDigest: claim.questionProfileContentDigest,
    derivationDefinitionContentDigest: claim.derivationDefinitionContentDigest,
  });
}

/**
 * Re-authenticates the immutable artifact and per-question identities without opening
 * an evidence reader. The DEE-621 profile/receipt was authenticated before the
 * artifact was built; replay/export consumers only reproduce its exact identities.
 */
export function assertMarketUnderstandingReplayArtifactV1(
  artifact: MarketUnderstandingArtifactV1,
): MarketUnderstandingArtifactV1 {
  assertMarketUnderstandingArtifactRuntimeShapeV1(artifact);
  const canonicalQuestionIds = [...CANONICAL_MARKET_QUESTION_IDS].sort(canonicalTextCompare);
  const artifactQuestionIds = artifact.claims.map((claim) => claim.marketQuestionId);
  if (
    artifact.schemaVersion !== MARKET_UNDERSTANDING_ARTIFACT_V1_SCHEMA_VERSION ||
    !isNonEmpty(artifact.scope.organizationId) ||
    (artifact.scope.accountId !== null && !isNonEmpty(artifact.scope.accountId)) ||
    !(INFORMATION_ANALYSIS_PURPOSES_V2 as readonly string[]).includes(artifact.scope.purpose) ||
    !isNonEmpty(artifact.scope.symbol) ||
    !isNonEmpty(artifact.scope.venue) ||
    !isNonEmpty(artifact.scope.analyticalTimeframe) ||
    !isNonEmpty(artifact.scope.horizon) ||
    !Number.isFinite(Date.parse(artifact.scope.pitAnchor)) ||
    new Date(artifact.scope.pitAnchor).toISOString() !== artifact.scope.pitAnchor ||
    !isNonEmpty(artifact.scope.profileId) ||
    !EXACT_DIGEST.test(artifact.scope.profileContentDigest) ||
    artifact.scope.profileId !== artifact.scope.profileContentDigest ||
    !isNonEmpty(artifact.scope.sufficiencyReceiptId) ||
    !EXACT_DIGEST.test(artifact.scope.sufficiencyReceiptContentDigest) ||
    artifact.scope.sufficiencyReceiptId !== artifact.scope.sufficiencyReceiptContentDigest ||
    artifact.evaluatedAt !== artifact.scope.pitAnchor ||
    canonicalJsonString(artifactQuestionIds) !== canonicalJsonString(canonicalQuestionIds) ||
    canonicalJsonString(artifact.derivationDefinition) !==
      canonicalJsonString(MARKET_UNDERSTANDING_DERIVATION_DEFINITION_V1) ||
    canonicalJsonString(artifact.authority) !==
      canonicalJsonString(MARKET_UNDERSTANDING_ONLY_AUTHORITY_V1)
  ) {
    throw new Error("MARKET_UNDERSTANDING_REPLAY_IDENTITY_INVALID:artifactContract");
  }

  const artifactEvidence = [...artifact.evidenceUsed, ...artifact.evidenceIgnored];
  const artifactEvidenceById = new Map(
    artifactEvidence.map((evidence) => [evidence.evidenceId, evidence]),
  );
  for (const evidence of artifactEvidence) assertCanonicalEvidenceRef(evidence);
  if (
    artifactEvidenceById.size !== artifactEvidence.length ||
    !isSortedByEvidenceIdentity(artifact.evidenceUsed, (evidence) => evidence) ||
    !isSortedByEvidenceIdentity(artifact.evidenceIgnored, (evidence) => evidence)
  ) {
    throw new Error("MARKET_UNDERSTANDING_REPLAY_IDENTITY_INVALID:evidencePartition");
  }
  const consumedIds = new Set<string>();
  for (const claim of artifact.claims) {
    const { contentDigest, ...claimBody } = claim;
    const mapping = MARKET_UNDERSTANDING_QUESTION_MAPPING_V1.find(
      (candidate) => candidate.marketQuestionId === claim.marketQuestionId,
    );
    const dependencyIds = claim.dependencies.map(
      (dependency) => dependency.evidence.evidenceId,
    );
    const computationInputPaths = claim.computationInputs.map((entry) => entry.path);
    const missingRequirementIds = claim.missingExpectedEvidence.map(
      (entry) => entry.requirementId,
    );
    const consumedDependencies = claim.dependencies.filter(
      (dependency) => dependency.disposition === "CONSUMED",
    );
    const consumedObservationKeys = consumedDependencies.map(
      (dependency) =>
        `${dependency.evidence.observationId}:${dependency.evidence.observationContentDigest}:${dependency.evidence.measurementValueContentDigest ?? ""}`,
    );
    const hasConsumedContradiction = consumedDependencies.some(
      (dependency) => dependency.role === "CONTRADICTING",
    );
    const hasCausalSupport = consumedDependencies.some(
      (dependency) =>
        dependency.role === "SUPPORTING" && dependency.evidence.epistemicRole === "CAUSAL",
    );
    const hasNonCausalWhySupport = consumedDependencies.some(
      (dependency) =>
        dependency.role === "SUPPORTING" && dependency.evidence.epistemicRole !== "CAUSAL",
    );
    const hasBlockingMissingEvidence = claim.missingExpectedEvidence.some(
      (entry) => entry.blocking,
    );
    const expectedDependenceGroups = [
      ...new Set(consumedDependencies.map((dependency) => dependency.evidence.dependenceGroup)),
    ].sort(canonicalTextCompare);
    const capitalQuestion =
      claim.marketQuestionId === "Q_DEPLOY_CAPITAL" ||
      claim.marketQuestionId === "Q_PRESERVE_CAPITAL";
    const unresolvedNoDependencyState =
      claim.claimState === "UNAVAILABLE" ||
      claim.claimState === "NOT_REQUIRED" ||
      claim.claimState === "NOT_APPLICABLE";
    if (
      claim.schemaVersion !== UNDERSTANDING_CLAIM_V1_SCHEMA_VERSION ||
      !(UNDERSTANDING_CLAIM_STATES_V1 as readonly string[]).includes(claim.claimState) ||
      !(UNDERSTANDING_CLAIM_KINDS_V1 as readonly string[]).includes(claim.claimKind) ||
      !isNonEmpty(claim.answerSummary) ||
      canonicalJsonString(claim.scope) !== canonicalJsonString(artifact.scope) ||
      mapping?.informationQuestionId !== claim.informationQuestionId ||
      (capitalQuestion
        ? claim.claimState !== "NOT_APPLICABLE" ||
          claim.claimKind !== "UNRESOLVED" ||
          consumedDependencies.length !== 0
        : claim.claimState === "NOT_APPLICABLE") ||
      (claim.claimState === "SUPPORTED" &&
        (hasBlockingMissingEvidence ||
          consumedDependencies.length === 0 ||
          hasConsumedContradiction ||
          claim.claimKind === "UNRESOLVED")) ||
      (claim.claimState === "PARTIALLY_SUPPORTED" &&
        (consumedDependencies.length === 0 || claim.claimKind === "UNRESOLVED")) ||
      (claim.claimState === "CONFLICTED" &&
        (consumedDependencies.length === 0 ||
          !hasConsumedContradiction ||
          claim.claimKind === "UNRESOLVED")) ||
      (unresolvedNoDependencyState &&
        (consumedDependencies.length !== 0 || claim.claimKind !== "UNRESOLVED")) ||
      (claim.claimState === "UNKNOWN" && claim.claimKind !== "UNRESOLVED") ||
      (claim.marketQuestionId === "Q_WHY_HAPPENING" && hasNonCausalWhySupport) ||
      (claim.claimKind === "EVIDENCE_SUPPORTED_CAUSAL_ATTRIBUTION" && !hasCausalSupport) ||
      !EXACT_DIGEST.test(claim.contentDigest) ||
      !EXACT_DIGEST.test(claim.causalLineageDigest) ||
      !EXACT_DIGEST.test(claim.questionProfileContentDigest) ||
      !EXACT_DIGEST.test(claim.questionReceiptContentDigest) ||
      !EXACT_DIGEST.test(claim.derivationDefinitionContentDigest) ||
      claim.computationInputs.length === 0 ||
      computationInputPaths.some((path) => !isNonEmpty(path)) ||
      new Set(computationInputPaths).size !== computationInputPaths.length ||
      canonicalJsonString(computationInputPaths) !==
        canonicalJsonString([...computationInputPaths].sort(canonicalTextCompare)) ||
      claim.computationInputs.some((entry) => !EXACT_DIGEST.test(entry.contentDigest)) ||
      !isCanonicalStringList(claim.effectiveDependenceGroups) ||
      canonicalJsonString(claim.effectiveDependenceGroups) !==
        canonicalJsonString(expectedDependenceGroups) ||
      new Set(missingRequirementIds).size !== missingRequirementIds.length ||
      canonicalJsonString(missingRequirementIds) !==
        canonicalJsonString([...missingRequirementIds].sort(canonicalTextCompare)) ||
      claim.missingExpectedEvidence.some(
        (entry) =>
          !isNonEmpty(entry.requirementId) ||
          !(INFORMATION_QUESTION_IDS_V2 as readonly string[]).includes(
            entry.informationQuestionId,
          ) ||
          entry.informationQuestionId !== claim.informationQuestionId ||
          !(INFORMATION_REQUIREMENT_CLASSES_V2 as readonly string[]).includes(
            entry.classification,
          ) ||
          !(INFORMATION_REQUIREMENT_TERMINAL_STATUSES_V2 as readonly string[]).includes(
            entry.terminalStatus,
          ) ||
          entry.terminalStatus === "ANSWERED_SUFFICIENTLY" ||
          typeof entry.blocking !== "boolean" ||
          !isCanonicalStringList(entry.matchedEvidenceIds) ||
          !isCanonicalStringList(entry.acceptedEvidenceIds) ||
          entry.matchedEvidenceIds.some((evidenceId) => !artifactEvidenceById.has(evidenceId)) ||
          entry.acceptedEvidenceIds.some(
            (evidenceId) =>
              !artifactEvidenceById.has(evidenceId) ||
              !entry.matchedEvidenceIds.includes(evidenceId),
          ) ||
          !isCanonicalStringList(entry.reasonCodes),
      ) ||
      claim.dependencies.length !== artifactEvidence.length ||
      new Set(dependencyIds).size !== dependencyIds.length ||
      new Set(consumedObservationKeys).size !== consumedObservationKeys.length ||
      !isSortedByEvidenceIdentity(claim.dependencies, (dependency) => dependency.evidence) ||
      claim.dependencies.some(
        (dependency) =>
          !(UNDERSTANDING_COMPUTATION_DISPOSITIONS_V1 as readonly string[]).includes(
            dependency.disposition,
          ) ||
          (dependency.role !== null &&
            !(UNDERSTANDING_EVIDENCE_ROLES_V1 as readonly string[]).includes(dependency.role)) ||
          canonicalJsonString(artifactEvidenceById.get(dependency.evidence.evidenceId)) !==
            canonicalJsonString(dependency.evidence) ||
          (dependency.disposition === "CONSUMED"
            ? dependency.role === null ||
              dependency.dependencyPaths.length === 0 ||
              dependency.evidence.availability !== "AVAILABLE" ||
              !dependency.evidence.pitQualified ||
              !dependency.evidence.replayEligible ||
              Date.parse(dependency.evidence.availableAt) > Date.parse(artifact.scope.pitAnchor) ||
              !isCanonicalStringList(dependency.dependencyPaths) ||
              dependency.dependencyPaths.some((path) => !computationInputPaths.includes(path)) ||
              ((dependency.evidence.contradiction === "CONTRADICTS" ||
                dependency.evidence.contradiction === "UNRESOLVED") !==
                (dependency.role === "CONTRADICTING")) ||
              (dependency.role === "CORROBORATING" &&
                dependency.evidence.epistemicRole !== "CORROBORATING")
            : dependency.role !== null || dependency.dependencyPaths.length !== 0),
      ) ||
      computeExactContentDigest(claimBody) !== contentDigest ||
      computeClaimCausalLineageDigest(claim) !== claim.causalLineageDigest ||
      claim.derivationDefinitionContentDigest !== artifact.derivationDefinition.contentDigest ||
      canonicalJsonString(claim.authority) !==
        canonicalJsonString(MARKET_UNDERSTANDING_ONLY_AUTHORITY_V1)
    ) {
      throw new Error("MARKET_UNDERSTANDING_REPLAY_IDENTITY_INVALID:questionLineage");
    }
    for (const dependency of claim.dependencies) {
      if (dependency.disposition === "CONSUMED") {
        consumedIds.add(dependency.evidence.evidenceId);
      }
    }
  }
  const evidenceUsedIds = artifact.evidenceUsed
    .map((evidence) => evidence.evidenceId)
    .sort(canonicalTextCompare);
  const evidenceIgnoredIds = artifact.evidenceIgnored
    .map((evidence) => evidence.evidenceId)
    .sort(canonicalTextCompare);
  const expectedUsedIds = [...consumedIds].sort(canonicalTextCompare);
  const expectedIgnoredIds = [...artifactEvidenceById.keys()]
    .filter((evidenceId) => !consumedIds.has(evidenceId))
    .sort(canonicalTextCompare);
  if (
    canonicalJsonString(evidenceUsedIds) !== canonicalJsonString(expectedUsedIds) ||
    canonicalJsonString(evidenceIgnoredIds) !== canonicalJsonString(expectedIgnoredIds)
  ) {
    throw new Error("MARKET_UNDERSTANDING_REPLAY_IDENTITY_INVALID:evidencePartition");
  }

  const { contentDigest, ...artifactBody } = artifact;
  if (computeExactContentDigest(artifactBody) !== contentDigest) {
    throw new Error("MARKET_UNDERSTANDING_REPLAY_IDENTITY_INVALID:artifactContent");
  }
  assertMarketUnderstandingArtifactV1(artifact);
  return artifact;
}

/** Full exact artifact content identity. Unlike the legacy snapshot digest, no field is stripped. */
export function computeUnderstandingArtifactReproDigest(
  artifact: MarketUnderstandingArtifactV1,
): string {
  return assertMarketUnderstandingReplayArtifactV1(artifact).contentDigest;
}

/**
 * Question-causal replay identity. It intentionally excludes profile/receipt ids and
 * ignored evidence, matching the A-wave claim lineage boundary: revising evidence
 * that no computation consumed cannot rewrite historical causal attribution.
 */
export function computeUnderstandingCausalReproDigest(
  artifact: MarketUnderstandingArtifactV1,
): string {
  assertMarketUnderstandingReplayArtifactV1(artifact);
  return computeExactContentDigest({
    schemaVersion: MARKET_UNDERSTANDING_REPLAY_IDENTITY_V1_SCHEMA_VERSION,
    derivationDefinitionContentDigest: artifact.derivationDefinition.contentDigest,
    scope: {
      organizationId: artifact.scope.organizationId,
      accountId: artifact.scope.accountId,
      purpose: artifact.scope.purpose,
      symbol: artifact.scope.symbol,
      venue: artifact.scope.venue,
      analyticalTimeframe: artifact.scope.analyticalTimeframe,
      horizon: artifact.scope.horizon,
      pitAnchor: artifact.scope.pitAnchor,
    },
    questionLineage: artifact.claims
      .map((claim) => ({
        marketQuestionId: claim.marketQuestionId,
        causalLineageDigest: claim.causalLineageDigest,
      }))
      .sort((left, right) =>
        canonicalTextCompare(left.marketQuestionId, right.marketQuestionId),
      ),
  });
}

export function buildMarketUnderstandingReplayIdentityV1(
  artifact: MarketUnderstandingArtifactV1,
): MarketUnderstandingReplayIdentityV1 {
  assertMarketUnderstandingReplayArtifactV1(artifact);
  return {
    schemaVersion: MARKET_UNDERSTANDING_REPLAY_IDENTITY_V1_SCHEMA_VERSION,
    artifactSchemaVersion: artifact.schemaVersion,
    understandingContentDigest: artifact.contentDigest,
    causalReproDigest: computeUnderstandingCausalReproDigest(artifact),
    derivationDefinitionSchemaVersion: artifact.derivationDefinition.schemaVersion,
    derivationDefinitionContentDigest: artifact.derivationDefinition.contentDigest,
    profileId: artifact.scope.profileId,
    profileContentDigest: artifact.scope.profileContentDigest,
    sufficiencyReceiptId: artifact.scope.sufficiencyReceiptId,
    sufficiencyReceiptContentDigest: artifact.scope.sufficiencyReceiptContentDigest,
    evaluatedAt: artifact.evaluatedAt,
    questionLineage: artifact.claims
      .map((claim) => ({
        marketQuestionId: claim.marketQuestionId,
        informationQuestionId: claim.informationQuestionId,
        claimState: claim.claimState,
        claimKind: claim.claimKind,
        claimContentDigest: claim.contentDigest,
        causalLineageDigest: claim.causalLineageDigest,
        questionProfileContentDigest: claim.questionProfileContentDigest,
        questionReceiptContentDigest: claim.questionReceiptContentDigest,
        evidenceDependencies: claim.dependencies,
      }))
      .sort((left, right) =>
        canonicalTextCompare(left.marketQuestionId, right.marketQuestionId),
      ),
    authority: artifact.authority,
  };
}

export function computeFusedContextReproDigest(fused: FusedMarketContext): string {
  return computeReplayReproContentDigest(fused);
}

export function computeMsvReproDigest(msv: MsvEnvelope): string {
  return computeReplayReproContentDigest({
    derived: msv.derived,
    crowd: msv.crowd,
    physics: msv.physics,
    liquidity: msv.liquidity,
  });
}

export function computeUnderstandingReproDigest(
  understanding: MarketUnderstandingSnapshot,
): string {
  return computeReplayReproContentDigest(understanding);
}
