import type { Regime } from "@/lib/trader/intelligence/types";
import type { MiPattern } from "@/lib/trader/mi/pattern.types";

export const PATTERN_CATALOG_SCHEMA_VERSION = "waia.trader.pattern-catalog.v1" as const;

export type PatternCatalogRunConfig = {
  enabled: boolean;
};

export const DEFAULT_PATTERN_CATALOG_RUN_CONFIG: PatternCatalogRunConfig = {
  enabled: false,
};

export type PatternCatalogOutcomeTag = "supporting" | "contradicting" | "neutral";

export type PatternCatalogSubjectKind = "close" | "rejection";

export type PatternCatalogSubject = {
  kind: PatternCatalogSubjectKind;
  subjectRef: string;
  symbol: string;
  evaluatedAt: string;
  regime: Regime;
  priceMoveUsdt: string | null;
  outcomeTag: PatternCatalogOutcomeTag;
};

export type PatternCatalogFeatureSnapshot = {
  close: string;
  zscoreVsSma20: string;
  priceDispersion20: string;
  eventRiskScore: string;
};

export type PatternCatalogScoreBreakdown = {
  zscoreComponent: string;
  volComponent: string;
  eventRiskComponent: string;
  matchScore: string;
};

export type PatternCatalogScores = {
  matchScore: string;
  relevanceScore: string;
  confidenceMean: string;
  confidenceBandLow: string;
  confidenceBandHigh: string;
  priorHits: number;
  priorMisses: number;
  rationale: readonly string[];
};

export type PatternCatalogMatchResult = {
  pattern: MiPattern;
  scores: PatternCatalogScores;
  breakdown: PatternCatalogScoreBreakdown;
};

export type PatternCatalogExplanationPayload = {
  schemaVersion: typeof PATTERN_CATALOG_SCHEMA_VERSION;
  subjectRef: string;
  subjectKind: PatternCatalogSubjectKind;
  symbol: string;
  regime: Regime;
  priceMoveUsdt: string | null;
  patternKey: string;
  definitionDigest: string;
  breakdown: PatternCatalogScoreBreakdown;
  scores: PatternCatalogScores;
  outcomeTag: PatternCatalogOutcomeTag;
  explanation: string;
};

export type PatternCatalogPassResult = {
  schemaVersion: typeof PATTERN_CATALOG_SCHEMA_VERSION;
  subjectsProcessed: number;
  scoreRowsWritten: number;
  explanationRowsWritten: number;
  edgeRowsWritten: number;
};
