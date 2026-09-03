import { computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  assessPredictiveAdmissionV1,
  buildMarketStateSnapshotV2,
  type RuntimeAnalysisPostureV1,
} from "@/lib/trader/intelligence/predictive-admission";
import type { ForecastContractBindingV1 } from
  "@/lib/trader/intelligence/forecast-v2/forecast-contract-binding-service-v1";
import {
  HISTORICAL_INTELLIGENCE_CYCLE_AUTHORITY_V2,
  type ForecastRuntimeInputV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import {
  assertHistoricalKnowledgeSnapshotAuthorityV2,
  type HistoricalKnowledgeSnapshotAuthorityV2,
} from "@/lib/trader/intelligence/forecast-v2/historical-knowledge-snapshot-authority-v2";
import type { PredictivePackageV1 } from
  "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import type {
  InformationSufficiencyReceiptV2,
  RequiredInformationProfileV2,
} from "@/lib/trader/intelligence/information-sufficiency";
import { bindInformationSufficiencyReceiptAuthorityV2 } from
  "@/lib/trader/intelligence/information-sufficiency/information-sufficiency-runtime-authority-v2";
import type { EvaluationCycleResult } from "@/lib/trader/intelligence/types";
import { assertMarketUnderstandingArtifactV1 } from
  "@/lib/trader/intelligence/market-understanding-evidence-attribution-v1";
import {
  computeCanonicalCycleCausalInputDigestV2,
  parseCanonicalCycleCausalInputBundleV2,
} from "@/lib/trader/intelligence/records/causal-input-bundle-v2";
import { computeCycleEnvelopeContentDigest } from
  "@/lib/trader/intelligence/records/serialize-intelligence-records";
import { buildCanonicalCausalLineageV1 } from
  "@/lib/trader/intelligence/causal-lineage/canonical-causal-lineage-v1";
import type { HypothesisSet } from
  "@/lib/trader/intelligence/hypothesis/hypothesis.types";
import type { CanonicalRuntimeIntelligenceStateV1 } from
  "@/lib/trader/intelligence/hypothesis/runtime-knowledge-authority-v1";
import { historicalInstrumentsMatch } from
  "@/lib/trader/symbols/historical-instrument";
import type {
  ScientificAdmissionExpectedBindingsV2,
  ScientificAdmissionReceiptV2,
} from "@/lib/trader/research/execopp-qualification/scientific-admission-v2";

import { buildHistoricalHypothesisApplicabilitySetV2 } from
  "./hypothesis-applicability-v2";
import {
  buildHistoricalForecastKnowledgeBootstrapV2,
  type HistoricalForecastKnowledgeBootstrapV2,
} from "./forecast-knowledge-bootstrap-v2";

export const HISTORICAL_FORECAST_CYCLE_RUNTIME_INPUT_V2 =
  "waia.trader.historical_forecast_cycle_runtime_input.v2" as const;
const HISTORICAL_FORECAST_FAILURE_BOUNDARY_V1 =
  "waia.trader.historical_forecast_failure_boundary.v1" as const;

