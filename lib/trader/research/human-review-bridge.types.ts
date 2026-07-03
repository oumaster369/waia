import type { MarketReasoningProposal } from "@/lib/trader/research/market-reasoning-proposal.types";

/** Future — operator review under ADR-0011. R2: not implemented. */
export type HumanReviewDisposition = "pending" | "accepted" | "deferred" | "rejected";

export interface HumanReviewBridge {
  loadPendingProposal(vaultDir: string): MarketReasoningProposal;
  validateProposalForReview(proposal: MarketReasoningProposal): void;
}

export type HumanDispositionRecord = {
  reasoningSessionId: string;
  proposalDigest: string;
  disposition: Exclude<HumanReviewDisposition, "pending">;
  operatorAttestation: {
    operatorId: string;
    attestedAt: string;
    attestationDigest: string;
  };
  reviewNotes?: string;
};

/** Future — maps accepted proposal to MI register draft. R2: not implemented. */
export interface HypothesisRegistrationBridge {
  buildRegistrationDraft(proposal: MarketReasoningProposal): unknown;
}

/** Future — human-initiated RI campaign intent. R2: not implemented. */
export interface ResearchCampaignBridge {
  buildCampaignIntent(input: {
    hypothesisId: string;
    candidateId: string;
    operatorAttestation: string;
  }): unknown;
}
