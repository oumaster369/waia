import {
  canonicalizeSemanticJsonString,
  computeSemanticSha256Hex,
} from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { MarketStateSnapshotV2 } from "@/lib/trader/intelligence/predictive-admission";
import {
  requireForecastRuntimeAdmittedPredictiveAdmissionV1,
  type ForecastRuntimeAdmittedPredictiveAdmissionReceiptV1,
  type PredictiveAdmissionReceiptV1,
} from "@/lib/trader/intelligence/predictive-admission";

import {
  type ForecastContractBindingV1,
  requireForecastContractBindingV1,
} from "./forecast-contract-binding-service-v1";
import { computeForecastInputIdentitiesV2 } from "./forecast-contract-foundation-v2";
import { digestHex } from "./identity-digests";
import {
  computeForecastContentDigest,
  computePredictivePackageContentDigest,
  computePredictivePackageGenerationIdentityDigest,
  computeReplicaRootFamilyIdentityDigest,
} from "./identity-digests";
import { computeDistributionSemanticDigest } from "./distribution-semantic-digest-v1";
import { computePoolSemanticDigest } from "./pool-semantic-digest-v1";
import { terminalRhFromOutcome13dV1 } from "./exec-opp-outcome-materializer-v1";
import {
  computeTerminalTargetGridFromDevelopmentReturns,
} from "@/lib/trader/research/benchmark/target-grid-ceremony-v1";
import { TARGET_ROLE_EXECUTION, TARGET_ROLE_TERMINAL } from "./constants";
import {
  isModelTransformReady,
  issueForecastV1,
  fitReplicaArtifactV1,
  computeTerminalTargetGridIdentityDigestHex,
  verifyReplicaPoolReplayV1,
  type ForecastIssuanceV1,
  type PredictivePackageV1,
} from "./rv-state-conditional-empirical-joint-v1";

export const FORECAST_RUNTIME_AUTHORITY_V2_VERSION =
  "waia.trader.forecast_runtime_authority.v2" as const;
const CANONICAL_KNOWLEDGE_EDGE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const FORECAST_RUNTIME_NON_ACTIONABLE_V2_VERSION =
  "waia.trader.forecast_runtime_non_actionable.v2" as const;

export type ForecastRuntimeNonActionableReasonV2 =
  | "MISSING_OR_NOT_ADMITTED"
  | "PREDICTIVE_ADMISSION_MISMATCH"
  | "CONTRACT_BINDING_MISMATCH"
  | "EXECUTABLE_PACKAGE_MISMATCH"
  | "PIT_OR_INPUT_MISMATCH"
  | "FORECAST_ISSUANCE_NON_ACTIONABLE"
  | "FORECAST_REPLAY_MISMATCH";

export type ForecastRuntimeAuthorityV2 = Readonly<{
  schemaVersion: typeof FORECAST_RUNTIME_AUTHORITY_V2_VERSION;
  organizationId: string;
  analysisPurpose: "NEW_OPPORTUNITY" | "OPEN_POSITION_REASSESSMENT";
  anchorClosedBarAt: string;
  anchorClosedBarEpochMs: number;
  anchorRealizedVol20m_1m: number;
  executionHorizonMinutes: number;
  normalizationVersionDigestHex: string;
  marketStateSnapshotContentDigestHex: string;
  predictiveAdmissionReceiptContentDigestHex: string;
  forecastContractBindingContentDigestHex: string;
  scientificAdmissionReceiptContentDigestHex: string;
  selectedPredictivePackageContentDigestHex: string;
  inputContractDigestHex: string;
  modelSpecDigestHex: string;
  modelArtifactDigestHex: string;
  qualifiedInputBindingDigestHex: string;
  runtimeContractDigestHex: string;
  terminalTargetDefinitionDigestHex: string;
  executionOpportunityTargetDefinitionDigestHex: string;
  forecastGenerationIdentityDigestHex: string;
  terminalDistributionSemanticDigestHex: string;
  executionDistributionSemanticDigestHex: string;
  terminalForecastContentDigestHex: string;
  executionForecastContentDigestHex: string;
  knowledgeEdgeId: string;
  knowledgeContentDigestHex: string;
  contentDigestHex: string;
}>;

