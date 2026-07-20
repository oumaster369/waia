import { createHash } from "node:crypto";

import {
  ABSTENTION_OUTCOME_SCHEMA_VERSION,
  FORECAST_OUTCOME_SCHEMA_VERSION,
  HYPOTHESIS_OUTCOME_SCHEMA_VERSION,
} from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";

export function deriveDeterministicUuidV4(seed: string): string {
  const hash = createHash("sha256").update(seed, "utf8").digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function deriveForecastOutcomeId(input: {
  organizationId: string;
  forecastRecordId: string;
}): string {
  return deriveDeterministicUuidV4(
    `${FORECAST_OUTCOME_SCHEMA_VERSION}|${input.organizationId}|${input.forecastRecordId}`,
  );
}

export function deriveForecastOutcomeIdempotencyKey(input: {
  organizationId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  forecastRecordId: string;
}): string {
  return [
    FORECAST_OUTCOME_SCHEMA_VERSION,
    input.organizationId,
    input.runId,
    input.cycleId,
    input.symbol,
    input.forecastRecordId,
  ].join("|");
}

export function deriveHypothesisOutcomeId(input: {
  organizationId: string;
  hypothesisRecordId: string;
}): string {
  return deriveDeterministicUuidV4(
    `${HYPOTHESIS_OUTCOME_SCHEMA_VERSION}|${input.organizationId}|${input.hypothesisRecordId}`,
  );
}

export function deriveHypothesisOutcomeIdempotencyKey(input: {
  organizationId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  hypothesisRecordId: string;
}): string {
  return [
    HYPOTHESIS_OUTCOME_SCHEMA_VERSION,
    input.organizationId,
    input.runId,
    input.cycleId,
    input.symbol,
    input.hypothesisRecordId,
  ].join("|");
}

export function deriveAbstentionOutcomeId(input: {
  organizationId: string;
  decisionRecordId: string;
}): string {
  return deriveDeterministicUuidV4(
    `${ABSTENTION_OUTCOME_SCHEMA_VERSION}|${input.organizationId}|${input.decisionRecordId}`,
  );
}

export function deriveAbstentionOutcomeIdempotencyKey(input: {
  organizationId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  decisionRecordId: string;
}): string {
  return [
    ABSTENTION_OUTCOME_SCHEMA_VERSION,
    input.organizationId,
    input.runId,
    input.cycleId,
    input.symbol,
    input.decisionRecordId,
  ].join("|");
}
