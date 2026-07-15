import { createHash } from "node:crypto";

import {
  DECISION_FORECAST_LINK_SCHEMA_VERSION,
  DECISION_RECORD_SCHEMA_VERSION,
  ENTRY_PURPOSE_RECORD_SCHEMA_VERSION,
  FORECAST_RECORD_SCHEMA_VERSION,
} from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

function deriveDeterministicUuidV4(seed: string): string {
  const hash = createHash("sha256").update(seed, "utf8").digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export type CycleSymbolIdentityInput = Readonly<{
  organizationId: string;
  runId: string;
  cycleId: string;
  symbol: string;
}>;

export type ForecastKeyDigestInput = Readonly<{
  organizationId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  hypothesisRecordId: string;
  targetWindowStartAt: string;
  targetWindowEndAt: string;
  marketQuestion: string;
  forecastModelVersion: string;
}>;

export function deriveForecastKeyDigest(input: ForecastKeyDigestInput): string {
  return computeSemanticSha256Hex({
    organization_id: input.organizationId,
    run_id: input.runId,
    cycle_id: input.cycleId,
    symbol: input.symbol,
    hypothesis_record_id: input.hypothesisRecordId,
    target_window_start_at: input.targetWindowStartAt,
    target_window_end_at: input.targetWindowEndAt,
    market_question: input.marketQuestion,
    forecast_model_version: input.forecastModelVersion,
  });
}

export function deriveForecastRecordId(input: ForecastKeyDigestInput): string {
  const forecastKeyDigest = deriveForecastKeyDigest(input);
  return deriveDeterministicUuidV4(
    `${FORECAST_RECORD_SCHEMA_VERSION}|${input.organizationId}|${input.runId}|${input.cycleId}|${input.symbol}|${forecastKeyDigest}`,
  );
}

export function deriveDecisionRecordId(input: CycleSymbolIdentityInput): string {
  return deriveDeterministicUuidV4(
    `${DECISION_RECORD_SCHEMA_VERSION}|${input.organizationId}|${input.runId}|${input.cycleId}|${input.symbol}`,
  );
}

export function deriveDecisionForecastLinkId(input: {
  organizationId: string;
  decisionRecordId: string;
  forecastRecordId: string;
}): string {
  return deriveDeterministicUuidV4(
    `${DECISION_FORECAST_LINK_SCHEMA_VERSION}|${input.organizationId}|${input.decisionRecordId}|${input.forecastRecordId}`,
  );
}

export function deriveEntryPurposeRecordId(input: CycleSymbolIdentityInput): string {
  return deriveDeterministicUuidV4(
    `${ENTRY_PURPOSE_RECORD_SCHEMA_VERSION}|${input.organizationId}|${input.runId}|${input.cycleId}|${input.symbol}`,
  );
}
