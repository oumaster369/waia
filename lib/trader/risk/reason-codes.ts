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
} as const;

export const riskReasonCodes = {
  ...tradeAbuseReasonCodes,
  ...capitalReasonCodes,
} as const;

export type TradeAbuseReasonCode =
  (typeof tradeAbuseReasonCodes)[keyof typeof tradeAbuseReasonCodes];

export type CapitalLimitsReasonCode = (typeof capitalReasonCodes)[keyof typeof capitalReasonCodes];

export type RiskReasonCode = TradeAbuseReasonCode | CapitalLimitsReasonCode;