function deriveSealedKnowledgeLineage(input: Readonly<{
  canonicalState: CanonicalRuntimeIntelligenceStateV1;
  hypothesisSet: HypothesisSet;
  applicabilityAdmitted: boolean;
}>): Readonly<{
  activeKnowledgeStateDigestHex: string;
  selectedKnowledgeClaimDigestsHex: readonly string[];
  selectedFailureBoundaryDigestsHex: readonly string[];
}> {
  const active = input.hypothesisSet.activeHypothesis;
  if (!input.applicabilityAdmitted || !active) {
    return Object.freeze({
      activeKnowledgeStateDigestHex: input.canonicalState.semanticDigest,
      selectedKnowledgeClaimDigestsHex: Object.freeze([]),
      selectedFailureBoundaryDigestsHex: Object.freeze([]),
    });
  }
  if (
    active.authority !== "CANONICAL_PIT_KNOWLEDGE" ||
    !active.canonicalHypothesisId ||
    !active.canonicalCausalLineageDigest ||
    active.canonicalIntelligenceStateDigest !== input.canonicalState.semanticDigest
  ) {
    throw new Error("HISTORICAL_FORECAST_CYCLE_INPUT_REFUSED:KNOWLEDGE_LINEAGE");
  }
  const source = input.canonicalState.hypotheses.find(
    (hypothesis) => hypothesis.hypothesisId === active.canonicalHypothesisId,
  );
  if (!source) {
    throw new Error("HISTORICAL_FORECAST_CYCLE_INPUT_REFUSED:KNOWLEDGE_LINEAGE");
  }
  const canonicalLineage = buildCanonicalCausalLineageV1(input.canonicalState, source);
  if (canonicalLineage.contentDigest !== active.canonicalCausalLineageDigest) {
    throw new Error("HISTORICAL_FORECAST_CYCLE_INPUT_REFUSED:KNOWLEDGE_LINEAGE");
  }
  const selectedKnowledgeClaimDigestsHex = Object.freeze([
    canonicalLineage.contentDigest,
  ]);
  const selectedFailureBoundaryDigestsHex = Object.freeze(
    canonicalLineage.invalidationConditions.map((condition, ordinal) =>
      computeSemanticSha256Hex({
        schemaVersion: HISTORICAL_FORECAST_FAILURE_BOUNDARY_V1,
        canonicalIntelligenceStateDigestHex: input.canonicalState.semanticDigest,
        canonicalCausalLineageDigestHex: canonicalLineage.contentDigest,
        canonicalHypothesisId: canonicalLineage.hypothesisId,
        ordinal,
        condition,
      }),
    ),
  );
  return Object.freeze({
    activeKnowledgeStateDigestHex: input.canonicalState.semanticDigest,
    selectedKnowledgeClaimDigestsHex,
    selectedFailureBoundaryDigestsHex,
  });
}

/**
 * Closes one already-evaluated PIT cycle into the exact Forecast V2 runtime input.
 * No analytical digest is accepted from the caller: reconstruction, state,
 * understanding and hypothesis identities are derived from the real evaluation bytes.
 */
