import {
  compareCodePoints,
  computeSemanticSha256Hex,
  sortCodePointStrings,
} from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  deriveForecastKeyDigest,
  type ForecastKeyDigestInput,
} from "@/lib/trader/intelligence/forecast-decision/derive-forecast-decision-ids";
import {
  type TraderIntelligenceDecisionForecastLink,
  type TraderIntelligenceDecisionRecord,
  type TraderIntelligenceEntryPurposeRecord,
  type TraderIntelligenceForecastRecord,
} from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";

export { deriveForecastKeyDigest };
export type { ForecastKeyDigestInput };

export function canonicalizeForecastRecord(
  record: TraderIntelligenceForecastRecord,
): Record<string, unknown> {
  return {
    schema_version: record.schemaVersion,
    organization_id: record.organizationId,
    run_id: record.runId,
    cycle_id: record.cycleId,
    symbol: record.symbol,
    forecast_key_digest: record.forecastKeyDigest,
    evaluated_at: record.evaluatedAt,
    issued_at: record.issuedAt,
    evidence_cutoff_at: record.evidenceCutoffAt,
    target_window_start_at: record.targetWindowStartAt,
    target_window_end_at: record.targetWindowEndAt,
    market_question: record.marketQuestion,
    invalidation_conditions_json: record.invalidationConditionsJson,
    scenario_set_json: record.scenarioSetJson,
    forecast_confidence_json: record.forecastConfidenceJson,
    historical_profile_id: record.historicalProfileId,
    historical_profile_digest: record.historicalProfileDigest,
    matrix_digest: record.matrixDigest,
    evidence_digest: record.evidenceDigest,
    authoritative_link_digest: record.authoritativeLinkDigest,
    forecast_model_version: record.forecastModelVersion,
  };
}

export function computeForecastRecordContentDigest(
  record: TraderIntelligenceForecastRecord,
): string {
  return computeSemanticSha256Hex(canonicalizeForecastRecord(record));
}

export function canonicalizeDecisionRecord(
  record: TraderIntelligenceDecisionRecord,
): Record<string, unknown> {
  return {
    schema_version: record.schemaVersion,
    organization_id: record.organizationId,
    run_id: record.runId,
    cycle_id: record.cycleId,
    symbol: record.symbol,
    evaluated_at: record.evaluatedAt,
    issued_at: record.issuedAt,
    decision_class: record.decisionClass,
    universal_terminal_reason_code: record.universalTerminalReasonCode,
    why_not_cash_json: record.whyNotCashJson,
    why_cash_or_abstain_json: record.whyCashOrAbstainJson,
    gross_expected_reward: record.grossExpectedReward,
    expected_fees: record.expectedFees,
    expected_slippage: record.expectedSlippage,
    expected_other_costs: record.expectedOtherCosts,
    expected_reward_after_costs: record.expectedRewardAfterCosts,
    cost_model_id: record.costModelId,
    cost_model_version: record.costModelVersion,
    cost_evidence_state: record.costEvidenceState,
    cde_msv_permission_snapshot_json: record.cdeMsvPermissionSnapshotJson,
    reason_codes_json: record.reasonCodesJson,
    strategy_id: record.strategyId,
    strategy_version: record.strategyVersion,
  };
}

export function computeDecisionRecordContentDigest(
  record: TraderIntelligenceDecisionRecord,
): string {
  return computeSemanticSha256Hex(canonicalizeDecisionRecord(record));
}

export function canonicalizeDecisionForecastLink(
  record: TraderIntelligenceDecisionForecastLink,
): Record<string, unknown> {
  return {
    schema_version: record.schemaVersion,
    organization_id: record.organizationId,
    decision_record_id: record.decisionRecordId,
    forecast_record_id: record.forecastRecordId,
    link_role: record.linkRole,
    ordinal: record.ordinal,
  };
}

export function computeDecisionForecastLinkContentDigest(
  record: TraderIntelligenceDecisionForecastLink,
): string {
  return computeSemanticSha256Hex(canonicalizeDecisionForecastLink(record));
}

export function canonicalizeEntryPurposeRecord(
  record: TraderIntelligenceEntryPurposeRecord,
): Record<string, unknown> {
  return {
    schema_version: record.schemaVersion,
    organization_id: record.organizationId,
    run_id: record.runId,
    cycle_id: record.cycleId,
    symbol: record.symbol,
    original_thesis_json: record.originalThesisJson,
    expected_path: record.expectedPath,
    forecast_horizon: record.forecastHorizon,
    entry_reason: record.entryReason,
    entry_condition_json: record.entryConditionJson,
    invalidation_condition_json: record.invalidationConditionJson,
    initial_stop_model_json: record.initialStopModelJson,
    target_model_json: record.targetModelJson,
    optional_partial_targets_json: record.optionalPartialTargetsJson,
    maximum_holding_until: record.maximumHoldingUntil,
    why_not_cash_json: record.whyNotCashJson,
    risk_amount_json: record.riskAmountJson,
    expected_reward_after_costs: record.expectedRewardAfterCosts,
    evidence_digest: record.evidenceDigest,
    strategy_id: record.strategyId,
    strategy_version: record.strategyVersion,
  };
}

export function computeEntryPurposeRecordContentDigest(
  record: TraderIntelligenceEntryPurposeRecord,
): string {
  return computeSemanticSha256Hex(canonicalizeEntryPurposeRecord(record));
}

export function sortForecastsByKeyDigestCodePoint(
  forecasts: readonly TraderIntelligenceForecastRecord[],
): TraderIntelligenceForecastRecord[] {
  return [...forecasts].sort((a, b) => compareCodePoints(a.forecastKeyDigest, b.forecastKeyDigest));
}

export function sortDecisionForecastLinks(
  links: readonly TraderIntelligenceDecisionForecastLink[],
): TraderIntelligenceDecisionForecastLink[] {
  return [...links].sort((a, b) => {
    const ordinalCompare = a.ordinal - b.ordinal;
    if (ordinalCompare !== 0) {
      return ordinalCompare;
    }
    return compareCodePoints(a.forecastRecordId, b.forecastRecordId);
  });
}

export function canonicalizeReasonCodesJson(reasonCodes: readonly string[]): string {
  return JSON.stringify(sortCodePointStrings(reasonCodes));
}
