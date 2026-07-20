/** Stable trade-abuse reason codes (Master Spec §13). */
export const tradeAbuseReasonCodes = {
  symbolNotAllowed: "RISK_SYMBOL_NOT_ALLOWED",
  maxNotionalExceeded: "RISK_MAX_NOTIONAL_EXCEEDED",
  orderRateExceeded: "RISK_ORDER_RATE_EXCEEDED",
  priceCollarBreached: "RISK_PRICE_COLLAR_BREACHED",
} as const;

/** Stable capital-limits reason codes (Master Spec §13). */
export const capitalReasonCodes = {
  sellExceedsOpenQuantity: "RISK_SELL_EXCEEDS_OPEN_QUANTITY",
  maxPositionPerSymbolExceeded: "RISK_MAX_POSITION_PER_SYMBOL",
  maxDailyLossExceeded: "RISK_MAX_DAILY_LOSS",
  maxDrawdownExceeded: "RISK_MAX_DRAWDOWN",
  maxOpenOrdersExceeded: "RISK_MAX_OPEN_ORDERS",
  maxQuoteExposureExceeded: "RISK_MAX_QUOTE_EXPOSURE",
  maxConcurrentPositionsExceeded: "RISK_MAX_CONCURRENT_POSITIONS",
  maxPortfolioRiskExceeded: "RISK_MAX_PORTFOLIO_RISK",
  insufficientAvailableBalance: "RISK_INSUFFICIENT_AVAILABLE_BALANCE",
  invalidStopDistance: "RISK_INVALID_STOP_DISTANCE",
} as const;

/** HTR-WP16 D-20 drawdown policy reason codes. */
export const drawdownReasonCodes = {
  accountDrawdown: "RISK_D20_ACCOUNT_DRAWDOWN",
  monthlyDrawdown: "RISK_D20_MONTHLY_DRAWDOWN",
  strategyDrawdown: "RISK_D20_STRATEGY_DRAWDOWN",
} as const;

export const strategyGateReasonCodes = {
  versionNotRegistered: "STRAT_VERSION_NOT_REGISTERED",
  lifecycleNotEligible: "STRAT_LIFECYCLE_NOT_ELIGIBLE",
  trialNotEligible: "STRAT_TRIAL_NOT_ELIGIBLE",
  strategyNotAllowed: "STRAT_TM_STRATEGY_NOT_ALLOWED",
  entryPurposeVersionMismatch: "STRAT_ENTRY_PURPOSE_VERSION_MISMATCH",
} as const;

/**
 * Engine-level fail-closed reason codes (DEE-241). Emitted by the risk engine
 * orchestrator when an order cannot be evaluated safely — not by an individual evaluator.
 */
export const engineReasonCodes = {
  limitsNotConfigured: "RISK_LIMITS_NOT_CONFIGURED",
  accountStateUnavailable: "RISK_ACCOUNT_STATE_UNAVAILABLE",
  evaluationError: "RISK_EVALUATION_ERROR",
} as const;

/** Kill-switch enforcement reason codes (DEE-244). */
export const killSwitchReasonCodes = {
  killSwitchActive: "RISK_KILL_SWITCH_ACTIVE",
  killSwitchUnavailable: "RISK_KILL_SWITCH_UNAVAILABLE",
} as const;

export const riskReasonCodes = {
  ...tradeAbuseReasonCodes,
  ...capitalReasonCodes,
  ...drawdownReasonCodes,
  ...engineReasonCodes,
  ...killSwitchReasonCodes,
} as const;

export type TradeAbuseReasonCode =
  (typeof tradeAbuseReasonCodes)[keyof typeof tradeAbuseReasonCodes];

export type CapitalLimitsReasonCode = (typeof capitalReasonCodes)[keyof typeof capitalReasonCodes];

export type EngineReasonCode = (typeof engineReasonCodes)[keyof typeof engineReasonCodes];

export type KillSwitchReasonCode =
  (typeof killSwitchReasonCodes)[keyof typeof killSwitchReasonCodes];

export type DrawdownReasonCode = (typeof drawdownReasonCodes)[keyof typeof drawdownReasonCodes];

export type RiskReasonCode =
  | TradeAbuseReasonCode
  | CapitalLimitsReasonCode
  | EngineReasonCode
  | KillSwitchReasonCode
  | DrawdownReasonCode;
