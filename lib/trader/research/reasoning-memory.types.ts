export type ReasoningMemoryAvailability = "empty" | "partial" | "loaded";

export type ReasoningMemoryRef = {
  contentDigest: string;
  schemaVersion: string;
  recordedAt: string;
};

export type ReasoningMemory = {
  readonly snapshotId: string;
  readonly availability: ReasoningMemoryAvailability;
  readonly assembledAt: string;
  acceptedHypotheses: readonly ReasoningMemoryRef[];
  rejectedHypotheses: readonly ReasoningMemoryRef[];
  previousProposals: readonly ReasoningMemoryRef[];
  previousEvolutionCycles: readonly ReasoningMemoryRef[];
  productionKnowledgeAssets: readonly ReasoningMemoryRef[];
  historicalFailures: readonly ReasoningMemoryRef[];
  validatedMarketKnowledge: readonly ReasoningMemoryRef[];
};

export const EMPTY_REASONING_MEMORY_SNAPSHOT_ID = "empty" as const;

export const emptyReasoningMemory: ReasoningMemory = {
  snapshotId: EMPTY_REASONING_MEMORY_SNAPSHOT_ID,
  availability: "empty",
  assembledAt: "1970-01-01T00:00:00.000Z",
  acceptedHypotheses: [],
  rejectedHypotheses: [],
  previousProposals: [],
  previousEvolutionCycles: [],
  productionKnowledgeAssets: [],
  historicalFailures: [],
  validatedMarketKnowledge: [],
};