export type ForecastRuntimeNonActionableV2 = Readonly<{
  schemaVersion: typeof FORECAST_RUNTIME_NON_ACTIONABLE_V2_VERSION;
  status: "NON_ACTIONABLE";
  capitalAuthority: "NONE";
  reason: ForecastRuntimeNonActionableReasonV2;
  predictiveAdmissionReceiptContentDigestHex: string | null;
  marketStateSnapshotContentDigestHex: string | null;
  selectedPredictivePackageContentDigestHex: string | null;
  upstreamReasonCodes: readonly string[];
  contentDigestHex: string;
}>;

export type ForecastRuntimeInputV2 = Readonly<{
  predictiveAdmissionReceipt: PredictiveAdmissionReceiptV1 | null;
  marketStateSnapshot: MarketStateSnapshotV2 | null;
  forecastContractBinding: ForecastContractBindingV1 | null;
  predictivePackage: PredictivePackageV1 | null;
  executionHorizonMinutes: number;
  normalizationVersionDigestHex: string;
  /** Issuance-time Knowledge identity; late outcome-time inference is prohibited. */
  knowledgeEdgeId?: string;
  knowledgeContentDigestHex?: string;
}>;

export type ForecastRuntimeOutcomeV2 =
  | Readonly<{
      status: "FORECAST_AUTHORIZED";
      authority: ForecastRuntimeAuthorityV2;
      issuance: ForecastIssuanceV1;
    }>
  | ForecastRuntimeNonActionableV2;

export type ForecastRuntimeAuthorizedOutcomeV2 = Extract<
  ForecastRuntimeOutcomeV2,
  { status: "FORECAST_AUTHORIZED" }
>;

function nonActionable(
  input: ForecastRuntimeInputV2,
  reason: ForecastRuntimeNonActionableReasonV2,
  upstreamReasonCodes: readonly string[] = [],
): ForecastRuntimeNonActionableV2 {
  const body = {
    schemaVersion: FORECAST_RUNTIME_NON_ACTIONABLE_V2_VERSION,
    status: "NON_ACTIONABLE" as const,
    capitalAuthority: "NONE" as const,
    reason,
    predictiveAdmissionReceiptContentDigestHex:
      input.predictiveAdmissionReceipt?.contentDigestHex ?? null,
    marketStateSnapshotContentDigestHex: input.marketStateSnapshot?.contentDigestHex ?? null,
    selectedPredictivePackageContentDigestHex:
      input.forecastContractBinding?.selectedPredictivePackageContentDigestHex ?? null,
    upstreamReasonCodes: [...new Set(upstreamReasonCodes)].sort(),
  };
  return { ...body, contentDigestHex: computeSemanticSha256Hex(body) };
}

function requireSnapshotIdentity(
  snapshot: MarketStateSnapshotV2,
  admission: ForecastRuntimeAdmittedPredictiveAdmissionReceiptV1,
  binding: ForecastContractBindingV1,
): number {
  const { contentDigestHex, ...body } = snapshot;
  if (
    computeSemanticSha256Hex(body) !== contentDigestHex ||
    contentDigestHex !== admission.marketStateSnapshotContentDigestHex ||
    snapshot.qualifiedInputBindingDigestHex !== admission.qualifiedInputBindingDigestHex ||
    snapshot.analysisPurpose !== admission.analysisPurpose ||
    snapshot.pitAnchor !== admission.pitAnchor ||
    snapshot.organizationId !== binding.organizationId
  ) {
    throw new Error("FORECAST_RUNTIME_SNAPSHOT_MISMATCH");
  }
  const identities = computeForecastInputIdentitiesV2({
    contract: binding.inputContract,
    anchorClosedBarAt: snapshot.pitAnchor,
    predictors: { anchorRealizedVol20m_1m: snapshot.anchorRealizedVol20m_1m },
    hypothesisAssessmentContentDigestHex: snapshot.hypothesisAssessmentSetDigestHex,
  });
  if (
    identities.mathematicalInputDigestHex !== snapshot.mathematicalInputDigestHex ||
    identities.applicabilityPrerequisiteDigestHex !==
      snapshot.applicabilityPrerequisiteDigestHex ||
    identities.qualifiedInputBindingDigestHex !== snapshot.qualifiedInputBindingDigestHex
  ) {
    throw new Error("FORECAST_RUNTIME_INPUT_IDENTITY_MISMATCH");
  }
  const epoch = Date.parse(snapshot.pitAnchor);
  if (!Number.isSafeInteger(epoch) || new Date(epoch).toISOString() !== snapshot.pitAnchor) {
    throw new Error("FORECAST_RUNTIME_ANCHOR_INVALID");
  }
  return epoch;
}

