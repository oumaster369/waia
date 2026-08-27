export const FORECAST_RUNTIME_AUTHORITY_ALLOWED_CONSUMERS_V1 = [
  "lib/trader/intelligence/evaluation-cycle.ts",
  "lib/trader/intelligence/types.ts",
] as const;

export const FORECAST_RUNTIME_AUTHORITY_FORBIDDEN_CONSUMER_PREFIXES_V1 = [
  "lib/trader/intelligence/decision",
  "lib/trader/risk/",
  "lib/trader/execution/",
  "lib/trader/live/",
  "lib/trader/capital/",
  "lib/trader/research/holdout/",
] as const;

export function isForecastRuntimeAuthorityConsumerForbiddenV1(path: string): boolean {
  return FORECAST_RUNTIME_AUTHORITY_FORBIDDEN_CONSUMER_PREFIXES_V1.some((prefix) =>
    path.startsWith(prefix),
  );
}
