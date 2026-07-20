import { buildHypothesisDefinitionForProposal } from "@/lib/trader/research/evolution-cycle-mvp.types";
import type { ResearchRejectionRecord } from "@/lib/trader/research/research-rejection-record.types";
import type { ResearchQuestion } from "@/lib/trader/discovery/research-question.types";
import {
  HYPOTHESIS_PROPOSAL_SCHEMA_VERSION,
  type HypothesisProposalArtifact,
} from "@/lib/trader/discovery/hypothesis-proposal.types";
import { buildHypothesisProposalContentDigest } from "@/lib/trader/discovery/serialize-discovery";
import { assertNoBannedFields } from "@/lib/trader/discovery/no-reinforcement-guard";

export type HypothesisStudioInput = {
  organizationId: string;
  campaignId: string;
  researchQuestion: ResearchQuestion;
  rejectionContext?: ResearchRejectionRecord | null;
  strategyId: string;
  strategyVersion: string;
  candidateId?: string;
  proposalId: string;
  createdAt?: string;
};

function buildClaimText(strategyId: string, researchQuestion: ResearchQuestion): string {
  return (
    `${strategyId} hypothesis derived from research question ${researchQuestion.questionId}: ` +
    researchQuestion.questionText
  );
}

export function buildHypothesisProposalFromResearchQuestion(
  input: HypothesisStudioInput,
): HypothesisProposalArtifact {
  assertNoBannedFields(input.rejectionContext ?? {}, "rejectionContext");

  const missingBuckets = input.rejectionContext?.recordBody.missingBuckets ?? [];
  const candidateId =
    input.candidateId ?? input.rejectionContext?.recordBody.candidateId ?? input.proposalId;

  const hypothesisDefinition = buildHypothesisDefinitionForProposal({
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    candidateId,
    missingBuckets,
  });

  const draft: Omit<HypothesisProposalArtifact, "contentDigest"> = {
    schemaVersion: HYPOTHESIS_PROPOSAL_SCHEMA_VERSION,
    proposalId: input.proposalId,
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    researchQuestionRef: input.researchQuestion.questionId,
    claimText: buildClaimText(input.strategyId, input.researchQuestion),
    falsificationConditions: [...hypothesisDefinition.falsificationConditions],
    intendedRegimeScope: ["TREND_BEAR", "STRESS"],
    lineage: {
      priorCandidateId: input.rejectionContext?.recordBody.candidateId ?? null,
      priorStrategyId: input.rejectionContext?.recordBody.strategyId ?? input.strategyId,
      priorStrategyVersion:
        input.rejectionContext?.recordBody.strategyVersion ?? input.strategyVersion,
      parentHypothesisRef: null,
    },
    mapsToMiRegisterHypothesis: {
      hypothesisKind: "market_claim",
      name: `${input.strategyId} discovery proposal ${input.proposalId.slice(0, 8)}`,
      definition: hypothesisDefinition,
      supersedes: [],
      authoredBy: "discovery-hypothesis-studio",
    },
    createdAt: input.createdAt ?? new Date().toISOString(),
  };

  return {
    ...draft,
    contentDigest: buildHypothesisProposalContentDigest(draft),
  };
}

export type HypothesisStudioOutput = {
  researchQuestionRef: string;
  proposal: HypothesisProposalArtifact;
};

export function runHypothesisStudio(input: HypothesisStudioInput): HypothesisStudioOutput {
  const proposal = buildHypothesisProposalFromResearchQuestion(input);
  return {
    researchQuestionRef: input.researchQuestion.questionId,
    proposal,
  };
}
