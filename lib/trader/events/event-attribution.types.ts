import type { Regime } from "@/lib/trader/intelligence/types";
import type { EventClassificationKind } from "@/lib/trader/events/event-classification-kinds";

export const EVENT_ATTRIBUTION_SCHEMA_VERSION = "waia.trader.event-attribution.v1" as const;

export type EventAttributionRunConfig = {
  enabled: boolean;
};

export const DEFAULT_EVENT_ATTRIBUTION_RUN_CONFIG: EventAttributionRunConfig = {
  enabled: false,
};

/** Descriptive co-occurrence labels — not PnL-based, not profitable/unprofitable. */
export type EventAttributionOutcomeTag = "supporting" | "contradicting" | "neutral";

export type EventAttributionSubjectKind = "price_window" | "close" | "rejection" | "pattern";

export type NormalizedEventRecord = {
  eventKey: string;
  sourceRef: string;
  eventTime: string;
  symbolScope: string;
  payloadJson: string;
  contentDigest: string;
};

export type EventClassificationResult = {
  classificationKind: EventClassificationKind;
  ruleId: string;
  confidence: string;
  rationale: readonly string[];
};

export type EventAttributionFeatureSnapshot = {
  close: string;
  zscoreVsSma20: string;
  realizedVol20: string;
  regime: Regime;
};

export type EventAttributionSubject = {
  kind: EventAttributionSubjectKind;
  subjectRef: string;
  symbol: string;
  windowStartMs: number;
  windowEndMs: number;
  regime: Regime;
  outcomeTag: EventAttributionOutcomeTag;
};

export type EventAttributionScoreBreakdown = {
  timeProximityComponent: string;
  physicsComponent: string;
  metadataComponent: string;
  attributionStrength: string;
};

export type EventAttributionScores = {
  attributionStrength: string;
  confidenceMean: string;
  confidenceBandLow: string;
  confidenceBandHigh: string;
  priorSupporting: number;
  priorContradicting: number;
  rationale: readonly string[];
};

export type EventAttributionExplanationPayload = {
  schemaVersion: typeof EVENT_ATTRIBUTION_SCHEMA_VERSION;
  eventKey: string;
  eventDigest: string;
  classificationKind: EventClassificationKind;
  subjectRef: string;
  subjectKind: EventAttributionSubjectKind;
  symbol: string;
  regime: Regime;
  outcomeTag: EventAttributionOutcomeTag;
  breakdown: EventAttributionScoreBreakdown;
  scores: EventAttributionScores;
  explanation: string;
};

export type EventAttributionPassResult = {
  schemaVersion: typeof EVENT_ATTRIBUTION_SCHEMA_VERSION;
  eventsProcessed: number;
  attributionsWritten: number;
  explanationRowsWritten: number;
  edgeRowsWritten: number;
};

export type OptionalPatternCoOccurrence = {
  patternKey: string;
  definitionDigest: string;
  subjectRef: string;
};
