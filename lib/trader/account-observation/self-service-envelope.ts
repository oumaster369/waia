import { createObservationConfiguration } from "./runtime";

/** Operator envelope for personal-cabinet HTX observation. Must match the production
 * host configuration revision already collecting Org-0. Timing/coverage are not
 * per-partner and are not taken from the browser. */
export const ACCOUNT_OBSERVATION_SELF_SERVICE_HOST = "api.huobi.pro" as const;
export const ACCOUNT_OBSERVATION_SELF_SERVICE_SYMBOLS = Object.freeze(["BTCUSDT"]);
export const ACCOUNT_OBSERVATION_SELF_SERVICE_MAX_ASSIGNMENTS = 20;
export const ACCOUNT_OBSERVATION_SELF_SERVICE_READER_LIMITS = Object.freeze({
  pageSize: 100,
  maxPages: 2,
  maxRecords: 200,
  maxResponseBytes: 262144,
  tradeWindowMs: 86400000,
});

export function createAccountObservationSelfServiceConfiguration() {
  return createObservationConfiguration({
    symbols: [...ACCOUNT_OBSERVATION_SELF_SERVICE_SYMBOLS],
    pollIntervalMs: 60_000,
    maxBackoffMs: 300_000,
    readTimeoutMs: 10_000,
    leaseTtlMs: 120_000,
    htxCoverage: {
      ...ACCOUNT_OBSERVATION_SELF_SERVICE_READER_LIMITS,
      host: ACCOUNT_OBSERVATION_SELF_SERVICE_HOST,
    },
  });
}
