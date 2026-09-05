import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";

import * as pgSchema from "@/db/schema.postgres";
import {
  buildHistoricalDatasetTrustAuthorityV2,
  bindInformationSufficiencyReceiptAuthorityV2,
  defineRequiredInformationProfileV2,
  evaluateInformationSufficiencyV2,
  type InformationEvidenceV2,
  type InformationQuestionRequirementV2,
} from "@/lib/trader/intelligence/information-sufficiency";
import {
  persistInformationSufficiencyReceiptWithinTransactionV2Postgres,
  persistRequiredInformationProfileWithinTransactionV2Postgres,
  requireInformationSufficiencyAuthorityWithinTransactionV2Postgres,
} from
  "@/lib/trader/intelligence/information-sufficiency/information-sufficiency-repository-postgres";
import { CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION } from
  "@/lib/trader/mi/canonical-observation-v1";
import { persistCanonicalAvailableGatewayWithinHeldTransactionV1Postgres } from
  "@/lib/trader/mi/canonical-pit-service-postgres";
import { resolveAndPersistTrustAsOfV1Postgres } from
  "@/lib/trader/mi/trust-as-of-repository-postgres";
import { prepareCanonicalPitAttemptV1 } from
  "@/lib/trader/market-data/normalization/gateway-to-canonical-pit";
import type { NormalizedObservation } from
  "@/lib/trader/market-data/observation-types";
import { requireHistoricalFourSurfaceRatifiedAdmissionV2 } from
  "@/lib/trader/research/execopp-qualification/historical-four-surface-ratified-admission-v2";
import type { ForecastRuntimeInputV2 } from
  "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import { loadPostgresHistoricalForecastInputPitInTransactionV2 } from
  "./pit-forecast-input-loader-v2";
import { assertHistoricalEconomicTrustAsOfV2 } from "./economic-trust-as-of-v2";

import {
  prepareHistoricalProductionNextCycleAuthorityV2,
  type HistoricalProductionNextCycleAuthorityV2,
} from "./production-next-cycle-authority-v2";

export const HISTORICAL_PRODUCTION_NEXT_CYCLE_INFORMATION_V2 =
  "waia.trader.historical_production_next_cycle_information.v2" as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function refuse(code: string): never {
  throw new Error(`HISTORICAL_PRODUCTION_NEXT_CYCLE_INFORMATION_REFUSED:${code}`);
}

function informationRequirement(): InformationQuestionRequirementV2 {
  return Object.freeze({
    id: "canonical-walk-forward-price-state",
    questionId: "Q_WHAT_HAPPENING",
    classification: "MANDATORY",
    contextTriggerKey: null,
    satisfiers: Object.freeze([{
      evidenceFamily: "qualified_historical_price",
      providerIds: Object.freeze(["htx_spot_qualified_dataset"]),
      substitutionRuleId: null,
    }]),
    allowedObservationKinds: Object.freeze(["ohlcv_bar"] as const),
    allowedObservationSchemaVersions: Object.freeze([
      CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION,
    ]),
    allowedMeasurementDefinitionDigests: Object.freeze([]),
    maxStalenessMs: 0,
    minimumTrustScore: 1,
    minimumIndependentGroups: 1,
    contradictionPolicy: "FAIL_UNRESOLVED",
    requirePitQualified: true,
    requireReplayEligible: true,
    inquiryBounds: Object.freeze({ maxDepth: 0, maxDurationMs: 0, maxProviderFanout: 1 }),
  });
}

type PreviousRuntimeRow = Readonly<{
  forecast_id: string;
  cycle_id: string;
  record_index: number;
  pit_anchor: Date | string;
  knowledge_content_digest_hex: string;
  forecast_authority_content_digest_hex: string;
  dataset_authority_id: string;
}>;

export type HistoricalProductionNextCycleInformationV2 = Readonly<{
  sourceAuthority: HistoricalProductionNextCycleAuthorityV2;
  previousRuntimeInput: ForecastRuntimeInputV2;
  normalizedObservation: NormalizedObservation;
  requiredInformationProfile: ReturnType<typeof defineRequiredInformationProfileV2>;
  informationSufficiencyReceipt: ReturnType<typeof evaluateInformationSufficiencyV2>;
  informationSufficiencyAuthority: ReturnType<
    typeof bindInformationSufficiencyReceiptAuthorityV2
  >;
}>;

/**
 * Produces the dynamic, current-cycle information authority from durable rows only.
 * The immutable ratification contributes the release/WF/trust root; membership,
 * sealed bar and canonical observation are recomputed for exactly this cycle.
 */
