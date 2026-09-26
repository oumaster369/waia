import "server-only";

import { isDeepStrictEqual } from "node:util";
import type postgres from "postgres";

import { parsePostgresTimestamptz } from "@/db/postgres-session-transaction";
import { orgScopedPostgresPredicate, requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  scoreForecastV2MulticlassObservation,
  type ForecastV2CalibrationObservation,
  type ForecastV2ObjectiveEvidence,
} from "@/lib/trader/intelligence/calibration/calibration-scorer";
import {
  hydrateForecastAuthorizedOutcomeWireV1,
} from "@/lib/trader/intelligence/forecast-v2/forecast-package-wire-v1";
import { requireForecastRuntimeAuthorizedOutcomeV2 } from
  "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import { schemaVersionTextToInt2 } from "@/lib/trader/intelligence/forecast-v2/schema-version-storage-v1";
import { HISTORICAL_FORECAST_FAMILY_BOOTSTRAP_V2 } from
  "@/lib/trader/historical-simulation-v2/forecast-family-bootstrap-v2";
import {
  computeForecastV2EvidenceOnlyKnowledgeUpdate,
  KNOWLEDGE_CONFIDENCE_UPDATE_SCHEMA_VERSION,
  type KnowledgeConfidenceUpdateRecord,
} from "@/lib/trader/knowledge/knowledge-confidence-update";

export const FORECAST_V2_FEEDBACK_READ_VERSION = "waia.trader.forecast_feedback_read.v1";
export type ForecastV2FeedbackReference = Readonly<{
  bundleId: string;
  forecastId: string;
  packageId: string;
  knowledgeUpdateIdempotencyKey: string;
  symbol: string;
  futureRunId: string;
  futureCycleId: string;
  futureCyclePitAnchor: string;
}>;
export type ForecastV2FeedbackRefusalReason =
  | "INVALID_REFERENCE"
  | "MISSING_SOURCE"
  | "LEGACY_PAYLOAD_UNAVAILABLE"
  | "UNSUPPORTED_OUTCOME_DIGEST_LAYOUT"
  | "CORRUPT_SOURCE"
  | "IDENTITY_MISMATCH"
  | "NOT_YET_VISIBLE"
  | "NAMESPACE_MISMATCH";
type Source = "reference" | "bundle" | "forecast" | "package" | "outcome" |
  "calibration" | "knowledge";
export type ForecastV2FeedbackReadResult = Readonly<{
  schemaVersion: typeof FORECAST_V2_FEEDBACK_READ_VERSION;
  capitalAuthority: "NONE";
}> & (Readonly<{
  status: "unavailable";
  reason: ForecastV2FeedbackRefusalReason;
  source: Source;
}> | Readonly<{
  status: "ok";
  authorityClass: "EVIDENCE_ONLY";
  sourceReferences: ForecastV2FeedbackReference & Readonly<{
    organizationId: string;
    knowledgeUpdateId: string;
    knowledgeUpdateContentDigestHex: string;
    objectiveOutcomeContentDigestHex: string;
    observedOutcomeDigestHex: string;
    forecastRuntimeAuthorityContentDigestHex: string;
  }>;
  objectiveEvidence: ForecastV2ObjectiveEvidence;
  calibrationObservation: ForecastV2CalibrationObservation;
  knowledgeUpdate: KnowledgeConfidenceUpdateRecord;
}>);

class Refused extends Error {
  constructor(readonly reason: ForecastV2FeedbackRefusalReason, readonly source: Source) {
    super(`FORECAST_FEEDBACK_READ_REFUSED:${reason}:${source}`);
  }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Row = Record<string, unknown>;
function insist(condition: unknown, reason: ForecastV2FeedbackRefusalReason, source: Source): asserts condition {
  if (!condition) throw new Refused(reason, source);
}
function one(rows: Row[], source: Source): Row {
  insist(rows.length === 1, rows.length === 0 ? "MISSING_SOURCE" : "CORRUPT_SOURCE", source);
  return rows[0]!;
}
function hex(value: unknown): string {
  if (!Buffer.isBuffer(value) || value.length !== 32) throw new Error("Invalid stored digest");
  return value.toString("hex");
}
function iso(value: unknown): string {
  return parsePostgresTimestamptz(value).toISOString();
}
function canonicalIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value;
}
function projection(row: Row, expected: Row, source: Source): void {
  for (const [key, value] of Object.entries(expected)) {
    insist(isDeepStrictEqual(row[key], value), "CORRUPT_SOURCE", source);
  }
}

