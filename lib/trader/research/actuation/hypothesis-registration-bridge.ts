import type { HypothesisRegistrationBridge } from "@/lib/trader/research/human-review-bridge.types";
import type { MarketReasoningProposal } from "@/lib/trader/research/market-reasoning-proposal.types";
import type { RegisterHypothesisInput } from "@/lib/trader/mi/hypothesis.types";

export type HypothesisRegistrationDraft = {
  registerInput: RegisterHypothesisInput;
  sourceProposalDigest: string;
  reasoningSessionId: string;
  requiresOperatorAttestation: true;
};

export function createHypothesisRegistrationBridge(): HypothesisRegistrationBridge {
  return {
    buildRegistrationDraft(proposal: MarketReasoningProposal): HypothesisRegistrationDraft {
      const draft = proposal.proposalBody.recommendedNextHypothesis.mapsToMiRegisterHypothesisDraft;
      return {
        registerInput: {
          hypothesisKind: draft.hypothesisKind,
          name: draft.name,
          definition: draft.definition,
          supersedes: draft.supersedes,
          authoredBy: draft.authoredBy,
        },
        sourceProposalDigest: proposal.envelope.contentDigest,
        reasoningSessionId: proposal.envelope.reasoningSessionId,
        requiresOperatorAttestation: true,
      };
    },
  };
}
