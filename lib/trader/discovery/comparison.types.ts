export const COMPARISON_SCHEMA_VERSION = "waia.trader.discovery-comparison.v1" as const;

export const PROMOTION_PROPOSAL_SCHEMA_VERSION =
  "waia.trader.discovery-promotion-proposal.v1" as const;

export type ComparisonDimensionScore = {
  dimension: string;
  direction: "FOR" | "AGAINST" | "NEUTRAL";
  strength: string;
  relevanceScore: string;
};

export type ComparisonScore = {
  schemaVersion: typeof COMPARISON_SCHEMA_VERSION;
  scoreId: string;
  organizationId: string;
  campaignId: string;
  candidateRef: string;
  dimensionScores: readonly ComparisonDimensionScore[];
  aggregateRankScore: string;
  contentDigest: string;
  createdAt: string;
};

export type PromotionRecommendation = "human_review" | "defer" | "reject";

export type PromotionProposalArtifact = {
  schemaVersion: typeof PROMOTION_PROPOSAL_SCHEMA_VERSION;
  proposalId: string;
  organizationId: string;
  campaignId: string;
  candidateId: string;
  comparisonDigest: string;
  humanGateRequired: true;
  recommends: PromotionRecommendation;
  rationale: string;
  contentDigest: string;
  createdAt: string;
};

export type CandidateRankEntry = {
  candidateRef: string;
  rank: number;
  aggregateRankScore: string;
  dimensionScores: readonly ComparisonDimensionScore[];
};

export type CandidateComparatorResult = {
  ranked: readonly CandidateRankEntry[];
  comparisonDigest: string;
};
