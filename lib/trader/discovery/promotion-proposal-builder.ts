import {
  PROMOTION_PROPOSAL_SCHEMA_VERSION,
  type PromotionProposalArtifact,
  type PromotionRecommendation,
} from "@/lib/trader/discovery/comparison.types";
import type { CandidateComparatorResult } from "@/lib/trader/discovery/comparison.types";
import { buildPromotionProposalContentDigest } from "@/lib/trader/discovery/serialize-discovery";
import { assertNoBannedFields } from "@/lib/trader/discovery/no-reinforcement-guard";
import { compareDecimal } from "@/lib/trader/risk/numeric";

export type BuildPromotionProposalInput = {
  organizationId: string;
  campaignId: string;
  candidateId: string;
  comparison: CandidateComparatorResult;
  proposalId: string;
  createdAt?: string;
};

function resolveRecommendation(
  comparison: CandidateComparatorResult,
  candidateId: string,
): PromotionRecommendation {
  const entry = comparison.ranked.find((row) => row.candidateRef === candidateId);
  if (!entry) {
    return "defer";
  }
  if (compareDecimal(entry.aggregateRankScore, "0.50") >= 0) {
    return "human_review";
  }
  if (compareDecimal(entry.aggregateRankScore, "0.10") < 0) {
    return "reject";
  }
  return "defer";
}

/** Recommend-only artifact — never emits "promote". */
export function buildPromotionProposal(
  input: BuildPromotionProposalInput,
): PromotionProposalArtifact {
  assertNoBannedFields(input.comparison, "comparison");

  const recommends = resolveRecommendation(input.comparison, input.candidateId);
  const draft: Omit<PromotionProposalArtifact, "contentDigest"> = {
    schemaVersion: PROMOTION_PROPOSAL_SCHEMA_VERSION,
    proposalId: input.proposalId,
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    candidateId: input.candidateId,
    comparisonDigest: input.comparison.comparisonDigest,
    humanGateRequired: true,
    recommends,
    rationale:
      recommends === "human_review"
        ? "Epistemic dimensions meet review threshold — operator disposition required."
        : recommends === "reject"
          ? "Epistemic dimensions below minimum threshold — defer or archive."
          : "Insufficient epistemic signal — defer human review.",
    createdAt: input.createdAt ?? new Date().toISOString(),
  };

  return {
    ...draft,
    contentDigest: buildPromotionProposalContentDigest(draft),
  };
}
