import { isDeepStrictEqual } from "node:util";

import {
  canonicalizeSemanticJsonString,
  computeSemanticSha256Hex,
} from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  issueForecastRuntimeV2,
  type ForecastRuntimeInputV2,
  type ForecastRuntimeNonActionableV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";

export const HISTORICAL_FORECAST_NON_ACTIONABLE_SOURCE_V2 =
  "waia.trader.historical_forecast_non_actionable_source.v2" as const;
export const HISTORICAL_FORECAST_NON_ACTIONABLE_VERIFICATION_V2 =
  "waia.trader.historical_forecast_non_actionable_verification.v2" as const;
export const HISTORICAL_FORECAST_NON_ACTIONABLE_VERIFIER_V2 =
  "historical-forecast-non-actionable-verifier/1" as const;

export type HistoricalForecastNonActionableSourceV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_FORECAST_NON_ACTIONABLE_SOURCE_V2;
  organizationId: string;
  accountId: string;
  runId: string;
  cycleId: string;
  symbol: "BTCUSDT" | "ETHUSDT";
  pitAnchor: string;
  datasetMembershipContentDigestHex: string;
  runtimeInputContentDigestHex: string;
  runtimeInput: ForecastRuntimeInputV2;
  outcome: ForecastRuntimeNonActionableV2;
  contentDigestHex: string;
}>;

export type HistoricalForecastNonActionableVerificationV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_FORECAST_NON_ACTIONABLE_VERIFICATION_V2;
  organizationId: string;
  accountId: string;
  runId: string;
  cycleId: string;
  sourceContentDigestHex: string;
  outcomeContentDigestHex: string;
  verifierVersion: typeof HISTORICAL_FORECAST_NON_ACTIONABLE_VERIFIER_V2;
  verifierBuildDigestHex: string;
  verified: true;
  contentDigestHex: string;
}>;

const DIGEST = /^[0-9a-f]{64}$/;
const SHA = /^[0-9a-f]{40}$/;

function refuse(code: string): never {
  throw new Error(`HISTORICAL_FORECAST_NON_ACTIONABLE_REFUSED:${code}`);
}

function jsonRoundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertPermittedAbstention(
  runtimeInput: ForecastRuntimeInputV2,
  outcome: ForecastRuntimeNonActionableV2,
): void {
  const replay = issueForecastRuntimeV2(runtimeInput);
  if (
    replay.status !== "NON_ACTIONABLE" ||
    outcome.reason !== "MISSING_OR_NOT_ADMITTED" ||
    !isDeepStrictEqual(replay, outcome) ||
    canonicalizeSemanticJsonString(replay) !== canonicalizeSemanticJsonString(outcome) ||
    outcome.upstreamReasonCodes.length !== 1 ||
    outcome.upstreamReasonCodes[0] !== "HYPOTHESIS_NOT_APPLICABLE" ||
    runtimeInput.predictiveAdmissionReceipt?.verdict !== "NOT_ADMITTED" ||
    runtimeInput.predictiveAdmissionReceipt.blockingReasons.length !== 1 ||
    runtimeInput.predictiveAdmissionReceipt.blockingReasons[0] !==
      "HYPOTHESIS_NOT_APPLICABLE"
  ) {
    refuse("NOT_A_PERMITTED_MARKET_ABSTENTION");
  }
}

