import type {
  HumanDispositionRecord,
  HumanReviewDisposition,
} from "@/lib/trader/research/human-review-bridge.types";
import type { MarketReasoningProposal } from "@/lib/trader/research/market-reasoning-proposal.types";
import type { HypothesisProposalArtifact } from "@/lib/trader/discovery/hypothesis-proposal.types";
import type { PromotionProposalArtifact } from "@/lib/trader/discovery/comparison.types";
import type { ResearchQuestion } from "@/lib/trader/discovery/research-question.types";

export type ActuationArtifactKind =
  | "research_question"
  | "hypothesis_proposal"
  | "strategy_synthesis"
  | "promotion_proposal";

export type ActuationEnvelope = {
  organizationId: string;
  campaignId: string;
  artifactKind: ActuationArtifactKind;
  artifactDigest: string;
  operatorAttestationDigest: string;
  attestedAt: string;
};

export type ResearchQuestionDispositionRecord = {
  researchQuestionId: string;
  questionDigest: string;
  disposition: Exclude<HumanReviewDisposition, "pending">;
  operatorAttestation: HumanDispositionRecord["operatorAttestation"];
  reviewNotes?: string;
};

export type HypothesisProposalDispositionRecord = {
  proposalId: string;
  proposalDigest: string;
  researchQuestionRef: string;
  disposition: Exclude<HumanReviewDisposition, "pending">;
  operatorAttestation: HumanDispositionRecord["operatorAttestation"];
};

export type StrategySynthesisDispositionRecord = {
  synthesisId: string;
  synthesisDigest: string;
  disposition: Exclude<HumanReviewDisposition, "pending">;
  operatorAttestation: HumanDispositionRecord["operatorAttestation"];
};

export type ActuationQueueItem =
  | { kind: "research_question"; artifact: ResearchQuestion }
  | { kind: "hypothesis_proposal"; artifact: HypothesisProposalArtifact }
  | { kind: "market_reasoning_proposal"; artifact: MarketReasoningProposal }
  | { kind: "promotion_proposal"; artifact: PromotionProposalArtifact };