export function buildHistoricalForecastCycleRuntimeInputV2(input: Readonly<{
  releaseSha: string;
  organizationId: string;
  runId: string;
  accountId: string | null;
  symbol: "BTCUSDT" | "ETHUSDT";
  venue: "HTX";
  analyticalTimeframe: string;
  horizon: string;
  pitAnchor: string;
  runtimePosture: RuntimeAnalysisPostureV1;
  sourceProfileDigestHex: string;
  representationProfileDigestHex: string;
  runtimeContext: unknown;
  knowledgeBootstrap: HistoricalForecastKnowledgeBootstrapV2;
  knowledgeSnapshotAuthority: HistoricalKnowledgeSnapshotAuthorityV2;
  evaluation: EvaluationCycleResult;
  requiredInformationProfile: RequiredInformationProfileV2;
  informationSufficiencyReceipt: InformationSufficiencyReceiptV2;
  forecastContractBinding: ForecastContractBindingV1;
  scientificAdmissionReceipt: ScientificAdmissionReceiptV2;
  scientificAdmissionExpectedBindings: ScientificAdmissionExpectedBindingsV2;
  predictivePackage: PredictivePackageV1;
  packageQuarantinedOrStale: boolean;
  integrityAndPitValid: boolean;
}>): ForecastRuntimeInputV2 {
  const evaluation = input.evaluation;
  if (!evaluation.reconstruction || !evaluation.hypothesisSet ||
      !evaluation.marketStateSnapshot || !evaluation.decisionChain ||
      evaluation.features.evaluatedAt !== input.pitAnchor) {
    throw new Error("HISTORICAL_FORECAST_CYCLE_INPUT_REFUSED:INCOMPLETE_EVALUATION");
  }
  const rv = Number(evaluation.features.features.realizedVol20m_1m);
  if (!Number.isFinite(rv) || rv < 0) {
    throw new Error("HISTORICAL_FORECAST_CYCLE_INPUT_REFUSED:REALIZED_VOL");
  }
  if (
    !historicalInstrumentsMatch(input.symbol, evaluation.features.instrumentId) ||
    !historicalInstrumentsMatch(input.symbol, input.predictivePackage.family.symbol)
  ) {
    throw new Error("HISTORICAL_FORECAST_CYCLE_INPUT_REFUSED:SYMBOL_SCOPE");
  }
  const knowledgeSnapshotAuthority = assertHistoricalKnowledgeSnapshotAuthorityV2(
    input.knowledgeSnapshotAuthority,
  );
  if (knowledgeSnapshotAuthority.organizationId !== input.organizationId ||
      knowledgeSnapshotAuthority.runId !== input.runId ||
      knowledgeSnapshotAuthority.pitAnchor !== input.pitAnchor ||
      !historicalInstrumentsMatch(knowledgeSnapshotAuthority.symbol, input.symbol)) {
    throw new Error("HISTORICAL_FORECAST_CYCLE_INPUT_REFUSED:KNOWLEDGE_SNAPSHOT");
  }
  const expectedKnowledgeBootstrap = buildHistoricalForecastKnowledgeBootstrapV2({
    organizationId: input.organizationId,
    symbol: input.symbol,
    horizonMinutes: input.predictivePackage.family.executionHorizonMinutes,
    predictivePackageContentDigestHex:
      input.predictivePackage.predictivePackageContentDigest.toString("hex"),
  });
  if (
    computeSemanticSha256Hex(input.knowledgeBootstrap) !==
      computeSemanticSha256Hex(expectedKnowledgeBootstrap) ||
    input.knowledgeBootstrap.contentDigestHex !== expectedKnowledgeBootstrap.contentDigestHex
  ) {
    throw new Error("HISTORICAL_FORECAST_CYCLE_INPUT_REFUSED:KNOWLEDGE_LINEAGE");
  }
  if (!evaluation.canonicalRuntimeIntelligenceState) {
    throw new Error("HISTORICAL_FORECAST_CYCLE_INPUT_REFUSED:CANONICAL_STATE");
  }
  const epistemicAuthority = evaluation.canonicalRuntimeIntelligenceState.epistemicAuthority;
  const historicalAuthorities = input.informationSufficiencyReceipt.evidenceInventory
    .filter((evidence) => evidence.historyScope === "WALK_FORWARD_PREDICTIVE")
    .map((evidence) => evidence.historicalDatasetTrustAuthority);
  if (!epistemicAuthority || historicalAuthorities.length !== 1 ||
      historicalAuthorities.some((authority) =>
        !authority || authority.organizationId !== input.organizationId ||
        authority.runId !== input.runId || authority.releaseSha !== input.releaseSha ||
        authority.ratifiedAdmissionId !== epistemicAuthority.ratifiedAdmissionId ||
        authority.ratifiedAdmissionContentDigestHex !==
          epistemicAuthority.authorityContentDigestHex ||
        authority.epistemicRecordCutoff !== epistemicAuthority.createdAt ||
        authority.publicAvailableAt !== input.pitAnchor ||
        !historicalInstrumentsMatch(authority.symbol, input.symbol))) {
    throw new Error("HISTORICAL_FORECAST_CYCLE_INPUT_REFUSED:INFORMATION_AUTHORITY");
  }
  if (!evaluation.intelligenceCycleBundle) {
    throw new Error("HISTORICAL_FORECAST_CYCLE_INPUT_REFUSED:EVALUATION_SEAL");
  }
  const understandingArtifact = evaluation.understandingArtifact;
  const envelope = evaluation.intelligenceCycleBundle.envelope;
  const causalBundleJson = envelope.inputCausalBundleJson;
  if (!understandingArtifact || !causalBundleJson) {
    throw new Error("HISTORICAL_FORECAST_CYCLE_INPUT_REFUSED:UNDERSTANDING_AUTHORITY");
  }
  try {
    assertMarketUnderstandingArtifactV1(
      understandingArtifact,
      input.requiredInformationProfile,
      input.informationSufficiencyReceipt,
    );
    const causalBundle = parseCanonicalCycleCausalInputBundleV2(causalBundleJson);
    if (
      envelope.organizationId !== input.organizationId ||
      envelope.runId !== input.runId ||
      envelope.evaluatedAt !== input.pitAnchor ||
      !historicalInstrumentsMatch(envelope.symbol, input.symbol) ||
      computeCycleEnvelopeContentDigest(envelope) !== envelope.contentDigest ||
      computeCanonicalCycleCausalInputDigestV2(causalBundle) !==
        envelope.inputSemanticDigest ||
      causalBundle.understanding.status !== "EXACT" ||
      causalBundle.understanding.contentDigest !== understandingArtifact.contentDigest ||
      causalBundle.understanding.requiredInformationProfileId !==
        input.requiredInformationProfile.id ||
      causalBundle.understanding.requiredInformationProfileContentDigest !==
        input.requiredInformationProfile.contentDigest ||
      causalBundle.understanding.informationSufficiencyReceiptId !==
        input.informationSufficiencyReceipt.id ||
      causalBundle.understanding.informationSufficiencyReceiptContentDigest !==
        input.informationSufficiencyReceipt.contentDigest
    ) {
      throw new Error("understanding authority mismatch");
    }
  } catch {
    throw new Error("HISTORICAL_FORECAST_CYCLE_INPUT_REFUSED:UNDERSTANDING_AUTHORITY");
  }
  const historicalCycleAuthorityBody = {
    schemaVersion: HISTORICAL_INTELLIGENCE_CYCLE_AUTHORITY_V2,
    organizationId: input.organizationId,
    runId: input.runId,
    cycleId: envelope.cycleId,
    symbol: envelope.symbol,
    pitAnchor: input.pitAnchor,
    envelopeId: envelope.id,
    envelopeContentDigestHex: envelope.contentDigest,
    inputSemanticDigestHex: envelope.inputSemanticDigest,
    understandingArtifactContentDigestHex: understandingArtifact.contentDigest,
    understandingArtifactSemanticDigestHex: computeSemanticSha256Hex(
      understandingArtifact,
    ),
  };
  const historicalIntelligenceCycleAuthority = Object.freeze({
    ...historicalCycleAuthorityBody,
    contentDigestHex: computeSemanticSha256Hex(historicalCycleAuthorityBody),
  });
  const applicability = buildHistoricalHypothesisApplicabilitySetV2({
    releaseSha: input.releaseSha,
    organizationId: input.organizationId,
    // Applicability seals the analytical snapshot identity. The execution/package
    // symbol is independently bound below through the canonical instrument mapper.
    symbol: evaluation.features.instrumentId,
    pitAnchor: input.pitAnchor,
    reconstruction: evaluation.reconstruction,
    canonicalRuntimeIntelligenceState: evaluation.canonicalRuntimeIntelligenceState,
    evaluationEnvelope: evaluation.intelligenceCycleBundle.envelope,
    hypothesisSet: evaluation.hypothesisSet,
  });
  const knowledgeLineage = deriveSealedKnowledgeLineage({
    canonicalState: evaluation.canonicalRuntimeIntelligenceState,
    hypothesisSet: evaluation.hypothesisSet,
    applicabilityAdmitted: applicability.assessments.every(
      (assessment) => assessment.status === "APPLICABLE",
    ),
  });
  // Historical orchestration uses the execution-domain enum "HTX" while the
  // immutable Forecast family identity uses the canonical market-data token "htx".
  // Bind the snapshot to the package's frozen token; case must never create a
  // distinct mathematical identity or make an otherwise exact package non-executable.
  const forecastVenue = input.predictivePackage.family.venue;
  if (input.venue !== "HTX" || forecastVenue !== "htx") {
    throw new Error("HISTORICAL_FORECAST_CYCLE_INPUT_REFUSED:VENUE_IDENTITY");
  }
  const stateRepresentationSpecDigestHex = computeSemanticSha256Hex({
    schemaVersion: HISTORICAL_FORECAST_CYCLE_RUNTIME_INPUT_V2,
    releaseSha: input.releaseSha,
    reconstructionSchemaVersion: evaluation.reconstruction.schemaVersion,
    marketStateSchemaVersion: evaluation.marketStateSnapshot.schemaVersion,
  });
  const snapshot = buildMarketStateSnapshotV2({
    organizationId: input.organizationId,
    accountId: input.accountId,
    instrumentId: evaluation.features.instrumentId,
    symbol: input.symbol,
    venue: forecastVenue,
    analysisPurpose: "NEW_OPPORTUNITY",
    analyticalTimeframe: input.analyticalTimeframe,
    horizon: input.horizon,
    pitAnchor: input.pitAnchor,
    runtimeContextDigestHex: computeSemanticSha256Hex(input.runtimeContext),
    runtimePosture: input.runtimePosture,
    requiredInformationProfileDigestHex: input.requiredInformationProfile.contentDigest,
    informationSufficiencyReceiptDigestHex: input.informationSufficiencyReceipt.contentDigest,
    reconstructionDigestHex: computeSemanticSha256Hex(evaluation.reconstruction),
    stateRepresentationSpecDigestHex,
    dynamicStateDescriptorDigestHex: computeSemanticSha256Hex(evaluation.marketStateSnapshot),
    understandingClaimSetDigestHex: computeSemanticSha256Hex(
      evaluation.understandingArtifact ?? evaluation.understanding ?? { status: "UNAVAILABLE" },
    ),
    activeKnowledgeStateDigestHex: knowledgeLineage.activeKnowledgeStateDigestHex,
    selectedKnowledgeClaimDigestsHex: knowledgeLineage.selectedKnowledgeClaimDigestsHex,
    selectedFailureBoundaryDigestsHex: knowledgeLineage.selectedFailureBoundaryDigestsHex,
    hypothesisAssessmentSetDigestHex: applicability.contentDigestHex,
    consumedHypothesisAssessments: applicability.assessments,
    sourceProfileDigestHex: input.sourceProfileDigestHex,
    representationProfileDigestHex: input.representationProfileDigestHex,
    anchorRealizedVol20m_1m: rv,
    forecastContractBinding: input.forecastContractBinding,
  });
  const admission = assessPredictiveAdmissionV1({
    snapshot,
    requiredInformationProfile: input.requiredInformationProfile,
    informationSufficiencyReceipt: input.informationSufficiencyReceipt,
    forecastContractBinding: input.forecastContractBinding,
    scientificAdmissionReceipt: input.scientificAdmissionReceipt,
    scientificAdmissionExpectedBindings: input.scientificAdmissionExpectedBindings,
    expected: {
      organizationId: input.organizationId,
      symbol: input.symbol,
      venue: forecastVenue,
      analyticalTimeframe: input.analyticalTimeframe,
      horizon: input.horizon,
      sourceProfileDigestHex: input.sourceProfileDigestHex,
      representationProfileDigestHex: input.representationProfileDigestHex,
      stateRepresentationSpecDigestHex,
      selectedPredictivePackageContentDigestHex:
        input.forecastContractBinding.selectedPredictivePackageContentDigestHex,
      inputContractDigestHex: input.forecastContractBinding.inputContract.contentDigestHex,
      modelSpecDigestHex: input.forecastContractBinding.modelSpec.contentDigestHex,
      modelArtifactDigestHex: input.forecastContractBinding.modelArtifact.contentDigestHex,
    },
    integrityAndPitValid: input.integrityAndPitValid,
    packageQuarantinedOrStale: input.packageQuarantinedOrStale,
  });
  return Object.freeze({
    predictiveAdmissionReceipt: admission,
    marketStateSnapshot: snapshot,
    forecastContractBinding: input.forecastContractBinding,
    predictivePackage: input.predictivePackage,
    executionHorizonMinutes: input.predictivePackage.family.executionHorizonMinutes,
    normalizationVersionDigestHex:
      input.predictivePackage.family.normalizationVersionDigestHex,
    knowledgeEdgeId: expectedKnowledgeBootstrap.knowledgeEdgeId,
    knowledgeContentDigestHex: knowledgeSnapshotAuthority.knowledgeContentDigestHex,
    historicalKnowledgeSnapshotAuthority: knowledgeSnapshotAuthority,
    informationSufficiencyAuthority: bindInformationSufficiencyReceiptAuthorityV2(
      input.requiredInformationProfile,
      input.informationSufficiencyReceipt,
    ),
    historicalIntelligenceCycleAuthority,
  });
}