export async function prepareHistoricalProductionNextCycleInformationV2(input: Readonly<{
  tx: postgres.Sql;
  organizationId: string;
  accountId: string;
  runId: string;
  partition: "WALK_FORWARD";
  symbol: "BTCUSDT" | "ETHUSDT";
  primaryHorizonMinutes: 30 | 60;
  expectedRecordIndex: number;
}>): Promise<HistoricalProductionNextCycleInformationV2> {
  const sourceAuthority = await prepareHistoricalProductionNextCycleAuthorityV2(input);
  const ratifiedRows = await input.tx<Array<Readonly<{
    id: string;
    release_sha: string;
    aggregate_admission_receipt_id: string;
    authority_content_digest_hex: string;
  }>>>`
    SELECT id::text, release_sha, aggregate_admission_receipt_id::text,
           authority_content_digest_hex
    FROM trader_historical_four_surface_ratified_admission_v2
    WHERE organization_id=${input.organizationId}::uuid AND run_id=${input.runId}
  `;
  const ratifiedRow = ratifiedRows[0];
  if (!ratifiedRow || ratifiedRows.length !== 1 || !UUID.test(ratifiedRow.id)) {
    refuse("RATIFICATION");
  }
  const ratified = await requireHistoricalFourSurfaceRatifiedAdmissionV2(input.tx, {
    organizationId: input.organizationId,
    runId: input.runId,
    releaseSha: ratifiedRow.release_sha,
    aggregateAdmissionReceiptId: ratifiedRow.aggregate_admission_receipt_id,
    authorityContentDigestHex: ratifiedRow.authority_content_digest_hex,
  });
  const rootEvidence = ratified.marketEvidence.find((entry) => entry.symbol === input.symbol);
  const surface = ratified.surfaceAdmissions.find((entry) =>
    entry.surfaceKey === `${input.symbol}:${input.primaryHorizonMinutes}`);
  if (!rootEvidence || !surface || rootEvidence.trustAuthorityKind !==
      "HISTORICAL_DATASET_TRUST") {
    refuse("RATIFIED_SURFACE");
  }

  const previousRows = await input.tx<PreviousRuntimeRow[]>`
    SELECT p.forecast_id::text, p.cycle_id, p.record_index, p.pit_anchor,
           p.knowledge_content_digest_hex,
           p.forecast_authority_content_digest_hex, p.dataset_authority_id::text
    FROM trader_historical_forecast_input_pit_v2 p
    WHERE p.organization_id=${input.organizationId}::uuid
      AND p.run_id=${input.runId}
      AND p.cycle_id=${sourceAuthority.previousCycleId}
      AND p.partition='WALK_FORWARD' AND p.symbol=${input.symbol}
  `;
  const previousRow = previousRows[0];
  if (!previousRow || previousRows.length !== 1) refuse("PREVIOUS_RUNTIME");
  const previousPitAnchor = new Date(previousRow.pit_anchor).toISOString();
  const previousRuntimeInput = await loadPostgresHistoricalForecastInputPitInTransactionV2(
    input.tx,
    {
      organizationId: input.organizationId,
      runId: input.runId,
      cycleId: previousRow.cycle_id,
      forecastId: previousRow.forecast_id,
      symbol: input.symbol,
      pitAnchor: previousPitAnchor,
      knowledgeContentDigestHex: previousRow.knowledge_content_digest_hex,
      forecastAuthorityContentDigestHex:
        previousRow.forecast_authority_content_digest_hex,
      datasetAuthorityId: previousRow.dataset_authority_id,
    },
  );
  if (previousRuntimeInput.marketStateSnapshot?.organizationId !== input.organizationId ||
      previousRuntimeInput.historicalIntelligenceCycleAuthority?.runId !== input.runId ||
      previousRuntimeInput.historicalIntelligenceCycleAuthority?.cycleId !==
        previousRow.cycle_id ||
      previousRow.record_index >= input.expectedRecordIndex ||
      previousRuntimeInput.marketStateSnapshot.symbol.replace("/", "") !== input.symbol ||
      previousRuntimeInput.forecastContractBinding
        ?.selectedPredictivePackageContentDigestHex !==
        surface.predictivePackageContentDigestHex) {
    refuse("PREVIOUS_RUNTIME_BINDING");
  }

  const pitAnchor = sourceAuthority.currentSealedCycle.closedBar.barCloseTime;
  const normalizedObservation: NormalizedObservation = Object.freeze({
    schemaVersion: "waia.trader.observation.v1",
    kind: "ohlcv_bar",
    interval: "1m",
    sessionPhase: "UNKNOWN",
    provenance: Object.freeze({
      providerId: "htx_spot",
      venue: "htx",
      feedKind: "ohlcv_bar",
      symbol: input.symbol,
      eventTimeUtc: pitAnchor,
      ingestTimeUtc: ratified.epistemicRecordCutoff,
    }),
    health: "HEALTHY",
    freshnessMs: 0,
    latencyMs: Math.max(0,
      Date.parse(ratified.epistemicRecordCutoff) - Date.parse(pitAnchor)),
    confidence: Number(rootEvidence.trustScore),
    payload: Object.freeze({
      barCount: 1,
      latestClose: sourceAuthority.currentSealedCycle.closedBar.close,
      latestBarCloseTime: pitAnchor,
    }),
  });
  const attempt = prepareCanonicalPitAttemptV1(normalizedObservation);
  if (attempt.status !== "AVAILABLE" || !attempt.kind || !attempt.subjectRef ||
      !attempt.payloadCanonical || !attempt.eventTimeUtc || !attempt.availableAtUtc ||
      !attempt.ingestTimeUtc || attempt.source?.symbol !== input.symbol) {
    refuse("CANONICAL_ATTEMPT");
  }
  const executor = drizzle(input.tx, { schema: pgSchema });
  const currentTrust = await resolveAndPersistTrustAsOfV1Postgres(
    executor,
    { organizationId: input.organizationId },
    {
      sourceId: rootEvidence.sourceId,
      anchorTime: new Date(attempt.availableAtUtc),
    },
  );
  assertHistoricalEconomicTrustAsOfV2({
    organizationId: input.organizationId,
    sourceId: rootEvidence.sourceId,
    economicPitAnchor: pitAnchor,
    canonicalRecordAvailableAt: attempt.availableAtUtc,
    canonicalRecordIngestTime: attempt.ingestTimeUtc,
    epistemicRecordCutoff: ratified.epistemicRecordCutoff,
    ratifiedTrustRevisionId: rootEvidence.trustRevisionId,
    ratifiedTrustRevisionContentDigestHex:
      rootEvidence.trustRevisionContentDigestHex,
    ratifiedTrustScore: rootEvidence.trustScore,
    receipt: currentTrust.receipt,
  });
  const stored = await persistCanonicalAvailableGatewayWithinHeldTransactionV1Postgres(
    executor,
    { organizationId: input.organizationId },
    {
      sourceId: rootEvidence.sourceId,
      observationKind: attempt.kind,
      subjectRef: attempt.subjectRef,
      payloadCanonical: attempt.payloadCanonical,
      eventTime: new Date(attempt.eventTimeUtc),
      availableAt: new Date(attempt.availableAtUtc),
      ingestTime: new Date(attempt.ingestTimeUtc),
      canonicalProviderId: attempt.providerId,
      trustAsOfReceiptId: currentTrust.receipt.id,
      normalizedInputDigest: attempt.normalizedInputDigest,
    },
  );
  const membership = sourceAuthority.currentMembership;
  if (membership.datasetAuthorityClass !== "PRE_HOLDOUT_QUALIFICATION_V1") {
    refuse("DATASET_CLASS");
  }
  const historicalDatasetTrustAuthority = buildHistoricalDatasetTrustAuthorityV2({
    organizationId: input.organizationId,
    symbol: input.symbol,
    runId: input.runId,
    releaseSha: ratified.releaseSha,
    ratifiedAdmissionId: ratifiedRow.id,
    ratifiedAdmissionContentDigestHex: ratified.contentDigestHex,
    epistemicRecordCutoff: ratified.epistemicRecordCutoff,
    datasetAuthorityId: sourceAuthority.currentDatasetAuthorityId,
    datasetAuthorityContentDigestHex:
      sourceAuthority.currentDatasetAuthorityContentDigestHex,
    datasetAuthorityDigestHex: membership.datasetAuthorityDigestHex,
    partitionRawSha256Hex: membership.partitionRawSha256Hex,
    membershipContentDigestHex: membership.contentDigestHex,
    sealedCycleContentDigestHex: sourceAuthority.currentSealedCycle.contentDigestHex,
    wfPredictiveSemanticContentDigestHex:
      rootEvidence.wfPredictiveSemanticContentDigestHex,
    wfPredictiveStartUtc: rootEvidence.wfPredictiveStartUtc,
    wfPredictiveEndUtc: rootEvidence.wfPredictiveEndUtc,
    publicAvailableAt: pitAnchor,
    canonicalRecordAvailableAt: stored.observation.availableAt.toISOString(),
    canonicalRecordIngestTime: stored.observation.ingestTime.toISOString(),
    sourceId: rootEvidence.sourceId,
    trustAsOfReceiptId: currentTrust.receipt.id,
    trustRevisionId: rootEvidence.trustRevisionId,
    trustRevisionContentDigestHex: rootEvidence.trustRevisionContentDigestHex,
    trustScore: Number(rootEvidence.trustScore),
    observationId: stored.observation.id,
    observationContentDigestHex: stored.observation.contentDigest,
  });
  const binding = previousRuntimeInput.forecastContractBinding;
  if (!binding) refuse("FORECAST_BINDING");
  const requiredInformationProfile = defineRequiredInformationProfileV2({
    organizationId: input.organizationId,
    accountId: input.accountId,
    profileVersion: HISTORICAL_PRODUCTION_NEXT_CYCLE_INFORMATION_V2,
    purpose: "NEW_OPPORTUNITY",
    symbol: input.symbol,
    venue: "htx",
    analyticalTimeframe: "1m",
    horizon: `${input.primaryHorizonMinutes}m`,
    forecastPackageId: "rv-state-conditional-empirical-joint/v1",
    forecastPackageContentDigest: binding.selectedPredictivePackageContentDigestHex,
    inputContractContentDigest: binding.inputContract.contentDigestHex,
    requirements: [informationRequirement()],
    aggregateQualityContract: null,
  });
  const evidence: InformationEvidenceV2 = Object.freeze({
    evidenceId: `${stored.observation.id}:historical-information-v2`,
    evidenceFamily: "qualified_historical_price",
    providerId: "htx_spot_qualified_dataset",
    sourceId: rootEvidence.sourceId,
    observationId: stored.observation.id,
    observationKind: "ohlcv_bar",
    observationSchemaVersion: CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION,
    observationContentDigest: stored.observation.contentDigest,
    trustAsOfReceiptId: currentTrust.receipt.id,
    trustRevisionId: rootEvidence.trustRevisionId,
    trustRevisionContentDigest: rootEvidence.trustRevisionContentDigestHex,
    measurementDefinitionId: null,
    measurementDefinitionContentDigest: null,
    measurementValueId: null,
    measurementValueContentDigest: null,
    availability: "AVAILABLE",
    availableAt: pitAnchor,
    trust: "TRUSTED",
    trustScore: Number(rootEvidence.trustScore),
    pitQualified: true,
    replayEligible: true,
    dependenceGroup: `qualified-walk-forward:${input.symbol}`,
    contradictionGroup: null,
    contradiction: "NONE",
    epistemicRole: "PRICE_STATE",
    historyScope: "WALK_FORWARD_PREDICTIVE",
    degradationReasonCodes: Object.freeze([]),
    historicalDatasetTrustAuthority,
  });
  const informationSufficiencyReceipt = evaluateInformationSufficiencyV2({
    profile: requiredInformationProfile,
    organizationId: input.organizationId,
    accountId: input.accountId,
    purpose: "NEW_OPPORTUNITY",
    symbol: input.symbol,
    venue: "htx",
    analyticalTimeframe: "1m",
    horizon: `${input.primaryHorizonMinutes}m`,
    pitAnchor,
    activeContextTriggers: [],
    evidence: [evidence],
  });
  if (informationSufficiencyReceipt.status !== "SUFFICIENT") {
    refuse("INFORMATION_SUFFICIENCY");
  }
  await persistRequiredInformationProfileWithinTransactionV2Postgres(
    executor,
    { organizationId: input.organizationId },
    requiredInformationProfile,
  );
  await persistInformationSufficiencyReceiptWithinTransactionV2Postgres(
    executor,
    { organizationId: input.organizationId },
    informationSufficiencyReceipt,
  );
  await requireInformationSufficiencyAuthorityWithinTransactionV2Postgres(
    executor,
    { organizationId: input.organizationId },
    requiredInformationProfile,
    informationSufficiencyReceipt,
  );
  return Object.freeze({
    sourceAuthority,
    previousRuntimeInput,
    normalizedObservation,
    requiredInformationProfile,
    informationSufficiencyReceipt,
    informationSufficiencyAuthority: bindInformationSufficiencyReceiptAuthorityV2(
      requiredInformationProfile,
      informationSufficiencyReceipt,
    ),
  });
}
