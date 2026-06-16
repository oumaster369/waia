/** Canonical spot symbol for MVP intelligence slice (HTX-style slash form). */
export const BTC_USDT = "BTC/USDT" as const;

export type InstrumentId = typeof BTC_USDT | string;

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
  permissionBlocked: "STRAT_MR_PERMISSION_BLOCKED",
  zscoreNeutral: "STRAT_MR_ZSCORE_NEUTRAL",
  strategyNotAllowed: "STRAT_MR_STRATEGY_NOT_ALLOWED",
} as const;

export type StrategySignal = {
  strategySignalId: string;
  strategyId: typeof MEAN_REVERSION_V0;
  strategyVersion: typeof MEAN_REVERSION_V0_VERSION;
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
};

export type EvaluationCycleResult = {
  features: FeatureSnapshot;
  msv: MsvEnvelope;
  signal: StrategySignal;
};
