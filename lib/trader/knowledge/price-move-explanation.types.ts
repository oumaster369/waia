export const PRICE_MOVE_EXPLANATION_SCHEMA_VERSION =
  "waia.trader.price-move-explanation.v1" as const;

export type PriceMoveExplanation = {
  id: string;
  organizationId: string;
  subjectRef: string;
  priceMoveJson: string;
  patternRefsJson: string;
  scoreBreakdownJson: string;
  contentDigest: string;
  createdAt: Date;
};

export type InsertPriceMoveExplanationRow = {
  id: string;
  subjectRef: string;
  priceMoveJson: string;
  patternRefsJson: string;
  scoreBreakdownJson: string;
  contentDigest: string;
  createdAt: Date;
};

export type MiPatternScoreEvent = {
  id: string;
  organizationId: string;
  patternKey: string;
  definitionDigest: string;
  subjectRef: string;
  matchScore: string;
  relevanceScore: string;
  confidenceMean: string;
  confidenceBandLow: string;
  confidenceBandHigh: string;
  priorHits: number;
  priorMisses: number;
  regime: string;
  evaluatedAt: Date;
  contentDigest: string;
  createdAt: Date;
};

export type InsertMiPatternScoreEventRow = {
  id: string;
  patternKey: string;
  definitionDigest: string;
  subjectRef: string;
  matchScore: string;
  relevanceScore: string;
  confidenceMean: string;
  confidenceBandLow: string;
  confidenceBandHigh: string;
  priorHits: number;
  priorMisses: number;
  regime: string;
  evaluatedAt: Date;
  contentDigest: string;
  createdAt: Date;
};