export function createHistoricalForecastNonActionableSourceV2(input: Readonly<{
  organizationId: string;
  accountId: string;
  runId: string;
  cycleId: string;
  symbol: "BTCUSDT" | "ETHUSDT";
  pitAnchor: string;
  datasetMembershipContentDigestHex: string;
  runtimeInput: ForecastRuntimeInputV2;
  outcome: ForecastRuntimeNonActionableV2;
}>): HistoricalForecastNonActionableSourceV2 {
  assertPermittedAbstention(input.runtimeInput, input.outcome);
  // This source is durable JSONB. Normalize through the same JSON boundary
  // before hashing so Date instances cannot change identity after a retry.
  const runtimeInput = jsonRoundTrip(input.runtimeInput);
  const outcome = jsonRoundTrip(input.outcome);
  assertPermittedAbstention(runtimeInput, outcome);
  const body = {
    schemaVersion: HISTORICAL_FORECAST_NON_ACTIONABLE_SOURCE_V2,
    organizationId: input.organizationId,
    accountId: input.accountId,
    runId: input.runId,
    cycleId: input.cycleId,
    symbol: input.symbol,
    pitAnchor: input.pitAnchor,
    datasetMembershipContentDigestHex: input.datasetMembershipContentDigestHex,
    runtimeInputContentDigestHex: computeSemanticSha256Hex(runtimeInput),
    runtimeInput,
    outcome,
  } as const;
  const source = Object.freeze({
    ...body,
    contentDigestHex: computeSemanticSha256Hex(body),
  });
  assertHistoricalForecastNonActionableSourceV2(source, input);
  return source;
}

export function assertHistoricalForecastNonActionableSourceV2(
  value: HistoricalForecastNonActionableSourceV2,
  expected: Readonly<{
    organizationId: string;
    accountId: string;
    runId: string;
    cycleId: string;
    symbol: "BTCUSDT" | "ETHUSDT";
    pitAnchor: string;
    datasetMembershipContentDigestHex: string;
  }>,
): HistoricalForecastNonActionableSourceV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) refuse("SOURCE_SHAPE");
  const { contentDigestHex, ...body } = value;
  if (
    value.schemaVersion !== HISTORICAL_FORECAST_NON_ACTIONABLE_SOURCE_V2 ||
    value.organizationId !== expected.organizationId ||
    value.accountId !== expected.accountId ||
    value.runId !== expected.runId ||
    value.cycleId !== expected.cycleId ||
    value.symbol !== expected.symbol ||
    value.pitAnchor !== expected.pitAnchor ||
    value.datasetMembershipContentDigestHex !==
      expected.datasetMembershipContentDigestHex ||
    new Date(value.pitAnchor).toISOString() !== value.pitAnchor ||
    !DIGEST.test(value.datasetMembershipContentDigestHex) ||
    value.runtimeInputContentDigestHex !== computeSemanticSha256Hex(value.runtimeInput) ||
    contentDigestHex !== computeSemanticSha256Hex(body)
  ) {
    refuse("SOURCE_IDENTITY");
  }
  assertPermittedAbstention(value.runtimeInput, value.outcome);
  return value;
}

export function createHistoricalForecastNonActionableVerificationV2(input: Readonly<{
  source: HistoricalForecastNonActionableSourceV2;
  releaseSha: string;
}>): HistoricalForecastNonActionableVerificationV2 {
  if (!SHA.test(input.releaseSha)) refuse("RELEASE_SHA");
  assertHistoricalForecastNonActionableSourceV2(input.source, input.source);
  const body = {
    schemaVersion: HISTORICAL_FORECAST_NON_ACTIONABLE_VERIFICATION_V2,
    organizationId: input.source.organizationId,
    accountId: input.source.accountId,
    runId: input.source.runId,
    cycleId: input.source.cycleId,
    sourceContentDigestHex: input.source.contentDigestHex,
    outcomeContentDigestHex: input.source.outcome.contentDigestHex,
    verifierVersion: HISTORICAL_FORECAST_NON_ACTIONABLE_VERIFIER_V2,
    verifierBuildDigestHex: computeSemanticSha256Hex({
      verifierVersion: HISTORICAL_FORECAST_NON_ACTIONABLE_VERIFIER_V2,
      releaseSha: input.releaseSha,
    }),
    verified: true as const,
  };
  return Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
}

export function assertHistoricalForecastNonActionableVerificationV2(
  value: HistoricalForecastNonActionableVerificationV2,
  input: Readonly<{
    source: HistoricalForecastNonActionableSourceV2;
    releaseSha: string;
  }>,
): HistoricalForecastNonActionableVerificationV2 {
  const expected = createHistoricalForecastNonActionableVerificationV2(input);
  if (!isDeepStrictEqual(value, expected)) refuse("VERIFICATION_IDENTITY");
  return value;
}
