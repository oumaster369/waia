import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  deriveForecastOutcomeId,
  deriveForecastOutcomeIdempotencyKey,
} from "@/lib/trader/intelligence/outcome-resolution/derive-outcome-ids";
import {
  evaluateForecastPath,
  extractHorizonFromForecast,
  extractRegimeFromDecision,
} from "@/lib/trader/intelligence/outcome-resolution/evaluate-forecast-path";
import { OutcomeResolutionEarlyResolutionError } from "@/lib/trader/intelligence/outcome-resolution/errors";
import type {
  ForecastOutcomeRecord,
  OutcomeResolutionSource,
  OutcomeResolutionSink,
  PitBarWindow,
  ResolveForecastOutcomeInput,
} from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";
import { computeForecastOutcomeContentDigest } from "@/lib/trader/intelligence/outcome-resolution/serialize-outcome-resolution";
import type { TraderIntelligenceForecastRecord } from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import { FORECAST_OUTCOME_SCHEMA_VERSION } from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";

export function resolveForecastOutcomeClass(
  input: ResolveForecastOutcomeInput,
): ForecastOutcomeRecord {
  const evaluation = evaluateForecastPath({
    scenarioSetJson: input.forecast.scenarioSetJson,
    invalidationConditionsJson: input.forecast.invalidationConditionsJson,
    issuedAt: input.forecast.issuedAt,
    eligibleResolutionAt: input.forecast.targetWindowEndAt,
    evidenceCutoffAt: input.pitWindow.evidenceCutoffAt,
    asOf: input.pitWindow.asOf,
    bars: input.pitWindow.bars,
  });

  const regime = extractRegimeFromDecision(input.decision?.cdeMsvPermissionSnapshotJson);
  const horizon = extractHorizonFromForecast(
    input.forecast.targetWindowEndAt,
    input.forecast.targetWindowStartAt,
  );

  const base: Omit<ForecastOutcomeRecord, "contentDigest" | "id" | "idempotencyKey"> = {
    organizationId: input.context.organizationId,
    runId: input.forecast.runId,
    cycleId: input.forecast.cycleId,
    symbol: input.forecast.symbol,
    forecastRecordId: input.forecast.id,
    decisionRecordId: input.decision?.id ?? null,
    hypothesisRecordId: input.forecast.hypothesisRecordId,
    modelVersion: input.forecast.forecastModelVersion,
    strategyVersion: input.decision?.strategyVersion ?? null,
    regime,
    horizon,
    issuedAt: input.forecast.issuedAt,
    eligibleResolutionAt: input.forecast.targetWindowEndAt,
    resolvedAt: evaluation.outcomeClass === "ACTIVE" ? null : input.pitWindow.asOf,
    pitEvidenceBoundary: input.pitWindow.asOf,
    outcomeClass: evaluation.outcomeClass,
    outcomeVerdict: evaluation.outcomeVerdict,
    score: evaluation.netMove,
    sourceRecordIdsJson: canonicalizeSemanticJsonString({
      forecast_record_id: input.forecast.id,
      decision_record_id: input.decision?.id ?? null,
      hypothesis_record_id: input.forecast.hypothesisRecordId,
    }),
    provenance: input.provenance,
    terminalReason: evaluation.outcomeClass,
    schemaVersion: FORECAST_OUTCOME_SCHEMA_VERSION,
  };

  const id = deriveForecastOutcomeId({
    organizationId: input.context.organizationId,
    forecastRecordId: input.forecast.id,
  });
  const idempotencyKey = deriveForecastOutcomeIdempotencyKey({
    organizationId: input.context.organizationId,
    runId: input.forecast.runId,
    cycleId: input.forecast.cycleId,
    symbol: input.forecast.symbol,
    forecastRecordId: input.forecast.id,
  });

  const withDigest: ForecastOutcomeRecord = {
    ...base,
    id,
    idempotencyKey,
    contentDigest: "",
  };

  return {
    ...withDigest,
    contentDigest: computeForecastOutcomeContentDigest(withDigest),
  };
}

export function isForecastEligibleForResolution(
  forecast: TraderIntelligenceForecastRecord,
  asOf: string,
): boolean {
  const asOfMs = new Date(asOf).getTime();
  const eligibleMs = new Date(forecast.targetWindowEndAt).getTime();
  return asOfMs >= eligibleMs;
}

export async function resolveEligibleForecastOutcomes(input: {
  context: OrgContext;
  runId: string;
  asOf: string;
  pitWindow: PitBarWindow;
  source: OutcomeResolutionSource;
  sink: OutcomeResolutionSink;
  provenance: ResolveForecastOutcomeInput["provenance"];
  decisionByForecastId?: ReadonlyMap<string, ResolveForecastOutcomeInput["decision"]>;
}): Promise<readonly ForecastOutcomeRecord[]> {
  const forecasts = await input.source.listForecastsEligibleForResolution(
    input.context,
    input.runId,
    input.asOf,
  );
  const resolved: ForecastOutcomeRecord[] = [];

  for (const forecast of forecasts) {
    if (!isForecastEligibleForResolution(forecast, input.asOf)) {
      continue;
    }

    const existing = await input.sink.forecastOutcomeRepository.findByForecastRecordId(
      input.context,
      forecast.id,
    );
    if (existing) {
      resolved.push(existing);
      continue;
    }

    const decision = input.decisionByForecastId?.get(forecast.id) ?? null;
    const record = resolveForecastOutcomeClass({
      context: input.context,
      forecast,
      decision,
      pitWindow: input.pitWindow,
      provenance: input.provenance,
      codeSha: input.provenance.codeSha,
    });

    await input.sink.forecastOutcomeRepository.insert(input.context, record);
    resolved.push(record);
  }

  return resolved;
}

export { OutcomeResolutionEarlyResolutionError };
