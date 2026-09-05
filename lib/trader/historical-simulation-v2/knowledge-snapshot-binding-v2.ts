import type postgres from "postgres";

import { computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  computeKnowledgeConfidenceUpdateContentDigest,
  KNOWLEDGE_CONFIDENCE_UPDATE_MODEL_VERSION,
  KNOWLEDGE_CONFIDENCE_UPDATE_SCHEMA_VERSION,
  type KnowledgeConfidenceUpdateRecord,
} from "@/lib/trader/knowledge/knowledge-confidence-update";
import {
  KNOWLEDGE_CONFIDENCE_VALUE_CLASS,
  WP21_EPISTEMIC_AUTHORITY_DEFAULTS,
} from "@/lib/trader/intelligence/epistemic/epistemic-authority.types";
import { formatEpistemicScore } from
  "@/lib/trader/intelligence/calibration/brier-score";
import { EPISTEMIC_CONFIDENCE_BOUNDS } from
  "@/lib/trader/intelligence/epistemic/epistemic-scoring-contract";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import {
  buildHistoricalKnowledgeSnapshotAuthorityV2,
  type HistoricalKnowledgeSnapshotAuthorityV2,
} from "@/lib/trader/intelligence/forecast-v2/historical-knowledge-snapshot-authority-v2";
import { historicalInstrumentsMatch } from "@/lib/trader/symbols/historical-instrument";

export const HISTORICAL_SIMULATION_KNOWLEDGE_BINDING_V2 =
  "waia.trader.historical_simulation_knowledge_binding.v2" as const;

export type HistoricalSimulationVisibleKnowledgeEvidenceV2 = Readonly<{
  id: string;
  knowledgeEdgeId: string;
  contentDigestHex: string;
  resolvedAt: string;
  pitEvidenceBoundary: string;
  visibleFromPitAnchor: string;
  forecastAuthorityContentDigestHex: unknown;
  outcomeContentDigestHex: unknown;
}>;

export type HistoricalForecastPitKnowledgeRowV2 = Readonly<{
  id: string; organization_id: string; run_id: string; cycle_id: string; symbol: string;
  knowledge_edge_id: string; update_kind: string; update_model_version: string;
  prior_confidence: string; posterior_confidence: string; delta: string;
  issued_at: Date | string; eligible_resolution_at: Date | string; resolved_at: Date | string;
  pit_evidence_boundary: Date | string; outcome_class: string; score: string | null;
  source_record_ids_json: string; content_digest: string; idempotency_key: string;
  provenance_json: string; terminal_reason: string; schema_version: string;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;

function iso(value: Date | string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("HISTORICAL_SIMULATION_KNOWLEDGE_BINDING_REFUSED:TIME");
  }
  return date.toISOString();
}

