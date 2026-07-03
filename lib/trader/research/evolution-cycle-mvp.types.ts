import type { HypothesisDefinition } from "@/lib/trader/mi/hypothesis.types";
import type { RegisterHypothesisInput } from "@/lib/trader/mi/hypothesis.types";
import type { RejectionMissingBucket } from "@/lib/trader/research/research-rejection-record.types";

import type { ResearchRejectionRecord } from "@/lib/trader/research/research-rejection-record.types";

export const EVOLUTION_CYCLE_MVP_SCHEMA_VERSION = "waia.trader.evolution-cycle-mvp.v1" as const;

export type KnowledgeNeedType =
  | "missing_regime_context"
  | "insufficient_sample"
  | "unresolved_pattern";

export type EvolutionCycleMvpEnvelope = {
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  sourceOutcomeKind: "rejected" | "qualified";
  sourceRejectionDigest: string | null;
  contentDigest: string;
};

export type EvolutionCycleMvpObservation = {
  observedRegimes: string[];
  missingBuckets: RejectionMissingBucket[];
  blindConsumed: boolean;
  failureCode: string | null;
  candidateId: string;
};

export type EvolutionCycleMvpResearchQuestion = {
  questionText: string;
  researchProgram: string;
  status: "open";
};

export type EvolutionCycleMvpKnowledgeNeed = {
  needType: KnowledgeNeedType;
  severity: "high" | "medium" | "low";
  statement: string;
  evidenceRefs: string[];
};

export type EvolutionCycleMvpHypothesisLineage = {
  priorCandidateId: string;
  priorStrategyId: string;
  priorStrategyVersion: string;
};

export type EvolutionCycleMvpHypothesisProposal = {
  claimText: string;
  falsificationConditions: string[];
  intendedRegimeScope: string[];
  lineage: EvolutionCycleMvpHypothesisLineage;
  mapsToMiRegisterHypothesis: RegisterHypothesisInput;
};

export type EvolutionCycleMvpHumanReview = {
  disposition: "pending";
  reviewChecklist: string[];
  nextSteps: string[];
};

export type EvolutionCycleMvpBody = {
  observation: EvolutionCycleMvpObservation;
  researchQuestion: EvolutionCycleMvpResearchQuestion;
  knowledgeNeed: EvolutionCycleMvpKnowledgeNeed;
  hypothesisProposal: EvolutionCycleMvpHypothesisProposal;
  humanReview: EvolutionCycleMvpHumanReview;
};

export type EvolutionCycleMvp = {
  schemaVersion: typeof EVOLUTION_CYCLE_MVP_SCHEMA_VERSION;
  envelope: EvolutionCycleMvpEnvelope;
  cycleBody: EvolutionCycleMvpBody;
};

export type BuildEvolutionCycleMvpInput = {
  rejectionRecord: ResearchRejectionRecord;
};

/** Exported for tests — maps strategyId to research program label. */
export const RESEARCH_PROGRAM_BY_STRATEGY: Record<string, string> = {
  mean_reversion_v0: "mean_reversion_research_program",
  trend_momentum_v0: "trend_following_research_program",
};

export type HypothesisProposalTemplateContext = {
  strategyId: string;
  strategyVersion: string;
  candidateId: string;
  missingBuckets: RejectionMissingBucket[];
};

export function buildHypothesisDefinitionForProposal(
  context: HypothesisProposalTemplateContext,
): HypothesisDefinition {
  return {
    claimShape: {
      relationshipType: "predictive",
      isDirectional: true,
      isTrendEdge: false,
      isTimingEdge: true,
    },
    prior: {
      ordinal: "speculative",
      band: "low",
    },
    falsificationConditions: [
      "No trade-attributed activity in TREND_BEAR or STRESS over the sealed evaluation window after explicit down-regime gate activation.",
      "Net attribution in down regimes is non-positive after modeled costs.",
    ],
    requiredNulls: ["always-flat-cash"],
    patternRefs: [],
    measurementRefs: [],
    regimeScope: {
      description: "TREND_BEAR and STRESS regimes on BTC/USDT 1m sealed research dataset",
      notes: `Derived from campaign rejection for ${context.strategyId}@${context.strategyVersion}`,
    },
  };
}