/**
 * Exact persisted data replay, not qualification or a Navigator/Knowledge transition.
 * Owns a new read-only snapshot; accepts a pool, never an already-owned transaction.
 * Infrastructure failures propagate. Refusals contain no stored payload or error text.
 */
export async function readForecastV2FeedbackPostgres(
  pool: postgres.Sql,
  context: OrgContext,
  input: ForecastV2FeedbackReference,
): Promise<ForecastV2FeedbackReadResult> {
  const reference = { ...input };
  const base = { schemaVersion: FORECAST_V2_FEEDBACK_READ_VERSION, capitalAuthority: "NONE" } as const;
  const organizationId = requireOrgContext(context.organizationId).organizationId;
  let source: Source = "reference";
  try {
    insist(
      [organizationId, reference.bundleId, reference.forecastId, reference.packageId]
        .every((value) => typeof value === "string" && uuid.test(value)) &&
      [reference.knowledgeUpdateIdempotencyKey, reference.symbol, reference.futureRunId, reference.futureCycleId]
        .every((value) => typeof value === "string" && value.length > 0 && value.length <= 1024) &&
      canonicalIso(reference.futureCyclePitAnchor),
      "INVALID_REFERENCE", source,
    );
    // A reserved/transaction handle must not escape to a second pool or silently
    // weaken an outer transaction. This API deliberately owns its transaction.
    if (typeof pool.begin !== "function") throw new Error("FORECAST_FEEDBACK_POOL_REQUIRED");
    return await pool.begin("isolation level repeatable read read only", async (tx) => {
      const sql = tx as unknown as postgres.Sql;
      source = "bundle";
      const bundle = one(await sql<Row[]>`
        SELECT *, anchor_closed_bar_epoch_ms::text AS anchor_text
        FROM trader_forecast_bundle_v2
        WHERE ${orgScopedPostgresPredicate(sql, organizationId)} AND id = ${reference.bundleId}::uuid
      `, source);
      insist(bundle.predictive_package_id === reference.packageId && bundle.symbol === reference.symbol,
        "IDENTITY_MISMATCH", source);
      insist(bundle.forecast_runtime_authorized_outcome_json != null, "LEGACY_PAYLOAD_UNAVAILABLE", source);
      projection(bundle, { schema_version: schemaVersionTextToInt2("forecast-bundle/v2") }, source);

      source = "forecast";
      const forecast = one(await sql<Row[]>`
        SELECT * FROM trader_forecast_v2
        WHERE ${orgScopedPostgresPredicate(sql, organizationId)} AND id = ${reference.forecastId}::uuid
      `, source);
      insist(forecast.bundle_id === reference.bundleId && forecast.target_role_id === "TERMINAL_RETURN",
        "IDENTITY_MISMATCH", source);

      source = "package";
      const pkg = one(await sql<Row[]>`
        SELECT * FROM trader_forecast_predictive_package_v2
        WHERE ${orgScopedPostgresPredicate(sql, organizationId)} AND id = ${reference.packageId}::uuid
      `, source);
      insist(pkg.package_subject_version !== HISTORICAL_FORECAST_FAMILY_BOOTSTRAP_V2,
        "NAMESPACE_MISMATCH", source);
      const authorized = requireForecastRuntimeAuthorizedOutcomeV2(
        await hydrateForecastAuthorizedOutcomeWireV1(sql,
          bundle.forecast_runtime_authorized_outcome_json as never,
          { organizationId, packageId: reference.packageId }),
      );
      const { authority, issuance } = authorized;
      insist(!authority.historicalIntelligenceCycleAuthorityContentDigestHex &&
        !authority.historicalKnowledgeSnapshotAuthorityContentDigestHex &&
        issuance.package.family.packageSubjectVersion !== HISTORICAL_FORECAST_FAMILY_BOOTSTRAP_V2,
      "NAMESPACE_MISMATCH", source);
      insist(authority.organizationId === organizationId && issuance.package.family.symbol === reference.symbol &&
        bundle.anchor_text === String(authority.anchorClosedBarEpochMs), "IDENTITY_MISMATCH", "bundle");
      projection(pkg, {
        symbol: reference.symbol,
        package_subject_version: issuance.package.family.packageSubjectVersion,
        predictive_package_content_digest: authority.selectedPredictivePackageContentDigestHex,
        schema_version: "predictive-package/v2",
      }, source);
      insist(hex(bundle.bundle_content_digest) === authority.terminalForecastContentDigestHex,
        "CORRUPT_SOURCE", "bundle");
      insist(hex(forecast.forecast_content_digest) === authority.terminalForecastContentDigestHex &&
        hex(forecast.forecast_generation_identity_digest) === authority.forecastGenerationIdentityDigestHex &&
        hex(forecast.distribution_semantic_digest) === authority.terminalDistributionSemanticDigestHex,
      "CORRUPT_SOURCE", "forecast");
      projection(forecast, {
        schema_version: schemaVersionTextToInt2("forecast/v2"),
        k_config_dec: issuance.package.kConfigDec,
        m_config_dec: issuance.package.mConfigDec,
        s_dec: issuance.package.kConfigDec * issuance.package.mConfigDec,
      }, "forecast");

      source = "outcome";
      const outcome = one(await sql<Row[]>`
        SELECT *, resolved_at::text AS resolved_text FROM trader_forecast_outcome_v2
        WHERE ${orgScopedPostgresPredicate(sql, organizationId)} AND forecast_id = ${reference.forecastId}::uuid
      `, source);
      insist(outcome.bundle_id === reference.bundleId && outcome.target_role_id === "TERMINAL_RETURN",
        "IDENTITY_MISMATCH", source);
      insist(outcome.objective_evidence_json != null, "LEGACY_PAYLOAD_UNAVAILABLE", source);
      const objectiveEvidence = outcome.objective_evidence_json as ForecastV2ObjectiveEvidence;
      // The canonical durable producer hashes this body. Lower-level legacy writers
      // accepted other digest layouts; they are unavailable, never rewritten here.
      insist(hex(outcome.content_digest) === computeSemanticSha256Hex(objectiveEvidence),
        "UNSUPPORTED_OUTCOME_DIGEST_LAYOUT", source);
      const observation = scoreForecastV2MulticlassObservation({ authorizedOutcome: authorized, objectiveEvidence });
      projection(outcome, {
        outcome_class: "RESOLVED",
        schema_version: schemaVersionTextToInt2("forecast-outcome/v2"),
        observed_terminal_return: objectiveEvidence.observedTerminalReturn,
        observed_bucket_ordinal: observation.observedBucketOrdinal,
        predictive_package_content_digest: observation.predictivePackageContentDigestHex,
        terminal_target_definition_digest: observation.terminalTargetDefinitionDigestHex,
        knowledge_edge_id: observation.knowledgeEdgeId,
      }, source);
      insist(iso(outcome.resolved_text) === observation.resolvedAt &&
        hex(outcome.observed_outcome_digest) === observation.observedOutcomeDigestHex &&
        hex(outcome.pit_measurement_identity_digest) === observation.pitMeasurementIdentityDigestHex &&
        hex(outcome.forecast_runtime_authority_content_digest) === observation.forecastRuntimeAuthorityContentDigestHex &&
        hex(outcome.terminal_distribution_semantic_digest) === observation.terminalDistributionSemanticDigestHex &&
        hex(outcome.knowledge_content_digest) === observation.knowledgeContentDigestHex,
      "CORRUPT_SOURCE", source);

      source = "calibration";
      const calibration = one(await sql<Row[]>`
        SELECT * FROM trader_forecast_calibration_observation_v2
        WHERE ${orgScopedPostgresPredicate(sql, organizationId)} AND forecast_id = ${reference.forecastId}::uuid
      `, source);
      insist(calibration.bundle_id === reference.bundleId && calibration.target_role_id === "TERMINAL_RETURN",
        "IDENTITY_MISMATCH", source);
      insist(calibration.calibration_payload_json != null, "LEGACY_PAYLOAD_UNAVAILABLE", source);
      projection(calibration, {
        schema_version: schemaVersionTextToInt2("forecast-calibration/v2"),
        scoring_eligible: true,
        scoring_version: observation.schemaVersion,
        observed_bucket_ordinal: observation.observedBucketOrdinal,
        probability_vector_json: observation.probabilities,
        normalized_brier_score: Number(observation.normalizedBrierScore),
        log_loss_score: Number(observation.logLossScore),
        calibration_payload_json: observation,
      }, source);
      insist(hex(calibration.content_digest) === observation.contentDigest, "CORRUPT_SOURCE", source);

      source = "knowledge";
      const knowledge = one(await sql<Row[]>`
        SELECT *, issued_at::text AS issued_text, eligible_resolution_at::text AS eligible_text,
          resolved_at::text AS resolved_text, pit_evidence_boundary::text AS boundary_text
        FROM trader_knowledge_confidence_update_record
        WHERE ${orgScopedPostgresPredicate(sql, organizationId)}
          AND idempotency_key = ${reference.knowledgeUpdateIdempotencyKey}
      `, source);
      insist(knowledge.run_id === reference.futureRunId && knowledge.cycle_id === reference.futureCycleId &&
        knowledge.symbol === reference.symbol && knowledge.knowledge_edge_id === observation.knowledgeEdgeId,
      "IDENTITY_MISMATCH", source);
      const sources = JSON.parse(knowledge.source_record_ids_json as string) as Record<string, unknown>;
      const visibleAt = sources.visible_from_cycle_pit_anchor;
      insist(canonicalIso(visibleAt), "CORRUPT_SOURCE", source);
      insist(Date.parse(reference.futureCyclePitAnchor) >= Date.parse(visibleAt), "NOT_YET_VISIBLE", source);
      insist(reference.futureCyclePitAnchor === visibleAt, "IDENTITY_MISMATCH", source);
      const prefix = `${KNOWLEDGE_CONFIDENCE_UPDATE_SCHEMA_VERSION}|${organizationId}|${observation.knowledgeEdgeId}|FORECAST_V2_EVIDENCE_ONLY|`;
      const key = reference.knowledgeUpdateIdempotencyKey;
      const sequenceText = key.slice(prefix.length);
      insist(key.startsWith(prefix) && /^(0|[1-9]\d*)$/.test(sequenceText) &&
        Number.isSafeInteger(Number(sequenceText)), "CORRUPT_SOURCE", source);
      const update = computeForecastV2EvidenceOnlyKnowledgeUpdate({
        organizationId,
        futureRunId: reference.futureRunId,
        futureCycleId: reference.futureCycleId,
        futureCyclePitAnchor: visibleAt,
        priorMachineRecommendedConfidence: knowledge.prior_confidence as string,
        calibrationObservation: observation,
        provenance: JSON.parse(knowledge.provenance_json as string),
        sequence: Number(sequenceText),
      });
      projection(knowledge, {
        id: update.id, idempotency_key: update.idempotencyKey, content_digest: update.contentDigest,
        update_kind: update.updateKind, update_model_version: update.updateModelVersion,
        prior_confidence: update.priorMachineRecommendedConfidence,
        posterior_confidence: update.machineRecommendedConfidence, delta: update.machineRecommendedDelta,
        outcome_class: update.outcomeClass, score: update.score,
        source_record_ids_json: update.sourceRecordIdsJson,
        terminal_reason: update.terminalReason, schema_version: update.schemaVersion,
      }, source);
      insist(iso(knowledge.issued_text) === update.issuedAt &&
        iso(knowledge.eligible_text) === update.eligibleResolutionAt &&
        iso(knowledge.resolved_text) === update.resolvedAt &&
        iso(knowledge.boundary_text) === update.pitEvidenceBoundary, "CORRUPT_SOURCE", source);
      return {
        ...base, status: "ok", authorityClass: "EVIDENCE_ONLY",
        sourceReferences: {
          ...reference, organizationId, knowledgeUpdateId: update.id,
          knowledgeUpdateContentDigestHex: update.contentDigest,
          objectiveOutcomeContentDigestHex: hex(outcome.content_digest),
          observedOutcomeDigestHex: observation.observedOutcomeDigestHex,
          forecastRuntimeAuthorityContentDigestHex: authority.contentDigestHex,
        },
        objectiveEvidence, calibrationObservation: observation, knowledgeUpdate: update,
      } as const;
    }) as ForecastV2FeedbackReadResult;
  } catch (error) {
    if (error instanceof Refused) return { ...base, status: "unavailable", reason: error.reason, source: error.source };
    // SQL/connection failures and misuse of the transaction-owning API are not
    // corrupt saved data. Preserve these operational errors for the caller.
    if (!(error instanceof Error) || "code" in error ||
      error.message === "FORECAST_FEEDBACK_POOL_REQUIRED") throw error;
    return { ...base, status: "unavailable", reason: "CORRUPT_SOURCE", source };
  }
}
