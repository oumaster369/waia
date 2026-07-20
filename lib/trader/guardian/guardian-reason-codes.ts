export const guardianReasonCodes = {
  closeOnlyPermission: "GUARDIAN_CLOSE_ONLY_PERMISSION",
  stopTradingFlat: "GUARDIAN_STOP_TRADING_FLAT",
  strategyDisallowed: "GUARDIAN_STRATEGY_DISALLOWED",
  maxHoldBars: "GUARDIAN_MAX_HOLD_BARS",
  hold: "GUARDIAN_HOLD",
  inventoryCappedPartial: "GUARDIAN_INVENTORY_CAPPED_PARTIAL",
} as const;

export const guardianRuleIds = {
  closeOnlyPermission: "CLOSE_ONLY_PERMISSION",
  stopTradingWithOpenRisk: "STOP_TRADING_WITH_OPEN_RISK",
  strategyDisallowed: "STRATEGY_DISALLOWED",
  maxHoldBars: "MAX_HOLD_BARS",
  defaultHold: "DEFAULT_HOLD",
} as const;
