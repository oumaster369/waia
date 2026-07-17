import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type {
  AbstentionOutcomeRecord,
  ForecastOutcomeRecord,
  HypothesisOutcomeRecord,
} from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";

function canonicalizeCommonFields(record: {
  schemaVersion: string;
  organizationId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  modelVersion: string | null;
  strategyVersion: string | null;
  regime: string;
  horizon: string;
  issuedAt: string;
  eligibleResolutionAt: string;
  resolvedAt: string | null;
  pitEvidenceBoundary: string | null;
  outcomeClass: string;
  score: string | null;
  sourceRecordIdsJson: string;
  terminalReason: string;
  provenance: {
    codeSha: string;
    datasetContentDigest: string;
    profileDigest: string;
    canonicalizer: string;
  };
}): Record<string, unknown> {
  return {
    schema_version: record.schemaVersion,
    organization_id: record.organizationId,
    run_id: record.runId,
    cycle_id: record.cycleId,
    symbol: record.symbol,
    model_version: record.modelVersion,
    strategy_version: record.strategyVersion,
    regime: record.regime,
    horizon: record.horizon,
    issued_at: record.issuedAt,
    eligible_resolution_at: record.eligibleResolutionAt,
    resolved_at: record.resolvedAt,
    pit_evidence_boundary: record.pitEvidenceBoundary,
    outcome_class: record.outcomeClass,
    score: record.score,
    source_record_ids_json: record.sourceRecordIdsJson,
    terminal_reason: record.terminalReason,
    provenance: {
      code_sha: record.provenance.codeSha,
      dataset_content_digest: record.provenance.datasetContentDigest,
      profile_digest: record.provenance.profileDigest,
      canonicalizer: record.provenance.canonicalizer,
    },
  };
}

export function canonicalizeForecastOutcomeRecord(
  record: ForecastOutcomeRecord,
): Record<string, unknown> {
  return {
    ...canonicalizeCommonFields({ ...record, modelVersion: record.modelVersion }),
    forecast_record_id: record.forecastRecordId,
    decision_record_id: record.decisionRecordId,
    hypothesis_record_id: record.hypothesisRecordId,
    outcome_verdict: record.outcomeVerdict,
  };
}

export function computeForecastOutcomeContentDigest(record: ForecastOutcomeRecord): string {
  return computeSemanticSha256Hex(canonicalizeForecastOutcomeRecord(record));
}

export function canonicalizeHypothesisOutcomeRecord(
  record: HypothesisOutcomeRecord,
): Record<string, unknown> {
  return {
    ...canonicalizeCommonFields({ ...record, modelVersion: record.modelVersion }),
    hypothesis_record_id: record.hypothesisRecordId,
    decision_record_id: record.decisionRecordId,
    forecast_outcome_ids_json: record.forecastOutcomeIdsJson,
  };
}

export function computeHypothesisOutcomeContentDigest(record: HypothesisOutcomeRecord): string {
  return computeSemanticSha256Hex(canonicalizeHypothesisOutcomeRecord(record));
}

export function canonicalizeAbstentionOutcomeRecord(
  record: AbstentionOutcomeRecord,
): Record<string, unknown> {
  return {
    ...canonicalizeCommonFields({
      ...record,
      resolvedAt: record.resolvedAt,
      pitEvidenceBoundary: record.pitEvidenceBoundary,
    }),
    decision_record_id: record.decisionRecordId,
    forecast_record_id: record.forecastRecordId,
    forecast_outcome_id: record.forecastOutcomeId,
    observed_outcome_json: record.observedOutcomeJson,
    counterfactual_trade_sim_json: record.counterfactualTradeSimJson,
  };
}

export function computeAbstentionOutcomeContentDigest(record: AbstentionOutcomeRecord): string {
  return computeSemanticSha256Hex(canonicalizeAbstentionOutcomeRecord(record));
}
