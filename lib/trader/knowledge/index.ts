export type {
  ForecastDecisionLineageRow,
  HypothesisFamilyByRegime,
  MkbReadModelEntry,
  MkbReadModelQuery,
  MkbReadModelResult,
  MkbReadModelSnapshot,
  MkbSubjectKind,
  NoTradeObservation,
  OutcomeResolutionReadPort,
  OutcomeResolutionRow,
  OutcomeResolutionVerdict,
  PatternDiscoveryCandidate,
} from "@/lib/trader/knowledge/mkb-read-model.types";
export { MKB_READ_MODEL_SCHEMA_VERSION } from "@/lib/trader/knowledge/mkb-read-model.types";
export {
  MKB_KNOWLEDGE_STATES,
  MKB_STALE_AFTER_MS,
  MkbCapitalAuthorityError,
  assertNoCapitalAuthority,
  classifyForecastKnowledgeState,
  classifyKnowledgeEdgeState,
  classifyLegacyPredictionKnowledgeState,
  classifyMarketEventState,
  classifyNoTradeObservationState,
  classifyOutcomeVerdict,
  isForecastDecisionChainComplete,
  isObservationOnlyState,
  isVerifiedKnowledgeState,
} from "@/lib/trader/knowledge/mkb-knowledge-state";
export type { MkbKnowledgeState } from "@/lib/trader/knowledge/mkb-knowledge-state";
export type { MkbReadModelSource } from "@/lib/trader/knowledge/mkb-read-model-source";
export { createInMemoryMkbReadModelSource } from "@/lib/trader/knowledge/mkb-read-model-source";
export { createMkbReadModelSourcePostgres } from "@/lib/trader/knowledge/mkb-read-model-postgres";
export {
  computeLineageDigest,
  queryForecastDecisionLineage,
  queryHypothesisFamiliesByRegime,
  queryNoTradeObservations,
  queryPatternDiscoveryCandidates,
} from "@/lib/trader/knowledge/mkb-read-model-queries";
export {
  queryMkbReadModel,
  type QueryMkbReadModelDeps,
} from "@/lib/trader/knowledge/mkb-read-model";
export {
  compareWp15SemanticParity,
  runWp15MkbReadModelEvidenceHarness,
  writeWp15MkbReadModelEvidence,
} from "@/lib/trader/knowledge/mkb-read-model-evidence-harness";

export {
  MarketMemoryError,
  adjustEdgeConfidenceFromVerification,
  computeMarketPredictionDigest,
  recordMarketPrediction,
  queryMarketKnowledgeReadModel,
  updateEdgeConfidenceFromVerification,
  verifyMarketPredictionOutcome,
} from "@/lib/trader/knowledge/market-memory";

export type {
  KnowledgeEdge,
  MarketEvent,
  MarketPrediction,
  MarketPredictionVerificationResult,
} from "@/lib/trader/knowledge/knowledge.types";
