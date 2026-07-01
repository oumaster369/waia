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

export const RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION = "1.0.0" as const;

export type ResearchRegimeMetricSlice = {
  regimeLabel: string;
  tradeCount: number;
  periodRealizedPnl: string;
  periodTotalFees: string;
};

export type ResearchValidationMetrics = {
  schemaVersion: typeof RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION;
  tradeCount: number;
  periodRealizedPnl: string;
  periodTotalFees: string;
  byRegime: ResearchRegimeMetricSlice[];
};

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
