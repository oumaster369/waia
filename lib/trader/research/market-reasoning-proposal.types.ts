import type { HypothesisDefinition } from "@/lib/trader/mi/hypothesis.types";

export const MARKET_REASONING_PROPOSAL_SCHEMA_VERSION =
  "waia.trader.market-reasoning-proposal.v1" as const;

export type MarketReasoningConfidenceLevel = "low" | "medium" | "high";

export type MarketReasoningInputArtifactDigests = {
  rejectionRecord: string;
  evolutionCycle: string;
  reasoningContext: string;
};

export type MarketReasoningAlternativeHypothesis = {
  claimText: string;
  rationale: string;
  intendedRegimeScope: string[];
};

export type MarketReasoningRecommendedHypothesisDraft = {
  claimText: string;
  falsificationConditions: string[];
  intendedRegimeScope: string[];
  mapsToMiRegisterHypothesisDraft: {
    hypothesisKind: "market_claim";
    name: string;
    definition: HypothesisDefinition;
    supersedes: string[];
    authoredBy: string;
  };
};

export type MarketReasoningHumanReview = {
  disposition: "pending";
  reviewChecklist: string[];
  nextSteps: string[];
};

export type MarketReasoningProviderMetadata = {
  foundationProfile: "ai-trader";
  agentId: "market-reasoning-assist";
  providerId: string;
  model: string;
  providerRequestId?: string;
  completedAt: string;
};

export type MarketReasoningProposalBody = {
  inputArtifactDigests: MarketReasoningInputArtifactDigests;
  reasoningSummary: string;
  marketExplanation: string;
  alternativeHypotheses: MarketReasoningAlternativeHypothesis[];
  recommendedNextHypothesis: MarketReasoningRecommendedHypothesisDraft;
  overfittingWarnings: string[];
  confidenceLevel: MarketReasoningConfidenceLevel;
  humanReview: MarketReasoningHumanReview;
  providerMetadata: MarketReasoningProviderMetadata;
  promptDigest: string;
  reasoningOutputDigest: string;
};

export type MarketReasoningProposalEnvelope = {
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  candidateId: string;
  contentDigest: string;
};

export type MarketReasoningProposal = {
  schemaVersion: typeof MARKET_REASONING_PROPOSAL_SCHEMA_VERSION;
  envelope: MarketReasoningProposalEnvelope;
  proposalBody: MarketReasoningProposalBody;
};

/** Provider JSON shape before guardrails and envelope assembly. */
export type MarketReasoningProposalDraft = {
  reasoningSummary: string;
  marketExplanation: string;
  alternativeHypotheses: MarketReasoningAlternativeHypothesis[];
  recommendedNextHypothesis: MarketReasoningRecommendedHypothesisDraft;
  overfittingWarnings: string[];
  confidenceLevel: MarketReasoningConfidenceLevel;
  humanReview: MarketReasoningHumanReview;
};

export const MARKET_REASONING_FIELD_LIMITS = {
  reasoningSummary: 2_000,
  marketExplanation: 4_000,
  claimText: 1_000,
  rationale: 1_500,
  falsificationCondition: 500,
  overfittingWarning: 500,
  reviewItem: 300,
} as const;

export const MARKET_REASONING_ALTERNATIVE_HYPOTHESIS_BOUNDS = {
  min: 1,
  max: 5,
} as const;

export const MARKET_REASONING_FALSIFICATION_MIN = 2 as const;
