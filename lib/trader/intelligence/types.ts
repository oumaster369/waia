import type { WaiaTraderTelemetrySink } from "@/lib/observability/waia-trader-telemetry";
import type {
  CrossVenueAgreement,
  MarketUnderstandingSnapshot,
  MtfAlignment,
  RegimeHint,
  SpotPosture,
} from "@/lib/trader/intelligence/market-understanding.types";
import type { FusedMarketContext } from "@/lib/trader/market-data/observation-types";
import type {
  DecisionChain,
  HypothesisSessionState,
  MarketStateSnapshot,
} from "@/lib/trader/intelligence/mi-core.types";
import type { ReconstructionSnapshot } from "@/lib/trader/intelligence/reconstruction/reconstruction.types";
import type { HypothesisSet } from "@/lib/trader/intelligence/hypothesis/hypothesis.types";
import type { HistoricalIntelligenceProfile } from "@/lib/trader/intelligence/historical-profile/historical-profile.types";
import type { IntelligenceCycleBundle } from "@/lib/trader/intelligence/records/intelligence-records.types";
import type { ForecastDecisionBundle } from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import type { InformationSufficiencyRuntimeAuthorityV2 } from "@/lib/trader/intelligence/information-sufficiency";
import type { CostModelV1 } from "@/lib/trader/execution/cost-model";

/** Canonical spot symbol for MVP intelligence slice (HTX-style slash form). */
export const BTC_USDT = "BTC/USDT" as const;

export const ETH_USDT = "ETH/USDT" as const;

/** Pipeline P3 live ingestion symbols (Execution Program v2). */
export const P3_MARKET_BRAIN_SYMBOLS = [BTC_USDT, ETH_USDT] as const;

export type InstrumentId = typeof BTC_USDT | typeof ETH_USDT | string;

export type BarInterval = "1m" | "15m" | "1h" | "4h" | "1d";

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
  /** @deprecated Use priceDispersion20 — legacy price-level std mislabeled as vol */
  realizedVol20: string;
  /** Price-level sample std over SMA window (not log-return RV). */
  priceDispersion20?: string;
  /** Sum of squared 1m log returns over PIT window (t-20m, t]; UNAVAILABLE if gaps. */
  realizedVar20m_1m?: string;
  /** sqrt(realizedVar20m_1m); no demeaning, no annualization. */
  realizedVol20m_1m?: string;
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
  fearGreedIndex: number | null;
  newsSentiment: string | null;
};

export type MsvFutureContextBlock = {
  eventRiskScore: string;
  sessionPhase?: string;
  asianRangeCorridorPresent?: boolean;
};

export type MsvDerivedBlock = {
  regime: Regime;
  tradingPermission: TradingPermission;
  allowedStrategyIds: readonly string[];
  riskMultiplier: string;
  dataQualityScore: number;
  reasonCodes: readonly string[];
  /** PR-2 MI Core: active hypothesis conviction (0..1). */
  conviction?: number;
  /** PR-2 MI Core: opportunity authorized this cycle. */
  opportunityAuthorized?: boolean;
  /** PR-2 MI Core: active hypothesis type. */
  activeHypothesisType?: string | null;
  /** PR-2 MI Core: eligible strategy families from hypothesis engine. */
  eligibleStrategyFamilies?: readonly string[];
};

