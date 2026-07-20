import type { RegisterHypothesisInput } from "@/lib/trader/mi/hypothesis.types";

export const HYPOTHESIS_PROPOSAL_SCHEMA_VERSION =
  "waia.trader.discovery-hypothesis-proposal.v1" as const;

export type HypothesisProposalLineage = {
  priorCandidateId: string | null;
  priorStrategyId: string | null;
  priorStrategyVersion: string | null;
  parentHypothesisRef: string | null;
};

export type HypothesisProposalArtifact = {
  schemaVersion: typeof HYPOTHESIS_PROPOSAL_SCHEMA_VERSION;
  proposalId: string;
  organizationId: string;
  campaignId: string;
  /** Required parent — hypotheses must trace to a Research Question. */
  researchQuestionRef: string;
  claimText: string;
  falsificationConditions: readonly string[];
  intendedRegimeScope: readonly string[];
  lineage: HypothesisProposalLineage;
  mapsToMiRegisterHypothesis: RegisterHypothesisInput;
  contentDigest: string;
  createdAt: string;
};

export type CandidateProposal = {
  candidateId: string;
  strategyId: string;
  strategyVersion: string;
  hypothesisProposalRef: string;
  synthesisRef: string;
  paramsJson: string;
  contentDigest: string;
};
