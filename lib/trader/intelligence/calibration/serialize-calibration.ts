import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type {
  CalibrationObservationRecord,
  CalibrationSnapshotRecord,
} from "@/lib/trader/intelligence/calibration/calibration.types";

export function canonicalizeCalibrationObservationRecord(
  record: CalibrationObservationRecord,
): Record<string, unknown> {
  return {
    schema_version: record.schemaVersion,
    organization_id: record.organizationId,
    run_id: record.runId,
    cycle_id: record.cycleId,
    symbol: record.symbol,
    forecast_record_id: record.forecastRecordId,
    forecast_outcome_id: record.forecastOutcomeId,
    model_version: record.modelVersion,
    strategy_version: record.strategyVersion,
    regime: record.regime,
    horizon: record.horizon,
    issued_at: record.issuedAt,
    eligible_resolution_at: record.eligibleResolutionAt,
    resolved_at: record.resolvedAt,
    pit_evidence_boundary: record.pitEvidenceBoundary,
    probability: record.probability,
    outcome_encoding: record.outcomeEncoding,
    brier_score: record.brierScore,
    log_loss_score: record.logLossScore,
    scoring_eligible: record.scoringEligible,
    non_scoring_reason: record.nonScoringReason,
    terminal_reason: record.terminalReason,
    provenance: record.provenance,
  };
}

export function computeCalibrationObservationContentDigest(
  record: CalibrationObservationRecord,
): string {
  return computeSemanticSha256Hex(canonicalizeCalibrationObservationRecord(record));
}

export function canonicalizeCalibrationSnapshotRecord(
  record: CalibrationSnapshotRecord,
): Record<string, unknown> {
  return {
    schema_version: record.schemaVersion,
    organization_id: record.organizationId,
    run_id: record.runId,
    cycle_id: record.cycleId,
    symbol: record.symbol,
    forecast_model_version: record.forecastModelVersion,
    regime: record.regime,
    horizon: record.horizon,
    sample_count: record.sampleCount,
    scoring_sample_count: record.scoringSampleCount,
    brier_mean: record.brierMean,
    log_loss_mean: record.logLossMean,
    calibration_status: record.calibrationStatus,
    calibration_window: record.calibrationWindow,
    survivorship_counts_json: record.survivorshipCountsJson,
    issued_at: record.issuedAt,
    eligible_resolution_at: record.eligibleResolutionAt,
    resolved_at: record.resolvedAt,
    pit_evidence_boundary: record.pitEvidenceBoundary,
    outcome_class: record.outcomeClass,
    score: record.score,
    terminal_reason: record.terminalReason,
    provenance: record.provenance,
  };
}

export function computeCalibrationSnapshotContentDigest(record: CalibrationSnapshotRecord): string {
  return computeSemanticSha256Hex(canonicalizeCalibrationSnapshotRecord(record));
}