function mapKnowledgeRow(row: HistoricalForecastPitKnowledgeRowV2): KnowledgeConfidenceUpdateRecord {
  let source: Record<string, unknown>;
  let provenance: KnowledgeConfidenceUpdateRecord["provenance"];
  try {
    source = JSON.parse(row.source_record_ids_json) as Record<string, unknown>;
    provenance = JSON.parse(row.provenance_json) as KnowledgeConfidenceUpdateRecord["provenance"];
  } catch {
    throw new Error("HISTORICAL_SIMULATION_KNOWLEDGE_BINDING_REFUSED:JSON");
  }
  const requiredAuthority = ["confidence_value_class", "authority_class", "operator_disposition",
    "capital_authority", "strategy_authority", "trade_eligibility_authority", "guardian_authority"];
  if (requiredAuthority.some((key) => typeof source[key] !== "string")) {
    throw new Error("HISTORICAL_SIMULATION_KNOWLEDGE_BINDING_REFUSED:AUTHORITY_SOURCE");
  }
  return {
    id: row.id, organizationId: row.organization_id, runId: row.run_id, cycleId: row.cycle_id,
    symbol: row.symbol, knowledgeEdgeId: row.knowledge_edge_id,
    updateKind: row.update_kind as KnowledgeConfidenceUpdateRecord["updateKind"],
    updateModelVersion: row.update_model_version,
    priorMachineRecommendedConfidence: row.prior_confidence,
    machineRecommendedConfidence: row.posterior_confidence, machineRecommendedDelta: row.delta,
    confidenceValueClass: source.confidence_value_class as KnowledgeConfidenceUpdateRecord["confidenceValueClass"],
    authorityClass: source.authority_class as KnowledgeConfidenceUpdateRecord["authorityClass"],
    operatorDisposition: source.operator_disposition as KnowledgeConfidenceUpdateRecord["operatorDisposition"],
    capitalAuthority: source.capital_authority as KnowledgeConfidenceUpdateRecord["capitalAuthority"],
    strategyAuthority: source.strategy_authority as KnowledgeConfidenceUpdateRecord["strategyAuthority"],
    tradeEligibilityAuthority: source.trade_eligibility_authority as KnowledgeConfidenceUpdateRecord["tradeEligibilityAuthority"],
    guardianAuthority: source.guardian_authority as KnowledgeConfidenceUpdateRecord["guardianAuthority"],
    issuedAt: iso(row.issued_at), eligibleResolutionAt: iso(row.eligible_resolution_at),
    resolvedAt: iso(row.resolved_at), pitEvidenceBoundary: iso(row.pit_evidence_boundary),
    outcomeClass: row.outcome_class, score: row.score, sourceRecordIdsJson: row.source_record_ids_json,
    contentDigest: row.content_digest, idempotencyKey: row.idempotency_key, provenance,
    terminalReason: row.terminal_reason,
    schemaVersion: row.schema_version as KnowledgeConfidenceUpdateRecord["schemaVersion"],
  };
}

const FORECAST_EVIDENCE_SOURCE_KEYS = [
  "authority_class",
  "calibration_observation_content_digest",
  "capital_authority",
  "confidence_value_class",
  "feedback_policy",
  "forecast_content_digest_hex",
  "forecast_outcome_content_digest_hex",
  "forecast_runtime_authority_content_digest_hex",
  "guardian_authority",
  "knowledge_content_digest_hex",
  "knowledge_edge_id",
  "operator_disposition",
  "pit_measurement_identity_digest_hex",
  "predictive_package_content_digest_hex",
  "strategy_authority",
  "terminal_target_definition_digest_hex",
  "trade_eligibility_authority",
  "visible_from_cycle_pit_anchor",
] as const;

export type RequiredHistoricalForecastPitKnowledgeRowV2 = Readonly<{
  canonical: KnowledgeConfidenceUpdateRecord;
  visibleFromPitAnchor: string;
  forecastAuthorityContentDigestHex: string;
  outcomeContentDigestHex: string;
}>;

/**
 * Replays the exact evidence-only record emitted by the canonical Forecast V2
 * closure. A merely content-sealed row with a suffix-matching model name is
 * not historical knowledge authority.
 */
