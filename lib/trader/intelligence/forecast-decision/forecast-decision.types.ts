export const FORECAST_RECORD_SCHEMA_VERSION =
  "waia.trader.intelligence_forecast_record.v1" as const;
export const DECISION_RECORD_SCHEMA_VERSION =
  "waia.trader.intelligence_decision_record.v1" as const;
export const DECISION_FORECAST_LINK_SCHEMA_VERSION =
  "waia.trader.intelligence_decision_forecast_link.v1" as const;
export const ENTRY_PURPOSE_RECORD_SCHEMA_VERSION =
  "waia.trader.intelligence_entry_purpose_record.v1" as const;
export const FORECAST_MODEL_VERSION = "waia.trader.forecast_model.v1" as const;

export const decisionClassEnum = ["TRADE", "REDUCED_RISK", "NO_TRADE"] as const;
export type DecisionClass = (typeof decisionClassEnum)[number];

export const costEvidenceStateEnum = ["AVAILABLE", "UNAVAILABLE", "NOT_APPLICABLE"] as const;
export type CostEvidenceState = (typeof costEvidenceStateEnum)[number];

export const decisionForecastLinkRoleEnum = ["PRIMARY", "SUPPORTING"] as const;
export type DecisionForecastLinkRole = (typeof decisionForecastLinkRoleEnum)[number];

export type TraderIntelligenceForecastRecord = Readonly<{
  id: string;
  organizationId: string;
  cycleEnvelopeId: string;
  hypothesisRecordId: string;
  convictionRecordId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  forecastKeyDigest: string;
  evaluatedAt: string;
  issuedAt: string;
  evidenceCutoffAt: string;
  targetWindowStartAt: string;
  targetWindowEndAt: string;
  marketQuestion: string;
  invalidationConditionsJson: string;
  scenarioSetJson: string;
  forecastConfidenceJson: string;
  historicalProfileId: string;
  historicalProfileDigest: string;
  matrixDigest: string;
  evidenceDigest: string;
  authoritativeLinkDigest: string;
  canonicalCausalLineageJson?: string | null;
  canonicalCausalLineageDigest?: string | null;
  forecastModelVersion: string;
  contentDigest: string;
  schemaVersion: typeof FORECAST_RECORD_SCHEMA_VERSION;
}>;

export type TraderIntelligenceDecisionRecord = Readonly<{
  id: string;
  organizationId: string;
  cycleEnvelopeId: string;
  convictionRecordId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  evaluatedAt: string;
  issuedAt: string;
  decisionClass: DecisionClass;
  universalTerminalReasonCode: string;
  whyNotCashJson: string | null;
  whyCashOrAbstainJson: string | null;
  grossExpectedReward: string | null;
  expectedFees: string | null;
  expectedSlippage: string | null;
  expectedOtherCosts: string | null;
  expectedRewardAfterCosts: string | null;
  costModelId: string | null;
  costModelVersion: string | null;
  costEvidenceState: CostEvidenceState;
  cdeMsvPermissionSnapshotJson: string;
  reasonCodesJson: string;
  strategyId: string | null;
  strategyVersion: string | null;
  contentDigest: string;
  schemaVersion: typeof DECISION_RECORD_SCHEMA_VERSION;
}>;

export type TraderIntelligenceDecisionForecastLink = Readonly<{
  id: string;
  organizationId: string;
  decisionRecordId: string;
  forecastRecordId: string;
  linkRole: DecisionForecastLinkRole;
  ordinal: number;
  contentDigest: string;
  schemaVersion: typeof DECISION_FORECAST_LINK_SCHEMA_VERSION;
}>;

export type TraderIntelligenceEntryPurposeRecord = Readonly<{
  id: string;
  organizationId: string;
  decisionRecordId: string;
  primaryForecastRecordId: string;
  hypothesisRecordId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  originalThesisJson: string;
  expectedPath: string;
  forecastHorizon: string;
  entryReason: string;
  entryConditionJson: string;
  invalidationConditionJson: string;
  initialStopModelJson: string;
  targetModelJson: string;
  optionalPartialTargetsJson: string | null;
  maximumHoldingUntil: string;
  whyNotCashJson: string;
  riskAmountJson: string;
  expectedRewardAfterCosts: string;
  evidenceDigest: string;
  strategyId: string;
  strategyVersion: string;
  contentDigest: string;
  schemaVersion: typeof ENTRY_PURPOSE_RECORD_SCHEMA_VERSION;
}>;

export type ForecastDecisionBundle = Readonly<{
  forecasts: readonly TraderIntelligenceForecastRecord[];
  decision: TraderIntelligenceDecisionRecord;
  links: readonly TraderIntelligenceDecisionForecastLink[];
  entryPurpose: TraderIntelligenceEntryPurposeRecord | null;
}>;
