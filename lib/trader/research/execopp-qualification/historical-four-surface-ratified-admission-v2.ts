import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import type postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as pgSchema from "@/db/schema.postgres";

import {
  parsePostgresTimestamptz,
  withPostgresSessionTransaction,
} from "@/db/postgres-session-transaction";
import {
  canonicalizeDiagnosticJsonString,
  canonicalizeSemanticJsonString,
  computeSemanticSha256Hex,
} from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { historicalDatasetAuthorityRunLockKeyV2 } from "@/lib/trader/historical-simulation-v2/canonical-verification-receipt-postgres-v2";
import { createCanonicalDecisionVerificationReceiptServiceV2 } from "@/lib/trader/historical-simulation-v2/canonical-verification-receipt-postgres-v2";
import { requireHistoricalApprovedOperatorRoleV2 } from "@/lib/trader/historical-simulation-v2/historical-runner-role-v2";
import type { Bar } from "@/lib/trader/intelligence/types";
import { createPostgresMiSourceProvenanceService } from "@/lib/trader/mi/source-provenance-service";
import {
  findSourceByLogicalKeyPostgres,
  getSourceByIdPostgres,
  listTrustHistoryPostgres,
} from "@/lib/trader/mi/repository-postgres";
import {
  resolveAndPersistTrustAsOfV1Postgres,
  readTrustAsOfReceiptV1Postgres,
} from "@/lib/trader/mi/trust-as-of-repository-postgres";
import {
  persistCanonicalAvailableGatewayWithinHeldTransactionV1Postgres,
  readCanonicalPitObservationWithinHeldTransactionV1Postgres,
} from "@/lib/trader/mi/canonical-pit-service-postgres";
import { prepareCanonicalPitAttemptV1 } from "@/lib/trader/market-data/normalization/gateway-to-canonical-pit";
import type { NormalizedObservation } from "@/lib/trader/market-data/observation-types";
import {
  buildSourceTrustDigestInput,
  computeSourceTrustDigest,
} from "@/lib/trader/mi/serialize-source-trust";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import {
  loadHistoricalDevelopmentSourceCorpusSnapshotFromDatasetV2,
  loadHistoricalWalkForwardPredictiveSourceCorpusSnapshotFromDatasetV2,
} from "@/lib/trader/historical-simulation-v2/development-source-corpus-v2";
import { terminalRhFromOutcome13dV1 } from "@/lib/trader/intelligence/forecast-v2/exec-opp-outcome-materializer-v1";
import {
  buildPredictivePackageV1,
  issueForecastV1,
} from "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import {
  assertFhvPreHoldoutFilesMatchReceipt,
  assertFhvPreHoldoutQualificationPass,
  readFhvPreHoldoutQualificationReceipt,
  type FhvPreHoldoutQualificationReceiptV1,
} from "@/lib/trader/market-data/fhv-pre-holdout-qualification";
import {
  assertHtxVolumeAuthorityQualified,
  readHtxVolumeQualificationReceipt,
  type HtxVolumeQualificationReceiptV1,
} from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import type { ResearchHarnessAdmissionInputV1 } from "@/lib/trader/research/benchmark/research-harness-admission-orchestrator-v1";
import {
  buildEpistemicParameterRatificationReceiptV1,
  buildPredictiveTerminalReceiptV1,
} from "./scientific-admission-v2";
import {
  buildScientificAdmissionReceiptRecordV2,
  persistScientificAdmissionReceiptV2,
} from "./scientific-admission-receipt-service-v2";
import {
  INTERNAL_prepareKmFourSurfaceScientificAdmissionWithHeldPostgresV2,
  type InternalKmFourSurfaceScientificAdmissionProductionV2,
  type KmFourSurfaceProductionPreflightInputV2,
} from "./km-four-surface-production-preflight-v2";

import {
  requireScientificAdmissionFourSurfaceForOrganizationV2,
  type ScientificAdmissionFourSurfaceReceiptV2,
} from "./scientific-admission-four-surface-repository-postgres-v2";
import {
  requireScientificAdmissionV2,
  type ScientificAdmissionReceiptV2,
} from "./scientific-admission-v2";
import {
  computeHistoricalPrerunKnowledgeSnapshotDigestV2,
  INTERNAL_buildHistoricalPrerunKnowledgeBootstrapV2,
  type HistoricalPrerunKnowledgeSnapshotV2,
} from "./historical-prerun-knowledge-bootstrap-v2";

export const HISTORICAL_FOUR_SURFACE_RATIFIED_ADMISSION_V2 =
  "waia.trader.historical_four_surface_ratified_admission.v2" as const;
export const HISTORICAL_FOUR_SURFACE_HUMAN_DECISION_V2 =
  "RATIFY_FOUR_SURFACE_WF_PREDICTIVE_FOR_HISTORICAL_SIMULATION_ONLY" as const;

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SURFACE_KEYS = ["BTCUSDT:30", "BTCUSDT:60", "ETHUSDT:30", "ETHUSDT:60"] as const;

export type HistoricalFourSurfaceKeyV2 = (typeof SURFACE_KEYS)[number];

export type HistoricalFourSurfaceRatifiedSurfaceV2 = Readonly<{
  surfaceKey: HistoricalFourSurfaceKeyV2;
  scientificAdmissionReceiptId: string;
  scientificAdmissionContentDigestHex: string;
  scientificAdmissionEvidenceSemanticDigestHex: string;
  familyIdentityDigestHex: string;
  predictivePackageGenerationIdentityDigestHex: string;
  predictivePackageContentDigestHex: string;
  kmGlobalAnchorSetDigestHex: string;
  predictiveTerminalReceipt: ScientificAdmissionReceiptV2["predictiveTerminalReceipt"];
  humanRatificationReceipt: ScientificAdmissionReceiptV2["epistemicParameterRatificationReceipt"];
}>;

export type HistoricalRatifiedMarketEvidenceV2 = Readonly<{
  schemaVersion: "waia.trader.historical_ratified_market_evidence.v2";
  organizationId: string;
  runId: string;
  releaseSha: string;
  symbol: "BTCUSDT" | "ETHUSDT";
  qualificationReceiptDigestHex: string;
  trustAuthorityKind: "HISTORICAL_DATASET_TRUST";
  datasetAuthorityId: string;
  datasetAuthorityContentDigestHex: string;
  datasetAuthorityDigestHex: string;
  partitionRawSha256Hex: string;
  membershipContentDigestHex: string;
  sealedCycleContentDigestHex: string;
  wfPredictiveSemanticContentDigestHex: string;
  wfPredictiveStartUtc: string;
  wfPredictiveEndUtc: string;
  publicAvailableAt: string;
  sourceId: string;
  trustAsOfReceiptId: string;
  trustRevisionId: string;
  trustRevisionContentDigestHex: string;
  trustScore: string;
  observationId: string;
  observationContentDigestHex: string;
  observationSchemaVersion: "mi-canonical-pit-observation-v1";
  observationEventTime: string;
  observationAvailableAt: string;
  observationIngestTime: string;
  normalizedInputDigestHex: string;
  contentDigestHex: string;
}>;

export type HistoricalFourSurfaceRatifiedAdmissionV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_FOUR_SURFACE_RATIFIED_ADMISSION_V2;
  organizationId: string;
  runId: string;
  releaseSha: string;
  aggregateAdmissionReceiptId: string;
  aggregateAdmissionContentDigestHex: string;
  developmentDatasetIdentityDigestHex: string;
  operatorUserId: string;
  operatorMemberRole: "owner" | "manager";
  executionExtent: Readonly<{ initialRecordIndex: number; cycleCount: number }>;
  surfaceAdmissions: readonly HistoricalFourSurfaceRatifiedSurfaceV2[];
  epistemicRecordCutoff: string;
  knowledgeSnapshots: readonly HistoricalPrerunKnowledgeSnapshotV2[];
  knowledgeSnapshotDigestHex: string;
  marketEvidence: readonly HistoricalRatifiedMarketEvidenceV2[];
  marketEvidenceDigestHex: string;
  authorityBoundary: Readonly<{
    capitalAuthority: "NONE";
    liveTradingAuthority: "NONE";
    blindHoldoutAuthority: "FORBIDDEN_NOT_PRESENT_NOT_ACCESSED";
  }>;
  contentDigestHex: string;
}>;

export type HistoricalFourSurfaceTechnicalSurfaceCandidateV2 = Readonly<{
  surfaceKey: HistoricalFourSurfaceKeyV2;
  symbol: "BTCUSDT" | "ETHUSDT";
  primaryHorizonMinutes: 30 | 60;
  executionHorizonMinutes: number;
  familyIdentityDigestHex: string;
  predictivePackageGenerationIdentityDigestHex: string;
  predictivePackageContentDigestHex: string;
  kmGlobalAnchorSetDigestHex: string;
  predictiveTerminalReceipt: ScientificAdmissionReceiptV2["predictiveTerminalReceipt"];
  volumeQualificationReceiptDigestHex: string;
  marketBoundaryBar: Bar;
}>;

/** Non-Human evidence sealed on the execution host before the Admin approval click. */
export type HistoricalFourSurfaceTechnicalCandidateV2 = Readonly<{
  schemaVersion: "waia.trader.historical_four_surface_technical_candidate.v2";
  organizationId: string;
  runId: string;
  releaseSha: string;
  aggregateAdmissionReceiptId: string;
  aggregateAdmissionContentDigestHex: string;
  developmentDatasetIdentityDigestHex: string;
  qualificationReceiptDigestHex: string;
  firstEconomicRecordIndex: number;
  economicRecordCount: number;
  surfaces: readonly HistoricalFourSurfaceTechnicalSurfaceCandidateV2[];
  authorityBoundary: HistoricalFourSurfaceRatifiedAdmissionV2["authorityBoundary"];
  contentDigestHex: string;
}>;

type HistoricalFourSurfaceRatificationInputV2 = Readonly<{
  organizationId: string;
  runId: string;
  releaseSha: string;
  aggregateAdmissionReceiptId: string;
  operatorUserId: string;
  scientificAdmissionReceiptIds: Readonly<Record<HistoricalFourSurfaceKeyV2, string>>;
  knowledgeSnapshots: readonly HistoricalPrerunKnowledgeSnapshotV2[];
  marketEvidence: readonly HistoricalRatifiedMarketEvidenceV2[];
  executionExtent: Readonly<{ initialRecordIndex: number; cycleCount: number }>;
}>;

/** Safe server-action input. Actor and receipt identities are deliberately absent. */
export type HistoricalFourSurfaceAuthenticatedRatificationInputV2 = Readonly<{
  preflight: KmFourSurfaceProductionPreflightInputV2;
  humanDecision: typeof HISTORICAL_FOUR_SURFACE_HUMAN_DECISION_V2;
  executionExtent?: Readonly<{ initialRecordIndex: number; cycleCount: number }>;
}>;

function computeHistoricalHumanRatificationIdentityDigestV2(
  input: Readonly<{
    organizationId: string;
    runId: string;
    releaseSha: string;
    operatorUserId: string;
    aggregateAdmissionReceiptId: string;
    aggregateAdmissionContentDigestHex: string;
    surfaceKey: HistoricalFourSurfaceKeyV2;
    familyIdentityDigestHex: string;
    predictiveTerminalReceiptContentDigestHex: string;
    kmConvergenceEvidenceSemanticDigestHex: string;
    selectedK: number;
    selectedM: number;
    predictivePackageGenerationIdentityDigestHex: string;
    predictivePackageContentDigestHex: string;
  }>,
): string {
  return computeSemanticSha256Hex({
    schemaVersion: "waia.trader.historical_human_ratification_identity.v2",
    intent: "HUMAN_RATIFY_PREDICTIVE_SURFACE_FOR_HISTORICAL_SIMULATION",
    ...input,
  });
}

type ScientificAdmissionRow = Readonly<{
  id: string;
  organization_id: string;
  receipt_kind: string;
  receipt_json: string;
  content_digest: string;
  evidence_semantic_digest: string;
  km_global_anchor_set_digest: string | null;
  replica_root_family_identity_digest: string | null;
}>;

type DurableAuthorityRow = Readonly<{
  id: string;
  organization_id: string;
  run_id: string;
  release_sha: string;
  aggregate_admission_receipt_id: string;
  aggregate_admission_content_digest_hex: string;
  development_dataset_identity_digest_hex: string;
  operator_user_id: string;
  surface_admissions_json: unknown;
  knowledge_snapshots_json: unknown;
  knowledge_snapshot_digest_hex: string;
  market_evidence_json: unknown;
  market_evidence_digest_hex: string;
  authority_json: unknown;
  authority_content_digest_hex: string;
  schema_version: string;
  created_at: Date | string;
}>;

function refuse(code: string): never {
  throw new Error(`HISTORICAL_FOUR_SURFACE_RATIFICATION_REFUSED:${code}`);
}

function knowledgeSnapshotBody(
  snapshot: HistoricalPrerunKnowledgeSnapshotV2,
): Omit<HistoricalPrerunKnowledgeSnapshotV2, "snapshotContentDigestHex"> {
  const { snapshotContentDigestHex, ...body } = snapshot;
  void snapshotContentDigestHex;
  return body;
}

function marketEvidenceBody(
  evidence: HistoricalRatifiedMarketEvidenceV2,
): Omit<HistoricalRatifiedMarketEvidenceV2, "contentDigestHex"> {
  const { contentDigestHex, ...body } = evidence;
  void contentDigestHex;
  return body;
}

