import type { ResearchRegimeCoverage } from "@/lib/trader/research/research-evidence-export.types";
import type { BarInterval, InstrumentId } from "@/lib/trader/intelligence/types";

export const PRODUCTION_KNOWLEDGE_ASSET_SCHEMA_VERSION =
  "waia.trader.production-knowledge-asset.v1" as const;

export const KNOWLEDGE_CLASSES = ["regime_strategy_validation"] as const;
export type KnowledgeClass = (typeof KNOWLEDGE_CLASSES)[number];

export const PKA_CREATION_REASONS = [
  "research_pipeline_blind_validated",
  "research_pipeline_validation_failed",
] as const;
export type PkaCreationReason = (typeof PKA_CREATION_REASONS)[number];

export const PKA_LIFECYCLE_STATES = ["creation", "maturation"] as const;
export type PkaLifecycleState = (typeof PKA_LIFECYCLE_STATES)[number];

export type KnowledgeDomain = {
  instrument: InstrumentId;
  interval: BarInterval;
  venue: string;
};

export type StrategyRef = {
  strategyId: string;
  strategyVersion: string;
  paramsDigest: string;
};

export type EvidenceRef = {
  contentDigest: string;
  datasetId: string;
  backtestRunId: string;
  strategyCandidateId: string;
  blindValidationResultId: string;
};

export type ProvenanceChainEntry = {
  kind: string;
  id: string;
};

export type DatasetLineage = {
  source: "htx" | "trader_market_bars";
  symbol: InstrumentId;
  interval: BarInterval;
  barCount: number;
  barSetDigest: string;
  trainDigest: string;
  validationDigest: string;
  blindDigest: string;
  builderGitSha: string | null;
};

export type ValidationHistorySummary = {
  walkForwardWindowCount: number;
  blindHoldoutTradeCount: number;
  blindHoldoutRegimeLabels: string[];
};

export type ConfidenceMetadata = {
  edgeConfidence: string;
  edgeStrength: string;
  edgeVerified: boolean;
};

export type EvolutionMetadata = {
  lifecycleState: PkaLifecycleState;
  knowledgeNeed: null;
  evolutionProposal: null;
  supersedesKnowledgeId: string | null;
};

export type MkbLinkage = {
  marketEventId: string;
  knowledgeEdgeId: string;
};

/** Immutable sealed knowledge artifact — never mutate after assembly (Constitution §5.3). */
export type ProductionKnowledgeAsset = {
  schemaVersion: typeof PRODUCTION_KNOWLEDGE_ASSET_SCHEMA_VERSION;
  knowledgeId: string;
  knowledgeClass: KnowledgeClass;
  knowledgeDomain: KnowledgeDomain;
  creationReason: PkaCreationReason;
  supersedesKnowledgeId: string | null;
  strategyRef: StrategyRef;
  sealedAt: string;
  reproducibilityDigest: string;
  evidenceRef: EvidenceRef;
  provenanceChain: readonly ProvenanceChainEntry[];
  datasetLineage: DatasetLineage;
  regimeCoverage: ResearchRegimeCoverage;
  validationHistory: ValidationHistorySummary;
  confidenceMetadata: ConfidenceMetadata;
  invalidationConditions: readonly string[];
  evolutionMetadata: EvolutionMetadata;
  mkbLinkage: MkbLinkage;
};

export const HUMAN_KNOWLEDGE_DISPOSITION_SCHEMA_VERSION =
  "waia.trader.human-knowledge-disposition.v1" as const;

export const RESEARCH_CONFIDENCE_BANDS = [
  "speculative",
  "preliminary",
  "solid",
  "compelling",
] as const;
export type ResearchConfidenceBand = (typeof RESEARCH_CONFIDENCE_BANDS)[number];

/** Human-authored disposition — separate from immutable PKA (Gate 1). */
export type HumanKnowledgeDisposition = {
  schemaVersion: typeof HUMAN_KNOWLEDGE_DISPOSITION_SCHEMA_VERSION;
  knowledgeId: string;
  researchConfidenceBand: ResearchConfidenceBand;
  dispositionAt: string;
  dispositionBy: string;
  rationale: string;
};