function requirePackageIdentity(
  pkg: PredictivePackageV1,
  binding: ForecastContractBindingV1,
  snapshot: MarketStateSnapshotV2,
  executionHorizonMinutes: number,
  normalizationVersionDigestHex: string,
): void {
  const root = computeReplicaRootFamilyIdentityDigest(pkg.family);
  const generation = computePredictivePackageGenerationIdentityDigest({
    replicaRootFamilyIdentityDigestHex: digestHex(root),
    kConfigDec: pkg.kConfigDec,
    mConfigDec: pkg.mConfigDec,
    alphaEpiConfigScale8: pkg.alphaEpiConfigScale8,
  });
  const content = computePredictivePackageContentDigest(
    generation,
    pkg.replicaArtifacts.map((artifact) => artifact.replicaArtifactDigest),
  );
  const horizon = Number(snapshot.horizon.replace(/m$/, ""));
  if (
    !root.equals(pkg.replicaRootFamilyIdentityDigest) ||
    !generation.equals(pkg.predictivePackageGenerationIdentityDigest) ||
    !content.equals(pkg.predictivePackageContentDigest) ||
    !isModelTransformReady(pkg) ||
    digestHex(content) !== binding.selectedPredictivePackageContentDigestHex ||
    pkg.family.organizationId !== binding.organizationId ||
    pkg.family.venue !== snapshot.venue ||
    pkg.family.symbol !== snapshot.symbol ||
    pkg.family.modelTransformVersion !== binding.modelSpec.modelTransformVersion ||
    pkg.family.developmentDatasetDigestHex !==
      binding.modelArtifact.developmentDatasetDigestHex ||
    digestHex(pkg.runtimeContractDigest) !== binding.modelArtifact.runtimeContractDigestHex ||
    pkg.family.terminalTargetDefinitionDigestHex !==
      binding.modelSpec.terminalTargetDefinitionDigestHex ||
    pkg.family.executionOpportunityTargetDefinitionDigestHex !==
      binding.modelSpec.executionOpportunityTargetDefinitionDigestHex ||
    pkg.family.primaryHorizonMinutes !== horizon ||
    pkg.family.executionHorizonMinutes !== executionHorizonMinutes ||
    pkg.family.normalizationVersionDigestHex !== normalizationVersionDigestHex
  ) {
    throw new Error("FORECAST_RUNTIME_PACKAGE_MISMATCH");
  }
  const expectedTargetGrid = computeTerminalTargetGridFromDevelopmentReturns(
    pkg.canonicalSourceCorpus.map((source) => terminalRhFromOutcome13dV1(source.outcome13d)),
  );
  if (
    !isDeepStrictEqual(expectedTargetGrid, pkg.terminalTargetGrid) ||
    computeTerminalTargetGridIdentityDigestHex(expectedTargetGrid) !==
      pkg.terminalTargetGridIdentityDigestHex
  ) {
    throw new Error("FORECAST_RUNTIME_PACKAGE_TARGET_GRID_MISMATCH");
  }
  if (pkg.replicaArtifacts.length !== pkg.kConfigDec) {
    throw new Error("FORECAST_RUNTIME_PACKAGE_REPLICA_COUNT_MISMATCH");
  }
  for (const [replicaOrdinal, artifact] of pkg.replicaArtifacts.entries()) {
    if (artifact.replicaOrdinal !== replicaOrdinal) {
      throw new Error("FORECAST_RUNTIME_PACKAGE_REPLICA_ORDINAL_MISMATCH");
    }
    const refit = fitReplicaArtifactV1({
      family: pkg.family,
      canonicalSourceCorpus: pkg.canonicalSourceCorpus,
      replicaRootFamilyIdentityDigest: root,
      replicaOrdinal: artifact.replicaOrdinal,
    });
    if (!isDeepStrictEqual(refit, artifact)) {
      throw new Error("FORECAST_RUNTIME_PACKAGE_ARTIFACT_MISMATCH");
    }
    const poolDigests = (["S0", "S1", "S2"] as const).map((stateId) =>
      computePoolSemanticDigest({
        organizationId: pkg.family.organizationId,
        venue: pkg.family.venue,
        market: pkg.family.market,
        symbol: pkg.family.symbol,
        primaryHorizonMinutes: pkg.family.primaryHorizonMinutes,
        replicaOrdinal: artifact.replicaOrdinal,
        stateId,
        developmentDatasetDigestHex: pkg.family.developmentDatasetDigestHex,
        observations: artifact.pools[stateId],
      }),
    );
    if (
      artifact.nS0 !== artifact.pools.S0.length ||
      artifact.nS1 !== artifact.pools.S1.length ||
      artifact.nS2 !== artifact.pools.S2.length ||
      !poolDigests[0].equals(artifact.poolSemanticDigestS0) ||
      !poolDigests[1].equals(artifact.poolSemanticDigestS1) ||
      !poolDigests[2].equals(artifact.poolSemanticDigestS2)
    ) {
      throw new Error("FORECAST_RUNTIME_PACKAGE_POOL_MISMATCH");
    }
    verifyReplicaPoolReplayV1({
      family: pkg.family,
      canonicalSourceCorpus: pkg.canonicalSourceCorpus,
      artifact,
    });
  }
}

