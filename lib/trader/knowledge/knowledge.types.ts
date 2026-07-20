export const MARKET_PREDICTION_VERIFICATION_RESULTS = [
  "confirmed",
  "rejected",
  "inconclusive",
] as const;

export type MarketPredictionVerificationResult =
  (typeof MARKET_PREDICTION_VERIFICATION_RESULTS)[number];

export type MarketPrediction = {
  id: string;
  organizationId: string;
  subjectRef: string;
  predictionJson: string;
  predictedAt: Date;
  outcomeJson: string | null;
  verifiedAt: Date | null;
  verificationResult: MarketPredictionVerificationResult | null;
  contentDigest: string;
  createdAt: Date;
};

export type InsertMarketPredictionRow = {
  id: string;
  subjectRef: string;
  predictionJson: string;
  predictedAt: Date;
  contentDigest: string;
  createdAt: Date;
};

export type MarketEvent = {
  id: string;
  organizationId: string;
  eventKind: string;
  subjectRef: string;
  payloadJson: string;
  eventTime: Date;
  confidence: string;
  contentDigest: string;
  createdAt: Date;
};

export type InsertMarketEventRow = {
  id: string;
  eventKind: string;
  subjectRef: string;
  payloadJson: string;
  eventTime: Date;
  confidence: string;
  contentDigest: string;
  createdAt: Date;
};

export type KnowledgeEdge = {
  id: string;
  organizationId: string;
  fromRef: string;
  toRef: string;
  relationKind: string;
  confidence: string;
  strength: string;
  regimeScope: string;
  failureCasesJson: string;
  hypothesisId: string | null;
  verified: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type InsertKnowledgeEdgeRow = {
  id: string;
  fromRef: string;
  toRef: string;
  relationKind: string;
  confidence: string;
  strength: string;
  regimeScope: string;
  failureCasesJson: string;
  hypothesisId?: string | null;
  verified?: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type UpdateKnowledgeEdgeRow = {
  confidence?: string;
  strength?: string;
  regimeScope?: string;
  failureCasesJson?: string;
  hypothesisId?: string | null;
  verified?: boolean;
  updatedAt: Date;
};
