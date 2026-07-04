export const exitReasonCodes = {
  stopLossHit: "GUARDIAN_STOP_LOSS_HIT",
  takeProfitHit: "GUARDIAN_TAKE_PROFIT_HIT",
  trailingStopHit: "GUARDIAN_TRAILING_STOP_HIT",
} as const;

export const exitRuleIds = {
  stopLoss: "SL_TP_STOP_LOSS",
  takeProfit: "SL_TP_TAKE_PROFIT",
  trailingStop: "SL_TP_TRAILING_STOP",
} as const;