function replayIssuance(issuance: ForecastIssuanceV1): void {
  const common = {
    forecastGenerationIdentityDigestHex: digestHex(issuance.forecastGenerationIdentityDigest),
    predictivePackageContentDigestHex: digestHex(
      issuance.package.predictivePackageContentDigest,
    ),
    k: issuance.package.kConfigDec,
    m: issuance.package.mConfigDec,
    normalizationVersionDigestHex: issuance.normalizationVersionDigestHex,
    samples: issuance.samples,
  };
  const terminal = computeDistributionSemanticDigest({
    ...common,
    targetRoleId: TARGET_ROLE_TERMINAL,
  });
  const execution = computeDistributionSemanticDigest({
    ...common,
    targetRoleId: TARGET_ROLE_EXECUTION,
  });
  if (
    !terminal.equals(issuance.distributionSemanticDigestTerminal) ||
    !execution.equals(issuance.distributionSemanticDigestExec) ||
    !computeForecastContentDigest(
      issuance.forecastGenerationIdentityDigest,
      terminal,
    ).equals(issuance.forecastContentDigestTerminal) ||
    !computeForecastContentDigest(
      issuance.forecastGenerationIdentityDigest,
      execution,
    ).equals(issuance.forecastContentDigestExec)
  ) {
    throw new Error("FORECAST_RUNTIME_REPLAY_MISMATCH");
  }
}