function isValidMarketEvidenceForInput(
  evidence: HistoricalRatifiedMarketEvidenceV2,
  input: Pick<HistoricalFourSurfaceRatificationInputV2, "organizationId" | "runId" | "releaseSha">,
  symbol: "BTCUSDT" | "ETHUSDT",
): boolean {
  return (
    evidence.schemaVersion === "waia.trader.historical_ratified_market_evidence.v2" &&
    evidence.organizationId === input.organizationId &&
    evidence.runId === input.runId &&
    evidence.releaseSha === input.releaseSha &&
    evidence.symbol === symbol &&
    evidence.trustAuthorityKind === "HISTORICAL_DATASET_TRUST" &&
    UUID.test(evidence.datasetAuthorityId) &&
    [
      evidence.datasetAuthorityContentDigestHex,
      evidence.datasetAuthorityDigestHex,
      evidence.partitionRawSha256Hex,
      evidence.membershipContentDigestHex,
      evidence.sealedCycleContentDigestHex,
      evidence.wfPredictiveSemanticContentDigestHex,
    ].every((value) => DIGEST.test(value)) &&
    [evidence.wfPredictiveStartUtc, evidence.wfPredictiveEndUtc, evidence.publicAvailableAt].every(
      (value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
    ) &&
    evidence.publicAvailableAt === evidence.wfPredictiveEndUtc &&
    Date.parse(evidence.wfPredictiveStartUtc) < Date.parse(evidence.wfPredictiveEndUtc) &&
    UUID.test(evidence.sourceId) &&
    DIGEST.test(evidence.qualificationReceiptDigestHex) &&
    DIGEST.test(evidence.trustAsOfReceiptId) &&
    UUID.test(evidence.trustRevisionId) &&
    DIGEST.test(evidence.trustRevisionContentDigestHex) &&
    Number.isFinite(Number(evidence.trustScore)) &&
    Number(evidence.trustScore) >= 0 &&
    Number(evidence.trustScore) <= 1 &&
    UUID.test(evidence.observationId) &&
    DIGEST.test(evidence.observationContentDigestHex) &&
    evidence.observationSchemaVersion === "mi-canonical-pit-observation-v1" &&
    DIGEST.test(evidence.normalizedInputDigestHex) &&
    [
      evidence.observationEventTime,
      evidence.observationAvailableAt,
      evidence.observationIngestTime,
    ].every(
      (value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
    ) &&
    Date.parse(evidence.observationEventTime) <= Date.parse(evidence.observationAvailableAt) &&
    Date.parse(evidence.observationAvailableAt) <= Date.parse(evidence.observationIngestTime) &&
    DIGEST.test(evidence.contentDigestHex) &&
    computeSemanticSha256Hex(marketEvidenceBody(evidence)) === evidence.contentDigestHex
  );
}

function isValidKnowledgeSnapshotForInput(
  snapshot: HistoricalPrerunKnowledgeSnapshotV2,
  input: Pick<HistoricalFourSurfaceRatificationInputV2, "organizationId" | "runId" | "releaseSha">,
  surfaceKey: HistoricalFourSurfaceKeyV2,
): boolean {
  return (
    snapshot.schemaVersion === "waia.trader.historical_prerun_knowledge_bootstrap.v2" &&
    snapshot.surfaceKey === surfaceKey &&
    snapshot.organizationId === input.organizationId &&
    snapshot.runId === input.runId &&
    snapshot.releaseSha === input.releaseSha &&
    snapshot.selectedHypothesisId === snapshot.hypothesis.id &&
    snapshot.selectedHypothesisKey === snapshot.hypothesis.hypothesisKey &&
    snapshot.lifecycle.state === "VALIDATED" &&
    snapshot.observation.eventTime === snapshot.marketPitBoundary &&
    snapshot.evidence.eventTime === snapshot.marketPitBoundary &&
    DIGEST.test(snapshot.snapshotContentDigestHex) &&
    DIGEST.test(snapshot.prediction.sealDigestHex) &&
    DIGEST.test(snapshot.knowledgeEdge.sealDigestHex) &&
    computeHistoricalPrerunKnowledgeSnapshotDigestV2(knowledgeSnapshotBody(snapshot)) ===
      snapshot.snapshotContentDigestHex
  );
}

function validateInput(input: HistoricalFourSurfaceRatificationInputV2): void {
  if (
    !UUID.test(input.organizationId) ||
    !input.runId ||
    input.runId !== input.runId.trim() ||
    !SHA.test(input.releaseSha) ||
    !UUID.test(input.aggregateAdmissionReceiptId) ||
    !UUID.test(input.operatorUserId) ||
    !Number.isSafeInteger(input.executionExtent.initialRecordIndex) ||
    input.executionExtent.initialRecordIndex < 239 ||
    !Number.isSafeInteger(input.executionExtent.cycleCount) ||
    input.executionExtent.cycleCount < 1 || input.executionExtent.cycleCount > 10_000 ||
    SURFACE_KEYS.some((key) => !UUID.test(input.scientificAdmissionReceiptIds[key])) ||
    new Set(SURFACE_KEYS.map((key) => input.scientificAdmissionReceiptIds[key])).size !== 4 ||
    !Array.isArray(input.knowledgeSnapshots) ||
    input.knowledgeSnapshots.length !== 4 ||
    new Set(input.knowledgeSnapshots.map((item) => item.surfaceKey)).size !== 4 ||
    SURFACE_KEYS.some(
      (key) =>
        !input.knowledgeSnapshots.some((item) =>
          isValidKnowledgeSnapshotForInput(item, input, key),
        ),
    ) ||
    !Array.isArray(input.marketEvidence) ||
    input.marketEvidence.length !== 2 ||
    new Set(input.marketEvidence.map((item) => item.symbol)).size !== 2 ||
    (["BTCUSDT", "ETHUSDT"] as const).some(
      (symbol) =>
        !input.marketEvidence.some((item) => isValidMarketEvidenceForInput(item, input, symbol)),
    )
  )
    refuse("INPUT");
}

function parseReceipt<T>(json: string, code: string): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return refuse(code);
  }
}

async function loadScientificRow(
  sql: postgres.Sql,
  organizationId: string,
  id: string,
): Promise<ScientificAdmissionRow> {
  const rows = await sql<ScientificAdmissionRow[]>`
    SELECT id::text AS id, organization_id::text AS organization_id, receipt_kind,
      receipt_json, content_digest, evidence_semantic_digest,
      km_global_anchor_set_digest, replica_root_family_identity_digest
    FROM trader_scientific_admission_receipt_v1
    WHERE organization_id=${organizationId}::uuid AND id=${id}::uuid
  `;
  if (rows.length !== 1) refuse("SCIENTIFIC_ADMISSION_ROW");
  return rows[0]!;
}

async function validateAggregateRow(
  sql: postgres.Sql,
  row: ScientificAdmissionRow,
  input: HistoricalFourSurfaceRatificationInputV2,
): Promise<ScientificAdmissionFourSurfaceReceiptV2> {
  if (row.receipt_kind !== "WF_PREDICTIVE_FOUR_SURFACE") refuse("AGGREGATE_KIND");
  const receipt = parseReceipt<ScientificAdmissionFourSurfaceReceiptV2>(
    row.receipt_json,
    "AGGREGATE_JSON",
  );
  const rebuilt = await requireScientificAdmissionFourSurfaceForOrganizationV2(sql, {
    organizationId: input.organizationId,
    releaseSha: input.releaseSha,
    runId: input.runId,
    developmentDatasetIdentityDigestHex: receipt.developmentDatasetIdentityDigestHex,
    sourceQualificationReceiptDigestHex: receipt.sourceQualificationReceiptDigestHex,
    sourceFourSurfaceAuthorityContentDigestHex: receipt.sourceFourSurfaceAuthorityContentDigestHex,
    evidenceSemanticDigestHex: receipt.evidenceSemanticDigestHex,
  });
  if (
    row.id !== input.aggregateAdmissionReceiptId ||
    row.organization_id !== input.organizationId ||
    row.content_digest !== rebuilt.contentDigestHex ||
    row.evidence_semantic_digest !== rebuilt.evidenceSemanticDigestHex
  )
    refuse("AGGREGATE_DURABLE_CONTENT");
  return rebuilt;
}

function validateSurface(
  row: ScientificAdmissionRow,
  aggregate: ScientificAdmissionFourSurfaceReceiptV2,
  surfaceKey: HistoricalFourSurfaceKeyV2,
  provenance: Readonly<{
    aggregateAdmissionReceiptId: string;
    operatorUserId: string;
  }>,
): HistoricalFourSurfaceRatifiedSurfaceV2 {
  if (row.receipt_kind !== "WF_PREDICTIVE") refuse("SURFACE_KIND");
  const receipt = parseReceipt<ScientificAdmissionReceiptV2>(row.receipt_json, "SURFACE_JSON");
  const binding = aggregate.surfaceBindings.find((value) => value.surfaceKey === surfaceKey);
  if (!binding) refuse("SURFACE_BINDING");
  const admitted = requireScientificAdmissionV2(receipt, {
    organizationId: aggregate.organizationId,
    developmentDatasetDigestHex: aggregate.developmentDatasetIdentityDigestHex,
    targetGridReceiptDigestHex: receipt.predictiveTerminalReceipt.targetGridReceiptDigestHex,
    predictivePackageGenerationIdentityDigestHex:
      binding.predictivePackageGenerationIdentityDigestHex,
    predictivePackageContentDigestHex: binding.predictivePackageContentDigestHex,
    runtimeContractDigestHex: receipt.predictiveTerminalReceipt.runtimeContractDigestHex,
    scoringContractVersion: "multiclass-log-score/v1",
    evaluationPartitionReceiptDigestHex:
      receipt.predictiveTerminalReceipt.evaluationPartitionReceiptDigestHex,
    kmConvergenceEvidenceSemanticDigestHex: binding.convergenceEvidenceSemanticDigestHex,
    epistemicParameterRatificationReceiptDigestHex:
      receipt.epistemicParameterRatificationReceipt.contentDigestHex,
    predictiveTerminalReceiptContentDigestHex: receipt.predictiveTerminalReceipt.contentDigestHex,
  });
  const expectedHumanIdentity = computeHistoricalHumanRatificationIdentityDigestV2({
    organizationId: aggregate.organizationId,
    runId: aggregate.runId,
    releaseSha: aggregate.releaseSha,
    operatorUserId: provenance.operatorUserId,
    aggregateAdmissionReceiptId: provenance.aggregateAdmissionReceiptId,
    aggregateAdmissionContentDigestHex: aggregate.contentDigestHex,
    surfaceKey,
    familyIdentityDigestHex: binding.familyIdentityDigestHex,
    predictiveTerminalReceiptContentDigestHex: admitted.predictiveTerminalReceipt.contentDigestHex,
    kmConvergenceEvidenceSemanticDigestHex: binding.convergenceEvidenceSemanticDigestHex,
    selectedK: admitted.epistemicParameterRatificationReceipt.selectedK,
    selectedM: admitted.epistemicParameterRatificationReceipt.selectedM,
    predictivePackageGenerationIdentityDigestHex:
      binding.predictivePackageGenerationIdentityDigestHex,
    predictivePackageContentDigestHex: binding.predictivePackageContentDigestHex,
  });
  if (
    row.organization_id !== aggregate.organizationId ||
    row.content_digest !== admitted.contentDigestHex ||
    row.evidence_semantic_digest !== admitted.evidenceSemanticDigestHex ||
    admitted.kmConvergenceReceipt.replicaRootFamilyIdentityDigestHex !==
      binding.familyIdentityDigestHex ||
    admitted.predictiveTerminalReceipt.terminalStatus !== "QUALIFIED" ||
    admitted.terminalStatus !== "ADMITTED" ||
    !DIGEST.test(admitted.predictiveTerminalReceipt.targetGridReceiptDigestHex) ||
    !DIGEST.test(admitted.predictiveTerminalReceipt.evaluationPartitionReceiptDigestHex) ||
    admitted.epistemicParameterRatificationReceipt.humanReceiptIdentityDigestHex !==
      expectedHumanIdentity
  )
    refuse("SURFACE_DURABLE_CONTENT");
  return Object.freeze({
    surfaceKey,
    scientificAdmissionReceiptId: row.id,
    scientificAdmissionContentDigestHex: admitted.contentDigestHex,
    scientificAdmissionEvidenceSemanticDigestHex: admitted.evidenceSemanticDigestHex,
    familyIdentityDigestHex: binding.familyIdentityDigestHex,
    predictivePackageGenerationIdentityDigestHex:
      binding.predictivePackageGenerationIdentityDigestHex,
    predictivePackageContentDigestHex: binding.predictivePackageContentDigestHex,
    kmGlobalAnchorSetDigestHex: admitted.kmConvergenceReceipt.kmGlobalAnchorSetDigestHex,
    predictiveTerminalReceipt: admitted.predictiveTerminalReceipt,
    humanRatificationReceipt: admitted.epistemicParameterRatificationReceipt,
  });
}

function deriveQualifiedHistoricalTrustScoreV2(
  qualification: FhvPreHoldoutQualificationReceiptV1,
  symbol: "BTCUSDT" | "ETHUSDT",
): Readonly<{ score: "1"; rationale: string }> {
  const partition = qualification.partitions.filter(
    (entry) =>
      entry.partition === "walk-forward" &&
      entry.symbol === symbol &&
      entry.gapDuplicateIntegrity === "PASS",
  );
  const predictive = qualification.scientificSubpartitions.filter(
    (entry) =>
      entry.scientificPartition === "WF_PREDICTIVE" &&
      entry.symbol === symbol &&
      entry.gapDuplicateIntegrity === "PASS",
  );
  if (
    partition.length !== 1 ||
    predictive.length !== 1 ||
    !DIGEST.test(qualification.qualificationReceiptDigest) ||
    !DIGEST.test(partition[0]!.rawSha256) ||
    !DIGEST.test(predictive[0]!.semanticContentDigest) ||
    predictive[0]!.startUtc !== qualification.canonicalBoundaries.wfPredictive.startUtc ||
    predictive[0]!.endUtc !== qualification.canonicalBoundaries.wfPredictive.endUtc
  ) {
    refuse("MARKET_SOURCE_QUALIFICATION");
  }
  return Object.freeze({
    score: "1",
    rationale: canonicalizeSemanticJsonString({
      schemaVersion: "waia.trader.qualified_historical_source_trust.v2",
      qualificationReceiptDigestHex: qualification.qualificationReceiptDigest,
      symbol,
      completeWalkForwardRawSha256Hex: partition[0]!.rawSha256,
      wfPredictiveSemanticContentDigestHex: predictive[0]!.semanticContentDigest,
      wfPredictiveBounds: qualification.canonicalBoundaries.wfPredictive,
      gapDuplicateIntegrity: "PASS",
      holdout: "PRE_HOLDOUT_ONLY_NOT_PRESENT_NOT_ACCESSED",
      derivedTrustScore: "1",
    }),
  });
}

