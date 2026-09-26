/** Synthetic DEE-1110 native fixtures. No scientific/operator qualification claims. */
import { createHash } from "node:crypto";
import type postgres from "postgres";
import { MODEL_TRANSFORM_VERSION } from "@/lib/trader/intelligence/forecast-v2/constants";
import { digestHex, type ReplicaRootFamilyInput } from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import { buildPredictivePackageV1 } from "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import type { SourceAnchor } from "@/lib/trader/intelligence/forecast-v2/source-anchor-v1";
import { buildForecastInputContractV2, buildForecastModelArtifactV2, buildForecastModelSpecV2 } from "@/lib/trader/intelligence/forecast-v2/forecast-contract-foundation-v2";
import { buildForecastContractBindingV1, buildForecastContractBindingRecordV1, persistForecastContractBindingV1 } from "@/lib/trader/intelligence/forecast-v2/forecast-contract-binding-service-v1";
import { buildMarketStateSnapshotV2, type PredictiveAdmissionReceiptV1 } from "@/lib/trader/intelligence/predictive-admission";
import { computeSemanticSha256Hex, canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { issueForecastRuntimeV2, type ForecastRuntimeInputV2 } from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import { computeTerminalTargetGridFromDevelopmentReturns, bucketIndexForReturn } from "@/lib/trader/research/benchmark/target-grid-ceremony-v1";
import { buildPredictiveTerminalReceiptV1, buildEpistemicParameterRatificationReceiptV1 } from "@/lib/trader/research/execopp-qualification/scientific-admission-v2";
import { buildKmConvergenceReceiptV1 } from "@/lib/trader/research/execopp-qualification/km-convergence-gate-v1";
import { qualifyHtxKlineVolumeAuthority } from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import { persistHtxVolumeQualificationReceipt } from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification-receipt-service";
import { buildScientificAdmissionReceiptRecordV2, persistScientificAdmissionReceiptV2 } from "@/lib/trader/research/execopp-qualification/scientific-admission-receipt-service-v2";
import { persistPredictivePackageV2, persistForecastBundleV2 } from "@/lib/trader/intelligence/forecast-v2/forecast-v2-persistence-service";
import { buildForecastV2EvidenceOnlyClosure, type ForecastV2TerminalClosurePersistenceInput } from "@/lib/trader/intelligence/outcome-resolution/epistemic-closure-runtime";
import type { ForecastV2FeedbackReference } from "@/lib/trader/intelligence/outcome-resolution/forecast-v2-feedback-read-port-postgres";
import { HISTORICAL_FORECAST_FAMILY_BOOTSTRAP_V2 } from "@/lib/trader/historical-simulation-v2/forecast-family-bootstrap-v2";
function anchor(i: number): SourceAnchor {
  return {
    venue: "htx",
    market: "spot",
    symbol: "BTCUSDT",
    closedBarEpochMs: 1_700_000_000_000 + i * 60_000,
    barContentDigest: createHash("sha256").update(String(i)).digest("hex"),
    realizedVol20m_1m: 0.01 + (i % 12) * 0.0015,
    outcome13d: [0, 0, 0, -0.002 + (i % 7) * 0.0004, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
}

function buildFamily(): ReplicaRootFamilyInput {
  return {
    organizationId: "00000000-0000-4000-8000-000000000001",
    venue: "htx",
    market: "spot",
    symbol: "BTCUSDT",
    primaryHorizonMinutes: 30,
    executionHorizonMinutes: 33,
    packageSubjectVersion: "pkg-subject/v1",
    terminalTargetDefinitionDigestHex: "a".repeat(64),
    executionOpportunityTargetDefinitionDigestHex: "b".repeat(64),
    modelTransformVersion: MODEL_TRANSFORM_VERSION,
    developmentDatasetDigestHex: createHash("sha256").update("dev-dataset").digest("hex"),
    featureVersion: "feature-engine/rv/v2",
    normalizationVersionDigestHex: "c".repeat(64),
    codeReleaseSha: "d".repeat(40),
  };
}

function buildRuntimeInput(
  organizationId: string,
  predictivePackage: ReturnType<typeof buildPredictivePackageV1>,
  pitAnchor: string,
  scientific: Readonly<{ id: string; contentDigestHex: string }>,
  anchorRealizedVol20m1m = 0.018,
): ForecastRuntimeInputV2 {
  const family = predictivePackage.family;
  const hex = (char: string) => char.repeat(64);
  const inputContract = buildForecastInputContractV2({
    measurementSemanticVersion: family.featureVersion,
    hypothesisAssessmentSchemaVersion: "waia.trader.hypothesis_assessment.v1",
  });
  const modelSpec = buildForecastModelSpecV2({
    modelId: "rv-state-conditional-empirical-joint/v1",
    modelTransformVersion: family.modelTransformVersion,
    inputContractDigestHex: inputContract.contentDigestHex,
    terminalTargetDefinitionDigestHex: family.terminalTargetDefinitionDigestHex,
    executionOpportunityTargetDefinitionDigestHex:
      family.executionOpportunityTargetDefinitionDigestHex,
  });
  const modelArtifact = buildForecastModelArtifactV2({
    modelSpecDigestHex: modelSpec.contentDigestHex,
    inputContractDigestHex: inputContract.contentDigestHex,
    developmentDatasetDigestHex: family.developmentDatasetDigestHex,
    runtimeContractDigestHex: digestHex(predictivePackage.runtimeContractDigest),
    artifactPayloadDigestHex: hex("f"),
  });
  const forecastContractBinding = buildForecastContractBindingV1({
    organizationId,
    scientificAdmissionReceiptId: scientific.id,
    scientificAdmissionReceiptContentDigestHex: scientific.contentDigestHex,
    selectedPredictivePackageContentDigestHex: digestHex(
      predictivePackage.predictivePackageContentDigest,
    ),
    inputContract,
    modelSpec,
    modelArtifact,
  });
  const marketStateSnapshot = buildMarketStateSnapshotV2({
    organizationId,
    accountId: null,
    instrumentId: "BTC/USDT",
    symbol: family.symbol,
    venue: "htx",
    analysisPurpose: "NEW_OPPORTUNITY",
    analyticalTimeframe: "1m",
    horizon: "30m",
    pitAnchor,
    runtimeContextDigestHex: hex("2"),
    runtimePosture: "FULL_ANALYSIS_AND_NEW_RISK",
    requiredInformationProfileDigestHex: hex("3"),
    informationSufficiencyReceiptDigestHex: hex("4"),
    reconstructionDigestHex: hex("5"),
    stateRepresentationSpecDigestHex: hex("6"),
    dynamicStateDescriptorDigestHex: hex("7"),
    understandingClaimSetDigestHex: hex("8"),
    activeKnowledgeStateDigestHex: hex("9"),
    selectedKnowledgeClaimDigestsHex: [hex("a")],
    selectedFailureBoundaryDigestsHex: [hex("b")],
    hypothesisAssessmentSetDigestHex: hex("c"),
    consumedHypothesisAssessments: [{
      hypothesisAssessmentContentDigestHex: hex("d"),
      evaluatorIdentityDigestHex: hex("e"),
      status: "APPLICABLE",
    }],
    sourceProfileDigestHex: hex("f"),
    representationProfileDigestHex: hex("1"),
    anchorRealizedVol20m_1m: anchorRealizedVol20m1m,
    forecastContractBinding,
  });
  const receiptBody = {
    schemaVersion: "waia.trader.predictive_admission_receipt.v1" as const,
    verdict: "ADMITTED" as const,
    capitalAuthority: "NONE" as const,
    analysisPurpose: "NEW_OPPORTUNITY" as const,
    pitAnchor,
    marketStateSnapshotContentDigestHex: marketStateSnapshot.contentDigestHex,
    selectedPredictivePackageContentDigestHex:
      forecastContractBinding.selectedPredictivePackageContentDigestHex,
    scientificAdmissionReceiptContentDigestHex:
      forecastContractBinding.scientificAdmissionReceiptContentDigestHex,
    inputContractDigestHex: inputContract.contentDigestHex,
    modelSpecDigestHex: modelSpec.contentDigestHex,
    modelArtifactDigestHex: modelArtifact.contentDigestHex,
    qualifiedInputBindingDigestHex: marketStateSnapshot.qualifiedInputBindingDigestHex,
    blockingReasons: [] as const,
  };
  const predictiveAdmissionReceipt: PredictiveAdmissionReceiptV1 = {
    ...receiptBody,
    contentDigestHex: computeSemanticSha256Hex(receiptBody),
  };
  return {
    predictiveAdmissionReceipt,
    marketStateSnapshot,
    forecastContractBinding,
    predictivePackage,
    executionHorizonMinutes: family.executionHorizonMinutes,
    normalizationVersionDigestHex: family.normalizationVersionDigestHex,
    knowledgeEdgeId: "00000000-0000-4000-8000-000000063300",
    knowledgeContentDigestHex: computeSemanticSha256Hex({ organizationId, symbol: family.symbol, pitAnchor, fixture: "DEE-1110" }),
  };
}

async function persistScientificForPackage(sql: postgres.Sql, organizationId: string,
  pkg: ReturnType<typeof buildPredictivePackageV1>, seed: string) {
  const h = (value: string) => createHash("sha256").update(value).digest("hex");
  const developmentReturns = Array.from({ length: 400 }, (_, i) => Math.sin(i / 17) * 0.02 + (i % 9) * 0.0005);
  const historyReturns = Array.from({ length: 2500 }, (_, i) => developmentReturns[i % developmentReturns.length]!);
  const grid = computeTerminalTargetGridFromDevelopmentReturns(developmentReturns);
  const identities = {
    developmentDatasetDigestHex: pkg.family.developmentDatasetDigestHex,
    targetGridReceiptDigestHex: h(`${seed}-grid`),
    predictivePackageGenerationIdentityDigestHex: digestHex(pkg.predictivePackageGenerationIdentityDigest),
    predictivePackageContentDigestHex: digestHex(pkg.predictivePackageContentDigest),
    runtimeContractDigestHex: digestHex(pkg.runtimeContractDigest),
    scoringContractVersion: "multiclass-brier-reward/v1" as const,
    evaluationPartitionReceiptDigestHex: h(`${seed}-partition`),
  };
  const predictive = buildPredictiveTerminalReceiptV1({ identities, harnessInput: {
    venue: "htx", market: "spot", symbol: "BTCUSDT", primaryHorizonMinutes: 30,
    challengerPackageContentDigestHex: identities.predictivePackageContentDigestHex,
    comparisonFamilyId: "mandatory-baseline-family/v1",
    evaluationPartitionReceiptDigestHex: identities.evaluationPartitionReceiptDigestHex,
    purgeDurationMinutes: 30, embargoDurationMinutes: 30, developmentReturns, historyReturns,
    historyReturnMinuteOpenTimesMs: historyReturns.map((_, i) => 1_700_000_000_000 + i * 60_000),
    anchors: developmentReturns.slice(0, 24).map((observedReturn, i) => {
      const bucket = bucketIndexForReturn(observedReturn, grid);
      return { anchorId: `anchor-${i}`, observedReturn,
        challengerProbabilities: Array.from({ length: 7 }, (_, j) => j === bucket ? 0.999 : 0.001 / 6) };
    }),
  }});
  const km = buildKmConvergenceReceiptV1({
    replicaRootFamilyIdentityDigestHex: digestHex(pkg.replicaRootFamilyIdentityDigest),
    kmGlobalAnchorSetDigestHex: h(`${seed}-global-anchor`), candidateGenerationDigestsHex: [h(`${seed}-candidate`)],
    configurations: [{ kConfig: pkg.kConfigDec, mConfig: pkg.mConfigDec, evLowerRelativeErrorP95: 0.001,
      evBaseRelativeErrorP95: 0.001, evUpperRelativeErrorP95: 0.001, mcEsRelativeErrorP95: 0.001, qualifies: true }],
    selectedPackageGenerationIdentityDigestHex: identities.predictivePackageGenerationIdentityDigestHex,
    selectedPackageContentDigestHex: identities.predictivePackageContentDigestHex,
  });
  const ratification = buildEpistemicParameterRatificationReceiptV1({
    kmConvergenceEvidenceSemanticDigestHex: km.evidenceSemanticDigestHex, selectedK: km.selectedK!, selectedM: km.selectedM!,
    alphaEpiConfigScale8: km.alphaEpiConfigScale8,
    selectedPackageGenerationIdentityDigestHex: identities.predictivePackageGenerationIdentityDigestHex,
    selectedPackageContentDigestHex: identities.predictivePackageContentDigestHex, humanReceiptIdentityDigestHex: h(`${seed}-human`),
  });
  const volume = qualifyHtxKlineVolumeAuthority({ symbol: "BTCUSDT", rows: [
    { id: 1, open: 100, high: 101, low: 99, close: 100, amount: 10, vol: 1000, count: 1 },
    { id: 2, open: 50, high: 51, low: 49, close: 50, amount: 10, vol: 500, count: 1 },
  ]});
  await persistHtxVolumeQualificationReceipt(sql, { organizationId, receipt: volume });
  const record = buildScientificAdmissionReceiptRecordV2({ organizationId, predictiveTerminalReceipt: predictive,
    kmConvergenceReceipt: km, epistemicParameterRatificationReceipt: ratification, htxVolumeQualificationReceipt: volume });
  await persistScientificAdmissionReceiptV2(sql, record);
  return { id: record.id, contentDigestHex: record.contentDigest,
    evidenceSemanticDigestHex: record.evidenceSemanticDigest };
}


export async function createForecastFeedbackFixture(sql: postgres.Sql, organizationId: string) {
  const family = { ...buildFamily(), organizationId };
  const pkg = buildPredictivePackageV1({ family,
    sourceCorpus: Array.from({ length: 120 }, (_, i) => anchor(i)), kConfigDec: 3, mConfigDec: 4 });
  const persisted = await persistPredictivePackageV2(sql, pkg, {
    organizationId, kmGlobalAnchorSetDigestHex: "f".repeat(64) });
  const scientific = await persistScientificForPackage(sql, organizationId, pkg, "DEE-1110-fixture");
  const runtimeInput = buildRuntimeInput(organizationId, pkg, "2024-01-01T00:00:00.000Z", scientific);
  const binding = runtimeInput.forecastContractBinding!;
  await persistForecastContractBindingV1(sql, {
    ...buildForecastContractBindingRecordV1({ organizationId,
      scientificAdmissionReceiptId: scientific.id,
      scientificAdmissionReceiptContentDigestHex: scientific.contentDigestHex,
      selectedPredictivePackageContentDigestHex: binding.selectedPredictivePackageContentDigestHex,
      inputContract: binding.inputContract, modelSpec: binding.modelSpec, modelArtifact: binding.modelArtifact }),
    binding, bindingJson: canonicalizeSemanticJsonString(binding),
  });
  const authorizedOutcome = issueForecastRuntimeV2(runtimeInput);
  if (authorizedOutcome.status !== "FORECAST_AUTHORIZED") throw new Error("Synthetic Forecast fixture refused");
  let sequence = 0;
  return {
    async historicalPackage() {
      return persistPredictivePackageV2(sql, buildPredictivePackageV1({
        family: { ...family, packageSubjectVersion: HISTORICAL_FORECAST_FAMILY_BOOTSTRAP_V2 },
        sourceCorpus: Array.from({ length: 120 }, (_, i) => anchor(i)), kConfigDec: 3, mConfigDec: 4,
      }), { organizationId, kmGlobalAnchorSetDigestHex: "f".repeat(64) });
    },
    async pending() {
      sequence += 1;
      const bundle = await persistForecastBundleV2(sql, { organizationId,
        packageId: persisted.packageId, runId: `dee1110-issue-${sequence}`, cycleId: `issue-${sequence}`,
        symbol: family.symbol, anchorClosedBarEpochMs: authorizedOutcome.authority.anchorClosedBarEpochMs,
        issuance: authorizedOutcome.issuance, runtimeInput, authorizedOutcome, issuanceSequence: sequence });
      const resolvedAt = new Date(authorizedOutcome.authority.anchorClosedBarEpochMs + 33 * 60_000).toISOString();
      const objectiveEvidence = { organizationId, symbol: family.symbol,
        primaryHorizonMinutes: family.primaryHorizonMinutes,
        anchorClosedBarEpochMs: authorizedOutcome.authority.anchorClosedBarEpochMs,
        resolvedAt, pitEvidenceBoundary: resolvedAt, observedTerminalReturn: 0,
        observedOutcomeDigestHex: computeSemanticSha256Hex({ fixtureObservedReturn: 0, sequence }),
        pitMeasurementIdentityDigestHex: computeSemanticSha256Hex({ fixtureMeasurement: sequence }),
        knowledgeEdgeId: authorizedOutcome.authority.knowledgeEdgeId,
        knowledgeContentDigestHex: authorizedOutcome.authority.knowledgeContentDigestHex };
      const input: ForecastV2TerminalClosurePersistenceInput = { organizationId,
        bundleId: bundle.bundleId, forecastId: bundle.terminalForecastId,
        objectiveOutcomeContentDigestHex: computeSemanticSha256Hex(objectiveEvidence),
        authorizedOutcome, objectiveEvidence, futureRunId: "dee1110-future-run",
        futureCycleId: `future-${sequence}`, futureCyclePitAnchor: "2024-01-01T00:34:00.000Z",
        priorMachineRecommendedConfidence: "0.5000", sequence,
        provenance: { codeSha: "d".repeat(40), datasetContentDigest: "e".repeat(64),
          profileDigest: "f".repeat(64), canonicalizer: "HTR_SEMANTIC_CANONICAL_JSON_V1" } };
      const closure = buildForecastV2EvidenceOnlyClosure(input);
      const reference: ForecastV2FeedbackReference = { bundleId: bundle.bundleId,
        forecastId: bundle.terminalForecastId, packageId: persisted.packageId,
        knowledgeUpdateIdempotencyKey: closure.knowledgeUpdate.idempotencyKey,
        symbol: family.symbol, futureRunId: input.futureRunId, futureCycleId: input.futureCycleId,
        futureCyclePitAnchor: input.futureCyclePitAnchor };
      return { input, closure, reference, bundle };
    },
  };
}