export function issueForecastRuntimeV2(input: ForecastRuntimeInputV2): ForecastRuntimeOutcomeV2 {
  if (
    !input.predictiveAdmissionReceipt ||
    !input.marketStateSnapshot ||
    !input.forecastContractBinding ||
    !input.predictivePackage
  ) {
    return nonActionable(
      input,
      "MISSING_OR_NOT_ADMITTED",
      input.predictiveAdmissionReceipt?.blockingReasons,
    );
  }
  if (
    !input.knowledgeEdgeId ||
    !CANONICAL_KNOWLEDGE_EDGE_UUID.test(input.knowledgeEdgeId) ||
    !input.knowledgeContentDigestHex ||
    !/^[0-9a-f]{64}$/.test(input.knowledgeContentDigestHex)
  ) {
    return nonActionable(input, "PIT_OR_INPUT_MISMATCH");
  }

  let admission: ForecastRuntimeAdmittedPredictiveAdmissionReceiptV1;
  try {
    admission = requireForecastRuntimeAdmittedPredictiveAdmissionV1(
      input.predictiveAdmissionReceipt,
    );
  } catch {
    return nonActionable(
      input,
      "MISSING_OR_NOT_ADMITTED",
      input.predictiveAdmissionReceipt.blockingReasons,
    );
  }

  let binding: ForecastContractBindingV1;
  try {
    binding = requireForecastContractBindingV1(input.forecastContractBinding);
    if (
      admission.selectedPredictivePackageContentDigestHex !==
        binding.selectedPredictivePackageContentDigestHex ||
      admission.scientificAdmissionReceiptContentDigestHex !==
        binding.scientificAdmissionReceiptContentDigestHex ||
      admission.inputContractDigestHex !== binding.inputContract.contentDigestHex ||
      admission.modelSpecDigestHex !== binding.modelSpec.contentDigestHex ||
      admission.modelArtifactDigestHex !== binding.modelArtifact.contentDigestHex
    ) {
      throw new Error("FORECAST_RUNTIME_BINDING_MISMATCH");
    }
  } catch {
    return nonActionable(input, "CONTRACT_BINDING_MISMATCH");
  }

  let anchorClosedBarEpochMs: number;
  try {
    anchorClosedBarEpochMs = requireSnapshotIdentity(
      input.marketStateSnapshot,
      admission,
      binding,
    );
  } catch {
    return nonActionable(input, "PIT_OR_INPUT_MISMATCH");
  }

  try {
    requirePackageIdentity(
      input.predictivePackage,
      binding,
      input.marketStateSnapshot,
      input.executionHorizonMinutes,
      input.normalizationVersionDigestHex,
    );
  } catch {
    return nonActionable(input, "EXECUTABLE_PACKAGE_MISMATCH");
  }

  let issuance: ForecastIssuanceV1;
  try {
    issuance = issueForecastV1({
      pkg: input.predictivePackage,
      anchorClosedBarEpochMs,
      anchorRealizedVol20m_1m: input.marketStateSnapshot.anchorRealizedVol20m_1m,
      executionHorizonMinutes: input.executionHorizonMinutes,
      normalizationVersionDigestHex: input.normalizationVersionDigestHex,
    });
  } catch (error) {
    return nonActionable(input, "FORECAST_ISSUANCE_NON_ACTIONABLE", [
      error instanceof Error ? error.message : "FORECAST_ISSUANCE_FAILED",
    ]);
  }
  if (!issuance.actionable) {
    return nonActionable(
      input,
      "FORECAST_ISSUANCE_NON_ACTIONABLE",
      issuance.reasonCodes,
    );
  }
  if (admission.analysisPurpose === "RESEARCH_NON_CAPITAL") {
    return nonActionable(input, "MISSING_OR_NOT_ADMITTED");
  }
  try {
    replayIssuance(issuance);
  } catch {
    return nonActionable(input, "FORECAST_REPLAY_MISMATCH");
  }

  const body = {
    schemaVersion: FORECAST_RUNTIME_AUTHORITY_V2_VERSION,
    organizationId: binding.organizationId,
    analysisPurpose: admission.analysisPurpose,
    anchorClosedBarAt: admission.pitAnchor,
    anchorClosedBarEpochMs,
    anchorRealizedVol20m_1m: input.marketStateSnapshot.anchorRealizedVol20m_1m,
    executionHorizonMinutes: input.executionHorizonMinutes,
    normalizationVersionDigestHex: input.normalizationVersionDigestHex,
    marketStateSnapshotContentDigestHex: input.marketStateSnapshot.contentDigestHex,
    predictiveAdmissionReceiptContentDigestHex: admission.contentDigestHex,
    forecastContractBindingContentDigestHex: binding.contentDigestHex,
    scientificAdmissionReceiptContentDigestHex:
      binding.scientificAdmissionReceiptContentDigestHex,
    selectedPredictivePackageContentDigestHex:
      binding.selectedPredictivePackageContentDigestHex,
    inputContractDigestHex: binding.inputContract.contentDigestHex,
    modelSpecDigestHex: binding.modelSpec.contentDigestHex,
    modelArtifactDigestHex: binding.modelArtifact.contentDigestHex,
    qualifiedInputBindingDigestHex: admission.qualifiedInputBindingDigestHex,
    runtimeContractDigestHex: digestHex(issuance.package.runtimeContractDigest),
    terminalTargetDefinitionDigestHex:
      binding.modelSpec.terminalTargetDefinitionDigestHex,
    executionOpportunityTargetDefinitionDigestHex:
      binding.modelSpec.executionOpportunityTargetDefinitionDigestHex,
    forecastGenerationIdentityDigestHex: digestHex(issuance.forecastGenerationIdentityDigest),
    terminalDistributionSemanticDigestHex: digestHex(
      issuance.distributionSemanticDigestTerminal,
    ),
    executionDistributionSemanticDigestHex: digestHex(issuance.distributionSemanticDigestExec),
    terminalForecastContentDigestHex: digestHex(issuance.forecastContentDigestTerminal),
    executionForecastContentDigestHex: digestHex(issuance.forecastContentDigestExec),
    knowledgeEdgeId: input.knowledgeEdgeId,
    knowledgeContentDigestHex: input.knowledgeContentDigestHex,
  };
  const authority = { ...body, contentDigestHex: computeSemanticSha256Hex(body) };
  return { status: "FORECAST_AUTHORIZED", authority, issuance };
}

