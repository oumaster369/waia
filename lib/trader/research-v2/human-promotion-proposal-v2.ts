import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { ClosedTradeOutcomeRecordV2 } from "@/lib/trader/research-v2/closed-trade-outcome-evidence-v2";
import type { FalsifiableHypothesisV2 } from "@/lib/trader/research-v2/research-question-hypothesis-v2";
import { FALSIFIABLE_HYPOTHESIS_V2_SCHEMA } from "@/lib/trader/research-v2/research-question-hypothesis-v2";
import type { QualificationRecordV2 } from "@/lib/trader/research-v2/qualification-records-v2";
import { assertQualificationPairForCandidateV2 } from "@/lib/trader/research-v2/qualification-records-v2";
import type { ResearchMemoryV2 } from "@/lib/trader/research-v2/research-memory-v2";
import { queryContradictingResearchMemoryV2 } from "@/lib/trader/research-v2/research-memory-v2";
import type { StrategyEvolutionCandidateV2 } from "@/lib/trader/research-v2/strategy-candidate-generation-v2";
import { promoteStrategyCandidateV2 } from "@/lib/trader/research-v2/strategy-candidate-generation-v2";
import {
  assertResearchV2ContentDigest,
  StrategyEvolutionResearchError,
} from "@/lib/trader/research-v2/research-v2-guards";

export const HUMAN_PROMOTION_PROPOSAL_V2_SCHEMA =
  "waia.trader.human_promotion_proposal.v2" as const;

export type HumanPromotionProposalV2 = Readonly<{
  schemaVersion: typeof HUMAN_PROMOTION_PROPOSAL_V2_SCHEMA;
  capitalAuthority: "NONE";
  promotionAuthority: "NONE";
  accountAssignmentAuthority: "NONE";
  approvalAuthority: "HUMAN_ONLY";
  disposition: "pending";
  humanApprovalRequired: true;
  humanOnlyApprovalStatement: string;
  proposalId: string;
  candidateDigestHex: string;
  hypothesisDigestHex: string;
  developmentDigestHex: string;
  walkForwardDigestHex: string;
  positiveEvidence: readonly ClosedTradeOutcomeRecordV2[];
  negativeEvidence: readonly ClosedTradeOutcomeRecordV2[];
  proposedEligibleSymbols: readonly string[];
  proposedAccountAssignments: readonly [];
  contentDigestHex: string;
}>;

export function buildHumanPromotionProposalV2(input: {
  proposalId: string;
  candidate: StrategyEvolutionCandidateV2;
  hypothesis: FalsifiableHypothesisV2;
  memory: ResearchMemoryV2;
  development: QualificationRecordV2;
  walkForward: QualificationRecordV2;
}): HumanPromotionProposalV2 {
  if (input.candidate.promotionAuthority !== "NONE") {
    promoteStrategyCandidateV2(input.candidate);
  }
  assertQualificationPairForCandidateV2(input);
  assertResearchV2ContentDigest(input.hypothesis, "PROMOTION_HYPOTHESIS_INVALID");
  if (
    input.hypothesis.schemaVersion !== FALSIFIABLE_HYPOTHESIS_V2_SCHEMA ||
    input.hypothesis.capitalAuthority !== "NONE"
  ) {
    throw new StrategyEvolutionResearchError("PROMOTION_HYPOTHESIS_INVALID");
  }
  if (input.candidate.lineage.hypothesisDigestHex !== input.hypothesis.contentDigestHex) {
    throw new StrategyEvolutionResearchError("PROMOTION_HYPOTHESIS_MISMATCH");
  }
  if (input.development.verdict !== "QUALIFIED" || input.walkForward.verdict !== "QUALIFIED") {
    throw new StrategyEvolutionResearchError("PROMOTION_REQUIRES_QUALIFIED_PARTITIONS");
  }
  const positiveEvidence = Object.freeze(
    input.memory.records.filter((record) => record.evaluationRole === "SUPPORTING"),
  );
  const negativeEvidence = Object.freeze([...queryContradictingResearchMemoryV2(input.memory)]);
  if (positiveEvidence.length === 0) {
    throw new StrategyEvolutionResearchError("PROMOTION_POSITIVE_EVIDENCE_REQUIRED");
  }
  if (negativeEvidence.length === 0) {
    throw new StrategyEvolutionResearchError("PROMOTION_NEGATIVE_EVIDENCE_REQUIRED");
  }

  const body = {
    schemaVersion: HUMAN_PROMOTION_PROPOSAL_V2_SCHEMA,
    capitalAuthority: "NONE" as const,
    promotionAuthority: "NONE" as const,
    accountAssignmentAuthority: "NONE" as const,
    approvalAuthority: "HUMAN_ONLY" as const,
    disposition: "pending" as const,
    humanApprovalRequired: true as const,
    humanOnlyApprovalStatement:
      "Approval is Human-only. This proposal cannot self-promote, assign an account, or open a live or paper capital path.",
    proposalId: input.proposalId,
    candidateDigestHex: input.candidate.contentDigestHex,
    hypothesisDigestHex: input.hypothesis.contentDigestHex,
    developmentDigestHex: input.development.contentDigestHex,
    walkForwardDigestHex: input.walkForward.contentDigestHex,
    positiveEvidence,
    negativeEvidence,
    proposedEligibleSymbols: Object.freeze([input.hypothesis.intendedSymbol]),
    proposedAccountAssignments: Object.freeze([]) as readonly [],
  };
  return Object.freeze({
    ...body,
    contentDigestHex: computeSemanticSha256Hex(body),
  });
}
