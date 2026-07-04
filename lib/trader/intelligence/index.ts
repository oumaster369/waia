export {
  computeFeatureSnapshot,
  FEATURE_ENGINE_QUALITY_THRESHOLD,
  DEFAULT_INSTRUMENT,
  featureQualityReasonCodes,
  isInsufficientBars,
  type ComputeFeatureSnapshotInput,
} from "@/lib/trader/intelligence/feature-engine-v0";
export {
  buildMsvEnvelope,
  QUALITY_PAPER_ONLY_THRESHOLD,
  type BuildMsvEnvelopeInput,
} from "@/lib/trader/intelligence/cde-v0";
export { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
export {
  DEFAULT_EXIT_INTELLIGENCE_RUN_CONFIG,
  EXIT_INTELLIGENCE_CONTEXT_SCHEMA_VERSION,
  buildExitIntelligenceContext,
  type BuildExitIntelligenceContextInput,
  type ExitIntelligenceContext,
  type ExitIntelligenceRunConfig,
} from "@/lib/trader/intelligence/m5";
export {
  emitDecisionReasonCodeCounter,
  emitMsvDecisionCounters,
  DECISION_COUNTER_CODES,
  type EmitDecisionReasonCodeCounterInput,
} from "@/lib/trader/intelligence/decision-telemetry";
export {
  emitStrategyReasonCodeCounter,
  emitStrategySignalCounters,
  STRATEGY_COUNTER_CODES,
  type EmitStrategyReasonCodeCounterInput,
} from "@/lib/trader/intelligence/strategy-telemetry";
export {
  evaluateMeanReversionV0,
  ZSCORE_BUY_THRESHOLD,
  ZSCORE_SELL_THRESHOLD,
} from "@/lib/trader/intelligence/strategies/mean-reversion-v0";
export { evaluateLiquiditySweepReversalV0 } from "@/lib/trader/intelligence/strategies/liquidity-sweep-reversal-v0";
export {
  evaluateRegisteredStrategies,
  getStrategyRegistryEntry,
  isMvpStrategyId,
  listMvpStrategyRegistry,
  resolveMvpStrategyAssignments,
  selectPrimaryStrategySignal,
  strategyLifecycleStates,
  type MvpStrategyId,
  type StrategyEvaluator,
  type StrategyEvaluatorContext,
  type StrategyLifecycleState,
  type StrategyRegistryEntry,
} from "@/lib/trader/intelligence/strategies/registry";
export {
  BTC_USDT,
  LIQUIDITY_SWEEP_REVERSAL_V0,
  LIQUIDITY_SWEEP_REVERSAL_V0_VERSION,
  MEAN_REVERSION_V0,
  MEAN_REVERSION_V0_VERSION,
  cdeReasonCodes,
  featureReasonCodes,
  liquiditySweepReasonCodes,
  regimeEnum,
  strategyReasonCodes,
  tradingPermissionEnum,
  type Bar,
  type BarInterval,
  type EvaluationCycleInput,
  type EvaluationCycleResult,
  type FeatureSnapshot,
  type FeatureVector,
  type InstrumentId,
  type MsvCrowdBlock,
  type MsvDerivedBlock,
  type MsvEnvelope,
  type MsvFutureContextBlock,
  type MsvLiquidityBlock,
  type MsvPhysicsBlock,
  type Quote,
  type Regime,
  type SignalOutcome,
  type StrategySignal,
  type TradingPermission,
} from "@/lib/trader/intelligence/types";
