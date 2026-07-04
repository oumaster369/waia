/** Stable trade-abuse reason codes (Master Spec §13). */
export const tradeAbuseReasonCodes = {
  symbolNotAllowed: "RISK_SYMBOL_NOT_ALLOWED",
  maxNotionalExceeded: "RISK_MAX_NOTIONAL_EXCEEDED",
  orderRateExceeded: "RISK_ORDER_RATE_EXCEEDED",
  priceCollarBreached: "RISK_PRICE_COLLAR_BREACHED",
} as const;

/** Stable capital-limits reason codes (Master Spec §13). */
export const capitalReasonCodes = {
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
  ...engineReasonCodes,
  ...killSwitchReasonCodes,
} as const;

export type TradeAbuseReasonCode =
  (typeof tradeAbuseReasonCodes)[keyof typeof tradeAbuseReasonCodes];

export type CapitalLimitsReasonCode = (typeof capitalReasonCodes)[keyof typeof capitalReasonCodes];

export type EngineReasonCode = (typeof engineReasonCodes)[keyof typeof engineReasonCodes];

export type KillSwitchReasonCode =
  (typeof killSwitchReasonCodes)[keyof typeof killSwitchReasonCodes];

export type RiskReasonCode =
  | TradeAbuseReasonCode
  | CapitalLimitsReasonCode
  | EngineReasonCode
  | KillSwitchReasonCode;
