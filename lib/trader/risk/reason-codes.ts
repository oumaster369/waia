/** Stable risk reason codes (Master Spec §13). */
export const riskReasonCodes = {
  symbolNotAllowed: "RISK_SYMBOL_NOT_ALLOWED",
  maxNotionalExceeded: "RISK_MAX_NOTIONAL_EXCEEDED",
  orderRateExceeded: "RISK_ORDER_RATE_EXCEEDED",
  priceCollarBreached: "RISK_PRICE_COLLAR_BREACHED",
} as const;

export type TradeAbuseReasonCode = (typeof riskReasonCodes)[keyof typeof riskReasonCodes];

/** Reserved prefixes for DEE-240 capital limits evaluator. */
export type CapitalLimitsReasonCode = string;

export type RiskReasonCode = TradeAbuseReasonCode | CapitalLimitsReasonCode;
