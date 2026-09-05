import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";

import * as pgSchema from "@/db/schema.postgres";
import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import {
  persistPredictivePackageV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-v2-persistence-service";
import { persistForecastContractBindingV1 } from
  "@/lib/trader/intelligence/forecast-v2/forecast-contract-binding-service-v1";
import { digestHex } from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import {
  issueForecastRuntimeV2,
  requireForecastRuntimeAuthorizedOutcomeV2,
  type ForecastRuntimeNonActionableV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import {
  HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
  HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST,
} from
  "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import {
  foldCanonicalRuntimeIntelligenceStateV1,
} from "@/lib/trader/intelligence/hypothesis/canonical-runtime-intelligence-fold-v1";
import { createPostgresMiHypothesisRepository } from
  "@/lib/trader/mi/hypothesis-repository-adapters";
import { createPostgresMiEvidenceRepository } from
  "@/lib/trader/mi/evidence-repository-adapters";
import { createPostgresMiObservationRepository } from
  "@/lib/trader/mi/observation-repository-adapters";
import { createPostgresMiTrialRepository } from
  "@/lib/trader/mi/trial-repository-adapters";
import { createMkbReadModelSourcePostgres } from
  "@/lib/trader/knowledge/mkb-read-model-postgres";
import { persistIntelligenceCycleBundleWithinTransaction } from
  "@/lib/trader/intelligence/records/atomic-cycle-bundle-repository-postgres";
import {
  requireScientificAdmissionV2,
  type ScientificAdmissionExpectedBindingsV2,
  type ScientificAdmissionReceiptV2,
} from
  "@/lib/trader/research/execopp-qualification/scientific-admission-v2";
import {
  requireHistoricalFourSurfaceRatifiedAdmissionV2,
  type HistoricalFourSurfaceKeyV2,
} from
  "@/lib/trader/research/execopp-qualification/historical-four-surface-ratified-admission-v2";
import { projectHistoricalPrerunHypothesisV2 } from
  "@/lib/trader/research/execopp-qualification/historical-prerun-knowledge-bootstrap-v2";
import { computeSemanticSha256Hex, canonicalizeSemanticJsonString } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { deterministicExecutionUuidV2 } from "@/lib/trader/execution/v2/contracts";
import { historicalInstrumentsMatch } from "@/lib/trader/symbols/historical-instrument";

import { buildHistoricalForecastCycleRuntimeInputV2 } from
  "./forecast-cycle-runtime-input-v2";
import {
  buildHistoricalForecastKnowledgeBootstrapV2,
  persistHistoricalForecastKnowledgeBootstrapWithinTransactionV2,
} from "./forecast-knowledge-bootstrap-v2";
import { loadHistoricalKnowledgeSnapshotAuthorityV2 } from
  "./knowledge-snapshot-binding-v2";
import { buildHistoricalForecastAuthorityBootstrapV2 } from
  "./forecast-authority-bootstrap-v2";
import { persistHistoricalForecastCycleV2 } from "./forecast-cycle-persistence-v2";
import { createHistoricalSimulationPostgresKnowledgePortV2 } from
  "./knowledge-port-postgres";
import { loadHistoricalSimulationInitialRecordIndexV2 } from
  "./production-initial-cycle-index-v2";
import {
  prepareHistoricalProductionNextCycleInformationV2,
  type HistoricalProductionNextCycleInformationV2,
} from "./production-next-cycle-information-v2";

export const HISTORICAL_PRODUCTION_NEXT_CYCLE_FORECAST_V2 =
  "waia.trader.historical_production_next_cycle_forecast.v2" as const;

function refuse(code: string): never {
  throw new Error(`HISTORICAL_PRODUCTION_NEXT_CYCLE_FORECAST_REFUSED:${code}`);
}

export function assertHistoricalNextCycleKnowledgeBoundaryV2(input: Readonly<{
  sealedKnowledgeMarketPitBoundary: string;
  marketEvidencePublicAvailableAt: string;
  marketEvidenceObservationEventTime: string;
  currentEconomicPitAnchor: string;
}>): void {
  const values = [
    input.sealedKnowledgeMarketPitBoundary,
    input.marketEvidencePublicAvailableAt,
    input.marketEvidenceObservationEventTime,
    input.currentEconomicPitAnchor,
  ];
  if (
    values.some((value) =>
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) ||
    input.sealedKnowledgeMarketPitBoundary !== input.marketEvidencePublicAvailableAt ||
    input.sealedKnowledgeMarketPitBoundary !== input.marketEvidenceObservationEventTime ||
    Date.parse(input.sealedKnowledgeMarketPitBoundary) >=
      Date.parse(input.currentEconomicPitAnchor)
  ) {
    refuse("SEALED_KNOWLEDGE_AUTHORITY_BOUNDARY");
  }
}

function deterministicUuid(seed: Readonly<Record<string, unknown>>): string {
  return deterministicExecutionUuidV2("report", seed);
}

type ScientificRow = Readonly<{ receipt_json: string | ScientificAdmissionReceiptV2;
  content_digest: string }>;

function parseScientific(row: ScientificRow): ScientificAdmissionReceiptV2 {
  try {
    return typeof row.receipt_json === "string"
      ? JSON.parse(row.receipt_json) as ScientificAdmissionReceiptV2
      : row.receipt_json;
  } catch {
    return refuse("SCIENTIFIC_JSON");
  }
}

function expectedScientific(
  receipt: ScientificAdmissionReceiptV2,
  surface: Readonly<{
    predictivePackageGenerationIdentityDigestHex: string;
    predictivePackageContentDigestHex: string;
    scientificAdmissionContentDigestHex: string;
    predictiveTerminalReceipt: Readonly<{ contentDigestHex: string }>;
    humanRatificationReceipt: Readonly<{ contentDigestHex: string }>;
  }>,
  developmentDatasetIdentityDigestHex: string,
): ScientificAdmissionExpectedBindingsV2 {
  const predictive = receipt.predictiveTerminalReceipt;
  return {
    organizationId: receipt.organizationId,
    developmentDatasetDigestHex: developmentDatasetIdentityDigestHex,
    targetGridReceiptDigestHex: predictive.targetGridReceiptDigestHex,
    predictivePackageGenerationIdentityDigestHex:
      surface.predictivePackageGenerationIdentityDigestHex,
    predictivePackageContentDigestHex: surface.predictivePackageContentDigestHex,
    runtimeContractDigestHex: predictive.runtimeContractDigestHex,
    scoringContractVersion: "multiclass-log-score/v1",
    evaluationPartitionReceiptDigestHex: predictive.evaluationPartitionReceiptDigestHex,
    kmConvergenceEvidenceSemanticDigestHex:
      receipt.kmConvergenceReceipt.evidenceSemanticDigestHex,
    epistemicParameterRatificationReceiptDigestHex:
      surface.humanRatificationReceipt.contentDigestHex,
    predictiveTerminalReceiptContentDigestHex:
      surface.predictiveTerminalReceipt.contentDigestHex,
  };
}

export type HistoricalProductionNextCycleAuthorizedForecastV2 = Readonly<{
  status: "FORECAST_AUTHORIZED";
  information: HistoricalProductionNextCycleInformationV2;
  forecastId: string;
  bundleId: string;
  issuanceSequence: number;
  forecastAuthorityContentDigestHex: string;
  runtimeInput: Parameters<typeof issueForecastRuntimeV2>[0];
}>;

export type HistoricalProductionNextCycleNonActionableForecastV2 = Readonly<{
  status: "NON_ACTIONABLE";
  information: HistoricalProductionNextCycleInformationV2;
  issuanceSequence: number;
  runtimeInput: Parameters<typeof issueForecastRuntimeV2>[0];
  outcome: ForecastRuntimeNonActionableV2;
}>;

export type HistoricalProductionNextCycleForecastV2 =
  | HistoricalProductionNextCycleAuthorizedForecastV2
  | HistoricalProductionNextCycleNonActionableForecastV2;

/**
 * Builds exactly one Forecast for the next durable WALK_FORWARD membership.
 * It is transaction-bound and refuses when a PIT for that cycle already exists;
 * no loop or future-cycle precomputation exists in this producer.
 */
export async function prepareHistoricalProductionNextCycleForecastV2(input: Readonly<{
  tx: postgres.Sql;
  organizationId: string;
  accountId: string;
  runId: string;
  partition: "WALK_FORWARD";
  symbol: "BTCUSDT" | "ETHUSDT";
  primaryHorizonMinutes: 30 | 60;
  expectedRecordIndex: number;
}>): Promise<HistoricalProductionNextCycleForecastV2> {
  const information = await prepareHistoricalProductionNextCycleInformationV2(input);
  const ratifiedRows = await input.tx<Array<Readonly<{
    id: string; release_sha: string; aggregate_admission_receipt_id: string;
    authority_content_digest_hex: string; created_at: Date | string;
  }>>>`
    SELECT id::text, release_sha, aggregate_admission_receipt_id::text,
           authority_content_digest_hex, created_at
    FROM trader_historical_four_surface_ratified_admission_v2
    WHERE organization_id=${input.organizationId}::uuid AND run_id=${input.runId}
  `;
  const ratifiedRow = ratifiedRows[0];
  if (!ratifiedRow || ratifiedRows.length !== 1) refuse("RATIFICATION");
  const ratified = await requireHistoricalFourSurfaceRatifiedAdmissionV2(input.tx, {
    organizationId: input.organizationId,
    runId: input.runId,
    releaseSha: ratifiedRow.release_sha,
    aggregateAdmissionReceiptId: ratifiedRow.aggregate_admission_receipt_id,
    authorityContentDigestHex: ratifiedRow.authority_content_digest_hex,
  });
  const key = `${input.symbol}:${input.primaryHorizonMinutes}` as HistoricalFourSurfaceKeyV2;
  const surface = ratified.surfaceAdmissions.find((entry) => entry.surfaceKey === key);
  const sealedKnowledge = ratified.knowledgeSnapshots.find((entry) => entry.surfaceKey === key);
  if (!surface || !sealedKnowledge) refuse("RATIFIED_SURFACE");

  const scientificRows = await input.tx<ScientificRow[]>`
    SELECT receipt_json, content_digest
    FROM trader_scientific_admission_receipt_v1
    WHERE organization_id=${input.organizationId}::uuid
      AND id=${surface.scientificAdmissionReceiptId}::uuid
  `;
  const scientificRow = scientificRows[0];
  if (!scientificRow || scientificRows.length !== 1) refuse("SCIENTIFIC_ROW");
  const scientificReceipt = parseScientific(scientificRow);
  const scientificExpected = expectedScientific(
    scientificReceipt,
    surface,
    ratified.developmentDatasetIdentityDigestHex,
  );
  const scientific = requireScientificAdmissionV2(scientificReceipt, scientificExpected);
  if (scientific.contentDigestHex !== scientificRow.content_digest ||
      scientific.contentDigestHex !== surface.scientificAdmissionContentDigestHex) {
    refuse("SCIENTIFIC_REPLAY");
  }

  const priorRuntime = information.previousRuntimeInput;
  const predictivePackage = priorRuntime.predictivePackage;
  const binding = priorRuntime.forecastContractBinding;
  if (!predictivePackage || !binding ||
      digestHex(predictivePackage.predictivePackageContentDigest) !==
        surface.predictivePackageContentDigestHex) {
    refuse("PACKAGE_REPLAY");
  }
  const rebuiltBinding = buildHistoricalForecastAuthorityBootstrapV2({
    organizationId: input.organizationId,
    scientificAdmissionReceiptId: surface.scientificAdmissionReceiptId,
    scientificAdmissionReceipt: scientific,
    scientificAdmissionExpectedBindings: scientificExpected,
    predictivePackage,
  }).forecastContractBinding;
  if (canonicalizeSemanticJsonString(rebuiltBinding) !==
      canonicalizeSemanticJsonString(binding)) {
    refuse("CONTRACT_BINDING_REPLAY");
  }
  const current = information.sourceAuthority.currentSealedCycle;
  const pitAnchor = current.closedBar.barCloseTime;
  const instrumentId = current.closedBar.symbol;
  if (!historicalInstrumentsMatch(instrumentId, input.symbol)) refuse("INSTRUMENT");
  const marketEvidence = ratified.marketEvidence.find((entry) =>
    entry.symbol === input.symbol);
  if (!marketEvidence) refuse("RATIFIED_MARKET_EVIDENCE");
  assertHistoricalNextCycleKnowledgeBoundaryV2({
    sealedKnowledgeMarketPitBoundary: sealedKnowledge.marketPitBoundary,
    marketEvidencePublicAvailableAt: marketEvidence.publicAvailableAt,
    marketEvidenceObservationEventTime: marketEvidence.observationEventTime,
    currentEconomicPitAnchor: pitAnchor,
  });

  // Materialize only outcomes whose sealed terminal evidence is strictly older
  // than this PIT before the current Forecast is built. The durable producer is
  // rehydrated from PostgreSQL on every transaction, so there is no process-local
  // learning state and a resumed run cannot skip pending Forecasts. This canonical
  // path is intentionally evidence-only (zero confidence delta); it appends the
  // objective outcome, calibration and future-visible Knowledge record atomically.
  const knowledgeLifecycle = createHistoricalSimulationPostgresKnowledgePortV2({
    sql: input.tx,
    organizationId: input.organizationId,
    runId: input.runId,
    symbol: input.symbol,
    forecastProducer: {
      kmGlobalAnchorSetDigestHex: surface.kmGlobalAnchorSetDigestHex,
      priorMachineRecommendedConfidence: "0.5000",
      provenance: {
        codeSha: ratified.releaseSha,
        datasetContentDigest: ratified.developmentDatasetIdentityDigestHex,
        profileDigest: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST,
        canonicalizer: "HTR_SEMANTIC_CANONICAL_JSON_V1",
      },
      resolveVolumeAuthorityReceipt: (symbol) => {
        if (!historicalInstrumentsMatch(symbol, input.symbol)) {
          return refuse("VOLUME_AUTHORITY_SYMBOL");
        }
        return current.htxVolumeAuthorityReceipt;
      },
    },
  });
  await knowledgeLifecycle.processForecastCycle({
    organizationId: input.organizationId,
    runId: input.runId,
    cycleId: information.sourceAuthority.currentCycleId,
    pitAnchor,
    bars: information.sourceAuthority.warmupCycles.map((cycle) => cycle.closedBar),
    sequence: input.expectedRecordIndex,
    outcome: null,
  });

  const executor = drizzle(input.tx, { schema: pgSchema });
  const canonicalState = await foldCanonicalRuntimeIntelligenceStateV1({
    context: { organizationId: input.organizationId },
    symbol: instrumentId,
    asOf: new Date(pitAnchor),
    epistemicRecordCutoff: new Date(ratified.epistemicRecordCutoff),
    epistemicAuthority: {
      schemaVersion: ratified.schemaVersion,
      ratifiedAdmissionId: ratifiedRow.id,
      authorityContentDigestHex: ratified.contentDigestHex,
      createdAt: new Date(ratified.epistemicRecordCutoff),
    },
    requireMarketTimestampedKnowledge: true,
    sealedHistoricalKnowledge: {
      schemaVersion: sealedKnowledge.schemaVersion,
      organizationId: sealedKnowledge.organizationId,
      runId: sealedKnowledge.runId,
      releaseSha: sealedKnowledge.releaseSha,
      surfaceKey: sealedKnowledge.surfaceKey,
      selectedHypothesisType: sealedKnowledge.selectedHypothesisType,
      hypothesisId: sealedKnowledge.hypothesis.id,
      hypothesisKey: sealedKnowledge.hypothesis.hypothesisKey,
      hypothesisDefinitionDigest: sealedKnowledge.hypothesis.definitionDigest,
      hypothesisCreatedAt: sealedKnowledge.hypothesis.createdAt,
      lifecycleId: sealedKnowledge.lifecycle.id,
      lifecycleContentDigest: sealedKnowledge.lifecycle.contentDigest,
      lifecycleState: sealedKnowledge.lifecycle.state,
      lifecycleCreatedAt: sealedKnowledge.lifecycle.createdAt,
      evidence: sealedKnowledge.evidence,
      observation: sealedKnowledge.observation,
      trial: sealedKnowledge.trial,
      predictionId: sealedKnowledge.prediction.id,
      predictionSealDigestHex: sealedKnowledge.prediction.sealDigestHex,
      edgeId: sealedKnowledge.knowledgeEdge.id,
      edgeSealDigestHex: sealedKnowledge.knowledgeEdge.sealDigestHex,
      marketPitBoundary: sealedKnowledge.marketPitBoundary,
      snapshotContentDigestHex: sealedKnowledge.snapshotContentDigestHex,
    },
    projectHypothesis: (hypothesis, definition) => projectHistoricalPrerunHypothesisV2({
      organizationId: input.organizationId,
      runId: input.runId,
      releaseSha: ratified.releaseSha,
      surfaceKey: key,
      exchangeSymbol: input.symbol,
      instrumentId: instrumentId as "BTC/USDT" | "ETH/USDT",
      primaryHorizonMinutes: input.primaryHorizonMinutes,
      aggregateAdmissionContentDigestHex: ratified.aggregateAdmissionContentDigestHex,
      qualificationReceiptDigestHex:
        information.sourceAuthority.currentMembership.datasetAuthorityDigestHex!,
      predictivePackageContentDigestHex: surface.predictivePackageContentDigestHex,
      wfPredictiveStartUtc: marketEvidence.wfPredictiveStartUtc,
      wfPredictiveEndUtc: marketEvidence.wfPredictiveEndUtc,
    }, hypothesis, definition),
  }, {
    hypotheses: createPostgresMiHypothesisRepository(executor),
    evidence: createPostgresMiEvidenceRepository(executor),
    observations: createPostgresMiObservationRepository(executor),
    trials: createPostgresMiTrialRepository(executor),
    knowledgeSource: createMkbReadModelSourcePostgres(executor),
  });
  if (!canonicalState.hypotheses.some((hypothesis) =>
    hypothesis.lifecycleState === "VALIDATED" &&
    hypothesis.ordinalJudgment === "SUPPORTED" &&
    hypothesis.knowledgeRefs.some((edge) => edge.knowledgeState === "RESOLVED_CORRECT"))) {
    refuse("CANONICAL_KNOWLEDGE_NOT_READY");
  }
  let idOrdinal = 0;
  const evaluation = runEvaluationCycle({
    organizationId: input.organizationId,
    accountId: input.accountId,
    bars: information.sourceAuthority.warmupCycles.map((cycle) => cycle.closedBar),
    quote: { symbol: input.symbol, bid: current.closedBar.close,
      ask: current.closedBar.close, last: current.closedBar.close, timestamp: pitAnchor },
    fusedContext: {
      schemaVersion: "waia.trader.fused_context.v2",
      fusedAtUtc: pitAnchor,
      instrumentId,
      sessionPhase: "UNKNOWN",
      mtfBars: { "1m": [information.normalizedObservation] },
      aggregateHealth: "HEALTHY",
      aggregateConfidence: information.normalizedObservation.confidence,
      provenance: [information.normalizedObservation.provenance],
      degradationReasons: [],
    },
    evaluatedAt: pitAnchor,
    canonicalRuntimeIntelligenceState: canonicalState,
    historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
    informationSufficiencyAuthority: information.informationSufficiencyAuthority,
    runId: input.runId,
    cycleId: information.sourceAuthority.currentCycleId,
    symbol: instrumentId,
    newId: () => deterministicUuid({ runId: input.runId,
      cycleId: information.sourceAuthority.currentCycleId, idOrdinal: idOrdinal++ }),
  });
  if (!evaluation.intelligenceCycleBundle) refuse("INTELLIGENCE_CYCLE_NOT_SEALED");
  await persistIntelligenceCycleBundleWithinTransaction(
    { organizationId: input.organizationId },
    evaluation.intelligenceCycleBundle,
    executor,
  );
  const knowledgeBootstrap = buildHistoricalForecastKnowledgeBootstrapV2({
    organizationId: input.organizationId,
    symbol: input.symbol,
    horizonMinutes: predictivePackage.family.executionHorizonMinutes,
    predictivePackageContentDigestHex:
      digestHex(predictivePackage.predictivePackageContentDigest),
  });
  await persistHistoricalForecastKnowledgeBootstrapWithinTransactionV2(
    input.tx,
    knowledgeBootstrap,
  );
  const knowledgeSnapshotAuthority = await loadHistoricalKnowledgeSnapshotAuthorityV2(
    input.tx,
    { organizationId: input.organizationId, runId: input.runId,
      symbol: input.symbol, pitAnchor },
  );
  const runtimeInput = buildHistoricalForecastCycleRuntimeInputV2({
    releaseSha: ratified.releaseSha,
    organizationId: input.organizationId,
    runId: input.runId,
    accountId: input.accountId,
    symbol: input.symbol,
    venue: "HTX",
    analyticalTimeframe: "1m",
    horizon: `${input.primaryHorizonMinutes}m`,
    pitAnchor,
    runtimePosture: "FULL_ANALYSIS_AND_NEW_RISK",
    sourceProfileDigestHex: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST,
    representationProfileDigestHex: computeSemanticSha256Hex({
      schemaVersion: HISTORICAL_PRODUCTION_NEXT_CYCLE_FORECAST_V2,
      representation: "AUTHENTICATED_DYNAMIC_WALK_FORWARD_OHLCV_1M",
    }),
    runtimeContext: Object.freeze({
      mode: "HISTORICAL_PRE_HOLDOUT_NON_CAPITAL",
      datasetAuthorityContentDigestHex:
        information.sourceAuthority.currentDatasetAuthorityContentDigestHex,
      ratifiedAuthorityContentDigestHex: ratified.contentDigestHex,
    }),
    knowledgeBootstrap,
    knowledgeSnapshotAuthority,
    evaluation,
    requiredInformationProfile: information.requiredInformationProfile,
    informationSufficiencyReceipt: information.informationSufficiencyReceipt,
    forecastContractBinding: binding,
    scientificAdmissionReceipt: scientific,
    scientificAdmissionExpectedBindings: scientificExpected,
    predictivePackage,
    packageQuarantinedOrStale: false,
    integrityAndPitValid: true,
  });
  const persistedPackage = await persistPredictivePackageV2(input.tx, predictivePackage, {
    organizationId: input.organizationId,
    kmGlobalAnchorSetDigestHex: surface.kmGlobalAnchorSetDigestHex,
    idempotencyKey: deterministicUuid({ runId: input.runId, key, kind: "package" }),
  });
  await persistForecastContractBindingV1(input.tx, {
    id: deterministicUuid({ runId: input.runId, key, kind: "binding" }),
    binding,
    bindingJson: canonicalizeSemanticJsonString(binding),
  });
  const initialRecordIndex = await loadHistoricalSimulationInitialRecordIndexV2({
    tx: input.tx,
    organizationId: input.organizationId,
    accountId: input.accountId,
    runId: input.runId,
    partition: input.partition,
    symbol: input.symbol,
  });
  const issuanceSequence = input.expectedRecordIndex - initialRecordIndex;
  if (!Number.isSafeInteger(issuanceSequence) || issuanceSequence < 1) {
    refuse("ISSUANCE_SEQUENCE");
  }
  const issued = issueForecastRuntimeV2(runtimeInput);
  if (issued.status === "NON_ACTIONABLE") {
    if (
      issued.reason !== "MISSING_OR_NOT_ADMITTED" ||
      issued.upstreamReasonCodes.length !== 1 ||
      issued.upstreamReasonCodes[0] !== "HYPOTHESIS_NOT_APPLICABLE"
    ) {
      refuse(`FORECAST_${issued.reason}`);
    }
    return Object.freeze({
      status: "NON_ACTIONABLE" as const,
      information,
      issuanceSequence,
      runtimeInput,
      outcome: issued,
    });
  }
  const outcome = requireForecastRuntimeAuthorizedOutcomeV2(issued);
  const forecast = await persistHistoricalForecastCycleV2(input.tx, {
    organizationId: input.organizationId,
    packageId: persistedPackage.packageId,
    runId: input.runId,
    cycleId: information.sourceAuthority.currentCycleId,
    symbol: input.symbol,
    runtimeInput,
    issuanceSequence,
  });
  return Object.freeze({
    status: "FORECAST_AUTHORIZED" as const,
    information,
    forecastId: forecast.executionForecastId,
    bundleId: forecast.bundleId,
    issuanceSequence,
    forecastAuthorityContentDigestHex: outcome.authority.contentDigestHex,
    runtimeInput,
  });
}