async function buildCanonicalMarketEvidenceV2(
  input: Readonly<{
    sql: postgres.Sql;
    preflight: KmFourSurfaceProductionPreflightInputV2;
    organizationId: string;
    runId: string;
    releaseSha: string;
    operatorUserId: string;
    qualification: FhvPreHoldoutQualificationReceiptV1;
    marketBoundaryBars: Readonly<Record<"BTCUSDT" | "ETHUSDT", Bar>>;
  }>,
): Promise<readonly HistoricalRatifiedMarketEvidenceV2[]> {
  const executor = drizzle(input.sql, { schema: pgSchema });
  const context = { organizationId: input.organizationId };
  const sourceService = createPostgresMiSourceProvenanceService(executor, {
    actorType: "admin",
    actorId: input.operatorUserId,
  });
  const verification = createCanonicalDecisionVerificationReceiptServiceV2(input.sql);
  const results: HistoricalRatifiedMarketEvidenceV2[] = [];
  for (const symbol of ["BTCUSDT", "ETHUSDT"] as const) {
    const predictivePartition = input.qualification.scientificSubpartitions.find(
      (entry) => entry.scientificPartition === "WF_PREDICTIVE" && entry.symbol === symbol,
    );
    if (!predictivePartition || predictivePartition.barCount < 1) {
      refuse("MARKET_DATASET_PARTITION");
    }
    const registration = await verification.registerPreHoldoutDatasetAuthorityFromSource({
      datasetRoot: input.preflight.datasetRoot,
      qualificationReceiptPath: input.preflight.qualificationReceiptPath,
      runtimeRequalificationReceiptPath: input.preflight.runtimeRequalificationReceiptPath,
      htxVolumeQualificationReceiptPath: input.preflight.htxVolumeQualificationReceiptPaths[symbol],
      releaseSha: input.releaseSha,
      organizationId: input.organizationId,
      runId: input.runId,
      partition: "WALK_FORWARD",
      symbol,
      initialRecordIndex: predictivePartition.barCount - 1,
      cycleCount: 1,
    });
    const cycleId = registration.cycleIds[0];
    const datasetAuthorityId = cycleId ? registration.authorityIds.get(cycleId) : undefined;
    if (
      !cycleId ||
      !datasetAuthorityId ||
      registration.cycleIds.length !== 1 ||
      registration.qualificationReceiptDigestHex !== input.qualification.qualificationReceiptDigest
    ) {
      refuse("MARKET_DATASET_REGISTRATION");
    }
    const datasetRows = await input.sql<
      Array<
        Readonly<{
          authority_content_digest_hex: string;
          dataset_authority_digest_hex: string;
          membership_content_digest_hex: string;
          sealed_cycle_content_digest_hex: string;
          membership_json: unknown;
          sealed_cycle_json: Readonly<{ closedBar?: Bar }>;
        }>
      >
    >`
      SELECT authority_content_digest_hex, dataset_authority_digest_hex,
        membership_content_digest_hex, sealed_cycle_content_digest_hex,
        membership_json, sealed_cycle_json
      FROM trader_historical_dataset_authority_v2
      WHERE id=${datasetAuthorityId}::uuid AND organization_id=${input.organizationId}::uuid
        AND run_id=${input.runId} AND cycle_id=${cycleId}
        AND dataset_authority_class='PRE_HOLDOUT_QUALIFICATION_V1'
    `;
    const durableDataset = datasetRows[0];
    if (
      datasetRows.length !== 1 ||
      !durableDataset ||
      durableDataset.authority_content_digest_hex !==
        computeStableJsonDigest({
          organizationId: input.organizationId,
          runId: input.runId,
          membership: durableDataset.membership_json,
          sealedCycle: durableDataset.sealed_cycle_json,
        })
    ) {
      // This digest is produced by the canonical historical service. Its serializer
      // is verified again below by the first-cycle loader; refuse any unreadable row.
      refuse("MARKET_DATASET_AUTHORITY");
    }
    await input.sql`SELECT pg_advisory_xact_lock(hashtextextended(
      ${`historical-qualified-market-source:${input.organizationId}:${symbol}`},0))`;
    let source = await findSourceByLogicalKeyPostgres(
      executor,
      context,
      "htx",
      "ohlcv_bar",
      symbol,
    );
    if (!source) {
      source = await sourceService.createSource(context, {
        venue: "htx",
        feedKind: "ohlcv_bar",
        symbol,
        description: "Byte-authenticated HTX pre-holdout historical market source",
        status: "active",
        actorType: "admin",
        actorId: input.operatorUserId,
      });
    }
    if (source.status !== "active" || source.organizationId !== input.organizationId) {
      refuse("MARKET_SOURCE_STATUS");
    }
    const bar = input.marketBoundaryBars[symbol];
    if (
      !bar ||
      bar.barCloseTime !== input.qualification.canonicalBoundaries.wfPredictive.endUtc ||
      bar.symbol.replace("/", "") !== symbol
    ) {
      refuse("MARKET_BOUNDARY_BAR");
    }
    if (
      !durableDataset.sealed_cycle_json.closedBar ||
      canonicalizeSemanticJsonString(durableDataset.sealed_cycle_json.closedBar) !==
        canonicalizeSemanticJsonString(bar)
    ) {
      refuse("MARKET_DATASET_BOUNDARY_BAR");
    }
    const recordedRows = await input.sql<Array<Readonly<{ recorded_at: Date | string }>>>`
      SELECT clock_timestamp() AS recorded_at
    `;
    const recordedAt = recordedRows[0]?.recorded_at;
    if (!recordedAt) refuse("MARKET_RECORD_TIME");
    const recordTime = parsePostgresTimestamptz(recordedAt);
    const derivedTrust = deriveQualifiedHistoricalTrustScoreV2(input.qualification, symbol);
    const revision = await sourceService.appendTrustRevision(context, {
      sourceId: source.id,
      trustScore: derivedTrust.score,
      rationale: derivedTrust.rationale,
      recordedBy: `historical-ratification:${input.runId}:${input.releaseSha}`,
      eventTime: new Date(bar.barCloseTime),
      ingestTime: recordTime,
      actorType: "admin",
      actorId: input.operatorUserId,
    });
    const trust = await resolveAndPersistTrustAsOfV1Postgres(executor, context, {
      sourceId: source.id,
      anchorTime: recordTime,
    });
    if (
      trust.receipt.status !== "RESOLVED" ||
      trust.receipt.selectedTrustRevisionId !== revision.id ||
      trust.receipt.selectedContentDigest !== revision.contentDigest ||
      trust.receipt.selectedTrustScore !== revision.trustScore
    ) {
      refuse("MARKET_TRUST_AS_OF");
    }
    const normalized: NormalizedObservation = {
      schemaVersion: "waia.trader.observation.v1",
      kind: "ohlcv_bar",
      interval: "1m",
      sessionPhase: "UNKNOWN",
      provenance: {
        providerId: "htx_spot",
        venue: "htx",
        feedKind: "ohlcv_bar",
        symbol,
        eventTimeUtc: bar.barCloseTime,
        ingestTimeUtc: recordTime.toISOString(),
      },
      health: "HEALTHY",
      freshnessMs: 0,
      latencyMs: Math.max(0, recordTime.getTime() - Date.parse(bar.barCloseTime)),
      confidence: Number(derivedTrust.score),
      payload: {
        barCount: 1,
        latestClose: bar.close,
        latestBarCloseTime: bar.barCloseTime,
      },
    };
    const attempt = prepareCanonicalPitAttemptV1(normalized);
    if (
      attempt.status !== "AVAILABLE" ||
      !attempt.kind ||
      !attempt.subjectRef ||
      !attempt.payloadCanonical ||
      !attempt.eventTimeUtc ||
      !attempt.availableAtUtc ||
      !attempt.ingestTimeUtc ||
      attempt.source?.symbol !== symbol
    ) {
      refuse("MARKET_CANONICAL_ATTEMPT");
    }
    const stored = await persistCanonicalAvailableGatewayWithinHeldTransactionV1Postgres(
      executor,
      context,
      {
        sourceId: source.id,
        observationKind: attempt.kind,
        subjectRef: attempt.subjectRef,
        payloadCanonical: attempt.payloadCanonical,
        eventTime: new Date(attempt.eventTimeUtc),
        availableAt: new Date(attempt.availableAtUtc),
        ingestTime: new Date(attempt.ingestTimeUtc),
        canonicalProviderId: attempt.providerId,
        trustAsOfReceiptId: trust.receipt.id,
        normalizedInputDigest: attempt.normalizedInputDigest,
      },
    );
    const body = {
      schemaVersion: "waia.trader.historical_ratified_market_evidence.v2" as const,
      organizationId: input.organizationId,
      runId: input.runId,
      releaseSha: input.releaseSha,
      symbol,
      qualificationReceiptDigestHex: input.qualification.qualificationReceiptDigest,
      trustAuthorityKind: "HISTORICAL_DATASET_TRUST" as const,
      datasetAuthorityId,
      datasetAuthorityContentDigestHex: durableDataset.authority_content_digest_hex,
      datasetAuthorityDigestHex: durableDataset.dataset_authority_digest_hex,
      partitionRawSha256Hex: registration.partitionRawSha256Hex,
      membershipContentDigestHex: durableDataset.membership_content_digest_hex,
      sealedCycleContentDigestHex: durableDataset.sealed_cycle_content_digest_hex,
      wfPredictiveSemanticContentDigestHex: predictivePartition.semanticContentDigest,
      wfPredictiveStartUtc: predictivePartition.startUtc,
      wfPredictiveEndUtc: predictivePartition.endUtc,
      publicAvailableAt: bar.barCloseTime,
      sourceId: source.id,
      trustAsOfReceiptId: trust.receipt.id,
      trustRevisionId: revision.id,
      trustRevisionContentDigestHex: revision.contentDigest,
      trustScore: revision.trustScore,
      observationId: stored.observation.id,
      observationContentDigestHex: stored.observation.contentDigest,
      observationSchemaVersion: stored.observation.schemaVersion,
      observationEventTime: stored.observation.eventTime.toISOString(),
      observationAvailableAt: stored.observation.availableAt.toISOString(),
      observationIngestTime: stored.observation.ingestTime.toISOString(),
      normalizedInputDigestHex: stored.observation.normalizedInputDigest,
    };
    results.push(
      Object.freeze({
        ...body,
        contentDigestHex: computeSemanticSha256Hex(body),
      }),
    );
  }
  return Object.freeze(results.sort((a, b) => a.symbol.localeCompare(b.symbol)));
}

async function replayCanonicalMarketEvidenceV2(
  sql: postgres.Sql,
  authority: HistoricalFourSurfaceRatifiedAdmissionV2,
  qualificationReceiptDigestHex: string,
): Promise<readonly HistoricalRatifiedMarketEvidenceV2[]> {
  const executor = drizzle(sql, { schema: pgSchema });
  const context = { organizationId: authority.organizationId };
  const replayed: HistoricalRatifiedMarketEvidenceV2[] = [];
  for (const sealed of authority.marketEvidence) {
    if (!isValidMarketEvidenceForInput(sealed, authority, sealed.symbol)) {
      refuse("MARKET_EVIDENCE_SEAL");
    }
    const source = await getSourceByIdPostgres(executor, context, sealed.sourceId);
    const trust = await readTrustAsOfReceiptV1Postgres(
      executor,
      context,
      sealed.trustAsOfReceiptId,
    );
    const revision = (await listTrustHistoryPostgres(executor, context, sealed.sourceId)).find(
      (candidate) => candidate.id === sealed.trustRevisionId,
    );
    const observation = await readCanonicalPitObservationWithinHeldTransactionV1Postgres(
      executor,
      context,
      sealed.observationId,
    );
    const datasetRows = await sql<
      Array<
        Readonly<{
          dataset_authority_digest_hex: string;
          membership_content_digest_hex: string;
          sealed_cycle_content_digest_hex: string;
          authority_content_digest_hex: string;
          membership_json: unknown;
          sealed_cycle_json: Readonly<{ closedBar?: Bar }>;
        }>
      >
    >`
      SELECT dataset_authority_digest_hex, membership_content_digest_hex,
        sealed_cycle_content_digest_hex, authority_content_digest_hex,
        membership_json, sealed_cycle_json
      FROM trader_historical_dataset_authority_v2
      WHERE id=${sealed.datasetAuthorityId}::uuid
        AND organization_id=${authority.organizationId}::uuid AND run_id=${authority.runId}
        AND dataset_authority_class='PRE_HOLDOUT_QUALIFICATION_V1'
    `;
    const dataset = datasetRows[0];
    if (
      !dataset ||
      datasetRows.length !== 1 ||
      dataset.dataset_authority_digest_hex !== sealed.datasetAuthorityDigestHex ||
      dataset.membership_content_digest_hex !== sealed.membershipContentDigestHex ||
      dataset.sealed_cycle_content_digest_hex !== sealed.sealedCycleContentDigestHex ||
      dataset.authority_content_digest_hex !== sealed.datasetAuthorityContentDigestHex ||
      dataset.authority_content_digest_hex !==
        computeStableJsonDigest({
          organizationId: authority.organizationId,
          runId: authority.runId,
          membership: dataset.membership_json,
          sealedCycle: dataset.sealed_cycle_json,
        }) ||
      !dataset.sealed_cycle_json.closedBar ||
      dataset.sealed_cycle_json.closedBar.barCloseTime !== sealed.publicAvailableAt ||
      dataset.sealed_cycle_json.closedBar.symbol.replace("/", "") !== sealed.symbol ||
      !source ||
      source.organizationId !== authority.organizationId ||
      source.venue !== "htx" ||
      source.feedKind !== "ohlcv_bar" ||
      source.symbol !== sealed.symbol ||
      !trust ||
      trust.status !== "RESOLVED" ||
      !revision ||
      !observation ||
      trust.organizationId !== authority.organizationId ||
      trust.sourceId !== source.id ||
      trust.id !== trust.contentDigest ||
      trust.id !== sealed.trustAsOfReceiptId ||
      trust.anchorTimeUtc !== sealed.observationAvailableAt ||
      trust.selectedTrustRevisionId !== revision.id ||
      trust.selectedContentDigest !== revision.contentDigest ||
      trust.selectedTrustScore !== revision.trustScore ||
      revision.organizationId !== authority.organizationId ||
      revision.sourceId !== source.id ||
      revision.contentDigest !==
        computeSourceTrustDigest(
          buildSourceTrustDigestInput({
            organizationId: revision.organizationId,
            sourceId: revision.sourceId,
            trustScore: revision.trustScore,
            rationale: revision.rationale,
            recordedBy: revision.recordedBy,
            eventTime: revision.eventTime,
            ingestTime: revision.ingestTime,
            revisionOf: revision.revisionOf,
            revisionSeq: revision.revisionSeq,
          }),
        ) ||
      observation.organizationId !== authority.organizationId ||
      observation.sourceId !== source.id ||
      observation.observationKind !== "ohlcv_bar" ||
      observation.subjectRef !== sealed.symbol ||
      observation.trustAsOfReceiptId !== trust.id ||
      observation.sourceTrustRevisionId !== revision.id ||
      observation.sourceTrustContentDigest !== revision.contentDigest ||
      observation.eventTime.toISOString() !== sealed.observationEventTime ||
      observation.availableAt.toISOString() !== sealed.observationAvailableAt ||
      observation.ingestTime.toISOString() !== sealed.observationIngestTime ||
      observation.normalizedInputDigest !== sealed.normalizedInputDigestHex ||
      observation.contentDigest !== sealed.observationContentDigestHex ||
      sealed.qualificationReceiptDigestHex !== qualificationReceiptDigestHex
    ) {
      refuse("MARKET_EVIDENCE_DURABLE_REPLAY");
    }
    const body = marketEvidenceBody(sealed);
    replayed.push(
      Object.freeze({
        ...body,
        contentDigestHex: computeSemanticSha256Hex(body),
      }),
    );
  }
  return Object.freeze(replayed.sort((a, b) => a.symbol.localeCompare(b.symbol)));
}

