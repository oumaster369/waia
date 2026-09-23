const HOLDOUT_PAYLOAD = [
  /blind_holdout_payload/i,
  /holdout_feature_payload/i,
  /holdout_row_payload/i,
];

export function sqlTouchesHoldoutPayload(sqlText: string): boolean {
  return HOLDOUT_PAYLOAD.some((pattern) => pattern.test(sqlText));
}
