export const PREDICTIVE_ADMISSION_FORBIDDEN_CONSUMER_PREFIXES_V1 = [
  "lib/trader/intelligence/decision",
  "lib/trader/risk/",
  "lib/trader/execution/",
  "lib/trader/live/",
  "lib/trader/capital/",
  "lib/trader/research/holdout/",
] as const;

export const PREDICTIVE_ADMISSION_AUTHORIZED_CONSUMERS_V1 = [
  "lib/trader/intelligence/forecast-v2/",
] as const;

export function isPredictiveAdmissionCapitalConsumerForbiddenV1(path: string): boolean {
  return PREDICTIVE_ADMISSION_FORBIDDEN_CONSUMER_PREFIXES_V1.some((prefix) =>
    path.startsWith(prefix),
  );
}