export function requireHistoricalForecastPitKnowledgeRowV2(
  row: HistoricalForecastPitKnowledgeRowV2,
): RequiredHistoricalForecastPitKnowledgeRowV2 {
  const canonical = mapKnowledgeRow(row);
  let source: Record<string, unknown>;
  try {
    source = JSON.parse(row.source_record_ids_json) as Record<string, unknown>;
  } catch {
    throw new Error("HISTORICAL_SIMULATION_KNOWLEDGE_BINDING_REFUSED:JSON");
  }
  const exactKeys = Object.keys(source).sort();
  if (JSON.stringify(exactKeys) !== JSON.stringify([...FORECAST_EVIDENCE_SOURCE_KEYS].sort())) {
    throw new Error("HISTORICAL_SIMULATION_KNOWLEDGE_BINDING_REFUSED:EVIDENCE_SHAPE");
  }
  const digestKeys = [
    "calibration_observation_content_digest",
    "forecast_content_digest_hex",
    "forecast_outcome_content_digest_hex",
    "forecast_runtime_authority_content_digest_hex",
    "knowledge_content_digest_hex",
    "pit_measurement_identity_digest_hex",
    "predictive_package_content_digest_hex",
    "terminal_target_definition_digest_hex",
  ] as const;
  if (digestKeys.some((key) => typeof source[key] !== "string" ||
      !DIGEST.test(source[key] as string)) ||
      source.knowledge_edge_id !== row.knowledge_edge_id ||
      !UUID.test(String(source.knowledge_edge_id))) {
    throw new Error("HISTORICAL_SIMULATION_KNOWLEDGE_BINDING_REFUSED:EVIDENCE_IDENTITY");
  }
  const defaults = WP21_EPISTEMIC_AUTHORITY_DEFAULTS.knowledgeUpdate;
  const score = typeof row.score === "string" ? Number(row.score) : Number.NaN;
  const canonicalScore = Object.is(score, -0) ? "0" : score.toString();
  const visible = source.visible_from_cycle_pit_anchor;
  let canonicalBoundedPrior = false;
  try {
    canonicalBoundedPrior =
      row.prior_confidence === formatEpistemicScore(row.prior_confidence) &&
      compareDecimal(row.prior_confidence, EPISTEMIC_CONFIDENCE_BOUNDS.min) >= 0 &&
      compareDecimal(row.prior_confidence, EPISTEMIC_CONFIDENCE_BOUNDS.max) <= 0;
  } catch {
    canonicalBoundedPrior = false;
  }
  if (
    row.update_kind !== "UPDATE" ||
    row.update_model_version !== `${KNOWLEDGE_CONFIDENCE_UPDATE_MODEL_VERSION}.forecast-v2-evidence-only` ||
    row.schema_version !== KNOWLEDGE_CONFIDENCE_UPDATE_SCHEMA_VERSION ||
    row.terminal_reason !== "FORECAST_V2_EVIDENCE_ONLY_ZERO_DELTA" ||
    row.outcome_class !== "FORECAST_V2_EVIDENCE_ONLY" ||
    !canonicalBoundedPrior ||
    row.posterior_confidence !== row.prior_confidence ||
    row.delta !== "0.0000" ||
    !Number.isFinite(score) || score < 0 || score > 1 || row.score !== canonicalScore ||
    typeof visible !== "string" || iso(visible) !== visible ||
    source.feedback_policy !== "EVIDENCE_ONLY_ZERO_DELTA" ||
    source.confidence_value_class !== KNOWLEDGE_CONFIDENCE_VALUE_CLASS.machineRecommendedBoundedDelta ||
    source.authority_class !== defaults.authorityClass ||
    source.operator_disposition !== defaults.operatorDisposition ||
    source.capital_authority !== defaults.capitalAuthority ||
    source.strategy_authority !== defaults.strategyAuthority ||
    source.trade_eligibility_authority !== defaults.tradeEligibilityAuthority ||
    source.guardian_authority !== defaults.guardianAuthority
  ) {
    throw new Error("HISTORICAL_SIMULATION_KNOWLEDGE_BINDING_REFUSED:EVIDENCE_SEMANTICS");
  }
  return Object.freeze({
    canonical,
    visibleFromPitAnchor: visible,
    forecastAuthorityContentDigestHex:
      source.forecast_runtime_authority_content_digest_hex as string,
    outcomeContentDigestHex: source.forecast_outcome_content_digest_hex as string,
  });
}

/** Canonical historical knowledge snapshot identity shared by Forecast, PIT and replay. */
export function computeHistoricalSimulationKnowledgeBindingDigestV2(input: Readonly<{
  organizationId: string;
  symbol: string;
  visibleEvidence: readonly HistoricalSimulationVisibleKnowledgeEvidenceV2[];
}>): string {
  if (!input.organizationId.trim() || !input.symbol.trim()) {
    throw new Error("HISTORICAL_SIMULATION_KNOWLEDGE_BINDING_REFUSED:SCOPE");
  }
  return computeSemanticSha256Hex({
    schemaVersion: HISTORICAL_SIMULATION_KNOWLEDGE_BINDING_V2,
    organizationId: input.organizationId,
    symbol: input.symbol,
    visibleEvidence: input.visibleEvidence,
  });
}

export function computeHistoricalSimulationEmptyKnowledgeBindingDigestV2(
  organizationId: string,
  symbol: string,
): string {
  return computeHistoricalSimulationKnowledgeBindingDigestV2({
    organizationId,
    symbol,
    visibleEvidence: [],
  });
}

