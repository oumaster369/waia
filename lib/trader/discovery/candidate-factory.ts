import { createHash } from "node:crypto";

import type { HypothesisProposalArtifact } from "@/lib/trader/discovery/hypothesis-proposal.types";
import type { CandidateProposal } from "@/lib/trader/discovery/hypothesis-proposal.types";
import type { StrategySynthesisOutput } from "@/lib/trader/generator/generator.types";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import { assertNoBannedFields } from "@/lib/trader/discovery/no-reinforcement-guard";

export type CandidateFactoryInput = {
  hypothesisProposal: HypothesisProposalArtifact;
  synthesis: StrategySynthesisOutput;
  candidateId: string;
};

function buildCandidateProposalDigest(input: {
  candidateId: string;
  strategyId: string;
  strategyVersion: string;
  hypothesisProposalRef: string;
  synthesisRef: string;
  paramsJson: string;
}): string {
  return createHash("sha256").update(canonicalJsonString(input), "utf8").digest("hex");
}

export function buildCandidateProposal(input: CandidateFactoryInput): CandidateProposal {
  assertNoBannedFields(input.synthesis, "strategySynthesis");

  const draft = {
    candidateId: input.candidateId,
    strategyId: input.synthesis.strategyId,
    strategyVersion: input.synthesis.strategyVersion,
    hypothesisProposalRef: input.hypothesisProposal.proposalId,
    synthesisRef: input.synthesis.synthesisId,
    paramsJson: input.synthesis.paramsJson,
  };

  return {
    ...draft,
    contentDigest: buildCandidateProposalDigest(draft),
  };
}
