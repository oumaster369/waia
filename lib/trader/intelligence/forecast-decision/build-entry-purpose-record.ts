import type { MarketHypothesis } from "@/lib/trader/intelligence/hypothesis/hypothesis.types";
import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { deriveEntryPurposeRecordId } from "@/lib/trader/intelligence/forecast-decision/derive-forecast-decision-ids";
import { computeEntryPurposeRecordContentDigest } from "@/lib/trader/intelligence/forecast-decision/serialize-forecast-decision";
import {
  ENTRY_PURPOSE_RECORD_SCHEMA_VERSION,
  type DecisionClass,
  type TraderIntelligenceDecisionForecastLink,
  type TraderIntelligenceDecisionRecord,
  type TraderIntelligenceEntryPurposeRecord,
  type TraderIntelligenceForecastRecord,
} from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";

const ENTRY_PURPOSE_HORIZON_MS = 4 * 60 * 60 * 1000;

export type BuildEntryPurposeRecordInput = Readonly<{
  decision: TraderIntelligenceDecisionRecord;
  forecasts: readonly TraderIntelligenceForecastRecord[];
  links: readonly TraderIntelligenceDecisionForecastLink[];
  activeHypothesis: MarketHypothesis | null;
}>;

function addHorizon(isoTimestamp: string, horizonMs: number): string {
  return new Date(new Date(isoTimestamp).getTime() + horizonMs).toISOString();
}

export function buildEntryPurposeRecord(
  input: BuildEntryPurposeRecordInput,
): TraderIntelligenceEntryPurposeRecord | null {
  const decisionClass: DecisionClass = input.decision.decisionClass;
  if (decisionClass !== "TRADE" && decisionClass !== "REDUCED_RISK") {
    return null;
  }

  const primaryLink = input.links.find((link) => link.linkRole === "PRIMARY");
  if (!primaryLink) {
    throw new Error("buildEntryPurposeRecord: PRIMARY decision-forecast link required");
  }

  const primaryForecast = input.forecasts.find(
    (forecast) => forecast.id === primaryLink.forecastRecordId,
  );
  if (!primaryForecast) {
    throw new Error("buildEntryPurposeRecord: primary forecast not found");
  }

  if (!input.activeHypothesis) {
    throw new Error("buildEntryPurposeRecord: active hypothesis required for entry purpose");
  }

  if (!input.decision.strategyId || !input.decision.strategyVersion) {
    throw new Error("buildEntryPurposeRecord: strategy identity required for entry purpose");
  }

  const maximumHoldingUntil = addHorizon(input.decision.issuedAt, ENTRY_PURPOSE_HORIZON_MS);
  if (maximumHoldingUntil <= input.decision.issuedAt) {
    throw new Error(
      "buildEntryPurposeRecord: maximum_holding_until must be after decision issued_at",
    );
  }

  const whyNotCashJson =
    input.decision.whyNotCashJson ??
    canonicalizeSemanticJsonString({
      abstain: false,
      rationale: "Risk justified over cash preservation for this cycle.",
    });

  const base: TraderIntelligenceEntryPurposeRecord = {
    id: deriveEntryPurposeRecordId({
      organizationId: input.decision.organizationId,
      runId: input.decision.runId,
      cycleId: input.decision.cycleId,
      symbol: input.decision.symbol,
    }),
    organizationId: input.decision.organizationId,
    decisionRecordId: input.decision.id,
    primaryForecastRecordId: primaryForecast.id,
    hypothesisRecordId: primaryForecast.hypothesisRecordId,
    runId: input.decision.runId,
    cycleId: input.decision.cycleId,
    symbol: input.decision.symbol,
    originalThesisJson: canonicalizeSemanticJsonString({
      hypothesis_type: input.activeHypothesis.hypothesisType,
      expected_path: input.activeHypothesis.expectedPath,
      supporting_evidence: input.activeHypothesis.supportingEvidence,
      contradicting_evidence: input.activeHypothesis.contradictingEvidence,
    }),
    expectedPath: input.activeHypothesis.expectedPath,
    forecastHorizon: "4h",
    entryReason: `LD7_${decisionClass}_FROM_AUTHORIZED_OPPORTUNITY`,
    entryConditionJson: canonicalizeSemanticJsonString({
      decision_class: decisionClass,
      universal_terminal_reason_code: input.decision.universalTerminalReasonCode,
      strategy_id: input.decision.strategyId,
    }),
    invalidationConditionJson: canonicalizeSemanticJsonString(
      input.activeHypothesis.invalidationConditions,
    ),
    initialStopModelJson: canonicalizeSemanticJsonString({
      model: "fixed_risk_fraction_v1",
      risk_reference: input.decision.expectedRewardAfterCosts ?? "0",
    }),
    targetModelJson: canonicalizeSemanticJsonString({
      model: "expected_path_completion_v1",
      horizon: "4h",
    }),
    optionalPartialTargetsJson: null,
    maximumHoldingUntil,
    whyNotCashJson,
    riskAmountJson: canonicalizeSemanticJsonString({
      max_risk: input.decision.expectedRewardAfterCosts ?? "0",
      currency: "USDT",
    }),
    expectedRewardAfterCosts: input.decision.expectedRewardAfterCosts ?? "0",
    evidenceDigest: primaryForecast.evidenceDigest,
    strategyId: input.decision.strategyId,
    strategyVersion: input.decision.strategyVersion,
    contentDigest: "",
    schemaVersion: ENTRY_PURPOSE_RECORD_SCHEMA_VERSION,
  };

  return {
    ...base,
    contentDigest: computeEntryPurposeRecordContentDigest(base),
  };
}
