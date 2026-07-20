import type { EvolutionCycleMvp } from "@/lib/trader/research/evolution-cycle-mvp.types";
import type { EvolutionCycleMvpKnowledgeNeed } from "@/lib/trader/research/evolution-cycle-mvp.types";
import type { EvolutionCycleMvpResearchQuestion } from "@/lib/trader/research/evolution-cycle-mvp.types";
import type { ResearchRejectionRecord } from "@/lib/trader/research/research-rejection-record.types";
import type { ResearchValidationMetrics } from "@/lib/trader/research/strategy-candidate.types";

export const REASONING_CONTEXT_SCHEMA_VERSION = "waia.trader.reasoning-context.v1" as const;

export type ReasoningContextAvailability = "loaded" | "not_loaded";

export type ReasoningContextWalkForwardSummary = {
  windowCount: number;
  availability: ReasoningContextAvailability;
};

export type ReasoningContextBlindValidationSummary = {
  blindConsumed: boolean;
  blindMetrics: ResearchValidationMetrics;
  availability: ReasoningContextAvailability;
};

export type ReasoningContextStrategyMetadata = {
  strategyId: string;
  strategyVersion: string;
  availability: ReasoningContextAvailability;
};

export type ReasoningContextCandidateLineage = {
  candidateId: string;
  priorStrategyId: string;
  priorStrategyVersion: string;
  availability: ReasoningContextAvailability;
};

export type ReasoningContextBody = {
  rejectionRecord: ResearchRejectionRecord;
  evolutionCycle: EvolutionCycleMvp;
  validationMetrics: ResearchValidationMetrics;
  walkForwardSummary: ReasoningContextWalkForwardSummary;
  blindValidationSummary: ReasoningContextBlindValidationSummary;
  strategyMetadata: ReasoningContextStrategyMetadata;
  candidateLineage: ReasoningContextCandidateLineage;
  previousRejections: readonly [];
  previousHypotheses: readonly [];
  knowledgeNeeds: EvolutionCycleMvpKnowledgeNeed[];
  researchQuestions: EvolutionCycleMvpResearchQuestion[];
  productionKnowledgeAssets: readonly [];
  marketKnowledge: readonly [];
  marketStatistics: null;
  chartSnapshots: readonly [];
};

export type ReasoningContextSourceArtifactDigests = {
  rejectionRecord: string;
  evolutionCycle: string;
};

export type ReasoningContextEnvelope = {
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  candidateId: string;
  reasoningSessionId: string;
  assembledAt: string;
  contentDigest: string;
  sourceArtifactDigests: ReasoningContextSourceArtifactDigests;
};

export type ReasoningContext = {
  schemaVersion: typeof REASONING_CONTEXT_SCHEMA_VERSION;
  envelope: ReasoningContextEnvelope;
  contextBody: ReasoningContextBody;
};

export type AssembleReasoningContextInput = {
  rejectionRecord: ResearchRejectionRecord;
  evolutionCycle: EvolutionCycleMvp;
  assembledAt?: string;
  reasoningSessionId: string;
};