export type MsvUnderstandingBlock = {
  regimeHint: RegimeHint;
  mtfAlignment: MtfAlignment;
  spotPosture: SpotPosture;
  crossVenueAgreement: CrossVenueAgreement;
  understandingConfidence: number;
  postureRationale: readonly string[];
  knowledgeGapCount: number;
  dataQualitySufficient: boolean;
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
  understanding?: MsvUnderstandingBlock;
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
  providerDegraded: "CDE_PROVIDER_DEGRADED",
  fusedContextReduced: "CDE_FUSED_CONTEXT_REDUCED",
  understandingNoTrade: "CDE_UNDERSTANDING_NO_TRADE",
  understandingWait: "CDE_UNDERSTANDING_WAIT",
  understandingReducedRisk: "CDE_UNDERSTANDING_REDUCED_RISK",
  understandingPreserveCapital: "CDE_UNDERSTANDING_PRESERVE_CAPITAL",
  understandingCrossVenueConflict: "CDE_UNDERSTANDING_CROSS_VENUE_CONFLICT",
  understandingKnowledgeGap: "CDE_UNDERSTANDING_KNOWLEDGE_GAP",
  understandingDataInsufficient: "CDE_UNDERSTANDING_DATA_INSUFFICIENT",
  understandingStressed: "CDE_UNDERSTANDING_STRESSED",
  newsSentimentDeferredPr3: "NEWS_SENTIMENT_DEFERRED_PR3",
  /** PR-2 MI Core conviction path */
  convictionAllowTrading: "MI_CDE_CONVICTION_ALLOW_TRADING",
  convictionAllowReducedRisk: "MI_CDE_CONVICTION_ALLOW_REDUCED_RISK",
  truthfulHealthDegradedOk: "MI_CDE_TRUTHFUL_HEALTH_DEGRADED_OK",
  truthfulHealthSufficient: "MI_CDE_TRUTHFUL_HEALTH_SUFFICIENT",
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
  /** Exact registered semver; no alias/latest substitution (HTR-WP16 version pin). */
  strategyVersion: string;
  organizationId: string;
  symbol: InstrumentId;
  outcome: SignalOutcome;
  /** Raw evaluator outcome before trade-eligibility projection (D-2 research-only consumers). */
  researchEvaluationOutcome?: SignalOutcome;
  /** Whether this signal may participate in trade-eligible primary selection. */
  tradeEligible?: boolean;
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
  /** Account scope authenticated by the DEE-621 information-sufficiency receipt. */
  accountId?: string | null;
  bars: readonly Bar[];
  quote?: Quote;
  evaluatedAt?: string;
  newId?: () => string;
  telemetrySink?: WaiaTraderTelemetrySink;
  fusedContext?: FusedMarketContext;
  /** PR-2 MI Core: explicit flag override (defaults to WAIA_MI_CORE_ENABLED env). */
  miCoreEnabled?: boolean;
  /** PR-2 MI Core: within-session conviction state (caller-owned). */
  hypothesisSessionState?: HypothesisSessionState;
  /** HTR-WP09: prebuilt incremental reconstruction from canvas view (skips full recompute). */
  reconstruction?: ReconstructionSnapshot;
  /** HTR-WP13: explicit historical intelligence profile (never global default). */
  historicalProfile?: HistoricalIntelligenceProfile;
  /** HTR-WP13: run identifier for intelligence records. */
  runId?: string;
  /** HTR-WP13: cycle identifier for intelligence records. */
  cycleId?: string;
  /** HTR-WP13: symbol for intelligence records (defaults to bar symbol). */
  symbol?: string;
  /** HTR-WP14: cost model for net-economics fail-closed decision records. */
  costModel?: CostModelV1;
  /** DEE-621: exact receipt authority or explicit research-only declaration. Omission fails closed. */
  informationSufficiencyAuthority?: InformationSufficiencyRuntimeAuthorityV2;
  /**
   * IDHPS STREAM_ONLY hot path: skip WP13/WP14 artifact assembly when no sinks consume them.
   * Does not alter MSV/signals/hypothesis economics.
   */
  omitIntelligenceArtifacts?: boolean;
  /** When set, only these strategy ids are evaluated (others omitted before signal selection). */
  strategySignalIds?: readonly string[];
};

export type EvaluationCycleResult = {
  features: FeatureSnapshot;
  msv: MsvEnvelope;
  /** All registered strategy evaluations for this cycle. */
  signals: StrategySignal[];
  /** Primary signal for backward-compatible paper loop wiring. */
  signal: StrategySignal;
  fusedContext?: FusedMarketContext;
  understanding?: MarketUnderstandingSnapshot;
  /** PR-2 MI Core outputs (present only when miCoreEnabled). */
  reconstruction?: ReconstructionSnapshot;
  hypothesisSet?: HypothesisSet;
  marketStateSnapshot?: MarketStateSnapshot;
  decisionChain?: DecisionChain;
  hypothesisSessionState?: HypothesisSessionState;
  /** HTR-WP13: intelligence cycle bundle when historical profile active. */
  intelligenceCycleBundle?: IntelligenceCycleBundle;
  /** HTR-WP14: forecast-decision bundle when historical profile active. */
  forecastDecisionBundle?: ForecastDecisionBundle;
};
