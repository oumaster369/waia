import {
  canonicalizeSemanticJsonString,
  computeSemanticSha256Hex,
} from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { historicalInstrumentsMatch } from
  "@/lib/trader/symbols/historical-instrument";
import {
  assertInformationSufficiencyReceiptV2,
  assertRequiredInformationProfileV2,
} from "@/lib/trader/intelligence/information-sufficiency/information-sufficiency-v2";
import type { InformationSufficiencyRuntimeAuthorityV2 } from
  "@/lib/trader/intelligence/information-sufficiency/information-sufficiency-runtime-authority-v2";
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
import {
  assertHistoricalKnowledgeSnapshotAuthorityV2,
  type HistoricalKnowledgeSnapshotAuthorityV2,
} from "./historical-knowledge-snapshot-authority-v2";
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
export const HISTORICAL_INTELLIGENCE_CYCLE_AUTHORITY_V2 =
  "waia.trader.historical_intelligence_cycle_authority.v2" as const;

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
  informationSufficiencyProfileContentDigestHex?: string;
  informationSufficiencyReceiptContentDigestHex?: string;
  historicalIntelligenceCycleAuthorityContentDigestHex?: string;
  historicalKnowledgeSnapshotAuthorityContentDigestHex?: string;
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

export type HistoricalIntelligenceCycleAuthorityV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_INTELLIGENCE_CYCLE_AUTHORITY_V2;
  organizationId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  pitAnchor: string;
  envelopeId: string;
  envelopeContentDigestHex: string;
  inputSemanticDigestHex: string;
  understandingArtifactContentDigestHex: string;
  understandingArtifactSemanticDigestHex: string;
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
  /** Exact epistemic profile/receipt used to build the admitted market state. */
  informationSufficiencyAuthority?: InformationSufficiencyRuntimeAuthorityV2;
  /** Exact durable causal cycle consumed by a historical Forecast. */
  historicalIntelligenceCycleAuthority?: HistoricalIntelligenceCycleAuthorityV2;
  /** Exact run-scoped durable knowledge rows visible at this historical PIT. */
  historicalKnowledgeSnapshotAuthority?: HistoricalKnowledgeSnapshotAuthorityV2;
}>;

