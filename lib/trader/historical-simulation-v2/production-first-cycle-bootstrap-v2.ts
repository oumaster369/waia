import { canonicalizeSemanticJsonString, computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { drizzle } from "drizzle-orm/postgres-js";
import * as pgSchema from "@/db/schema.postgres";
import { withRequiredSessionPostgresClient } from "@/db/postgres-client";
import {
  bindPostgresReservedSession,
  parsePostgresTimestamptz,
  withPostgresSerializableTransactionRetry,
} from
  "@/db/postgres-session-transaction";
import type postgres from "postgres";
import { getOptionalAdminSessionUserId } from "@/lib/auth/session-user";

import { deterministicExecutionUuidV2 } from "@/lib/trader/execution/v2/contracts";
import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import {
  persistPredictivePackageV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-v2-persistence-service";
import {
  persistForecastContractBindingV1,
} from "@/lib/trader/intelligence/forecast-v2/forecast-contract-binding-service-v1";
import { digestHex } from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import {
  issueForecastRuntimeV2,
  requireForecastRuntimeAuthorizedOutcomeV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import { buildPredictivePackageV1 } from
  "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import {
  HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
  HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST,
} from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import { foldCanonicalRuntimeIntelligenceStateV1 } from
  "@/lib/trader/intelligence/hypothesis/canonical-runtime-intelligence-fold-v1";
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
import {
  defineRequiredInformationProfileV2,
  evaluateInformationSufficiencyV2,
  buildHistoricalDatasetTrustAuthorityV2,
  bindInformationSufficiencyReceiptAuthorityV2,
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
import {
  assertFhvPreHoldoutQualificationPass,
  readFhvPreHoldoutQualificationReceipt,
} from "@/lib/trader/market-data/fhv-pre-holdout-qualification";
import type { KmFourSurfaceProductionPreflightInputV2 } from
  "@/lib/trader/research/execopp-qualification/km-four-surface-production-preflight-v2";
import {
  requireHistoricalFourSurfaceRatifiedAdmissionV2,
  type HistoricalFourSurfaceKeyV2,
  type HistoricalFourSurfaceRatifiedAdmissionV2,
} from "@/lib/trader/research/execopp-qualification/historical-four-surface-ratified-admission-v2";
import { projectHistoricalPrerunHypothesisV2 } from
  "@/lib/trader/research/execopp-qualification/historical-prerun-knowledge-bootstrap-v2";
import {
  requireScientificAdmissionV2,
  type ScientificAdmissionExpectedBindingsV2,
  type ScientificAdmissionReceiptV2,
} from "@/lib/trader/research/execopp-qualification/scientific-admission-v2";
import { readScientificAdmissionReceiptV1 } from
  "@/lib/trader/research/execopp-qualification/scientific-admission-receipt-service-v1";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { historicalInstrumentsMatch } from
  "@/lib/trader/symbols/historical-instrument";
import { persistIntelligenceCycleBundleWithinTransaction } from
  "@/lib/trader/intelligence/records/atomic-cycle-bundle-repository-postgres";

import { ensureHistoricalAccountingInceptionV2 } from "./accounting-inception-v2";
import {
  loadHistoricalSimulationBootstrapSourceSnapshotV2,
} from "./bootstrap-source-loader-v2";
import {
  createCanonicalDecisionVerificationReceiptServiceV2,
  createPostgresCanonicalDecisionVerificationReceiptPortV2,
  historicalDatasetAuthorityRunLockKeyV2,
} from "./canonical-verification-receipt-postgres-v2";
import { createPostgresDee659AuthorityRepositoryV2 } from
  "./dee659-authority-repository-postgres-v2";
import { loadHistoricalDevelopmentSourceCorpusSnapshotFromDatasetV2 } from
  "./development-source-corpus-v2";
import { buildHistoricalForecastAuthorityBootstrapV2 } from
  "./forecast-authority-bootstrap-v2";
import { buildHistoricalForecastCycleRuntimeInputV2 } from
  "./forecast-cycle-runtime-input-v2";
import { buildHistoricalForecastFamilyV2 } from "./forecast-family-bootstrap-v2";
import {
  buildHistoricalForecastKnowledgeBootstrapV2,
  persistHistoricalForecastKnowledgeBootstrapWithinTransactionV2,
} from
  "./forecast-knowledge-bootstrap-v2";
import { persistHistoricalForecastCycleV2 } from "./forecast-cycle-persistence-v2";
import { loadHistoricalKnowledgeSnapshotAuthorityV2 } from
  "./knowledge-snapshot-binding-v2";
import {
  createPostgresHistoricalForecastInputPitProducerV2,
  type HistoricalForecastInputPitRecordV2,
} from "./pit-forecast-input-producer-v2";

export const HISTORICAL_PRODUCTION_FIRST_CYCLE_BOOTSTRAP_V2 =
  "waia.trader.historical_production_first_cycle_bootstrap.v2" as const;

type VerificationService = ReturnType<typeof createCanonicalDecisionVerificationReceiptServiceV2>;
type HistoricalPolicyConfigV2 = Parameters<VerificationService["preregisterExecution"]>[0]["policyConfig"];

export type HistoricalProductionFirstCycleBootstrapInputV2 = Readonly<{
  preflight: KmFourSurfaceProductionPreflightInputV2;
  ratifiedAuthorityId: string;
  accountId: string;
  symbol: "BTCUSDT" | "ETHUSDT";
  primaryHorizonMinutes: 30 | 60;
  startingCashUsdt: string;
  defaultQuantity: string;
  policyConfig: HistoricalPolicyConfigV2;
}>;

export type HistoricalProductionFirstCycleBootstrapResultV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_PRODUCTION_FIRST_CYCLE_BOOTSTRAP_V2;
  organizationId: string;
  accountId: string;
  runId: string;
  partition: "WALK_FORWARD";
  symbol: "BTCUSDT" | "ETHUSDT";
  primaryHorizonMinutes: 30 | 60;
  cycleId: string;
  pitAnchor: string;
  forecastId: string;
  datasetAuthorityId: string;
  ratifiedAuthorityContentDigestHex: string;
  forecastInputContentDigestHex: string;
  authorityBoundary: Readonly<{
    capitalAuthority: "NONE";
    liveTradingAuthority: "NONE";
    blindHoldoutAuthority: "FORBIDDEN_NOT_PRESENT_NOT_ACCESSED";
  }>;
}>;

type ScientificRow = Readonly<{ receipt_json: string; content_digest: string }>;

export type HistoricalProductionFirstCycleStepV2 =
  | "RATIFICATION_READY"
  | "PACKAGE_READY"
  | "FORECAST_PERSISTED"
  | "ACCOUNTING_PERSISTED"
  | "PREREGISTERED"
  | "RUN_STARTED"
  | "VERIFICATIONS_PERSISTED"
  | "PIT_PERSISTED";

type InternalStepObserverV2 = (
  step: HistoricalProductionFirstCycleStepV2,
) => void | Promise<void>;

function refuse(code: string): never {
  throw new Error(`HISTORICAL_PRODUCTION_FIRST_CYCLE_REFUSED:${code}`);
}

function deterministicUuid(seed: Readonly<Record<string, unknown>>): string {
  return deterministicExecutionUuidV2("report", seed);
}

function surfaceKey(input: HistoricalProductionFirstCycleBootstrapInputV2):
HistoricalFourSurfaceKeyV2 {
  return `${input.symbol}:${input.primaryHorizonMinutes}`;
}

function validateInput(input: HistoricalProductionFirstCycleBootstrapInputV2): void {
  if (
    input.preflight.initialDevelopmentRecordIndex < 0 ||
    input.preflight.developmentCycleCount < 1 ||
    input.preflight.organizationId.trim() === "" || input.preflight.runId.trim() === "" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(input.ratifiedAuthorityId) ||
    input.accountId.trim() === "" || input.startingCashUsdt.trim() === "" ||
    input.defaultQuantity.trim() === "" ||
    input.preflight.releaseSha !== input.preflight.releaseSha.toLowerCase()
  ) refuse("INPUT");
}

async function loadExistingRatification(
  sql: postgres.Sql,
  input: HistoricalProductionFirstCycleBootstrapInputV2,
): Promise<HistoricalFourSurfaceRatifiedAdmissionV2 | null> {
  const rows = await sql<Array<Readonly<{
    aggregate_admission_receipt_id: string;
    authority_content_digest_hex: string;
    release_sha: string;
  }>>>`
    SELECT aggregate_admission_receipt_id::text, authority_content_digest_hex, release_sha
    FROM trader_historical_four_surface_ratified_admission_v2
    WHERE organization_id=${input.preflight.organizationId}::uuid
      AND run_id=${input.preflight.runId}
      AND id=${input.ratifiedAuthorityId}::uuid
    FOR SHARE
  `;
  if (rows.length > 1) refuse("RATIFICATION_AMBIGUOUS");
  const row = rows[0];
  if (!row) return null;
  if (row.release_sha !== input.preflight.releaseSha) refuse("RATIFICATION_RELEASE");
  return requireHistoricalFourSurfaceRatifiedAdmissionV2(sql, {
    organizationId: input.preflight.organizationId,
    runId: input.preflight.runId,
    releaseSha: input.preflight.releaseSha,
    aggregateAdmissionReceiptId: row.aggregate_admission_receipt_id,
    authorityContentDigestHex: row.authority_content_digest_hex,
  });
}

async function requireRatification(
  sql: postgres.Sql,
  input: HistoricalProductionFirstCycleBootstrapInputV2,
): Promise<HistoricalFourSurfaceRatifiedAdmissionV2> {
  const existing = await loadExistingRatification(sql, input);
  if (!existing) refuse("HUMAN_RATIFICATION_REQUIRED");
  return existing;
}

async function requireAuthenticatedOperatorMembership(
  sql: postgres.Sql,
  organizationId: string,
  authenticatedOperatorUserId: string,
): Promise<void> {
  const rows = await sql<Array<Readonly<{ member_role: string }>>>`
    SELECT member_role FROM organization_members
    WHERE organization_id=${organizationId}::uuid
      AND user_id=${authenticatedOperatorUserId}::uuid
    FOR SHARE
  `;
  if (
    rows.length !== 1 ||
    (rows[0]?.member_role !== "owner" && rows[0]?.member_role !== "manager")
  ) refuse("AUTHENTICATED_OPERATOR_MEMBERSHIP");
}

async function loadScientific(
  sql: postgres.Sql,
  authority: HistoricalFourSurfaceRatifiedAdmissionV2,
  key: HistoricalFourSurfaceKeyV2,
): Promise<Readonly<{
  receipt: ScientificAdmissionReceiptV2;
  expected: ScientificAdmissionExpectedBindingsV2;
}>> {
  const surface = authority.surfaceAdmissions.find((candidate) => candidate.surfaceKey === key);
  if (!surface) refuse("SURFACE");
  const rows = await sql<ScientificRow[]>`
    SELECT receipt_json, content_digest
    FROM trader_scientific_admission_receipt_v1
    WHERE organization_id=${authority.organizationId}::uuid
      AND id=${surface.scientificAdmissionReceiptId}::uuid
    FOR SHARE
  `;
  if (rows.length !== 1) refuse("SCIENTIFIC_ROW");
  let receipt: ScientificAdmissionReceiptV2;
  try { receipt = JSON.parse(rows[0]!.receipt_json) as ScientificAdmissionReceiptV2; }
  catch { return refuse("SCIENTIFIC_JSON"); }
  const predictive = receipt.predictiveTerminalReceipt;
  const expected: ScientificAdmissionExpectedBindingsV2 = {
    organizationId: authority.organizationId,
    developmentDatasetDigestHex: authority.developmentDatasetIdentityDigestHex,
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
  const admitted = requireScientificAdmissionV2(receipt, expected);
  if (
    rows[0]!.content_digest !== admitted.contentDigestHex ||
    admitted.contentDigestHex !== surface.scientificAdmissionContentDigestHex ||
    admitted.kmConvergenceReceipt.kmGlobalAnchorSetDigestHex !==
      surface.kmGlobalAnchorSetDigestHex
  ) refuse("SCIENTIFIC_BINDING");
  return Object.freeze({ receipt: admitted, expected });
}

function informationRequirement(): InformationQuestionRequirementV2 {
  return Object.freeze({
    id: "canonical-development-price-state",
    questionId: "Q_WHAT_HAPPENING",
    classification: "MANDATORY",
    contextTriggerKey: null,
    satisfiers: Object.freeze([{
      evidenceFamily: "qualified_historical_price",
      providerIds: Object.freeze(["htx_spot_qualified_dataset"]),
      substitutionRuleId: null,
    }]),
    allowedObservationKinds: Object.freeze(["ohlcv_bar"] as const),
    allowedObservationSchemaVersions: Object.freeze([CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION]),
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

async function prepareFirstCycleWithHeldPostgres(
  sql: postgres.Sql,
  input: HistoricalProductionFirstCycleBootstrapInputV2,
  authenticatedOperatorUserId: string,
  onStep?: InternalStepObserverV2,
): Promise<HistoricalProductionFirstCycleBootstrapResultV2> {
  await requireAuthenticatedOperatorMembership(
    sql,
    input.preflight.organizationId,
    authenticatedOperatorUserId,
  );
  const existingStart = await sql<Array<Readonly<{ started: boolean }>>>`
    SELECT EXISTS (
      SELECT 1 FROM trader_historical_simulation_run_start_v2
      WHERE organization_id=${input.preflight.organizationId}::uuid
        AND run_id=${input.preflight.runId}
    ) AS started
  `;
  const ratification = await loadExistingRatification(sql, input);
  if (existingStart[0]?.started && !ratification) refuse("PARTIAL_STARTED_WITHOUT_RATIFICATION");
  const authority = ratification ?? await requireRatification(sql, input);
  await onStep?.("RATIFICATION_READY");
  const key = surfaceKey(input);
  const surface = authority.surfaceAdmissions.find((candidate) => candidate.surfaceKey === key);
  if (!surface) refuse("SURFACE");
  const scientific = await loadScientific(sql, authority, key);

  const qualification = readFhvPreHoldoutQualificationReceipt(
    input.preflight.qualificationReceiptPath,
  );
  assertFhvPreHoldoutQualificationPass(qualification);
  const wfPredictive = qualification.canonicalBoundaries.wfPredictive;
  const wfEconomic = qualification.canonicalBoundaries.wfEconomic;
  const predictivePartition = qualification.scientificSubpartitions.find((entry) =>
    entry.scientificPartition === "WF_PREDICTIVE" && entry.symbol === input.symbol);
  const economicPartition = qualification.scientificSubpartitions.find((entry) =>
    entry.scientificPartition === "WF_ECONOMIC" && entry.symbol === input.symbol);
  if (
    qualification.organizationId !== authority.organizationId ||
    qualification.holdout.status !== "PRE_HOLDOUT_ONLY_NOT_PRESENT_NOT_ACCESSED" ||
    wfPredictive.startUtc !== qualification.canonicalBoundaries.walkForward.startUtc ||
    wfPredictive.endUtc !== wfEconomic.startUtc ||
    !predictivePartition || !economicPartition || predictivePartition.barCount < 240 ||
    predictivePartition.startUtc !== wfPredictive.startUtc ||
    predictivePartition.endUtc !== wfPredictive.endUtc ||
    economicPartition.startUtc !== wfEconomic.startUtc ||
    economicPartition.endUtc !== wfEconomic.endUtc
  ) refuse("SCIENTIFIC_PARTITION_BOUNDARY");

  const corpusSnapshot = await loadHistoricalDevelopmentSourceCorpusSnapshotFromDatasetV2({
    datasetRoot: input.preflight.datasetRoot,
    symbol: input.symbol,
    primaryHorizonMinutes: input.primaryHorizonMinutes,
  });
  const family = buildHistoricalForecastFamilyV2({
    organizationId: authority.organizationId,
    symbol: input.symbol,
    primaryHorizonMinutes: input.primaryHorizonMinutes,
    developmentDatasetDigestHex: authority.developmentDatasetIdentityDigestHex,
    releaseSha: authority.releaseSha,
  });
  const predictivePackage = buildPredictivePackageV1({
    family,
    sourceCorpus: corpusSnapshot.corpus,
    kConfigDec: surface.humanRatificationReceipt.selectedK,
    mConfigDec: surface.humanRatificationReceipt.selectedM,
  });
  if (
    digestHex(predictivePackage.predictivePackageContentDigest) !==
      surface.predictivePackageContentDigestHex ||
    digestHex(predictivePackage.predictivePackageGenerationIdentityDigest) !==
      surface.predictivePackageGenerationIdentityDigestHex
  ) refuse("PACKAGE_REPLAY");

  // Forecast is issued exactly at the epistemically sealed boundary: the close of the
  // final WF_PREDICTIVE bar. The next bar is the first WF_ECONOMIC execution observation.
  const firstRecordIndex = predictivePartition.barCount - 1;
  const warmup = await loadHistoricalSimulationBootstrapSourceSnapshotV2({
    datasetRoot: input.preflight.datasetRoot,
    qualificationReceiptPath: input.preflight.qualificationReceiptPath,
    runtimeRequalificationReceiptPath: input.preflight.runtimeRequalificationReceiptPath,
    htxVolumeQualificationReceiptPath:
      input.preflight.htxVolumeQualificationReceiptPaths[input.symbol],
    releaseSha: authority.releaseSha,
    organizationId: authority.organizationId,
    runId: authority.runId,
    partition: "WALK_FORWARD",
    symbol: input.symbol,
    initialRecordIndex: firstRecordIndex - 239,
    cycleCount: 240,
  });
  const walkForwardPartition = qualification.partitions.find((entry) =>
    entry.partition === "walk-forward" && entry.symbol === input.symbol);
  if (!walkForwardPartition ||
      warmup.partitionRawSha256Hex !== walkForwardPartition.rawSha256) {
    refuse("WALK_FORWARD_BYTES_CHANGED");
  }
  const current = warmup.sources.at(-1)!;
  const evaluationInstrumentId = current.cycle.closedBar.symbol;
  if (!historicalInstrumentsMatch(
    evaluationInstrumentId,
    predictivePackage.family.symbol,
  )) {
    refuse("QUALIFIED_INSTRUMENT_IDENTITY");
  }
  const cycleId = `${authority.runId}:WALK_FORWARD:${input.symbol}:${firstRecordIndex}`;
  if (current.cycle.cycleId !== cycleId || current.membership.recordIndex !== firstRecordIndex) {
    refuse("FIRST_CYCLE_IDENTITY");
  }
  if (current.cycle.closedBar.barCloseTime !== wfEconomic.startUtc) {
    refuse("FIRST_FORECAST_NOT_AT_ECONOMIC_BOUNDARY");
  }
  const verification = createCanonicalDecisionVerificationReceiptServiceV2(sql);
  const registration = await verification.registerPreHoldoutDatasetAuthorityFromSource({
    datasetRoot: input.preflight.datasetRoot,
    qualificationReceiptPath: input.preflight.qualificationReceiptPath,
    runtimeRequalificationReceiptPath: input.preflight.runtimeRequalificationReceiptPath,
    htxVolumeQualificationReceiptPath:
      input.preflight.htxVolumeQualificationReceiptPaths[input.symbol],
    releaseSha: authority.releaseSha,
    organizationId: authority.organizationId,
    runId: authority.runId,
    partition: "WALK_FORWARD",
    symbol: input.symbol,
    initialRecordIndex: firstRecordIndex,
    cycleCount: 1,
  });
  if (registration.cycleIds.length !== 1 || registration.cycleIds[0] !== cycleId ||
      registration.partitionRawSha256Hex !== warmup.partitionRawSha256Hex) {
    refuse("WALK_FORWARD_DATASET_REGISTRATION");
  }
  const datasetRows = await sql<Array<Readonly<{
    id: string;
    dataset_authority_digest_hex: string;
    partition_raw_sha256_hex: string;
    membership_content_digest_hex: string;
    sealed_cycle_content_digest_hex: string;
    authority_content_digest_hex: string;
    membership_json: unknown;
    sealed_cycle_json: unknown;
  }>>>`
    SELECT id::text, dataset_authority_digest_hex,
      membership_json->>'partitionRawSha256Hex' AS partition_raw_sha256_hex,
      membership_content_digest_hex, sealed_cycle_content_digest_hex,
      authority_content_digest_hex, membership_json, sealed_cycle_json
    FROM trader_historical_dataset_authority_v2
    WHERE organization_id=${authority.organizationId}::uuid AND run_id=${authority.runId}
      AND cycle_id=${cycleId} AND dataset_authority_class='PRE_HOLDOUT_QUALIFICATION_V1'
    FOR SHARE
  `;
  const dataset = datasetRows[0];
  if (
    datasetRows.length !== 1 || !dataset ||
    dataset.partition_raw_sha256_hex !== warmup.partitionRawSha256Hex ||
    dataset.authority_content_digest_hex !== computeStableJsonDigest({
      organizationId: authority.organizationId,
      runId: authority.runId,
      membership: dataset.membership_json,
      sealedCycle: dataset.sealed_cycle_json,
    })
  ) refuse("DATASET_AUTHORITY");
  const sealedMarketEvidence = authority.marketEvidence.find((entry) =>
    entry.symbol === input.symbol);
  if (!sealedMarketEvidence ||
      sealedMarketEvidence.trustAuthorityKind !== "HISTORICAL_DATASET_TRUST" ||
      sealedMarketEvidence.qualificationReceiptDigestHex !==
        qualification.qualificationReceiptDigest ||
      sealedMarketEvidence.datasetAuthorityId !== dataset.id ||
      sealedMarketEvidence.datasetAuthorityContentDigestHex !==
        dataset.authority_content_digest_hex ||
      sealedMarketEvidence.datasetAuthorityDigestHex !== dataset.dataset_authority_digest_hex ||
      sealedMarketEvidence.partitionRawSha256Hex !== dataset.partition_raw_sha256_hex ||
      sealedMarketEvidence.membershipContentDigestHex !==
        dataset.membership_content_digest_hex ||
      sealedMarketEvidence.sealedCycleContentDigestHex !==
        dataset.sealed_cycle_content_digest_hex ||
      sealedMarketEvidence.wfPredictiveSemanticContentDigestHex !==
        predictivePartition.semanticContentDigest ||
      sealedMarketEvidence.wfPredictiveStartUtc !== wfPredictive.startUtc ||
      sealedMarketEvidence.wfPredictiveEndUtc !== wfPredictive.endUtc ||
      sealedMarketEvidence.publicAvailableAt !== current.cycle.closedBar.barCloseTime ||
      sealedMarketEvidence.observationEventTime !== current.cycle.closedBar.barCloseTime) {
    refuse("HISTORICAL_DATASET_TRUST_AUTHORITY");
  }

  const authorityBootstrap = buildHistoricalForecastAuthorityBootstrapV2({
    organizationId: authority.organizationId,
    scientificAdmissionReceiptId: surface.scientificAdmissionReceiptId,
    scientificAdmissionReceipt: scientific.receipt,
    scientificAdmissionExpectedBindings: scientific.expected,
    predictivePackage,
  });
  const pitAnchor = current.cycle.closedBar.barCloseTime;
  const ratificationRows = await sql<Array<Readonly<{
    id: string; authority_content_digest_hex: string; created_at: Date | string;
  }>>>`
    SELECT id::text, authority_content_digest_hex, created_at
    FROM trader_historical_four_surface_ratified_admission_v2
    WHERE organization_id=${authority.organizationId}::uuid
      AND run_id=${authority.runId} AND id=${input.ratifiedAuthorityId}::uuid
    FOR SHARE
  `;
  const ratificationRow = ratificationRows[0];
  const ratificationCreatedAt = ratificationRow
    ? parsePostgresTimestamptz(ratificationRow.created_at)
    : null;
  if (ratificationRows.length !== 1 || !ratificationRow ||
      !ratificationCreatedAt || !Number.isFinite(ratificationCreatedAt.getTime()) ||
      ratificationRow.authority_content_digest_hex !== authority.contentDigestHex ||
      ratificationCreatedAt.getTime() < Date.parse(pitAnchor) ||
      authority.epistemicRecordCutoff !== ratificationCreatedAt.toISOString()) {
    refuse("EPISTEMIC_AUTHORITY");
  }
  const sealedKnowledge = authority.knowledgeSnapshots.find((snapshot) =>
    snapshot.surfaceKey === key);
  if (!sealedKnowledge || sealedKnowledge.marketPitBoundary !== pitAnchor) {
    refuse("SEALED_KNOWLEDGE_AUTHORITY");
  }
  const executor = drizzle(sql, { schema: pgSchema });
  const canonicalState = await foldCanonicalRuntimeIntelligenceStateV1({
    context: { organizationId: authority.organizationId },
    symbol: evaluationInstrumentId,
    asOf: new Date(pitAnchor),
    epistemicRecordCutoff: ratificationCreatedAt,
    epistemicAuthority: {
      schemaVersion: "waia.trader.historical_four_surface_ratified_admission.v2",
      ratifiedAdmissionId: ratificationRow.id,
      authorityContentDigestHex: ratificationRow.authority_content_digest_hex,
      createdAt: ratificationCreatedAt,
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
      organizationId: authority.organizationId,
      runId: authority.runId,
      releaseSha: authority.releaseSha,
      surfaceKey: key,
      exchangeSymbol: input.symbol,
      instrumentId: evaluationInstrumentId as "BTC/USDT" | "ETH/USDT",
      primaryHorizonMinutes: input.primaryHorizonMinutes,
      aggregateAdmissionContentDigestHex: authority.aggregateAdmissionContentDigestHex,
      qualificationReceiptDigestHex: qualification.qualificationReceiptDigest,
      predictivePackageContentDigestHex: surface.predictivePackageContentDigestHex,
      wfPredictiveStartUtc: wfPredictive.startUtc,
      wfPredictiveEndUtc: wfPredictive.endUtc,
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
  const binding = authorityBootstrap.forecastContractBinding;
  const requiredInformationProfile = defineRequiredInformationProfileV2({
    organizationId: authority.organizationId,
    accountId: input.accountId,
    profileVersion: HISTORICAL_PRODUCTION_FIRST_CYCLE_BOOTSTRAP_V2,
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
  const historicalDatasetTrustAuthority = buildHistoricalDatasetTrustAuthorityV2({
    organizationId: authority.organizationId,
    symbol: input.symbol,
    runId: authority.runId,
    releaseSha: authority.releaseSha,
    ratifiedAdmissionId: input.ratifiedAuthorityId,
    ratifiedAdmissionContentDigestHex: authority.contentDigestHex,
    epistemicRecordCutoff: authority.epistemicRecordCutoff,
    datasetAuthorityId: sealedMarketEvidence.datasetAuthorityId,
    datasetAuthorityContentDigestHex: sealedMarketEvidence.datasetAuthorityContentDigestHex,
    datasetAuthorityDigestHex: sealedMarketEvidence.datasetAuthorityDigestHex,
    partitionRawSha256Hex: sealedMarketEvidence.partitionRawSha256Hex,
    membershipContentDigestHex: sealedMarketEvidence.membershipContentDigestHex,
    sealedCycleContentDigestHex: sealedMarketEvidence.sealedCycleContentDigestHex,
    wfPredictiveSemanticContentDigestHex:
      sealedMarketEvidence.wfPredictiveSemanticContentDigestHex,
    wfPredictiveStartUtc: sealedMarketEvidence.wfPredictiveStartUtc,
    wfPredictiveEndUtc: sealedMarketEvidence.wfPredictiveEndUtc,
    publicAvailableAt: sealedMarketEvidence.publicAvailableAt,
    canonicalRecordAvailableAt: sealedMarketEvidence.observationAvailableAt,
    canonicalRecordIngestTime: sealedMarketEvidence.observationIngestTime,
    sourceId: sealedMarketEvidence.sourceId,
    trustAsOfReceiptId: sealedMarketEvidence.trustAsOfReceiptId,
    trustRevisionId: sealedMarketEvidence.trustRevisionId,
    trustRevisionContentDigestHex: sealedMarketEvidence.trustRevisionContentDigestHex,
    trustScore: Number(sealedMarketEvidence.trustScore),
    observationId: sealedMarketEvidence.observationId,
    observationContentDigestHex: sealedMarketEvidence.observationContentDigestHex,
  });
  const evidence: InformationEvidenceV2 = Object.freeze({
    evidenceId: deterministicUuid({ runId: authority.runId, cycleId, kind: "price-evidence" }),
    evidenceFamily: "qualified_historical_price",
    providerId: "htx_spot_qualified_dataset",
    sourceId: sealedMarketEvidence.sourceId,
    observationId: sealedMarketEvidence.observationId,
    observationKind: "ohlcv_bar",
    observationSchemaVersion: CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION,
    observationContentDigest: sealedMarketEvidence.observationContentDigestHex,
    trustAsOfReceiptId: sealedMarketEvidence.trustAsOfReceiptId,
    trustRevisionId: sealedMarketEvidence.trustRevisionId,
    trustRevisionContentDigest: sealedMarketEvidence.trustRevisionContentDigestHex,
    measurementDefinitionId: null,
    measurementDefinitionContentDigest: null,
    measurementValueId: null,
    measurementValueContentDigest: null,
    availability: "AVAILABLE",
    availableAt: pitAnchor,
    trust: "TRUSTED",
    trustScore: Number(sealedMarketEvidence.trustScore),
    pitQualified: true,
    replayEligible: true,
    dependenceGroup: `qualified-wf-predictive-boundary:${input.symbol}`,
    contradictionGroup: null,
    contradiction: "NONE",
    epistemicRole: "PRICE_STATE",
    historyScope: "WALK_FORWARD_PREDICTIVE",
    degradationReasonCodes: Object.freeze([]),
    historicalDatasetTrustAuthority,
  });
  const informationSufficiencyReceipt = evaluateInformationSufficiencyV2({
    profile: requiredInformationProfile,
    organizationId: authority.organizationId,
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
  if (informationSufficiencyReceipt.status !== "SUFFICIENT") refuse("INFORMATION_SUFFICIENCY");
  await persistRequiredInformationProfileWithinTransactionV2Postgres(
    executor,
    { organizationId: authority.organizationId },
    requiredInformationProfile,
  );
  await persistInformationSufficiencyReceiptWithinTransactionV2Postgres(
    executor,
    { organizationId: authority.organizationId },
    informationSufficiencyReceipt,
  );
  await requireInformationSufficiencyAuthorityWithinTransactionV2Postgres(
    executor,
    { organizationId: authority.organizationId },
    requiredInformationProfile,
    informationSufficiencyReceipt,
  );
  const informationSufficiencyAuthority = bindInformationSufficiencyReceiptAuthorityV2(
    requiredInformationProfile,
    informationSufficiencyReceipt,
  );
  const normalizedBoundaryObservation = Object.freeze({
    schemaVersion: "waia.trader.observation.v1" as const,
    kind: "ohlcv_bar" as const,
    interval: "1m" as const,
    sessionPhase: "UNKNOWN" as const,
    provenance: Object.freeze({
      providerId: "htx_spot" as const,
      venue: "htx",
      feedKind: "ohlcv_bar",
      symbol: input.symbol,
      eventTimeUtc: pitAnchor,
      ingestTimeUtc: sealedMarketEvidence.observationIngestTime,
    }),
    health: "HEALTHY" as const,
    freshnessMs: 0,
    latencyMs: Math.max(0,
      Date.parse(sealedMarketEvidence.observationIngestTime) - Date.parse(pitAnchor)),
    confidence: Number(sealedMarketEvidence.trustScore),
    payload: Object.freeze({
      barCount: 1,
      latestClose: current.cycle.closedBar.close,
      latestBarCloseTime: pitAnchor,
    }),
  });
  if (computeStableJsonDigest(normalizedBoundaryObservation) !==
      sealedMarketEvidence.normalizedInputDigestHex) {
    refuse("CANONICAL_MARKET_OBSERVATION_REPLAY");
  }
  let idOrdinal = 0;
  const evaluation = runEvaluationCycle({
    organizationId: authority.organizationId,
    accountId: input.accountId,
    bars: warmup.sources.map((source) => source.cycle.closedBar),
    quote: {
      symbol: input.symbol,
      bid: current.cycle.closedBar.close,
      ask: current.cycle.closedBar.close,
      last: current.cycle.closedBar.close,
      timestamp: pitAnchor,
    },
    fusedContext: {
      schemaVersion: "waia.trader.fused_context.v2",
      fusedAtUtc: pitAnchor,
      instrumentId: evaluationInstrumentId,
      sessionPhase: "UNKNOWN",
      mtfBars: { "1m": [normalizedBoundaryObservation] },
      aggregateHealth: "HEALTHY",
      aggregateConfidence: Number(sealedMarketEvidence.trustScore),
      provenance: [normalizedBoundaryObservation.provenance],
      degradationReasons: [],
    },
    evaluatedAt: pitAnchor,
    canonicalRuntimeIntelligenceState: canonicalState,
    historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
    informationSufficiencyAuthority,
    runId: authority.runId,
    cycleId,
    symbol: evaluationInstrumentId,
    newId: () => deterministicUuid({ runId: authority.runId, cycleId, idOrdinal: idOrdinal++ }),
  });
  if (!evaluation.intelligenceCycleBundle) {
    refuse("INTELLIGENCE_CYCLE_NOT_SEALED");
  }
  await persistIntelligenceCycleBundleWithinTransaction(
    { organizationId: authority.organizationId },
    evaluation.intelligenceCycleBundle,
    executor,
  );
  const knowledgeBootstrap = buildHistoricalForecastKnowledgeBootstrapV2({
    organizationId: authority.organizationId,
    symbol: input.symbol,
    horizonMinutes: predictivePackage.family.executionHorizonMinutes,
    predictivePackageContentDigestHex:
      digestHex(predictivePackage.predictivePackageContentDigest),
  });
  await persistHistoricalForecastKnowledgeBootstrapWithinTransactionV2(
    sql,
    knowledgeBootstrap,
  );
  const knowledgeSnapshotAuthority = await loadHistoricalKnowledgeSnapshotAuthorityV2(sql, {
    organizationId: authority.organizationId,
    runId: authority.runId,
    symbol: input.symbol,
    pitAnchor,
  });
  if (knowledgeSnapshotAuthority.visibleEvidenceCount !== 0) {
    refuse("FIRST_CYCLE_KNOWLEDGE_NOT_EMPTY");
  }
  const runtimeInput = buildHistoricalForecastCycleRuntimeInputV2({
    releaseSha: authority.releaseSha,
    organizationId: authority.organizationId,
    runId: authority.runId,
    accountId: input.accountId,
    symbol: input.symbol,
    venue: "HTX",
    analyticalTimeframe: "1m",
    horizon: `${input.primaryHorizonMinutes}m`,
    pitAnchor,
    runtimePosture: "FULL_ANALYSIS_AND_NEW_RISK",
    sourceProfileDigestHex: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST,
    representationProfileDigestHex: computeSemanticSha256Hex({
      schemaVersion: HISTORICAL_PRODUCTION_FIRST_CYCLE_BOOTSTRAP_V2,
      representation: "AUTHENTICATED_WF_PREDICTIVE_BOUNDARY_OHLCV_1M",
    }),
    runtimeContext: Object.freeze({
      mode: "HISTORICAL_PRE_HOLDOUT_NON_CAPITAL",
      datasetAuthorityContentDigestHex: dataset.authority_content_digest_hex,
      ratifiedAuthorityContentDigestHex: authority.contentDigestHex,
    }),
    knowledgeBootstrap,
    knowledgeSnapshotAuthority,
    evaluation,
    requiredInformationProfile,
    informationSufficiencyReceipt,
    forecastContractBinding: binding,
    scientificAdmissionReceipt: scientific.receipt,
    scientificAdmissionExpectedBindings: scientific.expected,
    predictivePackage,
    packageQuarantinedOrStale: false,
    integrityAndPitValid: true,
  });

  const persistedPackage = await persistPredictivePackageV2(sql, predictivePackage, {
    organizationId: authority.organizationId,
    kmGlobalAnchorSetDigestHex: surface.kmGlobalAnchorSetDigestHex,
    idempotencyKey: deterministicUuid({ runId: authority.runId, key, kind: "package" }),
  });
  await persistForecastContractBindingV1(sql, {
    id: deterministicUuid({ runId: authority.runId, key, kind: "binding" }),
    binding,
    bindingJson: canonicalizeSemanticJsonString(binding),
  });
  await onStep?.("PACKAGE_READY");
  const forecast = await persistHistoricalForecastCycleV2(sql, {
    organizationId: authority.organizationId,
    packageId: persistedPackage.packageId,
    runId: authority.runId,
    cycleId,
    symbol: input.symbol,
    runtimeInput,
    issuanceSequence: 0,
  });
  await onStep?.("FORECAST_PERSISTED");
  const accounting = await ensureHistoricalAccountingInceptionV2(sql, {
    organizationId: authority.organizationId,
    accountId: input.accountId,
    runId: authority.runId,
    frontierAsOf: pitAnchor,
    startingCash: input.startingCashUsdt,
  });
  await onStep?.("ACCOUNTING_PERSISTED");
  const preregistration = await verification.preregisterExecution({
    organizationId: authority.organizationId,
    accountId: input.accountId,
    runId: authority.runId,
    forecastId: forecast.executionForecastId,
    datasetAuthorityId: dataset.id,
    cycleId,
    policyConfig: input.policyConfig,
    defaultQuantity: input.defaultQuantity,
    initialAccountingFrontierId: accounting.frontier.id,
  });
  await onStep?.("PREREGISTERED");
  await verification.startRun({
    organizationId: authority.organizationId,
    accountId: input.accountId,
    runId: authority.runId,
    preregistrationId: preregistration.preregistrationId,
    datasetAuthorityDigestHex: preregistration.datasetAuthorityDigestHex,
  });
  await onStep?.("RUN_STARTED");
  const issuedForecastOutcome = issueForecastRuntimeV2(runtimeInput);
  if (issuedForecastOutcome.status !== "FORECAST_AUTHORIZED") {
    refuse(`FORECAST_${issuedForecastOutcome.reason}`);
  }
  const forecastOutcome = requireForecastRuntimeAuthorizedOutcomeV2(issuedForecastOutcome);
  await verification.issueForecast({
    organizationId: authority.organizationId,
    forecastId: forecast.executionForecastId,
    subjectContentDigestHex: forecastOutcome.authority.contentDigestHex,
  });
  await verification.issueScientific({
    organizationId: authority.organizationId,
    runId: authority.runId,
    forecastId: forecast.executionForecastId,
    scientificAdmissionContentDigestHex: scientific.receipt.contentDigestHex,
  });
  const executionVerification = await verification.issueExecution({
    preregistrationId: preregistration.preregistrationId,
    organizationId: authority.organizationId,
    accountId: input.accountId,
    runId: authority.runId,
    forecastId: forecast.executionForecastId,
    datasetAuthorityDigestHex: preregistration.datasetAuthorityDigestHex,
    pitAnchor,
    subjectContentDigestHex: {
      anchor: preregistration.authorities.anchor.contentDigestHex,
      executablePolicy: preregistration.authorities.executablePolicy.contentDigestHex,
      economicSize: preregistration.authorities.economicSize.contentDigestHex,
      cash: preregistration.authorities.cash.contentDigestHex,
    },
  });
  const verificationPort = createPostgresCanonicalDecisionVerificationReceiptPortV2(sql);
  const forecastVerification = await verificationPort.loadForecastVerification({
    organizationId: authority.organizationId,
    forecastId: forecast.executionForecastId,
    subjectContentDigestHex: forecastOutcome.authority.contentDigestHex,
  });
  const scientificVerification = await verificationPort.loadScientificVerification({
    organizationId: authority.organizationId,
    forecastId: forecast.executionForecastId,
    scientificAdmissionContentDigestHex: scientific.receipt.contentDigestHex,
  });
  const scientificRecord = await readScientificAdmissionReceiptV1(sql, {
    organizationId: authority.organizationId,
    evidenceSemanticDigestHex: scientific.receipt.evidenceSemanticDigestHex,
  });
  if (!scientificRecord || scientificRecord.id !== surface.scientificAdmissionReceiptId) {
    refuse("SCIENTIFIC_RECORD_REPLAY");
  }
  const bundleRows = await sql<Array<Readonly<{ digest: string }>>>`
    SELECT encode(bundle_content_digest,'hex') AS digest
    FROM trader_forecast_bundle_v2
    WHERE organization_id=${authority.organizationId}::uuid AND id=${forecast.bundleId}::uuid
  `;
  if (bundleRows.length !== 1) refuse("FORECAST_BUNDLE");
  await createPostgresDee659AuthorityRepositoryV2({
    sql,
    verificationReceipts: verificationPort,
  }).persist({
    organizationId: authority.organizationId,
    accountId: input.accountId,
    runId: authority.runId,
    cycleId,
    forecastId: forecast.executionForecastId,
    forecastAuthorityContentDigestHex: forecastOutcome.authority.contentDigestHex,
    datasetAuthorityDigestHex: preregistration.datasetAuthorityDigestHex,
    dee659PreregistrationId: preregistration.preregistrationId,
    pitAnchor,
    forecastIssuanceReceiptDigestHex: bundleRows[0]!.digest,
    forecastVerificationReceiptDigestHex:
      forecastVerification.verificationReceiptDigestHex,
    scientificAdmission: scientificRecord,
    scientificVerificationReceiptDigestHex:
      scientificVerification.verificationReceiptDigestHex,
    anchorAuthority: preregistration.authorities.anchor,
    executablePolicy: preregistration.authorities.executablePolicy,
    economicSizeSet: preregistration.authorities.economicSize,
    cashAuthority: preregistration.authorities.cash,
    executionPayoffVerification: executionVerification,
  });
  await onStep?.("VERIFICATIONS_PERSISTED");
  const pitRecord = await createPostgresHistoricalForecastInputPitProducerV2(sql)({
    organizationId: authority.organizationId,
    runId: authority.runId,
    cycleId,
    forecastId: forecast.executionForecastId,
    symbol: input.symbol,
    pitAnchor,
    datasetAuthorityId: dataset.id,
  });
  await onStep?.("PIT_PERSISTED");
  return resultFromPit(input, authority, pitRecord);
}

function resultFromPit(
  input: HistoricalProductionFirstCycleBootstrapInputV2,
  authority: HistoricalFourSurfaceRatifiedAdmissionV2,
  pit: HistoricalForecastInputPitRecordV2,
): HistoricalProductionFirstCycleBootstrapResultV2 {
  return Object.freeze({
    schemaVersion: HISTORICAL_PRODUCTION_FIRST_CYCLE_BOOTSTRAP_V2,
    organizationId: authority.organizationId,
    accountId: input.accountId,
    runId: authority.runId,
    partition: "WALK_FORWARD",
    symbol: input.symbol,
    primaryHorizonMinutes: input.primaryHorizonMinutes,
    cycleId: pit.cycleId,
    pitAnchor: pit.pitAnchor,
    forecastId: pit.forecastId,
    datasetAuthorityId: pit.datasetAuthorityId,
    ratifiedAuthorityContentDigestHex: authority.contentDigestHex,
    forecastInputContentDigestHex: pit.contentDigestHex,
    authorityBoundary: Object.freeze({
      capitalAuthority: "NONE",
      liveTradingAuthority: "NONE",
      blindHoldoutAuthority: "FORBIDDEN_NOT_PRESENT_NOT_ACCESSED",
    }),
  });
}

/**
 * Closed production DEE-919 bootstrap. No SQL handle, corpus, Forecast, metrics,
 * knowledge state or receipt bytes are accepted from the public caller.
 */
export function prepareHistoricalProductionFirstCycleV2(
  input: HistoricalProductionFirstCycleBootstrapInputV2,
): Promise<HistoricalProductionFirstCycleBootstrapResultV2> {
  validateInput(input);
  return getOptionalAdminSessionUserId().then((authenticatedOperatorUserId) => {
    if (!authenticatedOperatorUserId) refuse("AUTHENTICATED_OPERATOR_REQUIRED");
    return withRequiredSessionPostgresClient(async (pool) => {
    const reserved = await pool.reserve();
    const sql = bindPostgresReservedSession(pool, reserved);
    const lockKey = historicalDatasetAuthorityRunLockKeyV2({
      organizationId: input.preflight.organizationId,
      runId: input.preflight.runId,
    });
    let locked = false;
    try {
      await sql`SELECT pg_advisory_lock(hashtextextended(${lockKey},0))`;
      locked = true;
      return await withPostgresSerializableTransactionRetry(sql, (transaction) =>
        prepareFirstCycleWithHeldPostgres(
          transaction,
          input,
          authenticatedOperatorUserId,
        ));
    } finally {
      try {
        if (locked) await sql`SELECT pg_advisory_unlock(hashtextextended(${lockKey},0))`;
      } finally {
        reserved.release();
      }
    }
    });
  });
}

/**
 * TEST_ONLY fault-injection seam for disposable PostgreSQL integration. It does
 * not acquire or release a connection/lock and is never re-exported. Tests must
 * supply the already-reserved backend holding the canonical org/run lock.
 */
export function TEST_ONLY_prepareHistoricalProductionFirstCycleWithHeldPostgresV2(
  sql: postgres.Sql,
  input: HistoricalProductionFirstCycleBootstrapInputV2,
  authenticatedOperatorUserId: string,
  onStep?: InternalStepObserverV2,
): Promise<HistoricalProductionFirstCycleBootstrapResultV2> {
  if (process.env.NODE_ENV !== "test" || process.env.VITEST !== "true") {
    refuse("TEST_ONLY_RUNTIME");
  }
  validateInput(input);
  if (typeof (sql as unknown as { release?: unknown }).release !== "function") {
    refuse("DEDICATED_SESSION_REQUIRED");
  }
  return withPostgresSerializableTransactionRetry(sql, (transaction) =>
    prepareFirstCycleWithHeldPostgres(
      transaction,
      input,
      authenticatedOperatorUserId,
      onStep,
    ));
}
