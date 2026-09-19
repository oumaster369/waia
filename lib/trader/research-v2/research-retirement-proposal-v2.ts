import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { ClosedTradeOutcomeRecordV2 } from "@/lib/trader/research-v2/closed-trade-outcome-evidence-v2";
import type { RejectedCandidateRecordV2 } from "@/lib/trader/research-v2/qualification-records-v2";
import { queryContradictingResearchMemoryV2 } from "@/lib/trader/research-v2/research-memory-v2";
import type { ResearchMemoryV2 } from "@/lib/trader/research-v2/research-memory-v2";
import {
  requireResearchV2NonEmpty,
  StrategyEvolutionResearchError,
} from "@/lib/trader/research-v2/research-v2-guards";
import type { StrategyEvolutionCandidateV2 } from "@/lib/trader/research-v2/strategy-candidate-generation-v2";

export const RESEARCH_RETIREMENT_PROPOSAL_V2_SCHEMA =
  "waia.trader.research_retirement_proposal.v2" as const;

export type ResearchRetirementProposalV2 = Readonly<{
  schemaVersion: typeof RESEARCH_RETIREMENT_PROPOSAL_V2_SCHEMA;
  capitalAuthority: "NONE";
  liveDemotionAuthority: "NONE";
  approvalAuthority: "HUMAN_ONLY";
  disposition: "pending";
  proposalId: string;
  candidateDigestHex: string;
  rejectedRecordDigestHex: string;
  contradictingEvidence: readonly ClosedTradeOutcomeRecordV2[];
  humanOnlyApprovalStatement: string;
  contentDigestHex: string;
}>;

export function buildResearchRetirementProposalV2(input: {
  proposalId: string;
  candidate: StrategyEvolutionCandidateV2;
  memory: ResearchMemoryV2;
  rejectedRecord: RejectedCandidateRecordV2;
}): ResearchRetirementProposalV2 {
  requireResearchV2NonEmpty(input.proposalId, "RETIREMENT_PROPOSAL_INVALID");
  if (input.rejectedRecord.status !== "REJECTED" || !input.rejectedRecord.recorded) {
    throw new StrategyEvolutionResearchError("RETIREMENT_REQUIRES_REJECTED_CANDIDATE");
  }
  const contradictingEvidence = Object.freeze([
    ...queryContradictingResearchMemoryV2(input.memory),
  ]);
  const body = {
    schemaVersion: RESEARCH_RETIREMENT_PROPOSAL_V2_SCHEMA,
    capitalAuthority: "NONE" as const,
    liveDemotionAuthority: "NONE" as const,
    approvalAuthority: "HUMAN_ONLY" as const,
    disposition: "pending" as const,
    proposalId: input.proposalId,
    candidateDigestHex: input.candidate.contentDigestHex,
    rejectedRecordDigestHex: input.rejectedRecord.contentDigestHex,
    contradictingEvidence,
    humanOnlyApprovalStatement:
      "Retirement is Human-only. This proposal cannot demote a live strategy, mutate Risk, or write a venue.",
  };
  return Object.freeze({
    ...body,
    contentDigestHex: computeSemanticSha256Hex(body),
  });
}