export function computeHistoricalForecastPitKnowledgeDigestV2(
  organizationId: string,
  runId: string,
  symbol: string,
  pitAnchor: string,
  rows: readonly HistoricalForecastPitKnowledgeRowV2[],
): string {
  return computeHistoricalSimulationKnowledgeBindingDigestV2({
    organizationId,
    symbol,
    visibleEvidence: rows.map((row) => {
      const required = requireHistoricalForecastPitKnowledgeRowV2(row);
      const canonical = required.canonical;
      if (row.organization_id !== organizationId || row.run_id !== runId ||
          !historicalInstrumentsMatch(row.symbol, symbol) ||
          !UUID.test(row.id) || !UUID.test(row.knowledge_edge_id) || !DIGEST.test(row.content_digest) ||
          computeKnowledgeConfidenceUpdateContentDigest(canonical) !== row.content_digest ||
          required.visibleFromPitAnchor > pitAnchor || canonical.resolvedAt > pitAnchor ||
          canonical.pitEvidenceBoundary > pitAnchor ||
          canonical.resolvedAt > required.visibleFromPitAnchor) {
        throw new Error("HISTORICAL_SIMULATION_KNOWLEDGE_BINDING_REFUSED:SOURCE");
      }
      return {
        id: row.id, knowledgeEdgeId: row.knowledge_edge_id, contentDigestHex: row.content_digest,
        resolvedAt: iso(row.resolved_at), pitEvidenceBoundary: iso(row.pit_evidence_boundary),
        visibleFromPitAnchor: required.visibleFromPitAnchor,
        forecastAuthorityContentDigestHex: required.forecastAuthorityContentDigestHex,
        outcomeContentDigestHex: required.outcomeContentDigestHex,
      };
    }).sort((a, b) => a.contentDigestHex.localeCompare(b.contentDigestHex)),
  });
}

export async function loadHistoricalKnowledgeSnapshotAuthorityV2(
  sql: postgres.Sql,
  input: Readonly<{ organizationId: string; runId: string; symbol: string; pitAnchor: string }>,
): Promise<HistoricalKnowledgeSnapshotAuthorityV2> {
  const rows = await sql<HistoricalForecastPitKnowledgeRowV2[]>`
    SELECT id::text, organization_id::text, run_id, cycle_id, symbol, knowledge_edge_id::text,
           update_kind, update_model_version, prior_confidence, posterior_confidence, delta,
           issued_at, eligible_resolution_at, resolved_at, pit_evidence_boundary, outcome_class,
           score, source_record_ids_json, content_digest, idempotency_key, provenance_json,
           terminal_reason, schema_version
    FROM trader_knowledge_confidence_update_record
    WHERE organization_id=${input.organizationId}::uuid AND run_id=${input.runId}
      AND replace(symbol, '/', '')=replace(${input.symbol}, '/', '')
      AND update_model_version=${`${KNOWLEDGE_CONFIDENCE_UPDATE_MODEL_VERSION}.forecast-v2-evidence-only`}
      AND (source_record_ids_json::jsonb ->> 'visible_from_cycle_pit_anchor')::timestamptz
            <= ${input.pitAnchor}::timestamptz
      AND resolved_at <= ${input.pitAnchor}::timestamptz
      AND pit_evidence_boundary <= ${input.pitAnchor}::timestamptz
    ORDER BY content_digest ASC
  `;
  return buildHistoricalKnowledgeSnapshotAuthorityFromRowsV2(input, rows);
}

export function buildHistoricalKnowledgeSnapshotAuthorityFromRowsV2(
  input: Readonly<{ organizationId: string; runId: string; symbol: string; pitAnchor: string }>,
  rows: readonly HistoricalForecastPitKnowledgeRowV2[],
): HistoricalKnowledgeSnapshotAuthorityV2 {
  return buildHistoricalKnowledgeSnapshotAuthorityV2({
    ...input,
    visibleEvidenceCount: rows.length,
    knowledgeContentDigestHex: computeHistoricalForecastPitKnowledgeDigestV2(
      input.organizationId, input.runId, input.symbol, input.pitAnchor, rows,
    ),
  });
}
