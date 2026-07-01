import type { WaiaTraderTelemetrySink } from "@/lib/observability/waia-trader-telemetry";

/** Canonical spot symbol for MVP intelligence slice (HTX-style slash form). */
export const BTC_USDT = "BTC/USDT" as const;

export const ETH_USDT = "ETH/USDT" as const;

/** Pipeline P3 live ingestion symbols (Execution Program v2). */
export const P3_MARKET_BRAIN_SYMBOLS = [BTC_USDT, ETH_USDT] as const;

export type InstrumentId = typeof BTC_USDT | typeof ETH_USDT | string;

export type BarInterval = "1m";

export type Bar = {
  symbol: InstrumentId;
  interval: BarInterval;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  barOpenTime: string;
  barCloseTime: string;
};

export type Quote = {
  symbol: InstrumentId;
  bid: string;
  ask: string;
  last: string;
  timestamp: string;
};

export type FeatureVector = {
  close: string;
  sma20: string;
  zscoreVsSma20: string;
  realizedVol20: string;
  spreadBps: string;
};

export type FeatureSnapshot = {
  featureSetId: string;
  instrumentId: InstrumentId;
  evaluatedAt: string;
  features: FeatureVector;
  /** 0..1 — owned exclusively by Feature Engine (Master Spec §8.2). */
  dataQualityScore: number;
  inputs: {
    barCount: number;
    latestQuoteAgeMs?: number;
  };
};

export const regimeEnum = [
  "TREND_BULL",
  "TREND_BEAR",
  "RANGE",
  "CHOP",
  "STRESS",
  "PANIC",
  "LIQUIDITY_VACUUM",
  "EVENT_RISK",
  "LOW_EDGE",
  "UNKNOWN",
] as const;

export type Regime = (typeof regimeEnum)[number];

export const tradingPermissionEnum = [
  "ALLOW_TRADING",
  "ALLOW_REDUCED_RISK",
  "ONLY_CLOSE_POSITIONS",
  "STOP_TRADING",
  "PAPER_ONLY",
] as const;

export type TradingPermission = (typeof tradingPermissionEnum)[number];

export type MsvPhysicsBlock = {
  close: string;
  zscoreVsSma20: string;
  realizedVol20: string;
};

export type MsvLiquidityBlock = {
  spreadBps: string;
};

export type MsvCrowdBlock = {
  fearGreedIndex: null;
  newsSentiment: string;
};

export type MsvFutureContextBlock = {
  eventRiskScore: string;
};

export type MsvDerivedBlock = {
  regime: Regime;
  tradingPermission: TradingPermission;
  allowedStrategyIds: readonly string[];
  riskMultiplier: string;
  dataQualityScore: number;
  reasonCodes: readonly string[];
};

export type MsvEnvelope = {
  msvId: string;
  instrumentId: InstrumentId;
  evaluatedAt: string;
  featureSetId: string;
  physics: MsvPhysicsBlock;
  liquidity: MsvLiquidityBlock;
  crowd: MsvCrowdBlock;
  futureContext: MsvFutureContextBlock;
  derived: MsvDerivedBlock;
};

export const MEAN_REVERSION_V0 = "mean_reversion_v0" as const;
export const MEAN_REVERSION_V0_VERSION = "0.1.0" as const;

export const LIQUIDITY_SWEEP_REVERSAL_V0 = "liquidity_sweep_reversal_v0" as const;
export const LIQUIDITY_SWEEP_REVERSAL_V0_VERSION = "0.1.0" as const;

export const TREND_MOMENTUM_V0 = "trend_momentum_v0" as const;
export const TREND_MOMENTUM_V0_VERSION = "0.1.0" as const;

export type MvpStrategyId =
  | typeof MEAN_REVERSION_V0
  | typeof LIQUIDITY_SWEEP_REVERSAL_V0
  | typeof TREND_MOMENTUM_V0;

export type SignalOutcome = "SIGNAL" | "NO_SIGNAL";

export const featureReasonCodes = {
  insufficientBars: "FE_INSUFFICIENT_BARS",
  barGapDetected: "FE_BAR_GAP_DETECTED",
  staleQuote: "FE_STALE_QUOTE",
} as const;

export const cdeReasonCodes = {
  qualityPaperOnly: "CDE_QUALITY_PAPER_ONLY",
  qualityAllowTrading: "CDE_QUALITY_ALLOW_TRADING",
  regimeRange: "CDE_REGIME_RANGE",
  regimeTrendBear: "CDE_REGIME_TREND_BEAR",
  regimeUnknown: "CDE_REGIME_UNKNOWN",
} as const;

export const strategyReasonCodes = {
  zscoreBuy: "STRAT_MR_ZSCORE_BUY",
  zscoreSell: "STRAT_MR_ZSCORE_SELL",
  permissionBlocked: "STRAT_MR_PERMISSION_BLOCKED",
  zscoreNeutral: "STRAT_MR_ZSCORE_NEUTRAL",
  strategyNotAllowed: "STRAT_MR_STRATEGY_NOT_ALLOWED",
} as const;

export const trendMomentumReasonCodes = {
  momentumEntry: "STRAT_TM_MOMENTUM_ENTRY",
  momentumExit: "STRAT_TM_MOMENTUM_EXIT",
  permissionBlocked: "STRAT_TM_PERMISSION_BLOCKED",
  strategyNotAllowed: "STRAT_TM_STRATEGY_NOT_ALLOWED",
  regimeFlat: "STRAT_TM_REGIME_FLAT",
  zscoreNeutral: "STRAT_TM_ZSCORE_NEUTRAL",
} as const;

export const liquiditySweepReasonCodes = {
  sweepEntry: "STRAT_LSR_SWEEP_ENTRY",
  recoveryExit: "STRAT_LSR_RECOVERY_EXIT",
  permissionBlocked: "STRAT_LSR_PERMISSION_BLOCKED",
  strategyNotAllowed: "STRAT_LSR_STRATEGY_NOT_ALLOWED",
  noPattern: "STRAT_LSR_NO_PATTERN",
} as const;

export type StrategySignal = {
  strategySignalId: string;
  strategyId: MvpStrategyId;
  strategyVersion: string;
  organizationId: string;
  symbol: InstrumentId;
  outcome: SignalOutcome;
  side?: "buy" | "sell";
  confidence?: string;
  expectedEdge?: string;
  horizon?: "1h";
  maxRisk?: string;
  reasonCodes: readonly string[];
  msvId: string;
  featureSetId: string;
  evaluatedAt: string;
};

export type EvaluationCycleInput = {
  organizationId: string;
  bars: readonly Bar[];
  quote?: Quote;
  evaluatedAt?: string;
  newId?: () => string;
  telemetrySink?: WaiaTraderTelemetrySink;
};

export type EvaluationCycleResult = {
  features: FeatureSnapshot;
  msv: MsvEnvelope;
  /** All registered strategy evaluations for this cycle. */
  signals: StrategySignal[];
  /** Primary signal for backward-compatible paper loop wiring. */
  signal: StrategySignal;
};