export function assertHistoricalIntelligenceCycleAuthorityV2(
  value: HistoricalIntelligenceCycleAuthorityV2,
): HistoricalIntelligenceCycleAuthorityV2 {
  const expectedKeys = [
    "schemaVersion", "organizationId", "runId", "cycleId", "symbol", "pitAnchor",
    "envelopeId", "envelopeContentDigestHex", "inputSemanticDigestHex",
    "understandingArtifactContentDigestHex", "understandingArtifactSemanticDigestHex",
    "contentDigestHex",
  ].sort();
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys)) {
    throw new Error("FORECAST_RUNTIME_HISTORICAL_CYCLE_AUTHORITY_INVALID");
  }
  const { contentDigestHex, ...body } = value;
  if (value.schemaVersion !== HISTORICAL_INTELLIGENCE_CYCLE_AUTHORITY_V2 ||
      !value.organizationId || !value.runId || !value.cycleId || !value.symbol ||
      !/^[0-9a-f-]{36}$/.test(value.envelopeId) ||
      new Date(value.pitAnchor).toISOString() !== value.pitAnchor ||
      [value.envelopeContentDigestHex, value.inputSemanticDigestHex,
        value.understandingArtifactContentDigestHex,
        value.understandingArtifactSemanticDigestHex, contentDigestHex]
        .some((digest) => !/^[0-9a-f]{64}$/.test(digest)) ||
      computeSemanticSha256Hex(body) !== contentDigestHex) {
    throw new Error("FORECAST_RUNTIME_HISTORICAL_CYCLE_AUTHORITY_INVALID");
  }
  return value;
}

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
    snapshot.organizationId !== binding.organizationId ||
    !historicalInstrumentsMatch(snapshot.instrumentId, snapshot.symbol)
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

  const historicalPackage = input.predictivePackage.family.packageSubjectVersion ===
    "waia.trader.historical_forecast_family_bootstrap.v2";
  let informationProfileDigestHex: string | null = null;
  let informationReceiptDigestHex: string | null = null;
  let historicalCycleAuthorityDigestHex: string | null = null;
  let historicalKnowledgeSnapshotAuthorityDigestHex: string | null = null;
  try {
    const informationAuthority = input.informationSufficiencyAuthority;
    if (historicalPackage && (!informationAuthority ||
        informationAuthority.kind !== "PROFILE_RECEIPT")) {
      throw new Error("missing historical information authority");
    }
    if (informationAuthority?.kind === "PROFILE_RECEIPT") {
      const profile = assertRequiredInformationProfileV2(informationAuthority.profile);
      const receipt = assertInformationSufficiencyReceiptV2(
        informationAuthority.receipt,
        profile,
      );
      const historical = receipt.evidenceInventory
        .filter((evidence) => evidence.historyScope === "WALK_FORWARD_PREDICTIVE")
        .map((evidence) => evidence.historicalDatasetTrustAuthority);
      if (informationAuthority.organizationId !== input.marketStateSnapshot.organizationId ||
          profile.organizationId !== input.marketStateSnapshot.organizationId ||
          receipt.organizationId !== input.marketStateSnapshot.organizationId ||
          profile.contentDigest !== input.marketStateSnapshot.requiredInformationProfileDigestHex ||
          receipt.contentDigest !==
            input.marketStateSnapshot.informationSufficiencyReceiptDigestHex ||
          receipt.pitAnchor !== input.marketStateSnapshot.pitAnchor ||
          !historicalInstrumentsMatch(profile.symbol, input.marketStateSnapshot.symbol) ||
          !historicalInstrumentsMatch(receipt.symbol, input.marketStateSnapshot.symbol)) {
        throw new Error("information authority scope mismatch");
      }
      // The evidence itself is the authority-class discriminator. A caller may not
      // downgrade a historical package to GENERAL while retaining a self-consistent
      // historical profile/receipt and thereby skip its 0194 and cycle proofs.
      if (!historicalPackage && historical.length > 0) {
        throw new Error("historical evidence on general package");
      }
      if (historicalPackage) {
        if (historical.length !== 1 || historical.some((authority) =>
          !authority || authority.organizationId !== receipt.organizationId ||
          !historicalInstrumentsMatch(authority.symbol, receipt.symbol) ||
          authority.publicAvailableAt !== receipt.pitAnchor)) {
          throw new Error("historical information authority mismatch");
        }
        const first = historical[0]!;
        if (historical.some((authority) =>
          authority!.runId !== first.runId || authority!.releaseSha !== first.releaseSha ||
          authority!.ratifiedAdmissionId !== first.ratifiedAdmissionId ||
          authority!.ratifiedAdmissionContentDigestHex !==
            first.ratifiedAdmissionContentDigestHex ||
          authority!.epistemicRecordCutoff !== first.epistemicRecordCutoff)) {
          throw new Error("historical information authority cohort mismatch");
        }
      }
      informationProfileDigestHex = profile.contentDigest;
      informationReceiptDigestHex = receipt.contentDigest;
    }
    const cycleAuthority = input.historicalIntelligenceCycleAuthority;
    if (historicalPackage && !cycleAuthority) {
      throw new Error("missing historical intelligence cycle authority");
    }
    if (cycleAuthority) {
      const sealedCycle = assertHistoricalIntelligenceCycleAuthorityV2(cycleAuthority);
      if (!historicalPackage ||
          sealedCycle.organizationId !== input.marketStateSnapshot.organizationId ||
          sealedCycle.pitAnchor !== input.marketStateSnapshot.pitAnchor ||
          !historicalInstrumentsMatch(
            sealedCycle.symbol,
            input.marketStateSnapshot.instrumentId,
          ) ||
          sealedCycle.understandingArtifactSemanticDigestHex !==
            input.marketStateSnapshot.understandingClaimSetDigestHex) {
        throw new Error("historical intelligence cycle authority mismatch");
      }
      historicalCycleAuthorityDigestHex = sealedCycle.contentDigestHex;
    }
    const knowledgeSnapshotAuthority = input.historicalKnowledgeSnapshotAuthority;
    if (historicalPackage && !knowledgeSnapshotAuthority) {
      throw new Error("missing historical knowledge snapshot authority");
    }
    if (knowledgeSnapshotAuthority) {
      const sealedKnowledge = assertHistoricalKnowledgeSnapshotAuthorityV2(
        knowledgeSnapshotAuthority,
      );
      if (!historicalPackage ||
          !cycleAuthority || sealedKnowledge.runId !== cycleAuthority.runId ||
          sealedKnowledge.organizationId !== input.marketStateSnapshot.organizationId ||
          sealedKnowledge.pitAnchor !== input.marketStateSnapshot.pitAnchor ||
          !historicalInstrumentsMatch(
            sealedKnowledge.symbol,
            input.marketStateSnapshot.instrumentId,
          ) || sealedKnowledge.knowledgeContentDigestHex !== input.knowledgeContentDigestHex) {
        throw new Error("historical knowledge snapshot authority mismatch");
      }
      historicalKnowledgeSnapshotAuthorityDigestHex = sealedKnowledge.contentDigestHex;
    }
  } catch {
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
    ...(historicalPackage && informationProfileDigestHex && informationReceiptDigestHex
      ? {
          informationSufficiencyProfileContentDigestHex: informationProfileDigestHex,
          informationSufficiencyReceiptContentDigestHex: informationReceiptDigestHex,
        }
      : {}),
    ...(historicalPackage && historicalCycleAuthorityDigestHex
      ? {
          historicalIntelligenceCycleAuthorityContentDigestHex:
            historicalCycleAuthorityDigestHex,
        }
      : {}),
    ...(historicalPackage && historicalKnowledgeSnapshotAuthorityDigestHex
      ? {
          historicalKnowledgeSnapshotAuthorityContentDigestHex:
            historicalKnowledgeSnapshotAuthorityDigestHex,
        }
      : {}),
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
  // PostgreSQL jsonb receives Node Buffers through their standard
  // `{ type: "Buffer", data: [...] }` JSON representation. Rehydrate that canonical wire form
  // before replay validation; accepting it here keeps every durable loader on the same validator.
  // Preserve object identity for already-canonical in-memory outcomes.
  if (containsForecastRuntimeBufferWireV2(value)) {
    value = reviveForecastRuntimeJsonV2(value);
  }
  const authority = requireForecastRuntimeAuthorityV2(value.authority);
  const historicalPackage = value.issuance.package.family.packageSubjectVersion ===
    "waia.trader.historical_forecast_family_bootstrap.v2";
  const hasInformationProfile = Object.prototype.hasOwnProperty.call(
    authority,
    "informationSufficiencyProfileContentDigestHex",
  );
  const hasInformationReceipt = Object.prototype.hasOwnProperty.call(
    authority,
    "informationSufficiencyReceiptContentDigestHex",
  );
  const hasHistoricalCycleAuthority = Object.prototype.hasOwnProperty.call(
    authority,
    "historicalIntelligenceCycleAuthorityContentDigestHex",
  );
  const hasHistoricalKnowledgeSnapshotAuthority = Object.prototype.hasOwnProperty.call(
    authority,
    "historicalKnowledgeSnapshotAuthorityContentDigestHex",
  );
  if (hasInformationProfile !== hasInformationReceipt ||
      historicalPackage !== hasInformationProfile ||
      historicalPackage !== hasHistoricalCycleAuthority ||
      historicalPackage !== hasHistoricalKnowledgeSnapshotAuthority) {
    throw new Error("FORECAST_RUNTIME_AUTHORITY_INFORMATION_BINDING_INVALID");
  }
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

function containsForecastRuntimeBufferWireV2(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Buffer.isBuffer(value)) return false;
  if (Array.isArray(value)) return value.some(containsForecastRuntimeBufferWireV2);
  const candidate = value as Record<string, unknown>;
  if (candidate.type === "Buffer" && Array.isArray(candidate.data)) return true;
  return Object.values(candidate).some(containsForecastRuntimeBufferWireV2);
}

/** Rehydrates the canonical Node Buffer JSON wire representation used by PostgreSQL jsonb. */
export function reviveForecastRuntimeJsonV2<T>(value: T): T {
  return JSON.parse(JSON.stringify(value), (_key, candidate) =>
    candidate && candidate.type === "Buffer" && Array.isArray(candidate.data)
      ? Buffer.from(candidate.data)
      : candidate,
  ) as T;
}

export function serializeForecastRuntimeAuthorityV2(value: ForecastRuntimeAuthorityV2): string {
  return canonicalizeSemanticJsonString(requireForecastRuntimeAuthorityV2(value));
}
import { isDeepStrictEqual } from "node:util";
