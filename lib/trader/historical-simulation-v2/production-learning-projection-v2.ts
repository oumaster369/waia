import type postgres from "postgres";

import type { HistoricalMaturedClosureV2 } from
  "@/lib/trader/backtest/historical-simulation-v2";
import type { HistoricalSimulationReasonLedgerV2Draft } from "./reason-ledger-v2";

type LearningProjectionV2 = HistoricalSimulationReasonLedgerV2Draft["learning"];

type KnowledgeUpdateRowV2 = Readonly<{
  content_digest: string;
  eligible_resolution_at: Date | string;
  resolved_at: Date | string;
  source_record_ids_json: string;
}>;

type SourceIdsV2 = Readonly<{
  forecast_runtime_authority_content_digest_hex?: unknown;
  forecast_outcome_content_digest_hex?: unknown;
  calibration_observation_content_digest?: unknown;
  visible_from_cycle_pit_anchor?: unknown;
}>;

function refuse(code: string): never {
  throw new Error(`HISTORICAL_PRODUCTION_LEARNING_REFUSED:${code}`);
}

function canonicalUtc(value: Date | string, field: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) refuse(field);
  return date.toISOString();
}

/**
 * Projects exactly one chronologically-applied terminal closure into the scalar
 * v2 reason-ledger contract. A normal minute-by-minute run matures at most one
 * Forecast per cycle. A backlog that would collapse several independent
 * calibration/Knowledge records into one ledger entry is refused, not hidden.
 */
export async function loadHistoricalProductionLearningProjectionV2(input: Readonly<{
  sql: postgres.Sql;
  organizationId: string;
  runId: string;
  symbol: string;
  pitAnchor: string;
  closures: readonly HistoricalMaturedClosureV2[];
}>): Promise<LearningProjectionV2> {
  const pitEpoch = Date.parse(input.pitAnchor);
  if (!Number.isSafeInteger(pitEpoch) || new Date(pitEpoch).toISOString() !== input.pitAnchor) {
    refuse("PIT");
  }
  if (input.closures.length === 0) {
    return Object.freeze({
      status: "PENDING" as const,
      reasonCodes: Object.freeze(["FUTURE_OUTCOME_NOT_YET_ELIGIBLE"]),
      calibrationObservationContentDigestHex: null,
      knowledgeUpdateContentDigestHex: null,
      eligibleResolutionAtUtc: null,
      visibleFromPitAnchorUtc: null,
    });
  }
  if (input.closures.length !== 1) refuse("MULTIPLE_CLOSURES_REQUIRE_LEDGER_V3");
  const closure = input.closures[0]!;
  const rows = await input.sql<KnowledgeUpdateRowV2[]>`
    SELECT content_digest, eligible_resolution_at, resolved_at, source_record_ids_json
    FROM trader_knowledge_confidence_update_record
    WHERE organization_id=${input.organizationId}::uuid
      AND run_id=${input.runId}
      AND replace(symbol, '/', '')=replace(${input.symbol}, '/', '')
      AND update_model_version=
        'waia.trader.knowledge_confidence_update_model.v1.forecast-v2-evidence-only'
      AND content_digest ~ '^[0-9a-f]{64}$'
      AND (source_record_ids_json::jsonb ->>
        'forecast_runtime_authority_content_digest_hex')=
          ${closure.forecastAuthorityContentDigestHex}
      AND (source_record_ids_json::jsonb ->>
        'forecast_outcome_content_digest_hex')=${closure.outcomeContentDigestHex}
      AND (source_record_ids_json::jsonb ->>
        'visible_from_cycle_pit_anchor')::timestamptz <= ${input.pitAnchor}::timestamptz
  `;
  const row = rows[0];
  if (!row || rows.length !== 1) refuse("CLOSURE_EVIDENCE");
  let source: SourceIdsV2;
  try {
    source = JSON.parse(row.source_record_ids_json) as SourceIdsV2;
  } catch {
    return refuse("SOURCE_JSON");
  }
  const calibration = source.calibration_observation_content_digest;
  const visible = source.visible_from_cycle_pit_anchor;
  if (typeof calibration !== "string" || !/^[0-9a-f]{64}$/.test(calibration) ||
      typeof visible !== "string") {
    refuse("SOURCE_IDENTITY");
  }
  const eligible = canonicalUtc(row.eligible_resolution_at, "ELIGIBLE");
  const resolved = canonicalUtc(row.resolved_at, "RESOLVED");
  const visibleUtc = canonicalUtc(visible, "VISIBLE");
  if (resolved !== closure.maturedAt || Date.parse(resolved) >= pitEpoch ||
      Date.parse(eligible) > Date.parse(resolved) ||
      Date.parse(visibleUtc) > pitEpoch || Date.parse(visibleUtc) <= Date.parse(resolved)) {
    refuse("CHRONOLOGY");
  }
  const calibrationRows = await input.sql<{ content_digest: string }[]>`
    SELECT encode(content_digest, 'hex') AS content_digest
    FROM trader_forecast_calibration_observation_v2
    WHERE organization_id=${input.organizationId}::uuid
      AND encode(content_digest, 'hex')=${calibration}
      AND scoring_eligible=true
  `;
  if (calibrationRows.length !== 1 || calibrationRows[0]!.content_digest !== calibration) {
    refuse("CALIBRATION_EVIDENCE");
  }
  return Object.freeze({
    status: "APPLIED" as const,
    reasonCodes: Object.freeze([]),
    calibrationObservationContentDigestHex: calibration,
    knowledgeUpdateContentDigestHex: row.content_digest,
    eligibleResolutionAtUtc: eligible,
    visibleFromPitAnchorUtc: visibleUtc,
  });
}

/** Exact durable set of Forecasts that still lack a terminal outcome. */
export async function loadHistoricalProductionPendingForecastsV2(input: Readonly<{
  sql: postgres.Sql;
  organizationId: string;
  runId: string;
}>): Promise<readonly string[]> {
  const rows = await input.sql<{ authority_digest: string }[]>`
    SELECT b.forecast_runtime_authorized_outcome_json -> 'authority' ->>
      'contentDigestHex' AS authority_digest
    FROM trader_forecast_bundle_v2 b
    JOIN trader_forecast_v2 f ON f.organization_id=b.organization_id
      AND f.bundle_id=b.id AND f.target_role_id='TERMINAL_RETURN'
    LEFT JOIN trader_forecast_outcome_v2 o ON o.organization_id=b.organization_id
      AND o.bundle_id=b.id AND o.forecast_id=f.id
    WHERE b.organization_id=${input.organizationId}::uuid
      AND b.run_id=${input.runId}
      AND b.forecast_runtime_authorized_outcome_json IS NOT NULL
      AND o.forecast_id IS NULL
    ORDER BY b.forecast_runtime_issuance_sequence ASC
  `;
  const values = rows.map((row) => row.authority_digest);
  if (values.some((value) => !/^[0-9a-f]{64}$/.test(value)) ||
      new Set(values).size !== values.length) {
    refuse("PENDING_IDENTITY");
  }
  return Object.freeze(values);
}
