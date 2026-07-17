import { createHash } from "node:crypto";

import {
  EPISTEMIC_CONFIDENCE_BOUNDS,
  EPISTEMIC_CONFIDENCE_DECAY_HALF_LIFE_BARS,
  EPISTEMIC_CONFIDENCE_UPDATE_CAP,
  EPISTEMIC_SAME_RUN_DECISION_AUTHORITY_PROHIBITED,
} from "@/lib/trader/intelligence/epistemic/epistemic-scoring-contract";
import { computePatternAgingDecay } from "@/lib/trader/mi/pattern-catalog-aging";
import {
  addDecimal,
  compareDecimal,
  multiplyDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";
import { formatEpistemicScore } from "@/lib/trader/intelligence/calibration/brier-score";
import type { CalibrationSnapshotRecord } from "@/lib/trader/intelligence/calibration/calibration.types";
import type { ForecastOutcomeRecord } from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";
import type { OutcomeProvenance } from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

export const KNOWLEDGE_CONFIDENCE_UPDATE_SCHEMA_VERSION =
  "waia.trader.knowledge_confidence_update_record.v1" as const;

export const KNOWLEDGE_CONFIDENCE_UPDATE_MODEL_VERSION =
  "waia.trader.knowledge_confidence_update_model.v1" as const;

export const knowledgeConfidenceUpdateKindEnum = ["UPDATE", "DECAY"] as const;
export type KnowledgeConfidenceUpdateKind = (typeof knowledgeConfidenceUpdateKindEnum)[number];

export type KnowledgeConfidenceUpdateRecord = Readonly<{
  id: string;
  organizationId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  knowledgeEdgeId: string;
  updateKind: KnowledgeConfidenceUpdateKind;
  updateModelVersion: string;
  priorConfidence: string;
  posteriorConfidence: string;
  delta: string;
  issuedAt: string;
  eligibleResolutionAt: string;
  resolvedAt: string;
  pitEvidenceBoundary: string;
  outcomeClass: string;
  score: string | null;
  sourceRecordIdsJson: string;
  contentDigest: string;
  idempotencyKey: string;
  provenance: OutcomeProvenance;
  terminalReason: string;
  schemaVersion: typeof KNOWLEDGE_CONFIDENCE_UPDATE_SCHEMA_VERSION;
}>;

function clampConfidence(value: string): string {
  if (compareDecimal(value, EPISTEMIC_CONFIDENCE_BOUNDS.min) < 0) {
    return EPISTEMIC_CONFIDENCE_BOUNDS.min;
  }
  if (compareDecimal(value, EPISTEMIC_CONFIDENCE_BOUNDS.max) > 0) {
    return EPISTEMIC_CONFIDENCE_BOUNDS.max;
  }
  return formatEpistemicScore(value);
}

function deriveDeterministicUuidV4(seed: string): string {
  const hash = createHash("sha256").update(seed, "utf8").digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function computeKnowledgeConfidenceUpdate(input: {
  organizationId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  knowledgeEdgeId: string;
  priorConfidence: string;
  forecastOutcome: ForecastOutcomeRecord;
  calibrationSnapshot: CalibrationSnapshotRecord | null;
  asOf: string;
  provenance: OutcomeProvenance;
  sequence: number;
}): KnowledgeConfidenceUpdateRecord {
  if (
    EPISTEMIC_SAME_RUN_DECISION_AUTHORITY_PROHIBITED &&
    input.forecastOutcome.cycleId === input.cycleId &&
    input.forecastOutcome.runId === input.runId
  ) {
    throw new Error("same-run decision authority prohibited for confidence update");
  }

  let delta = "0.0000";
  if (input.forecastOutcome.outcomeVerdict === "CORRECT") {
    delta = EPISTEMIC_CONFIDENCE_UPDATE_CAP;
  } else if (input.forecastOutcome.outcomeVerdict === "INCORRECT") {
    delta = formatEpistemicScore(multiplyDecimal(EPISTEMIC_CONFIDENCE_UPDATE_CAP, "-1"));
  }

  if (
    input.calibrationSnapshot?.calibrationStatus === "INSUFFICIENT_CALIBRATION" &&
    input.forecastOutcome.outcomeVerdict === "CORRECT"
  ) {
    delta = formatEpistemicScore(multiplyDecimal(EPISTEMIC_CONFIDENCE_UPDATE_CAP, "0.5"));
  }

  const rawPosterior = addDecimal(input.priorConfidence, delta);
  const posteriorConfidence = clampConfidence(rawPosterior);

  const id = deriveDeterministicUuidV4(
    `${KNOWLEDGE_CONFIDENCE_UPDATE_SCHEMA_VERSION}|${input.organizationId}|${input.knowledgeEdgeId}|UPDATE|${input.sequence}`,
  );
  const idempotencyKey = [
    KNOWLEDGE_CONFIDENCE_UPDATE_SCHEMA_VERSION,
    input.organizationId,
    input.knowledgeEdgeId,
    "UPDATE",
    String(input.sequence),
  ].join("|");

  const base: Omit<KnowledgeConfidenceUpdateRecord, "contentDigest"> = {
    id,
    organizationId: input.organizationId,
    runId: input.runId,
    cycleId: input.cycleId,
    symbol: input.symbol,
    knowledgeEdgeId: input.knowledgeEdgeId,
    updateKind: "UPDATE",
    updateModelVersion: KNOWLEDGE_CONFIDENCE_UPDATE_MODEL_VERSION,
    priorConfidence: formatEpistemicScore(input.priorConfidence),
    posteriorConfidence,
    delta: formatEpistemicScore(delta),
    issuedAt: input.forecastOutcome.issuedAt,
    eligibleResolutionAt: input.forecastOutcome.eligibleResolutionAt,
    resolvedAt: input.asOf,
    pitEvidenceBoundary: input.asOf,
    outcomeClass: input.forecastOutcome.outcomeClass,
    score: input.forecastOutcome.score,
    sourceRecordIdsJson: JSON.stringify({
      forecast_outcome_id: input.forecastOutcome.id,
      calibration_snapshot_id: input.calibrationSnapshot?.id ?? null,
    }),
    idempotencyKey,
    provenance: input.provenance,
    terminalReason: "CONFIDENCE_UPDATE",
    schemaVersion: KNOWLEDGE_CONFIDENCE_UPDATE_SCHEMA_VERSION,
  };

  const draft = { ...base, contentDigest: "" };
  return {
    ...draft,
    contentDigest: computeKnowledgeConfidenceUpdateContentDigest(draft),
  };
}

export function computeKnowledgeConfidenceDecay(input: {
  organizationId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  knowledgeEdgeId: string;
  priorConfidence: string;
  ageBars: number;
  asOf: string;
  provenance: OutcomeProvenance;
  sequence: number;
}): KnowledgeConfidenceUpdateRecord {
  const decayFactor = computePatternAgingDecay({
    ageBars: input.ageBars,
    halfLifeBars: EPISTEMIC_CONFIDENCE_DECAY_HALF_LIFE_BARS,
  });
  const posteriorConfidence = clampConfidence(
    formatEpistemicScore(multiplyDecimal(input.priorConfidence, decayFactor)),
  );
  const delta = subtractDecimal(posteriorConfidence, formatEpistemicScore(input.priorConfidence));

  const id = deriveDeterministicUuidV4(
    `${KNOWLEDGE_CONFIDENCE_UPDATE_SCHEMA_VERSION}|${input.organizationId}|${input.knowledgeEdgeId}|DECAY|${input.sequence}`,
  );
  const idempotencyKey = [
    KNOWLEDGE_CONFIDENCE_UPDATE_SCHEMA_VERSION,
    input.organizationId,
    input.knowledgeEdgeId,
    "DECAY",
    String(input.sequence),
  ].join("|");

  const base: Omit<KnowledgeConfidenceUpdateRecord, "contentDigest"> = {
    id,
    organizationId: input.organizationId,
    runId: input.runId,
    cycleId: input.cycleId,
    symbol: input.symbol,
    knowledgeEdgeId: input.knowledgeEdgeId,
    updateKind: "DECAY",
    updateModelVersion: KNOWLEDGE_CONFIDENCE_UPDATE_MODEL_VERSION,
    priorConfidence: formatEpistemicScore(input.priorConfidence),
    posteriorConfidence,
    delta: formatEpistemicScore(delta),
    issuedAt: input.asOf,
    eligibleResolutionAt: input.asOf,
    resolvedAt: input.asOf,
    pitEvidenceBoundary: input.asOf,
    outcomeClass: "DECAY",
    score: decayFactor,
    sourceRecordIdsJson: JSON.stringify({ age_bars: input.ageBars }),
    idempotencyKey,
    provenance: input.provenance,
    terminalReason: "CONFIDENCE_DECAY",
    schemaVersion: KNOWLEDGE_CONFIDENCE_UPDATE_SCHEMA_VERSION,
  };

  const draft = { ...base, contentDigest: "" };
  return {
    ...draft,
    contentDigest: computeKnowledgeConfidenceUpdateContentDigest(draft),
  };
}

export function canonicalizeKnowledgeConfidenceUpdateRecord(
  record: KnowledgeConfidenceUpdateRecord,
): Record<string, unknown> {
  return {
    schema_version: record.schemaVersion,
    organization_id: record.organizationId,
    run_id: record.runId,
    cycle_id: record.cycleId,
    symbol: record.symbol,
    knowledge_edge_id: record.knowledgeEdgeId,
    update_kind: record.updateKind,
    update_model_version: record.updateModelVersion,
    prior_confidence: record.priorConfidence,
    posterior_confidence: record.posteriorConfidence,
    delta: record.delta,
    issued_at: record.issuedAt,
    eligible_resolution_at: record.eligibleResolutionAt,
    resolved_at: record.resolvedAt,
    pit_evidence_boundary: record.pitEvidenceBoundary,
    outcome_class: record.outcomeClass,
    score: record.score,
    source_record_ids_json: record.sourceRecordIdsJson,
    terminal_reason: record.terminalReason,
    provenance: record.provenance,
  };
}

export function computeKnowledgeConfidenceUpdateContentDigest(
  record: KnowledgeConfidenceUpdateRecord,
): string {
  return computeSemanticSha256Hex(canonicalizeKnowledgeConfidenceUpdateRecord(record));
}
