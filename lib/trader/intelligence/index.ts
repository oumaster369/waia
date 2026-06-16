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
} from "@/lib/trader/intelligence/strategies/mean-reversion-v0";
export {
  BTC_USDT,
  MEAN_REVERSION_V0,
  MEAN_REVERSION_V0_VERSION,
  cdeReasonCodes,
  featureReasonCodes,
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
