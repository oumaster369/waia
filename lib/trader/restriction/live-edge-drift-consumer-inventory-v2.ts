export const LIVE_EDGE_DRIFT_FORBIDDEN_CONSUMER_PREFIXES_V2 = [
  "lib/trader/execution/",
  "lib/trader/live/",
  "lib/trader/capital/",
  "lib/trader/holdout/",
] as const;

export function isLiveEdgeDriftCapitalConsumerForbiddenV2(relativePath: string): boolean {
  return LIVE_EDGE_DRIFT_FORBIDDEN_CONSUMER_PREFIXES_V2.some((prefix) =>
    relativePath.startsWith(prefix),
  );
}