function buildAuthority(
  input: Readonly<{
    aggregate: ScientificAdmissionFourSurfaceReceiptV2;
    aggregateAdmissionReceiptId: string;
    operatorUserId: string;
    operatorMemberRole: "owner" | "manager";
    surfaces: readonly HistoricalFourSurfaceRatifiedSurfaceV2[];
    epistemicRecordCutoff: string;
    knowledgeSnapshots: readonly HistoricalPrerunKnowledgeSnapshotV2[];
    marketEvidence: readonly HistoricalRatifiedMarketEvidenceV2[];
    executionExtent: Readonly<{ initialRecordIndex: number; cycleCount: number }>;
  }>,
): HistoricalFourSurfaceRatifiedAdmissionV2 {
  const knowledgeSnapshots = Object.freeze(
    [...input.knowledgeSnapshots].sort((a, b) => a.surfaceKey.localeCompare(b.surfaceKey)),
  );
  const knowledgeSnapshotDigestHex = computeSemanticSha256Hex({
    schemaVersion: "waia.trader.historical_prerun_knowledge_snapshot_set.v2",
    organizationId: input.aggregate.organizationId,
    runId: input.aggregate.runId,
    releaseSha: input.aggregate.releaseSha,
    epistemicRecordCutoff: input.epistemicRecordCutoff,
    knowledgeSnapshots,
  });
  const marketEvidence = Object.freeze(
    [...input.marketEvidence].sort((a, b) => a.symbol.localeCompare(b.symbol)),
  );
  const marketEvidenceDigestHex = computeSemanticSha256Hex({
    schemaVersion: "waia.trader.historical_ratified_market_evidence_set.v2",
    organizationId: input.aggregate.organizationId,
    runId: input.aggregate.runId,
    releaseSha: input.aggregate.releaseSha,
    marketEvidence,
  });
  const body = {
    schemaVersion: HISTORICAL_FOUR_SURFACE_RATIFIED_ADMISSION_V2,
    organizationId: input.aggregate.organizationId,
    runId: input.aggregate.runId,
    releaseSha: input.aggregate.releaseSha,
    aggregateAdmissionReceiptId: input.aggregateAdmissionReceiptId,
    aggregateAdmissionContentDigestHex: input.aggregate.contentDigestHex,
    developmentDatasetIdentityDigestHex: input.aggregate.developmentDatasetIdentityDigestHex,
    operatorUserId: input.operatorUserId,
    operatorMemberRole: input.operatorMemberRole,
    executionExtent: input.executionExtent,
    surfaceAdmissions: Object.freeze([...input.surfaces]),
    epistemicRecordCutoff: input.epistemicRecordCutoff,
    knowledgeSnapshots,
    knowledgeSnapshotDigestHex,
    marketEvidence,
    marketEvidenceDigestHex,
    authorityBoundary: Object.freeze({
      capitalAuthority: "NONE" as const,
      liveTradingAuthority: "NONE" as const,
      blindHoldoutAuthority: "FORBIDDEN_NOT_PRESENT_NOT_ACCESSED" as const,
    }),
  };
  return Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
}

async function loadDurableAuthority(
  sql: postgres.Sql,
  organizationId: string,
  runId: string,
): Promise<DurableAuthorityRow | null> {
  const rows = await sql<DurableAuthorityRow[]>`
    SELECT id::text AS id, organization_id::text AS organization_id, run_id, release_sha,
      aggregate_admission_receipt_id::text AS aggregate_admission_receipt_id,
      aggregate_admission_content_digest_hex, development_dataset_identity_digest_hex,
      operator_user_id::text AS operator_user_id, surface_admissions_json, authority_json,
      knowledge_snapshots_json, knowledge_snapshot_digest_hex,
      market_evidence_json, market_evidence_digest_hex,
      authority_content_digest_hex, schema_version, created_at
    FROM trader_historical_four_surface_ratified_admission_v2
    WHERE organization_id=${organizationId}::uuid AND run_id=${runId}
  `;
  if (rows.length > 1) refuse("DURABLE_AMBIGUOUS");
  return rows[0] ?? null;
}

function rowMatches(
  row: DurableAuthorityRow,
  authority: HistoricalFourSurfaceRatifiedAdmissionV2,
): boolean {
  return (
    row.organization_id === authority.organizationId &&
    row.run_id === authority.runId &&
    row.release_sha === authority.releaseSha &&
    row.aggregate_admission_receipt_id === authority.aggregateAdmissionReceiptId &&
    row.aggregate_admission_content_digest_hex === authority.aggregateAdmissionContentDigestHex &&
    row.development_dataset_identity_digest_hex === authority.developmentDatasetIdentityDigestHex &&
    row.operator_user_id === authority.operatorUserId &&
    parsePostgresTimestamptz(row.created_at).toISOString() === authority.epistemicRecordCutoff &&
    canonicalizeSemanticJsonString(row.surface_admissions_json) ===
      canonicalizeSemanticJsonString(authority.surfaceAdmissions) &&
    canonicalizeSemanticJsonString(row.knowledge_snapshots_json) ===
      canonicalizeSemanticJsonString(authority.knowledgeSnapshots) &&
    row.knowledge_snapshot_digest_hex === authority.knowledgeSnapshotDigestHex &&
    canonicalizeSemanticJsonString(row.market_evidence_json) ===
      canonicalizeSemanticJsonString(authority.marketEvidence) &&
    row.market_evidence_digest_hex === authority.marketEvidenceDigestHex &&
    canonicalizeSemanticJsonString(row.authority_json) ===
      canonicalizeSemanticJsonString(authority) &&
    row.authority_content_digest_hex === authority.contentDigestHex &&
    row.schema_version === HISTORICAL_FOUR_SURFACE_RATIFIED_ADMISSION_V2
  );
}

async function persistHistoricalFourSurfaceRatificationV2(
  sql: postgres.Sql,
  input: HistoricalFourSurfaceRatificationInputV2,
  authenticatedOperatorUserId: string,
  persistAuthority = true,
  approvedProposal?: Readonly<{
    proposalId: string;
    proposalContentDigestHex: string;
    technicalCandidateContentDigestHex: string;
  }>,
): Promise<
  Readonly<{
    id: string;
    insertedNew: boolean;
    authority: HistoricalFourSurfaceRatifiedAdmissionV2;
  }>
