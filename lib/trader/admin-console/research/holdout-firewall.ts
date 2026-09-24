const HOLDOUT_PAYLOAD = [
  /blind_holdout_payload/i,
  /holdout_feature_payload/i,
  /holdout_row_payload/i,
  /partitions\/blind-holdout/i,
  /holdout_pnl/i,
  /holdoutPnl/,
  /holdoutEquity/,
  /holdoutTrades/,
  /holdoutDecisions/,
  /blindHoldoutPnl/,
  /blindHoldoutEquity/,
];

export function sqlTouchesHoldoutPayload(sqlText: string): boolean {
  return HOLDOUT_PAYLOAD.some((pattern) => pattern.test(sqlText));
}