export function requireForecastRuntimeAuthorityV2(
  value: ForecastRuntimeAuthorityV2,
): ForecastRuntimeAuthorityV2 {
  const { contentDigestHex, ...body } = value;
  const digestValues = Object.entries(value)
    .filter(([key]) => key.endsWith("DigestHex"))
    .map(([, digest]) => digest);
  if (
    value.schemaVersion !== FORECAST_RUNTIME_AUTHORITY_V2_VERSION ||
    (value.analysisPurpose !== "NEW_OPPORTUNITY" &&
      value.analysisPurpose !== "OPEN_POSITION_REASSESSMENT") ||
    !Number.isSafeInteger(value.anchorClosedBarEpochMs) ||
    !Number.isFinite(new Date(value.anchorClosedBarEpochMs).getTime()) ||
    new Date(value.anchorClosedBarEpochMs).toISOString() !== value.anchorClosedBarAt ||
    !Number.isFinite(value.anchorRealizedVol20m_1m) ||
    !Number.isSafeInteger(value.executionHorizonMinutes) ||
    value.executionHorizonMinutes <= 0 ||
    !CANONICAL_KNOWLEDGE_EDGE_UUID.test(value.knowledgeEdgeId) ||
    digestValues.some(
      (digest) => typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest),
    ) ||
    computeSemanticSha256Hex(body) !== contentDigestHex
  ) {
    throw new Error("FORECAST_RUNTIME_AUTHORITY_INVALID");
  }
  return value;
}