> {
  validateInput(input);
  if (authenticatedOperatorUserId !== input.operatorUserId) refuse("ACTOR");
  if (typeof (sql as unknown as { release?: unknown }).release !== "function") {
    refuse("DEDICATED_SESSION_REQUIRED");
  }
  const runLockKey = historicalDatasetAuthorityRunLockKeyV2(input);
  return withPostgresSessionTransaction(sql, "REPEATABLE READ", async (transaction) => {
      // This function is normally nested inside the materializer's transaction.
      // A transaction-scoped lock is released by that transaction owner after
      // COMMIT/ROLLBACK; attempting a session unlock from a nested callback would
      // itself fail while PostgreSQL is in the aborted-transaction state and mask
      // the original refusal.
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${runLockKey},0))`;
      const memberRole = approvedProposal
        ? await requireHistoricalApprovedOperatorRoleV2(transaction, {
          organizationId: input.organizationId,
          runId: input.runId,
          releaseSha: input.releaseSha,
          operatorUserId: authenticatedOperatorUserId,
        })
        : await (async () => {
          const memberRows = await transaction<Array<Readonly<{ member_role: string }>>>`
            SELECT member_role FROM organization_members
            WHERE organization_id=${input.organizationId}::uuid
              AND user_id=${authenticatedOperatorUserId}::uuid
            FOR SHARE
          `;
          const role = memberRows[0]?.member_role;
          if (memberRows.length !== 1 || (role !== "owner" && role !== "manager")) {
            refuse("OPERATOR_MEMBERSHIP");
          }
          return role;
        })();
      const aggregateRow = await loadScientificRow(
        transaction,
        input.organizationId,
        input.aggregateAdmissionReceiptId,
      );
      const aggregate = await validateAggregateRow(transaction, aggregateRow, input);
      const surfaces: HistoricalFourSurfaceRatifiedSurfaceV2[] = [];
      for (const surfaceKey of SURFACE_KEYS) {
        const row = await loadScientificRow(
          transaction,
          input.organizationId,
          input.scientificAdmissionReceiptIds[surfaceKey],
        );
        const validated = validateSurface(row, aggregate, surfaceKey, {
          aggregateAdmissionReceiptId: input.aggregateAdmissionReceiptId,
          operatorUserId: input.operatorUserId,
        });
        const receipt = parseReceipt<ScientificAdmissionReceiptV2>(
          row.receipt_json, "SURFACE_CONVERGENCE_JSON",
        );
        const frozen = aggregate.sourceAuthority.contract.surfaces.find(
          (surface) => surface.surfaceKey === surfaceKey,
        );
        if (!frozen || canonicalizeSemanticJsonString(receipt.kmConvergenceReceipt) !==
          canonicalizeSemanticJsonString(frozen.convergenceReceipt)) {
          refuse("SURFACE_CONVERGENCE_RECEIPT");
        }
        if (receipt.epistemicParameterRatificationReceipt
          .kmConvergenceEvidenceSemanticDigestHex !==
            frozen.convergenceReceipt.evidenceSemanticDigestHex) {
          refuse("SURFACE_HUMAN_CONVERGENCE_DIGEST");
        }
        if (receipt.epistemicParameterRatificationReceipt.selectedK !==
            frozen.convergenceReceipt.selectedK ||
          receipt.epistemicParameterRatificationReceipt.selectedM !==
            frozen.convergenceReceipt.selectedM) {
          refuse("SURFACE_HUMAN_SELECTED_KM");
        }
        if (receipt.epistemicParameterRatificationReceipt.alphaEpiConfigScale8 !==
          frozen.convergenceReceipt.alphaEpiConfigScale8) {
          refuse("SURFACE_HUMAN_ALPHA");
        }
        if (row.km_global_anchor_set_digest !== validated.kmGlobalAnchorSetDigestHex) {
          refuse("SURFACE_GLOBAL_ANCHOR");
        }
        if (row.replica_root_family_identity_digest !== validated.familyIdentityDigestHex) {
          refuse("SURFACE_FAMILY_IDENTITY");
        }
        surfaces.push(validated);
      }
      const cutoffRows = await transaction<Array<Readonly<{ cutoff: Date | string }>>>`
    SELECT clock_timestamp() AS cutoff
  `;
      const cutoffValue = cutoffRows[0]?.cutoff;
      if (!cutoffValue) refuse("KNOWLEDGE_SNAPSHOT_CUTOFF");
      const cutoff = parsePostgresTimestamptz(cutoffValue);
      if (
        input.knowledgeSnapshots.some(
          (snapshot) =>
            snapshot.organizationId !== input.organizationId ||
            snapshot.runId !== input.runId ||
            snapshot.releaseSha !== input.releaseSha ||
            Date.parse(snapshot.marketPitBoundary) >= cutoff.getTime() ||
            [
              snapshot.hypothesis.createdAt,
              snapshot.lifecycle.createdAt,
              snapshot.trial.ingestTime,
              snapshot.trial.createdAt,
              snapshot.observation.ingestTime,
              snapshot.observation.createdAt,
              snapshot.evidence.ingestTime,
              snapshot.evidence.createdAt,
            ].some(
              (value) =>
                !Number.isFinite(Date.parse(value)) || Date.parse(value) > cutoff.getTime(),
            ),
        )
      ) {
        refuse("KNOWLEDGE_SNAPSHOT_CUTOFF");
      }
      if (
        input.marketEvidence.some(
          (evidence) =>
            Date.parse(evidence.observationAvailableAt) > cutoff.getTime() ||
            Date.parse(evidence.observationIngestTime) > cutoff.getTime(),
        )
      ) {
        refuse("MARKET_EVIDENCE_CUTOFF");
      }
      const authority = buildAuthority({
        aggregate,
        aggregateAdmissionReceiptId: input.aggregateAdmissionReceiptId,
        operatorUserId: input.operatorUserId,
        operatorMemberRole: memberRole,
        surfaces: Object.freeze(surfaces),
        epistemicRecordCutoff: cutoff.toISOString(),
        knowledgeSnapshots: input.knowledgeSnapshots,
        marketEvidence: input.marketEvidence,
        executionExtent: input.executionExtent,
      });
      if (!persistAuthority) {
        return Object.freeze({ id: "", insertedNew: false, authority });
      }
      const existing = await loadDurableAuthority(transaction, input.organizationId, input.runId);
      if (existing) {
        if (!rowMatches(existing, authority)) refuse("CONFLICT");
        return Object.freeze({ id: existing.id, insertedNew: false, authority });
      }
      const id = randomUUID();
      if (approvedProposal) {
        // Check the exact database representation before entering the SECURITY
        // DEFINER finalizer. This keeps a cross-runtime JSON disagreement tied
        // to one surface and two non-sensitive digests instead of collapsing it
        // into a generic final-authority refusal.
        const convergenceBindings = await transaction<Array<Readonly<{
          surface_key: string | null;
          left_digest: string | null;
          right_digest: string | null;
          raw_equal: boolean | null;
          canonical_equal: boolean | null;
          first_top_level_diff: string | null;
          first_configuration_diff: string | null;
          left_configuration_value: string | null;
          right_configuration_value: string | null;
        }>>>`
          WITH authority_surface AS (
            SELECT value AS admission
            FROM jsonb_array_elements(
              ${JSON.stringify(authority)}::text::jsonb
                ->'surfaceAdmissions'
            )
          )
          SELECT
            admission->>'surfaceKey' AS surface_key,
            encode(sha256(convert_to(public.waia_canonical_jsonb_v1(
              surface.receipt_json::jsonb->'kmConvergenceReceipt'
            ), 'UTF8')), 'hex') AS left_digest,
            encode(sha256(convert_to(public.waia_canonical_jsonb_v1(
              frozen.value->'convergenceReceipt'
            ), 'UTF8')), 'hex') AS right_digest,
            surface.receipt_json::jsonb->'kmConvergenceReceipt'
              IS NOT DISTINCT FROM frozen.value->'convergenceReceipt' AS raw_equal,
            public.waia_canonical_jsonb_v1(
              surface.receipt_json::jsonb->'kmConvergenceReceipt'
            ) IS NOT DISTINCT FROM public.waia_canonical_jsonb_v1(
              frozen.value->'convergenceReceipt'
            ) AS canonical_equal,
            top_diff.key AS first_top_level_diff,
            configuration_diff.path AS first_configuration_diff,
            configuration_diff.left_value AS left_configuration_value,
            configuration_diff.right_value AS right_configuration_value
          FROM authority_surface
          LEFT JOIN public.trader_scientific_admission_receipt_v1 surface
            ON surface.id=(admission->>'scientificAdmissionReceiptId')::uuid
           AND surface.organization_id=${input.organizationId}::uuid
          LEFT JOIN public.trader_scientific_admission_receipt_v1 aggregate
            ON aggregate.id=${input.aggregateAdmissionReceiptId}::uuid
           AND aggregate.organization_id=${input.organizationId}::uuid
          LEFT JOIN LATERAL jsonb_array_elements(
            aggregate.receipt_json::jsonb#>'{sourceAuthority,contract,surfaces}'
          ) frozen(value)
            ON frozen.value->>'surfaceKey'=admission->>'surfaceKey'
          LEFT JOIN LATERAL (
            SELECT key
            FROM (
              SELECT jsonb_object_keys(
                surface.receipt_json::jsonb->'kmConvergenceReceipt'
              ) AS key
              UNION
              SELECT jsonb_object_keys(frozen.value->'convergenceReceipt') AS key
            ) keys
            WHERE surface.receipt_json::jsonb->'kmConvergenceReceipt'->key
              IS DISTINCT FROM frozen.value->'convergenceReceipt'->key
            ORDER BY key
            LIMIT 1
          ) top_diff ON true
          LEFT JOIN LATERAL (
            SELECT
              format('configurations[%s].%s', left_entry.ordinality - 1, keys.key) AS path,
              (left_entry.value->keys.key)::text AS left_value,
              (right_entry.value->keys.key)::text AS right_value
            FROM jsonb_array_elements(
              surface.receipt_json::jsonb#>'{kmConvergenceReceipt,configurations}'
            ) WITH ORDINALITY left_entry(value, ordinality)
            LEFT JOIN LATERAL (
              SELECT value
              FROM jsonb_array_elements(
                frozen.value#>'{convergenceReceipt,configurations}'
              ) WITH ORDINALITY candidate(value, ordinality)
              WHERE candidate.ordinality=left_entry.ordinality
            ) right_entry ON true
            CROSS JOIN LATERAL (
              SELECT jsonb_object_keys(COALESCE(left_entry.value, '{}'::jsonb)) AS key
              UNION
              SELECT jsonb_object_keys(COALESCE(right_entry.value, '{}'::jsonb)) AS key
            ) keys
            WHERE left_entry.value->keys.key IS DISTINCT FROM right_entry.value->keys.key
            ORDER BY left_entry.ordinality NULLS LAST, keys.key
            LIMIT 1
          ) configuration_diff ON true
          ORDER BY admission->>'surfaceKey'
        `;
        const convergenceMismatch = convergenceBindings.find(
          (binding) => binding.canonical_equal !== true || binding.raw_equal !== true,
        );
        if (convergenceBindings.length !== 4 || convergenceMismatch) {
          refuse(
            `FINALIZER_SCIENTIFIC_CONVERGENCE_SQL:${
              convergenceMismatch?.surface_key ?? "CARDINALITY"
            }:${convergenceMismatch?.left_digest ?? "NULL"}:${
              convergenceMismatch?.right_digest ?? "NULL"
            }:RAW_${convergenceMismatch?.raw_equal === true ? "EQUAL" : "DIFF"}:${
              convergenceMismatch?.first_configuration_diff ??
              convergenceMismatch?.first_top_level_diff ?? "UNKNOWN"
            }:${convergenceMismatch?.left_configuration_value ?? "NULL"}:${
              convergenceMismatch?.right_configuration_value ?? "NULL"
            }`,
          );
        }
        const finalized = await transaction<Array<Readonly<{ id: string }>>>`
          SELECT public.waia_finalize_historical_four_surface_authority_v2(
            ${approvedProposal.proposalId}::uuid,
            ${approvedProposal.proposalContentDigestHex},
            ${approvedProposal.technicalCandidateContentDigestHex},
            ${JSON.stringify(authority)}::text::jsonb
          )::text AS id
        `;
        if (finalized.length !== 1 || !finalized[0]?.id) refuse("FINALIZE_FUNCTION");
      } else await transaction`
    INSERT INTO trader_historical_four_surface_ratified_admission_v2 (
      id, organization_id, run_id, release_sha, aggregate_admission_receipt_id,
      aggregate_admission_content_digest_hex, development_dataset_identity_digest_hex,
      operator_user_id, surface_admissions_json, knowledge_snapshots_json,
      knowledge_snapshot_digest_hex, market_evidence_json, market_evidence_digest_hex,
      authority_json,
      authority_content_digest_hex, schema_version, created_at
    ) VALUES (
      ${id}::uuid, ${input.organizationId}::uuid, ${input.runId}, ${input.releaseSha},
      ${input.aggregateAdmissionReceiptId}::uuid, ${aggregate.contentDigestHex},
      ${aggregate.developmentDatasetIdentityDigestHex}, ${input.operatorUserId}::uuid,
      ${JSON.stringify(authority.surfaceAdmissions)}::text::jsonb,
      ${JSON.stringify(authority.knowledgeSnapshots)}::text::jsonb,
      ${authority.knowledgeSnapshotDigestHex},
      ${JSON.stringify(authority.marketEvidence)}::text::jsonb,
      ${authority.marketEvidenceDigestHex},
      ${JSON.stringify(authority)}::text::jsonb, ${authority.contentDigestHex},
      ${HISTORICAL_FOUR_SURFACE_RATIFIED_ADMISSION_V2},
      ${authority.epistemicRecordCutoff}::timestamptz
    ) ON CONFLICT DO NOTHING
  `;
      const durable = await loadDurableAuthority(transaction, input.organizationId, input.runId);
      if (!durable || !rowMatches(durable, authority)) refuse("CONFLICT");
      return Object.freeze({ id: durable.id, insertedNew: durable.id === id, authority });
    });
}

type AuthenticatedRatificationDependenciesV2 = Readonly<{
  prepare(
    sql: postgres.Sql,
    preflight: KmFourSurfaceProductionPreflightInputV2,
  ): Promise<InternalKmFourSurfaceScientificAdmissionProductionV2>;
  readQualification(path: string): FhvPreHoldoutQualificationReceiptV1;
  assertQualification(receipt: FhvPreHoldoutQualificationReceiptV1): void;
  assertFiles(
    input: Readonly<{
      datasetRoot: string;
      receipt: FhvPreHoldoutQualificationReceiptV1;
    }>,
  ): void;
  loadDevelopment: typeof loadHistoricalDevelopmentSourceCorpusSnapshotFromDatasetV2;
  loadWalkForward: typeof loadHistoricalWalkForwardPredictiveSourceCorpusSnapshotFromDatasetV2;
  readVolume(path: string): HtxVolumeQualificationReceiptV1;
}>;

const productionRatificationDependenciesV2: AuthenticatedRatificationDependenciesV2 = Object.freeze(
  {
    prepare: INTERNAL_prepareKmFourSurfaceScientificAdmissionWithHeldPostgresV2,
    readQualification: readFhvPreHoldoutQualificationReceipt,
    assertQualification: assertFhvPreHoldoutQualificationPass,
    assertFiles: assertFhvPreHoldoutFilesMatchReceipt,
    loadDevelopment: loadHistoricalDevelopmentSourceCorpusSnapshotFromDatasetV2,
    loadWalkForward: loadHistoricalWalkForwardPredictiveSourceCorpusSnapshotFromDatasetV2,
    readVolume: (path) => {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as HtxVolumeQualificationReceiptV1;
      const receipt = readHtxVolumeQualificationReceipt(parsed);
      assertHtxVolumeAuthorityQualified(receipt);
      return receipt;
    },
  },
);

function assertAuthenticatedRatificationScopeV2(
  input: HistoricalFourSurfaceAuthenticatedRatificationInputV2,
  receipt: FhvPreHoldoutQualificationReceiptV1,
): void {
  if (
    input.humanDecision !== HISTORICAL_FOUR_SURFACE_HUMAN_DECISION_V2 ||
    receipt.organizationId !== input.preflight.organizationId ||
    receipt.qualificationReceiptDigest === "" ||
    receipt.holdout.status !== "PRE_HOLDOUT_ONLY_NOT_PRESENT_NOT_ACCESSED" ||
    receipt.canonicalBoundaries.wfPredictive.startUtc !==
      receipt.canonicalBoundaries.walkForward.startUtc ||
    receipt.canonicalBoundaries.wfPredictive.endUtc >
      receipt.canonicalBoundaries.walkForward.endUtc ||
    receipt.canonicalBoundaries.wfPredictive.endUtc <=
      receipt.canonicalBoundaries.wfPredictive.startUtc
  ) {
    refuse("AUTHENTICATED_ACTION_SCOPE");
  }
}

async function buildTechnicalSurfaceCandidatesV2(
  input: Readonly<{
    preflight: KmFourSurfaceProductionPreflightInputV2;
    prepared: InternalKmFourSurfaceScientificAdmissionProductionV2;
    qualification: FhvPreHoldoutQualificationReceiptV1;
    dependencies: AuthenticatedRatificationDependenciesV2;
  }>,
): Promise<
  Readonly<{
    surfaces: readonly HistoricalFourSurfaceTechnicalSurfaceCandidateV2[];
    marketBoundaryBars: Readonly<Record<"BTCUSDT" | "ETHUSDT", Bar>>;
  }>
> {
  const candidates: HistoricalFourSurfaceTechnicalSurfaceCandidateV2[] = [];
  const marketBoundaryBars = {} as Record<"BTCUSDT" | "ETHUSDT", Bar>;
  for (const surface of input.prepared.authority.contract.surfaces) {
    if (!SURFACE_KEYS.includes(surface.surfaceKey as HistoricalFourSurfaceKeyV2)) {
      refuse("SURFACE_SET");
    }
    const surfaceKey = surface.surfaceKey as HistoricalFourSurfaceKeyV2;
    const selectedK = surface.convergenceReceipt.selectedK;
    const selectedM = surface.convergenceReceipt.selectedM;
    const generationDigest = surface.convergenceReceipt.selectedPackageGenerationIdentityDigestHex;
    const packageDigest = surface.convergenceReceipt.selectedPackageContentDigestHex;
    if (
      selectedK === null ||
      selectedM === null ||
      generationDigest === null ||
      packageDigest === null
    ) {
      refuse("SURFACE_NOT_CONVERGED");
    }
    const development = await input.dependencies.loadDevelopment({
      datasetRoot: input.preflight.datasetRoot,
      symbol: surface.symbol,
      primaryHorizonMinutes: surface.primaryHorizonMinutes,
    });
    const wfBounds = input.qualification.canonicalBoundaries.wfPredictive;
    const walkForward = await input.dependencies.loadWalkForward({
      datasetRoot: input.preflight.datasetRoot,
      symbol: surface.symbol,
      primaryHorizonMinutes: surface.primaryHorizonMinutes,
      startUtc: wfBounds.startUtc,
      endUtc: wfBounds.endUtc,
    });
    const subpartitions = input.qualification.scientificSubpartitions.filter(
      (entry) =>
        entry.scientificPartition === "WF_PREDICTIVE" &&
        entry.symbol === surface.symbol &&
        entry.startUtc === wfBounds.startUtc &&
        entry.endUtc === wfBounds.endUtc &&
        entry.gapDuplicateIntegrity === "PASS",
    );
    const walkForwardPartitions = input.qualification.partitions.filter(
      (entry) =>
        entry.partition === "walk-forward" &&
        entry.symbol === surface.symbol &&
        entry.gapDuplicateIntegrity === "PASS",
    );
    const window = walkForward.scientificWindowEvidence;
    if (
      subpartitions.length !== 1 ||
      walkForwardPartitions.length !== 1 ||
      !window ||
      walkForward.corpus.length < 90 ||
      walkForward.rawSha256Hex !== walkForwardPartitions[0]!.rawSha256 ||
      window.startUtc !== subpartitions[0]!.startUtc ||
      window.endUtc !== subpartitions[0]!.endUtc ||
      window.barCount !== subpartitions[0]!.barCount ||
      window.expectedBarCount !== subpartitions[0]!.expectedBarCount ||
      window.firstBarOpen !== subpartitions[0]!.firstBarOpen ||
      window.lastBarClose !== subpartitions[0]!.lastBarClose ||
      window.semanticContentDigest !== subpartitions[0]!.semanticContentDigest ||
      window.gapDuplicateIntegrity !== subpartitions[0]!.gapDuplicateIntegrity
    ) {
      refuse("WF_PREDICTIVE_AUTHORITY");
    }
    const predictivePackage = buildPredictivePackageV1({
      family: surface.family,
      sourceCorpus: development.corpus,
      kConfigDec: selectedK,
      mConfigDec: selectedM,
      alphaEpiConfigScale8: surface.convergenceReceipt.alphaEpiConfigScale8,
    });
    if (
      predictivePackage.predictivePackageGenerationIdentityDigest.toString("hex") !==
        generationDigest ||
      predictivePackage.predictivePackageContentDigest.toString("hex") !== packageDigest ||
      predictivePackage.family.developmentDatasetDigestHex !==
        input.prepared.authority.developmentDatasetIdentityDigestHex
    ) {
      refuse("SURFACE_PACKAGE_REPLAY");
    }
    const evaluationPartitionReceiptDigestHex = computeSemanticSha256Hex({
      schemaVersion: "waia.trader.wf_predictive_evaluation_partition.v2",
      organizationId: input.preflight.organizationId,
      runId: input.preflight.runId,
      releaseSha: input.preflight.releaseSha,
      qualificationReceiptDigestHex: input.qualification.qualificationReceiptDigest,
      wfPredictiveTypedContentDigestHex: input.qualification.wfPredictiveContentDigest,
      symbol: surface.symbol,
      primaryHorizonMinutes: surface.primaryHorizonMinutes,
      bounds: wfBounds,
      scientificSubpartitionEvidence: subpartitions[0],
      completeWalkForwardFileRawSha256Hex: walkForward.rawSha256Hex,
      predictivePackageContentDigestHex: packageDigest,
    });
    const developmentReturns = development.corpus.map((anchor) =>
      terminalRhFromOutcome13dV1(anchor.outcome13d),
    );
    const harnessInput: ResearchHarnessAdmissionInputV1 = {
      venue: "htx",
      market: "spot",
      symbol: surface.symbol,
      primaryHorizonMinutes: surface.primaryHorizonMinutes,
      challengerPackageContentDigestHex: packageDigest,
      comparisonFamilyId: `wf-predictive:${input.preflight.runId}:${surface.surfaceKey}`,
      evaluationPartitionReceiptDigestHex,
      purgeDurationMinutes: surface.primaryHorizonMinutes,
      embargoDurationMinutes: surface.primaryHorizonMinutes,
      developmentReturns,
      historyReturns: developmentReturns,
      historyReturnMinuteOpenTimesMs: development.corpus.map((anchor) => anchor.closedBarEpochMs),
      anchors: walkForward.corpus.map((anchor) => {
        const issuance = issueForecastV1({
          pkg: predictivePackage,
          anchorClosedBarEpochMs: anchor.closedBarEpochMs,
          anchorRealizedVol20m_1m: anchor.realizedVol20m_1m,
          executionHorizonMinutes: surface.family.executionHorizonMinutes,
          normalizationVersionDigestHex: surface.family.normalizationVersionDigestHex,
        });
        return Object.freeze({
          anchorId: computeSemanticSha256Hex({
            schemaVersion: "waia.trader.wf_predictive_anchor.v2",
            surfaceKey,
            closedBarEpochMs: anchor.closedBarEpochMs,
            barContentDigest: anchor.barContentDigest,
            evaluationPartitionReceiptDigestHex,
          }),
          observedReturn: terminalRhFromOutcome13dV1(anchor.outcome13d),
          challengerProbabilities: issuance.terminalScenarioMasses.probabilities,
        });
      }),
    };
    const predictive = buildPredictiveTerminalReceiptV1({
      harnessInput,
      identities: {
        developmentDatasetDigestHex: input.prepared.authority.developmentDatasetIdentityDigestHex,
        targetGridReceiptDigestHex: predictivePackage.terminalTargetGridIdentityDigestHex,
        predictivePackageGenerationIdentityDigestHex: generationDigest,
        predictivePackageContentDigestHex: packageDigest,
        runtimeContractDigestHex: predictivePackage.runtimeContractDigest.toString("hex"),
        scoringContractVersion: "multiclass-log-score/v1",
        evaluationPartitionReceiptDigestHex,
      },
    });
    if (predictive.terminalStatus !== "QUALIFIED") {
      const diagnostic = canonicalizeDiagnosticJsonString({
        reasonCodes: predictive.reasonCodes,
        meanImprovementByBaseline: predictive.meanImprovementByBaseline,
        holmComparisons: predictive.holmComparisons,
        holmResults: predictive.holmResults,
        commonAnchorSetDigestHex: predictive.commonAnchorSetDigestHex,
        evaluationPartitionReceiptDigestHex: predictive.evaluationPartitionReceiptDigestHex,
      });
      refuse(`WF_PREDICTIVE_NOT_QUALIFIED:${surfaceKey}:DIAGNOSTIC=${diagnostic}`);
    }
    const volume = input.dependencies.readVolume(
      input.preflight.htxVolumeQualificationReceiptPaths[surface.symbol],
    );
    if (!walkForward.bars || walkForward.bars.length !== window.barCount) {
      refuse("WF_PREDICTIVE_BAR_SNAPSHOT");
    }
    const boundaryBar = walkForward.bars.at(-1);
    if (!boundaryBar || boundaryBar.barCloseTime !== wfBounds.endUtc) {
      refuse("WF_PREDICTIVE_BOUNDARY_BAR");
    }
    const priorBoundaryBar = marketBoundaryBars[surface.symbol];
    if (
      priorBoundaryBar &&
      canonicalizeSemanticJsonString(priorBoundaryBar) !==
        canonicalizeSemanticJsonString(boundaryBar)
    ) {
      refuse("WF_PREDICTIVE_BOUNDARY_BAR_MISMATCH");
    }
    marketBoundaryBars[surface.symbol] = boundaryBar;
    candidates.push(
      Object.freeze({
        surfaceKey,
        symbol: surface.symbol,
        primaryHorizonMinutes: surface.primaryHorizonMinutes,
        executionHorizonMinutes: surface.family.executionHorizonMinutes,
        familyIdentityDigestHex: surface.familyIdentityDigestHex,
        predictivePackageGenerationIdentityDigestHex: generationDigest,
        predictivePackageContentDigestHex: packageDigest,
        kmGlobalAnchorSetDigestHex: surface.convergenceReceipt.kmGlobalAnchorSetDigestHex,
        predictiveTerminalReceipt: predictive,
        volumeQualificationReceiptDigestHex: volume.qualificationReceiptDigest,
        marketBoundaryBar: boundaryBar,
      }),
    );
  }
  if (
    candidates.length !== SURFACE_KEYS.length ||
    new Set(candidates.map((item) => item.surfaceKey)).size !== SURFACE_KEYS.length
  ) {
    refuse("TECHNICAL_SURFACE_SET");
  }
  if (!marketBoundaryBars.BTCUSDT || !marketBoundaryBars.ETHUSDT) {
    refuse("MARKET_BOUNDARY_BAR_SET");
  }
  return Object.freeze({
    surfaces: Object.freeze(candidates.sort((a, b) => a.surfaceKey.localeCompare(b.surfaceKey))),
    marketBoundaryBars: Object.freeze(marketBoundaryBars),
  });
}

async function materializeApprovedTechnicalSurfacesV2(
  input: Readonly<{
    sql: postgres.Sql;
    preflight: KmFourSurfaceProductionPreflightInputV2;
    prepared: InternalKmFourSurfaceScientificAdmissionProductionV2;
    qualification: FhvPreHoldoutQualificationReceiptV1;
    operatorUserId: string;
    candidate: HistoricalFourSurfaceTechnicalCandidateV2;
    dependencies: AuthenticatedRatificationDependenciesV2;
  }>,
): Promise<
  Readonly<{
    receiptIds: Readonly<Record<HistoricalFourSurfaceKeyV2, string>>;
    knowledgeSnapshots: readonly HistoricalPrerunKnowledgeSnapshotV2[];
    marketBoundaryBars: Readonly<Record<"BTCUSDT" | "ETHUSDT", Bar>>;
  }>
> {
  const ids = {} as Record<HistoricalFourSurfaceKeyV2, string>;
  const snapshots: HistoricalPrerunKnowledgeSnapshotV2[] = [];
  const bars = {} as Record<"BTCUSDT" | "ETHUSDT", Bar>;
  const wfBounds = input.qualification.canonicalBoundaries.wfPredictive;
  for (const technical of input.candidate.surfaces) {
    const surface = input.prepared.authority.contract.surfaces.find(
      (item) => item.surfaceKey === technical.surfaceKey,
    );
    if (!surface) refuse("APPROVED_TECHNICAL_SURFACE");
    const selectedK = surface.convergenceReceipt.selectedK;
    const selectedM = surface.convergenceReceipt.selectedM;
    const generationDigest = surface.convergenceReceipt.selectedPackageGenerationIdentityDigestHex;
    const packageDigest = surface.convergenceReceipt.selectedPackageContentDigestHex;
    if (
      selectedK === null ||
      selectedM === null ||
      generationDigest === null ||
      packageDigest === null ||
      generationDigest !== technical.predictivePackageGenerationIdentityDigestHex ||
      packageDigest !== technical.predictivePackageContentDigestHex ||
      surface.familyIdentityDigestHex !== technical.familyIdentityDigestHex ||
      surface.convergenceReceipt.kmGlobalAnchorSetDigestHex !== technical.kmGlobalAnchorSetDigestHex
    )
      refuse("APPROVED_TECHNICAL_BINDING");
    const human = buildEpistemicParameterRatificationReceiptV1({
      kmConvergenceEvidenceSemanticDigestHex: surface.convergenceReceipt.evidenceSemanticDigestHex,
      selectedK,
      selectedM,
      alphaEpiConfigScale8: surface.convergenceReceipt.alphaEpiConfigScale8,
      selectedPackageGenerationIdentityDigestHex: generationDigest,
      selectedPackageContentDigestHex: packageDigest,
      humanReceiptIdentityDigestHex: computeHistoricalHumanRatificationIdentityDigestV2({
        organizationId: input.preflight.organizationId,
        runId: input.preflight.runId,
        releaseSha: input.preflight.releaseSha,
        operatorUserId: input.operatorUserId,
        aggregateAdmissionReceiptId: input.prepared.admission.id,
        aggregateAdmissionContentDigestHex: input.prepared.admission.receipt.contentDigestHex,
        surfaceKey: technical.surfaceKey,
        familyIdentityDigestHex: technical.familyIdentityDigestHex,
        predictiveTerminalReceiptContentDigestHex:
          technical.predictiveTerminalReceipt.contentDigestHex,
        kmConvergenceEvidenceSemanticDigestHex:
          surface.convergenceReceipt.evidenceSemanticDigestHex,
        selectedK,
        selectedM,
        predictivePackageGenerationIdentityDigestHex: generationDigest,
        predictivePackageContentDigestHex: packageDigest,
      }),
    });
    const volume = input.dependencies.readVolume(
      input.preflight.htxVolumeQualificationReceiptPaths[technical.symbol],
    );
    if (volume.qualificationReceiptDigest !== technical.volumeQualificationReceiptDigestHex) {
      refuse("APPROVED_VOLUME_BINDING");
    }
    const persisted = await persistScientificAdmissionReceiptV2(
      input.sql,
      buildScientificAdmissionReceiptRecordV2({
        organizationId: input.preflight.organizationId,
        predictiveTerminalReceipt: technical.predictiveTerminalReceipt,
        kmConvergenceReceipt: surface.convergenceReceipt,
        epistemicParameterRatificationReceipt: human,
        htxVolumeQualificationReceipt: volume,
      }),
    );
    const walkForward = await input.dependencies.loadWalkForward({
      datasetRoot: input.preflight.datasetRoot,
      symbol: technical.symbol,
      primaryHorizonMinutes: technical.primaryHorizonMinutes,
      startUtc: wfBounds.startUtc,
      endUtc: wfBounds.endUtc,
    });
    if (
      !walkForward.bars ||
      canonicalizeSemanticJsonString(walkForward.bars.at(-1)) !==
        canonicalizeSemanticJsonString(technical.marketBoundaryBar)
    ) {
      refuse("APPROVED_MARKET_BOUNDARY_BINDING");
    }
    snapshots.push(
      await INTERNAL_buildHistoricalPrerunKnowledgeBootstrapV2({
        sql: input.sql,
        scope: {
          organizationId: input.preflight.organizationId,
          runId: input.preflight.runId,
          releaseSha: input.preflight.releaseSha,
          surfaceKey: technical.surfaceKey,
          exchangeSymbol: technical.symbol,
          instrumentId: technical.symbol === "BTCUSDT" ? "BTC/USDT" : "ETH/USDT",
          primaryHorizonMinutes: technical.primaryHorizonMinutes,
          operatorUserId: input.operatorUserId,
          aggregateAdmissionContentDigestHex: input.prepared.admission.receipt.contentDigestHex,
          qualificationReceiptDigestHex: input.qualification.qualificationReceiptDigest,
          predictivePackageContentDigestHex: technical.predictivePackageContentDigestHex,
          wfPredictiveStartUtc: wfBounds.startUtc,
          wfPredictiveEndUtc: wfBounds.endUtc,
        },
        wfPredictiveBars: walkForward.bars,
      }),
    );
    ids[technical.surfaceKey] = persisted.id;
    const prior = bars[technical.symbol];
    if (
      prior &&
      canonicalizeSemanticJsonString(prior) !==
        canonicalizeSemanticJsonString(technical.marketBoundaryBar)
    ) {
      refuse("APPROVED_MARKET_BOUNDARY_SET");
    }
    bars[technical.symbol] = technical.marketBoundaryBar;
  }
  if (
    SURFACE_KEYS.some((key) => !UUID.test(ids[key])) ||
    snapshots.length !== 4 ||
    !bars.BTCUSDT ||
    !bars.ETHUSDT
  )
    refuse("APPROVED_MATERIALIZATION_SET");
  return Object.freeze({
    receiptIds: Object.freeze(ids),
    knowledgeSnapshots: Object.freeze(snapshots),
    marketBoundaryBars: Object.freeze(bars),
  });
}

function sealTechnicalCandidateV2(input: Readonly<{
  preflight: KmFourSurfaceProductionPreflightInputV2;
  prepared: InternalKmFourSurfaceScientificAdmissionProductionV2;
  qualification: FhvPreHoldoutQualificationReceiptV1;
  surfaces: readonly HistoricalFourSurfaceTechnicalSurfaceCandidateV2[];
}>): HistoricalFourSurfaceTechnicalCandidateV2 {
  const predictiveCounts = input.qualification.scientificSubpartitions
    .filter((entry) => entry.scientificPartition === "WF_PREDICTIVE")
    .map((entry) => entry.barCount);
  const economicCounts = input.qualification.scientificSubpartitions
    .filter((entry) => entry.scientificPartition === "WF_ECONOMIC")
    .map((entry) => entry.barCount);
  if (predictiveCounts.length !== 2 || economicCounts.length !== 2 ||
      new Set(predictiveCounts).size !== 1 || new Set(economicCounts).size !== 1 ||
      predictiveCounts[0]! < 240 || economicCounts[0]! < 1) {
    refuse("QUALIFIED_EXECUTION_EXTENT");
  }
  const body = Object.freeze({
    schemaVersion: "waia.trader.historical_four_surface_technical_candidate.v2" as const,
    organizationId: input.preflight.organizationId,
    runId: input.preflight.runId,
    releaseSha: input.preflight.releaseSha,
    aggregateAdmissionReceiptId: input.prepared.admission.id,
    aggregateAdmissionContentDigestHex: input.prepared.admission.receipt.contentDigestHex,
    developmentDatasetIdentityDigestHex:
      input.prepared.authority.developmentDatasetIdentityDigestHex,
    qualificationReceiptDigestHex: input.qualification.qualificationReceiptDigest,
    firstEconomicRecordIndex: predictiveCounts[0]!,
    economicRecordCount: economicCounts[0]!,
    surfaces: input.surfaces,
    authorityBoundary: Object.freeze({
      capitalAuthority: "NONE" as const,
      liveTradingAuthority: "NONE" as const,
      blindHoldoutAuthority: "FORBIDDEN_NOT_PRESENT_NOT_ACCESSED" as const,
    }),
  });
  return Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
}

async function loadFrozenTechnicalAggregateV2(
  sql: postgres.Sql,
  candidate: HistoricalFourSurfaceTechnicalCandidateV2,
): Promise<InternalKmFourSurfaceScientificAdmissionProductionV2> {
  const row = await loadScientificRow(sql, candidate.organizationId,
    candidate.aggregateAdmissionReceiptId);
  if (row.receipt_kind !== "WF_PREDICTIVE_FOUR_SURFACE") refuse("FROZEN_AGGREGATE_KIND");
  const receipt = parseReceipt<ScientificAdmissionFourSurfaceReceiptV2>(
    row.receipt_json, "FROZEN_AGGREGATE_JSON",
  );
  const rebuilt = await requireScientificAdmissionFourSurfaceForOrganizationV2(sql, {
    organizationId: candidate.organizationId,
    releaseSha: candidate.releaseSha,
    runId: candidate.runId,
    developmentDatasetIdentityDigestHex: candidate.developmentDatasetIdentityDigestHex,
    sourceQualificationReceiptDigestHex: candidate.qualificationReceiptDigestHex,
    sourceFourSurfaceAuthorityContentDigestHex:
      receipt.sourceFourSurfaceAuthorityContentDigestHex,
    evidenceSemanticDigestHex: receipt.evidenceSemanticDigestHex,
  });
  if (row.id !== candidate.aggregateAdmissionReceiptId ||
      row.content_digest !== candidate.aggregateAdmissionContentDigestHex ||
      rebuilt.contentDigestHex !== candidate.aggregateAdmissionContentDigestHex ||
      rebuilt.sourceQualificationReceiptDigestHex !== candidate.qualificationReceiptDigestHex ||
      rebuilt.developmentDatasetIdentityDigestHex !==
        candidate.developmentDatasetIdentityDigestHex) {
    refuse("FROZEN_AGGREGATE_BINDING");
  }
  return Object.freeze({
    authority: rebuilt.sourceAuthority,
    admission: Object.freeze({ id: row.id, insertedNew: false, receipt: rebuilt }),
  });
}

async function prepareTechnicalCandidateWithHeldConnectionV2(
  sql: postgres.Sql,
  input: HistoricalFourSurfaceAuthenticatedRatificationInputV2,
  dependencies: AuthenticatedRatificationDependenciesV2,
): Promise<HistoricalFourSurfaceTechnicalCandidateV2> {
  if (typeof (sql as unknown as { release?: unknown }).release !== "function") {
    refuse("DEDICATED_SESSION_REQUIRED");
  }
  const receipt = dependencies.readQualification(input.preflight.qualificationReceiptPath);
  dependencies.assertQualification(receipt);
  dependencies.assertFiles({ datasetRoot: input.preflight.datasetRoot, receipt });
  assertAuthenticatedRatificationScopeV2(input, receipt);
  return withPostgresSessionTransaction(sql, "SERIALIZABLE", async (transaction) => {
    const prepared = await dependencies.prepare(transaction, input.preflight);
    if (
      prepared.admission.receipt.organizationId !== input.preflight.organizationId ||
      prepared.admission.receipt.runId !== input.preflight.runId ||
      prepared.admission.receipt.releaseSha !== input.preflight.releaseSha ||
      prepared.admission.receipt.sourceQualificationReceiptDigestHex !==
        receipt.qualificationReceiptDigest
    ) {
      refuse("AGGREGATE_SCOPE");
    }
    const technical = await buildTechnicalSurfaceCandidatesV2({
      preflight: input.preflight, prepared, qualification: receipt, dependencies,
    });
    const candidate = sealTechnicalCandidateV2({
      preflight: input.preflight, prepared, qualification: receipt,
      surfaces: technical.surfaces,
    });
    await transaction`
      INSERT INTO trader_historical_qualified_execution_extent_v2 (
        organization_id,run_id,release_sha,qualification_receipt_digest_hex,
        qualification_receipt_json,first_economic_record_index,economic_record_count,
        schema_version
      ) VALUES (
        ${candidate.organizationId}::uuid,${candidate.runId},${candidate.releaseSha},
        ${candidate.qualificationReceiptDigestHex},
        ${JSON.stringify(receipt)}::text::jsonb,
        ${candidate.firstEconomicRecordIndex},${candidate.economicRecordCount},
        'waia.trader.historical_qualified_execution_extent.v2'
      ) ON CONFLICT DO NOTHING
    `;
    const extentRows = await transaction<Array<Readonly<{
      first_economic_record_index: number;
      economic_record_count: number;
    }>>>`
      SELECT first_economic_record_index,economic_record_count
      FROM trader_historical_qualified_execution_extent_v2
      WHERE organization_id=${candidate.organizationId}::uuid AND run_id=${candidate.runId}
        AND release_sha=${candidate.releaseSha}
        AND qualification_receipt_digest_hex=${candidate.qualificationReceiptDigestHex}
    `;
    if (extentRows.length !== 1 ||
        extentRows[0]!.first_economic_record_index !== candidate.firstEconomicRecordIndex ||
        extentRows[0]!.economic_record_count !== candidate.economicRecordCount) {
      refuse("QUALIFIED_EXECUTION_EXTENT_DURABLE_CONFLICT");
    }
    return candidate;
  });
}

async function ratifyWithHeldConnectionV2(
  sql: postgres.Sql,
  input: HistoricalFourSurfaceAuthenticatedRatificationInputV2,
  authenticatedOperatorUserId: string,
  dependencies: AuthenticatedRatificationDependenciesV2,
  persistAuthority = true,
): Promise<
  Readonly<{
    id: string;
    insertedNew: boolean;
    authority: HistoricalFourSurfaceRatifiedAdmissionV2;
  }>
> {
  if (
    !UUID.test(authenticatedOperatorUserId) ||
    typeof (sql as unknown as { release?: unknown }).release !== "function"
  ) {
    refuse("AUTHENTICATED_SESSION");
  }
  const receipt = dependencies.readQualification(input.preflight.qualificationReceiptPath);
  dependencies.assertQualification(receipt);
  dependencies.assertFiles({ datasetRoot: input.preflight.datasetRoot, receipt });
  assertAuthenticatedRatificationScopeV2(input, receipt);
  return withPostgresSessionTransaction(sql, "SERIALIZABLE", async (transaction) => {
    const existing = await loadDurableAuthority(
      transaction,
      input.preflight.organizationId,
      input.preflight.runId,
    );
    if (existing) {
      const member = await transaction<Array<Readonly<{ member_role: string }>>>`
        SELECT member_role FROM organization_members
        WHERE organization_id=${input.preflight.organizationId}::uuid
          AND user_id=${authenticatedOperatorUserId}::uuid
        FOR SHARE
      `;
      if (
        member.length !== 1 ||
        (member[0]?.member_role !== "owner" && member[0]?.member_role !== "manager")
      ) {
        refuse("OPERATOR_MEMBERSHIP");
      }
      const authority = await requireHistoricalFourSurfaceRatifiedAdmissionV2(transaction, {
        organizationId: input.preflight.organizationId,
        runId: input.preflight.runId,
        releaseSha: input.preflight.releaseSha,
        aggregateAdmissionReceiptId: existing.aggregate_admission_receipt_id,
        authorityContentDigestHex: existing.authority_content_digest_hex,
      });
      return Object.freeze({ id: existing.id, insertedNew: false, authority });
    }
    const prepared = await dependencies.prepare(transaction, input.preflight);
    if (
      prepared.admission.receipt.organizationId !== input.preflight.organizationId ||
      prepared.admission.receipt.runId !== input.preflight.runId ||
      prepared.admission.receipt.releaseSha !== input.preflight.releaseSha ||
      prepared.admission.receipt.sourceQualificationReceiptDigestHex !==
        receipt.qualificationReceiptDigest
    ) {
      refuse("AGGREGATE_SCOPE");
    }
    const technical = await buildTechnicalSurfaceCandidatesV2({
      preflight: input.preflight,
      prepared,
      qualification: receipt,
      dependencies,
    });
    const candidate = sealTechnicalCandidateV2({
      preflight: input.preflight, prepared, qualification: receipt,
      surfaces: technical.surfaces,
    });
    const surfaces = await materializeApprovedTechnicalSurfacesV2({
      sql: transaction,
      preflight: input.preflight,
      prepared,
      qualification: receipt,
      operatorUserId: authenticatedOperatorUserId,
      candidate,
      dependencies,
    });
    const marketEvidence = await buildCanonicalMarketEvidenceV2({
      sql: transaction,
      preflight: input.preflight,
      organizationId: input.preflight.organizationId,
      runId: input.preflight.runId,
      releaseSha: input.preflight.releaseSha,
      operatorUserId: authenticatedOperatorUserId,
      qualification: receipt,
      marketBoundaryBars: surfaces.marketBoundaryBars,
    });
    return persistHistoricalFourSurfaceRatificationV2(
      transaction,
      {
        organizationId: input.preflight.organizationId,
        runId: input.preflight.runId,
        releaseSha: input.preflight.releaseSha,
        aggregateAdmissionReceiptId: prepared.admission.id,
        operatorUserId: authenticatedOperatorUserId,
        scientificAdmissionReceiptIds: surfaces.receiptIds,
        knowledgeSnapshots: surfaces.knowledgeSnapshots,
        marketEvidence,
        executionExtent: input.executionExtent ?? Object.freeze({
          initialRecordIndex: receipt.scientificSubpartitions.find((entry) =>
            entry.scientificPartition === "WF_PREDICTIVE")!.barCount - 1,
          cycleCount: receipt.scientificSubpartitions.find((entry) =>
            entry.scientificPartition === "WF_ECONOMIC")!.barCount + 1,
        }),
      },
      authenticatedOperatorUserId,
      persistAuthority,
    );
  });
}

/**
 * Authenticated server-only DEE-918 -> DEE-919 human ratification action. The request cannot
 * supply an actor, receipt id, evidence digest or predictive result: all are derived and replayed
 * under one dedicated PostgreSQL session and the run-scoped advisory lock.
 */
export async function ratifyHistoricalFourSurfaceAdmissionV2(
  _input: HistoricalFourSurfaceAuthenticatedRatificationInputV2,
): Promise<Readonly<{ id: string; insertedNew: boolean; authorityContentDigestHex: string }>> {
  refuse("SPLIT_RATIFICATION_REQUIRED");
}

/** TEST_ONLY dependency seam. Runtime guarded and never exported from the package index. */
export function TEST_ONLY_ratifyHistoricalFourSurfaceAdmissionWithHeldPostgresV2(
  sql: postgres.Sql,
  input: HistoricalFourSurfaceAuthenticatedRatificationInputV2,
  authenticatedOperatorUserId: string,
  dependencies: AuthenticatedRatificationDependenciesV2,
): Promise<
  Readonly<{
    id: string;
    insertedNew: boolean;
    authority: HistoricalFourSurfaceRatifiedAdmissionV2;
  }>
> {
  if (process.env.NODE_ENV !== "test" || process.env.VITEST !== "true") {
    refuse("TEST_ONLY_RUNTIME");
  }
  return ratifyWithHeldConnectionV2(sql, input, authenticatedOperatorUserId, dependencies);
}

/**
 * Execution-host technical preparation.  The actor must come from a durable,
 * authenticated proposal request; callers must not accept it from CLI input.
 * Only non-Human technical/aggregate evidence is persisted. Human-semantic
 * scientific, knowledge and market evidence is deferred until exact Admin approval.
 */
export function INTERNAL_prepareHistoricalFourSurfaceTechnicalAuthorityCandidateV2(
  sql: postgres.Sql,
  input: HistoricalFourSurfaceAuthenticatedRatificationInputV2,
): Promise<HistoricalFourSurfaceTechnicalCandidateV2> {
  return prepareTechnicalCandidateWithHeldConnectionV2(
    sql, input, productionRatificationDependenciesV2,
  );
}

/** TEST_ONLY equivalent of technical preparation with bounded evidence dependencies. */
export function TEST_ONLY_prepareHistoricalFourSurfaceTechnicalAuthorityCandidateV2(
  sql: postgres.Sql,
  input: HistoricalFourSurfaceAuthenticatedRatificationInputV2,
  dependencies: AuthenticatedRatificationDependenciesV2,
): Promise<HistoricalFourSurfaceTechnicalCandidateV2> {
  if (process.env.NODE_ENV !== "test" || process.env.VITEST !== "true") {
    refuse("TEST_ONLY_RUNTIME");
  }
  return prepareTechnicalCandidateWithHeldConnectionV2(sql, input, dependencies);
}

async function materializeApprovedCandidateWithHeldConnectionV2(
  sql: postgres.Sql,
  input: HistoricalFourSurfaceAuthenticatedRatificationInputV2,
  authenticatedOperatorUserId: string,
  candidate: HistoricalFourSurfaceTechnicalCandidateV2,
  approvedProposal: Readonly<{
    proposalId: string;
    proposalContentDigestHex: string;
    technicalCandidateContentDigestHex: string;
  }>,
  dependencies: AuthenticatedRatificationDependenciesV2,
): Promise<Readonly<{ id: string; insertedNew: boolean;
  authority: HistoricalFourSurfaceRatifiedAdmissionV2 }>> {
  if (!UUID.test(authenticatedOperatorUserId) ||
      typeof (sql as unknown as { release?: unknown }).release !== "function") {
    refuse("AUTHENTICATED_SESSION");
  }
  if (!input.executionExtent) refuse("APPROVED_EXECUTION_EXTENT");
  // Rebuild the capability object explicitly. TypeScript's structural typing permits
  // a caller to pass a richer launch plan; spreading that object into the durable
  // authority would silently widen the Human-approved execution capability.
  const executionExtent = Object.freeze({
    initialRecordIndex: input.executionExtent.initialRecordIndex,
    cycleCount: input.executionExtent.cycleCount,
  });
  const { contentDigestHex, ...candidateBody } = candidate;
  if (contentDigestHex !== approvedProposal.technicalCandidateContentDigestHex ||
      computeSemanticSha256Hex(candidateBody) !== contentDigestHex ||
      candidate.schemaVersion !== "waia.trader.historical_four_surface_technical_candidate.v2") {
    refuse("APPROVED_TECHNICAL_DIGEST");
  }
  const receipt = dependencies.readQualification(input.preflight.qualificationReceiptPath);
  dependencies.assertQualification(receipt);
  dependencies.assertFiles({ datasetRoot: input.preflight.datasetRoot, receipt });
  assertAuthenticatedRatificationScopeV2(input, receipt);
  return withPostgresSessionTransaction(sql, "SERIALIZABLE", async (transaction) => {
    // The proposal already froze the non-Human aggregate receipt. Recreating it here
    // would mint fresh timestamps/IDs for the same natural identity and is neither
    // deterministic nor necessary. Load and fully replay-validate that durable receipt.
    const prepared = await loadFrozenTechnicalAggregateV2(transaction, candidate);
    const technical = await buildTechnicalSurfaceCandidatesV2({
      preflight: input.preflight, prepared, qualification: receipt, dependencies,
    });
    const replayed = sealTechnicalCandidateV2({
      preflight: input.preflight, prepared, qualification: receipt,
      surfaces: technical.surfaces,
    });
    if (canonicalizeSemanticJsonString(replayed) !== canonicalizeSemanticJsonString(candidate)) {
      refuse("APPROVED_TECHNICAL_REPLAY");
    }
    const surfaces = await materializeApprovedTechnicalSurfacesV2({
      sql: transaction, preflight: input.preflight, prepared, qualification: receipt,
      // JSONB deliberately does not preserve object key order. The legacy
      // predictive-terminal receipt seal still uses JSON.stringify ordering, so
      // materialize from the exact deterministic execution-host replay after its
      // semantic equality to the approved JSONB proposal has been proven above.
      operatorUserId: authenticatedOperatorUserId, candidate: replayed, dependencies,
    });
    const marketEvidence = await buildCanonicalMarketEvidenceV2({
      sql: transaction, preflight: input.preflight,
      organizationId: input.preflight.organizationId, runId: input.preflight.runId,
      releaseSha: input.preflight.releaseSha, operatorUserId: authenticatedOperatorUserId,
      qualification: receipt, marketBoundaryBars: surfaces.marketBoundaryBars,
    });
    return persistHistoricalFourSurfaceRatificationV2(
      transaction,
      {
        organizationId: input.preflight.organizationId,
        runId: input.preflight.runId,
        releaseSha: input.preflight.releaseSha,
        aggregateAdmissionReceiptId: candidate.aggregateAdmissionReceiptId,
        operatorUserId: authenticatedOperatorUserId,
        scientificAdmissionReceiptIds: surfaces.receiptIds,
        knowledgeSnapshots: surfaces.knowledgeSnapshots,
        marketEvidence,
        executionExtent,
      },
      authenticatedOperatorUserId,
      true,
      approvedProposal,
    );
  });
}

/** Materializes Human-semantic evidence only after a separately persisted approval. */
export function INTERNAL_materializeApprovedHistoricalFourSurfaceCandidateV2(
  sql: postgres.Sql,
  input: HistoricalFourSurfaceAuthenticatedRatificationInputV2,
  authenticatedOperatorUserId: string,
  candidate: HistoricalFourSurfaceTechnicalCandidateV2,
  approvedProposal: Readonly<{
    proposalId: string;
    proposalContentDigestHex: string;
    technicalCandidateContentDigestHex: string;
  }>,
) {
  return materializeApprovedCandidateWithHeldConnectionV2(
    sql, input, authenticatedOperatorUserId, candidate, approvedProposal,
    productionRatificationDependenciesV2,
  );
}

/** TEST_ONLY evidence seam; approval binding and database role remain production-real. */
export function TEST_ONLY_materializeApprovedHistoricalFourSurfaceCandidateV2(
  sql: postgres.Sql,
  input: HistoricalFourSurfaceAuthenticatedRatificationInputV2,
  authenticatedOperatorUserId: string,
  candidate: HistoricalFourSurfaceTechnicalCandidateV2,
  approvedProposal: Readonly<{
    proposalId: string;
    proposalContentDigestHex: string;
    technicalCandidateContentDigestHex: string;
  }>,
  dependencies: AuthenticatedRatificationDependenciesV2,
) {
  if (process.env.NODE_ENV !== "test" || process.env.VITEST !== "true") {
    refuse("TEST_ONLY_RUNTIME");
  }
  return materializeApprovedCandidateWithHeldConnectionV2(
    sql, input, authenticatedOperatorUserId, candidate, approvedProposal, dependencies,
  );
}

/** Persist an exact candidate only after its separate durable Human approval was verified. */
export async function INTERNAL_persistApprovedHistoricalFourSurfaceAuthorityCandidateV2(
  sql: postgres.Sql,
  authority: HistoricalFourSurfaceRatifiedAdmissionV2,
): Promise<
  Readonly<{
    id: string;
    insertedNew: boolean;
    authority: HistoricalFourSurfaceRatifiedAdmissionV2;
  }>
> {
  const { contentDigestHex, ...body } = authority;
  if (
    computeSemanticSha256Hex(body) !== contentDigestHex ||
    authority.schemaVersion !== HISTORICAL_FOUR_SURFACE_RATIFIED_ADMISSION_V2
  ) {
    refuse("APPROVED_CANDIDATE_DIGEST");
  }
  const ids = {} as Record<HistoricalFourSurfaceKeyV2, string>;
  for (const surface of authority.surfaceAdmissions) {
    if (!SURFACE_KEYS.includes(surface.surfaceKey) || ids[surface.surfaceKey]) {
      refuse("APPROVED_CANDIDATE_SURFACES");
    }
    ids[surface.surfaceKey] = surface.scientificAdmissionReceiptId;
  }
  const input: HistoricalFourSurfaceRatificationInputV2 = {
    organizationId: authority.organizationId,
    runId: authority.runId,
    releaseSha: authority.releaseSha,
    aggregateAdmissionReceiptId: authority.aggregateAdmissionReceiptId,
    operatorUserId: authority.operatorUserId,
    scientificAdmissionReceiptIds: ids,
    knowledgeSnapshots: authority.knowledgeSnapshots,
    marketEvidence: authority.marketEvidence,
    executionExtent: authority.executionExtent,
  };
  validateInput(input);
  const approvedMemberRole = await requireHistoricalApprovedOperatorRoleV2(sql, {
    organizationId: authority.organizationId,
    runId: authority.runId,
    releaseSha: authority.releaseSha,
    operatorUserId: authority.operatorUserId,
  });
  if (approvedMemberRole !== authority.operatorMemberRole) {
    refuse("APPROVED_CANDIDATE_OPERATOR");
  }
  const aggregate = await validateAggregateRow(
    sql,
    await loadScientificRow(sql, authority.organizationId, authority.aggregateAdmissionReceiptId),
    input,
  );
  const replayedSurfaces: HistoricalFourSurfaceRatifiedSurfaceV2[] = [];
  for (const surfaceKey of SURFACE_KEYS) {
    replayedSurfaces.push(
      validateSurface(
        await loadScientificRow(sql, authority.organizationId, ids[surfaceKey]),
        aggregate,
        surfaceKey,
        {
          aggregateAdmissionReceiptId: authority.aggregateAdmissionReceiptId,
          operatorUserId: authority.operatorUserId,
        },
      ),
    );
  }
  if (
    canonicalizeSemanticJsonString(replayedSurfaces) !==
      canonicalizeSemanticJsonString(authority.surfaceAdmissions) ||
    computeSemanticSha256Hex({
      schemaVersion: "waia.trader.historical_prerun_knowledge_snapshot_set.v2",
      organizationId: authority.organizationId,
      runId: authority.runId,
      releaseSha: authority.releaseSha,
      epistemicRecordCutoff: authority.epistemicRecordCutoff,
      knowledgeSnapshots: authority.knowledgeSnapshots,
    }) !== authority.knowledgeSnapshotDigestHex
  ) {
    refuse("APPROVED_CANDIDATE_REPLAY");
  }
  const qualificationDigest = authority.marketEvidence[0]?.qualificationReceiptDigestHex;
  if (
    !qualificationDigest ||
    authority.marketEvidence.some(
      (item) => item.qualificationReceiptDigestHex !== qualificationDigest,
    )
  ) {
    refuse("APPROVED_CANDIDATE_MARKET_EVIDENCE");
  }
  const replayedMarket = await replayCanonicalMarketEvidenceV2(sql, authority, qualificationDigest);
  const cutoffMs = Date.parse(authority.epistemicRecordCutoff);
  if (
    !Number.isFinite(cutoffMs) ||
    authority.knowledgeSnapshots.some(
      (snapshot) =>
        Date.parse(snapshot.marketPitBoundary) >= cutoffMs ||
        [
          snapshot.hypothesis.createdAt,
          snapshot.lifecycle.createdAt,
          snapshot.trial.ingestTime,
          snapshot.trial.createdAt,
          snapshot.observation.ingestTime,
          snapshot.observation.createdAt,
          snapshot.evidence.ingestTime,
          snapshot.evidence.createdAt,
        ].some((value) => !Number.isFinite(Date.parse(value)) || Date.parse(value) > cutoffMs),
    ) ||
    authority.marketEvidence.some(
      (evidence) =>
        Date.parse(evidence.observationAvailableAt) > cutoffMs ||
        Date.parse(evidence.observationIngestTime) > cutoffMs,
    )
  ) {
    refuse("APPROVED_CANDIDATE_CUTOFF");
  }
  const rebuilt = buildAuthority({
    aggregate,
    aggregateAdmissionReceiptId: authority.aggregateAdmissionReceiptId,
    operatorUserId: authority.operatorUserId,
    operatorMemberRole: authority.operatorMemberRole,
    surfaces: replayedSurfaces,
    epistemicRecordCutoff: authority.epistemicRecordCutoff,
    knowledgeSnapshots: authority.knowledgeSnapshots,
    marketEvidence: replayedMarket,
    executionExtent: authority.executionExtent,
  });
  if (canonicalizeSemanticJsonString(rebuilt) !== canonicalizeSemanticJsonString(authority)) {
    refuse("APPROVED_CANDIDATE_REPLAY");
  }
  const existing = await loadDurableAuthority(sql, authority.organizationId, authority.runId);
  if (existing) {
    if (!rowMatches(existing, authority)) refuse("CONFLICT");
    return Object.freeze({ id: existing.id, insertedNew: false, authority });
  }
  const id = randomUUID();
  await sql`
    INSERT INTO trader_historical_four_surface_ratified_admission_v2 (
      id, organization_id, run_id, release_sha, aggregate_admission_receipt_id,
      aggregate_admission_content_digest_hex, development_dataset_identity_digest_hex,
      operator_user_id, surface_admissions_json, knowledge_snapshots_json,
      knowledge_snapshot_digest_hex, market_evidence_json, market_evidence_digest_hex,
      authority_json, authority_content_digest_hex, schema_version, created_at
    ) VALUES (
      ${id}::uuid, ${authority.organizationId}::uuid, ${authority.runId},
      ${authority.releaseSha}, ${authority.aggregateAdmissionReceiptId}::uuid,
      ${authority.aggregateAdmissionContentDigestHex},
      ${authority.developmentDatasetIdentityDigestHex}, ${authority.operatorUserId}::uuid,
      ${JSON.stringify(authority.surfaceAdmissions)}::text::jsonb,
      ${JSON.stringify(authority.knowledgeSnapshots)}::text::jsonb,
      ${authority.knowledgeSnapshotDigestHex},
      ${JSON.stringify(authority.marketEvidence)}::text::jsonb,
      ${authority.marketEvidenceDigestHex},
      ${JSON.stringify(authority)}::text::jsonb, ${authority.contentDigestHex},
      ${HISTORICAL_FOUR_SURFACE_RATIFIED_ADMISSION_V2},
      ${authority.epistemicRecordCutoff}::timestamptz
    ) ON CONFLICT DO NOTHING
  `;
  const durable = await loadDurableAuthority(sql, authority.organizationId, authority.runId);
  if (!durable || !rowMatches(durable, authority)) refuse("CONFLICT");
  return Object.freeze({ id: durable.id, insertedNew: durable.id === id, authority });
}

/** Replays all four durable source receipts; a copied/tampered authority fails closed. */
export async function requireHistoricalFourSurfaceRatifiedAdmissionV2(
  sql: postgres.Sql,
  expected: Readonly<{
    organizationId: string;
    runId: string;
    releaseSha: string;
    aggregateAdmissionReceiptId: string;
    authorityContentDigestHex: string;
  }>,
): Promise<HistoricalFourSurfaceRatifiedAdmissionV2> {
  const row = await loadDurableAuthority(sql, expected.organizationId, expected.runId);
  if (!row) refuse("MISSING");
  const authority = row.authority_json as HistoricalFourSurfaceRatifiedAdmissionV2;
  const { contentDigestHex: authorityDigest, ...authorityBody } = authority;
  if (
    !Array.isArray(authority.surfaceAdmissions) ||
    authority.surfaceAdmissions.length !== 4 ||
    !Array.isArray(authority.knowledgeSnapshots) ||
    authority.knowledgeSnapshots.length !== 4 ||
    !Array.isArray(authority.marketEvidence) ||
    authority.marketEvidence.length !== 2 ||
    !DIGEST.test(authority.knowledgeSnapshotDigestHex) ||
    !DIGEST.test(authority.marketEvidenceDigestHex) ||
    authority.epistemicRecordCutoff !== parsePostgresTimestamptz(row.created_at).toISOString() ||
    (authority.operatorMemberRole !== "owner" && authority.operatorMemberRole !== "manager") ||
    authority.organizationId !== expected.organizationId ||
    authority.runId !== expected.runId ||
    authority.releaseSha !== expected.releaseSha ||
    authority.aggregateAdmissionReceiptId !== expected.aggregateAdmissionReceiptId ||
    authorityDigest !== expected.authorityContentDigestHex ||
    computeSemanticSha256Hex(authorityBody) !== authorityDigest
  )
    refuse("EXPECTED_BINDING");
  const input: HistoricalFourSurfaceRatificationInputV2 = {
    organizationId: authority.organizationId,
    runId: authority.runId,
    releaseSha: authority.releaseSha,
    aggregateAdmissionReceiptId: authority.aggregateAdmissionReceiptId,
    operatorUserId: authority.operatorUserId,
    scientificAdmissionReceiptIds: Object.fromEntries(
      authority.surfaceAdmissions.map((surface) => [
        surface.surfaceKey,
        surface.scientificAdmissionReceiptId,
      ]),
    ) as Record<HistoricalFourSurfaceKeyV2, string>,
    knowledgeSnapshots: authority.knowledgeSnapshots,
    marketEvidence: authority.marketEvidence,
    executionExtent: authority.executionExtent,
  };
  validateInput(input);
  const aggregate = await validateAggregateRow(
    sql,
    await loadScientificRow(sql, input.organizationId, input.aggregateAdmissionReceiptId),
    input,
  );
  const marketEvidence = await replayCanonicalMarketEvidenceV2(
    sql,
    authority,
    aggregate.sourceQualificationReceiptDigestHex,
  );
  const surfaces = await Promise.all(
    SURFACE_KEYS.map(async (surfaceKey) =>
      validateSurface(
        await loadScientificRow(
          sql,
          input.organizationId,
          input.scientificAdmissionReceiptIds[surfaceKey],
        ),
        aggregate,
        surfaceKey,
        {
          aggregateAdmissionReceiptId: input.aggregateAdmissionReceiptId,
          operatorUserId: authority.operatorUserId,
        },
      ),
    ),
  );
  const rebuilt = buildAuthority({
    aggregate,
    aggregateAdmissionReceiptId: input.aggregateAdmissionReceiptId,
    operatorUserId: authority.operatorUserId,
    operatorMemberRole: authority.operatorMemberRole,
    surfaces,
    epistemicRecordCutoff: authority.epistemicRecordCutoff,
    knowledgeSnapshots: authority.knowledgeSnapshots,
    marketEvidence,
    executionExtent: authority.executionExtent,
  });
  if (!rowMatches(row, rebuilt)) refuse("DURABLE_CONTENT");
  return rebuilt;
}
