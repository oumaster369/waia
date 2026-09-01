import { computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  assessPredictiveAdmissionV1,
  buildMarketStateSnapshotV2,
  type RuntimeAnalysisPostureV1,
} from "@/lib/trader/intelligence/predictive-admission";
import type { ForecastContractBindingV1 } from
  "@/lib/trader/intelligence/forecast-v2/forecast-contract-binding-service-v1";
import type { ForecastRuntimeInputV2 } from
  "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import type { PredictivePackageV1 } from
  "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import type {
  InformationSufficiencyReceiptV2,
  RequiredInformationProfileV2,
} from "@/lib/trader/intelligence/information-sufficiency";
import type { EvaluationCycleResult } from "@/lib/trader/intelligence/types";
import type {
  ScientificAdmissionExpectedBindingsV2,
  ScientificAdmissionReceiptV2,
} from "@/lib/trader/research/execopp-qualification/scientific-admission-v2";

import { buildHistoricalHypothesisApplicabilitySetV2 } from
  "./hypothesis-applicability-v2";

export const HISTORICAL_FORECAST_CYCLE_RUNTIME_INPUT_V2 =
  "waia.trader.historical_forecast_cycle_runtime_input.v2" as const;

/**
 * Closes one already-evaluated PIT cycle into the exact Forecast V2 runtime input.
 * No analytical digest is accepted from the caller: reconstruction, state,
 * understanding and hypothesis identities are derived from the real evaluation bytes.
 */
export function buildHistoricalForecastCycleRuntimeInputV2(input: Readonly<{
  releaseSha: string;
  organizationId: string;
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
  activeKnowledgeState: unknown;
  selectedKnowledgeClaimDigestsHex: readonly string[];
  selectedFailureBoundaryDigestsHex: readonly string[];
  knowledgeEdgeId: string;
  knowledgeContentDigestHex: string;
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
  const applicability = buildHistoricalHypothesisApplicabilitySetV2({
    releaseSha: input.releaseSha,
    organizationId: input.organizationId,
    symbol: input.symbol,
    pitAnchor: input.pitAnchor,
    hypothesisSet: evaluation.hypothesisSet,
  });
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
    venue: input.venue,
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
    activeKnowledgeStateDigestHex: computeSemanticSha256Hex(input.activeKnowledgeState),
    selectedKnowledgeClaimDigestsHex: input.selectedKnowledgeClaimDigestsHex,
    selectedFailureBoundaryDigestsHex: input.selectedFailureBoundaryDigestsHex,
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
      venue: input.venue,
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
    knowledgeEdgeId: input.knowledgeEdgeId,
    knowledgeContentDigestHex: input.knowledgeContentDigestHex,
  });
}