export function requireForecastRuntimeAuthorizedOutcomeV2(
  value: ForecastRuntimeAuthorizedOutcomeV2,
): ForecastRuntimeAuthorizedOutcomeV2 {
  const authority = requireForecastRuntimeAuthorityV2(value.authority);
  let regenerated: ForecastIssuanceV1;
  try {
    replayIssuance(value.issuance);
    const pkg = value.issuance.package;
    const root = computeReplicaRootFamilyIdentityDigest(pkg.family);
    const generation = computePredictivePackageGenerationIdentityDigest({
      replicaRootFamilyIdentityDigestHex: digestHex(root),
      kConfigDec: pkg.kConfigDec,
      mConfigDec: pkg.mConfigDec,
      alphaEpiConfigScale8: pkg.alphaEpiConfigScale8,
    });
    const content = computePredictivePackageContentDigest(
      generation,
      pkg.replicaArtifacts.map((artifact) => artifact.replicaArtifactDigest),
    );
    const expectedTargetGrid = computeTerminalTargetGridFromDevelopmentReturns(
      pkg.canonicalSourceCorpus.map((source) =>
        terminalRhFromOutcome13dV1(source.outcome13d),
      ),
    );
    if (
      pkg.replicaArtifacts.length !== pkg.kConfigDec ||
      !root.equals(pkg.replicaRootFamilyIdentityDigest) ||
      !generation.equals(pkg.predictivePackageGenerationIdentityDigest) ||
      !content.equals(pkg.predictivePackageContentDigest) ||
      digestHex(content) !== authority.selectedPredictivePackageContentDigestHex ||
      !isDeepStrictEqual(expectedTargetGrid, pkg.terminalTargetGrid) ||
      computeTerminalTargetGridIdentityDigestHex(expectedTargetGrid) !==
        pkg.terminalTargetGridIdentityDigestHex
    ) {
      throw new Error("target-grid");
    }
    for (const [replicaOrdinal, artifact] of pkg.replicaArtifacts.entries()) {
      if (artifact.replicaOrdinal !== replicaOrdinal) throw new Error("ordinal");
      const refit = fitReplicaArtifactV1({
        family: pkg.family,
        canonicalSourceCorpus: pkg.canonicalSourceCorpus,
        replicaRootFamilyIdentityDigest: root,
        replicaOrdinal: artifact.replicaOrdinal,
      });
      if (!isDeepStrictEqual(refit, artifact)) throw new Error("artifact");
    }
    regenerated = issueForecastV1({
      pkg,
      anchorClosedBarEpochMs: authority.anchorClosedBarEpochMs,
      anchorRealizedVol20m_1m: authority.anchorRealizedVol20m_1m,
      executionHorizonMinutes: authority.executionHorizonMinutes,
      normalizationVersionDigestHex: authority.normalizationVersionDigestHex,
    });
    if (!isDeepStrictEqual(regenerated, value.issuance)) throw new Error("issuance");
  } catch {
    throw new Error("FORECAST_RUNTIME_AUTHORIZED_OUTCOME_INVALID:replay");
  }
  if (
    authority.organizationId !== value.issuance.organizationId ||
    authority.anchorClosedBarEpochMs !== value.issuance.anchorClosedBarEpochMs ||
    authority.anchorRealizedVol20m_1m !== value.issuance.anchorRealizedVol20m_1m ||
    authority.executionHorizonMinutes !== value.issuance.executionHorizonMinutes ||
    authority.normalizationVersionDigestHex !== value.issuance.normalizationVersionDigestHex ||
    authority.selectedPredictivePackageContentDigestHex !==
      digestHex(value.issuance.package.predictivePackageContentDigest) ||
    authority.runtimeContractDigestHex !==
      digestHex(value.issuance.package.runtimeContractDigest) ||
    authority.forecastGenerationIdentityDigestHex !==
      digestHex(value.issuance.forecastGenerationIdentityDigest) ||
    authority.terminalDistributionSemanticDigestHex !==
      digestHex(value.issuance.distributionSemanticDigestTerminal) ||
    authority.executionDistributionSemanticDigestHex !==
      digestHex(value.issuance.distributionSemanticDigestExec) ||
    authority.terminalForecastContentDigestHex !==
      digestHex(value.issuance.forecastContentDigestTerminal) ||
    authority.executionForecastContentDigestHex !==
      digestHex(value.issuance.forecastContentDigestExec) ||
    authority.terminalTargetDefinitionDigestHex !==
      value.issuance.package.family.terminalTargetDefinitionDigestHex ||
    authority.executionOpportunityTargetDefinitionDigestHex !==
      value.issuance.package.family.executionOpportunityTargetDefinitionDigestHex
  ) {
    throw new Error("FORECAST_RUNTIME_AUTHORIZED_OUTCOME_INVALID:binding");
  }
  return value;
}

export function serializeForecastRuntimeAuthorityV2(value: ForecastRuntimeAuthorityV2): string {
  return canonicalizeSemanticJsonString(requireForecastRuntimeAuthorityV2(value));
}
import { isDeepStrictEqual } from "node:util";
