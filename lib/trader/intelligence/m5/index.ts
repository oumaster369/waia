export {
  EXIT_INTELLIGENCE_CONTEXT_SCHEMA_VERSION,
  DEFAULT_EXIT_INTELLIGENCE_RUN_CONFIG,
  type ExitIntelligenceContext,
  type ExitIntelligenceConflictAnalysis,
  type ExitIntelligenceLayerSummary,
  type ExitIntelligenceRegimeContext,
  type ExitIntelligenceRunConfig,
  type ExitIntelligenceScores,
} from "@/lib/trader/intelligence/m5/exit-intelligence-types";

export {
  buildExitIntelligenceContext,
  type BuildExitIntelligenceContextInput,
} from "@/lib/trader/intelligence/m5/exit-intelligence-context";

export {
  buildRegimeContext,
  collectStrategySignalRefs,
  computeAnalyticalScores,
  computeConflictScore,
  computeExitPressureScore,
  computeRiskAlignmentScore,
  summarizeLayerState,
} from "@/lib/trader/intelligence/m5/exit-intelligence-scores";

export {
  buildExplanation,
  detectCrossLayerConflicts,
  exitIntelligenceConflictTags,
} from "@/lib/trader/intelligence/m5/exit-intelligence-conflicts";
