import { createHash } from "node:crypto";

import {
  KNOWLEDGE_CONFIDENCE_VALUE_CLASS,
  WP21_EPISTEMIC_AUTHORITY_DEFAULTS,
} from "@/lib/trader/intelligence/epistemic/epistemic-authority.types";
import type {
  EpistemicAuthorityClass,
  EpistemicDownstreamAuthority,
  EpistemicOperatorDisposition,
  KnowledgeConfidenceValueClass,
} from "@/lib/trader/intelligence/epistemic/epistemic-authority.types";
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
  /** Machine-recommended prior confidence — not operator attestation. */
  priorMachineRecommendedConfidence: string;
  /** Machine-recommended posterior confidence — not operator attestation. */
  machineRecommendedConfidence: string;
  machineRecommendedDelta: string;
  confidenceValueClass: KnowledgeConfidenceValueClass;
  authorityClass: EpistemicAuthorityClass;
  operatorDisposition: EpistemicOperatorDisposition;
  capitalAuthority: EpistemicDownstreamAuthority;
  strategyAuthority: EpistemicDownstreamAuthority;
  tradeEligibilityAuthority: EpistemicDownstreamAuthority;
  guardianAuthority: EpistemicDownstreamAuthority;
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

function buildAuthorityFields(
  confidenceValueClass: KnowledgeConfidenceValueClass,
): Pick<
  KnowledgeConfidenceUpdateRecord,
  | "confidenceValueClass"
  | "authorityClass"
  | "operatorDisposition"
  | "capitalAuthority"
  | "strategyAuthority"
  | "tradeEligibilityAuthority"
  | "guardianAuthority"
> {
  return {
    confidenceValueClass,
    authorityClass: WP21_EPISTEMIC_AUTHORITY_DEFAULTS.knowledgeUpdate.authorityClass,
    operatorDisposition: WP21_EPISTEMIC_AUTHORITY_DEFAULTS.knowledgeUpdate.operatorDisposition,
    capitalAuthority: WP21_EPISTEMIC_AUTHORITY_DEFAULTS.knowledgeUpdate.capitalAuthority,
    strategyAuthority: WP21_EPISTEMIC_AUTHORITY_DEFAULTS.knowledgeUpdate.strategyAuthority,
    tradeEligibilityAuthority:
      WP21_EPISTEMIC_AUTHORITY_DEFAULTS.knowledgeUpdate.tradeEligibilityAuthority,
    guardianAuthority: WP21_EPISTEMIC_AUTHORITY_DEFAULTS.knowledgeUpdate.guardianAuthority,
  };
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
    priorMachineRecommendedConfidence: formatEpistemicScore(input.priorConfidence),
    machineRecommendedConfidence: posteriorConfidence,
    machineRecommendedDelta: formatEpistemicScore(delta),
    ...buildAuthorityFields(KNOWLEDGE_CONFIDENCE_VALUE_CLASS.machineRecommendedBoundedDelta),
    issuedAt: input.forecastOutcome.issuedAt,
    eligibleResolutionAt: input.forecastOutcome.eligibleResolutionAt,
    resolvedAt: input.asOf,
    pitEvidenceBoundary: input.asOf,
    outcomeClass: input.forecastOutcome.outcomeClass,
    score: input.forecastOutcome.score,
    sourceRecordIdsJson: JSON.stringify({
      forecast_outcome_id: input.forecastOutcome.id,
      calibration_snapshot_id: input.calibrationSnapshot?.id ?? null,
      confidence_value_class: KNOWLEDGE_CONFIDENCE_VALUE_CLASS.machineRecommendedBoundedDelta,
      authority_class: WP21_EPISTEMIC_AUTHORITY_DEFAULTS.knowledgeUpdate.authorityClass,
      operator_disposition: WP21_EPISTEMIC_AUTHORITY_DEFAULTS.knowledgeUpdate.operatorDisposition,
      capital_authority: WP21_EPISTEMIC_AUTHORITY_DEFAULTS.knowledgeUpdate.capitalAuthority,
      strategy_authority: WP21_EPISTEMIC_AUTHORITY_DEFAULTS.knowledgeUpdate.strategyAuthority,
      trade_eligibility_authority:
        WP21_EPISTEMIC_AUTHORITY_DEFAULTS.knowledgeUpdate.tradeEligibilityAuthority,
      guardian_authority: WP21_EPISTEMIC_AUTHORITY_DEFAULTS.knowledgeUpdate.guardianAuthority,
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
    priorMachineRecommendedConfidence: formatEpistemicScore(input.priorConfidence),
    machineRecommendedConfidence: posteriorConfidence,
    machineRecommendedDelta: formatEpistemicScore(delta),
    ...buildAuthorityFields(KNOWLEDGE_CONFIDENCE_VALUE_CLASS.derivedStalenessEvidence),
    issuedAt: input.asOf,
    eligibleResolutionAt: input.asOf,
    resolvedAt: input.asOf,
    pitEvidenceBoundary: input.asOf,
    outcomeClass: "DECAY",
    score: decayFactor,
    sourceRecordIdsJson: JSON.stringify({
      age_bars: input.ageBars,
      confidence_value_class: KNOWLEDGE_CONFIDENCE_VALUE_CLASS.derivedStalenessEvidence,
      authority_class: WP21_EPISTEMIC_AUTHORITY_DEFAULTS.knowledgeUpdate.authorityClass,
      operator_disposition: WP21_EPISTEMIC_AUTHORITY_DEFAULTS.knowledgeUpdate.operatorDisposition,
      capital_authority: WP21_EPISTEMIC_AUTHORITY_DEFAULTS.knowledgeUpdate.capitalAuthority,
      strategy_authority: WP21_EPISTEMIC_AUTHORITY_DEFAULTS.knowledgeUpdate.strategyAuthority,
      trade_eligibility_authority:
        WP21_EPISTEMIC_AUTHORITY_DEFAULTS.knowledgeUpdate.tradeEligibilityAuthority,
      guardian_authority: WP21_EPISTEMIC_AUTHORITY_DEFAULTS.knowledgeUpdate.guardianAuthority,
    }),
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
    prior_machine_recommended_confidence: record.priorMachineRecommendedConfidence,
    machine_recommended_confidence: record.machineRecommendedConfidence,
    machine_recommended_delta: record.machineRecommendedDelta,
    confidence_value_class: record.confidenceValueClass,
    authority_class: record.authorityClass,
    operator_disposition: record.operatorDisposition,
    capital_authority: record.capitalAuthority,
    strategy_authority: record.strategyAuthority,
    trade_eligibility_authority: record.tradeEligibilityAuthority,
    guardian_authority: record.guardianAuthority,
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
