import type { Bar } from "@/lib/trader/intelligence/types";

export const STRATEGY_CANDIDATE_STATUS_VALUES = [
  "draft",
  "registered",
  "backtested",
  "walk_forward_validated",
  "blind_validated",
  "rejected",
] as const;

export type StrategyCandidateStatus = (typeof STRATEGY_CANDIDATE_STATUS_VALUES)[number];

export type StrategyCandidate = {
  id: string;
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  hypothesisId: string | null;
  trialId: string | null;
  status: StrategyCandidateStatus;
  paramsJson: string;
  blindUsed: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type InsertStrategyCandidateRow = {
  id: string;
  strategyId: string;
  strategyVersion: string;
  hypothesisId?: string | null;
  trialId?: string | null;
  status?: StrategyCandidateStatus;
  paramsJson: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export const RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1 = "1.0.0" as const;

export const RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION = "2.0.0" as const;

export type ResearchRegimeMetricSliceV1 = {
  regimeLabel: string;
  tradeCount: number;
  periodRealizedPnl: string;
  periodTotalFees: string;
};

/** @deprecated legacy v1 slice — use ResearchRegimeMetricSliceV2 for new metrics. */
export type ResearchRegimeMetricSlice = ResearchRegimeMetricSliceV1;

export type ResearchValidationMetricsV1 = {
  schemaVersion: typeof RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1;
  tradeCount: number;
  periodRealizedPnl: string;
  periodTotalFees: string;
  byRegime: ResearchRegimeMetricSliceV1[];
};

export type ResearchTradeMetricTaxonomy = {
  submittedOrders: number;
  acceptedOrders: number;
  filledOrders: number;
  openPositions: number;
  closedTrades: number;
  markToCloseTrades: number;
  realizedPnl: string;
  markedPnl: string;
  periodTotalFees: string;
  rejectedSignals: number;
  skippedSignals: number;
};

export type ResearchRegimeMetricSliceV2 = ResearchTradeMetricTaxonomy & {
  regimeLabel: string;
};

export type ResearchValidationMetricsV2 = ResearchTradeMetricTaxonomy & {
  schemaVersion: typeof RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION;
  closedTradeSemanticsVersion: string;
  tradeLifecycleSemanticsVersion: string;
  costModelVersion: string;
  byRegime: ResearchRegimeMetricSliceV2[];
};

export type ResearchValidationMetrics = ResearchValidationMetricsV1 | ResearchValidationMetricsV2;

export type WalkForwardWindowResult = {
  windowIndex: number;
  inSampleDigest: string;
  outOfSampleDigest: string;
  metrics: ResearchValidationMetrics;
};

export type WalkForwardWindowPlan = {
  windowIndex: number;
  inSampleBars: readonly Bar[];
  outOfSampleBars: readonly Bar[];
  inSampleDigest: string;
  outOfSampleDigest: string;
};

export type InsertWalkForwardWindowRow = {
  id: string;
  candidateId: string;
  windowIndex: number;
  inSampleDigest: string;
  outOfSampleDigest: string;
  metricsJson: string;
  createdAt?: Date;
};

export type WalkForwardWindowRecord = {
  id: string;
  organizationId: string;
  candidateId: string;
  windowIndex: number;
  inSampleDigest: string;
  outOfSampleDigest: string;
  metricsJson: string;
  createdAt: Date;
};

export type BlindValidationResult = {
  id: string;
  organizationId: string;
  candidateId: string;
  datasetId: string;
  metricsJson: string;
  evidenceDigest: string;
  validatedAt: Date;
  createdAt: Date;
};

export type InsertBlindValidationResultRow = {
  id: string;
  candidateId: string;
  datasetId: string;
  metricsJson: string;
  evidenceDigest: string;
  validatedAt: Date;
  createdAt?: Date;
};
