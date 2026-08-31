import type postgres from "postgres";

import {
  issueForecastRuntimeV2,
  type ForecastRuntimeInputV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { HistoricalDatasetMembershipV2 } from "./dataset-membership-v2";
import { HISTORICAL_FORECAST_INPUT_PIT_V2 } from "./pit-forecast-input-producer-v2";

type PitInputRow = Readonly<{
  organization_id: string;
  run_id: string;
  cycle_id: string;
  forecast_id: string;
  symbol: string;
  partition: string;
  record_index: number;
  dataset_membership_content_digest_hex: string;
  dataset_membership_json: HistoricalDatasetMembershipV2;
  pit_anchor: Date | string;
  visible_from: Date | string;
  knowledge_content_digest_hex: string;
  forecast_authority_content_digest_hex: string;
  runtime_input_json: ForecastRuntimeInputV2;
  content_digest_hex: string;
  schema_version: string;
}>;

export type HistoricalForecastInputPitIdentityV2 = Readonly<{
  organizationId: string;
  runId: string;
  cycleId: string;
  forecastId: string;
  symbol: "BTCUSDT" | "ETHUSDT";
  pitAnchor: string;
  knowledgeContentDigestHex: string;
  forecastAuthorityContentDigestHex: string;
  datasetMembership: HistoricalDatasetMembershipV2;
}>;

const DIGEST = /^[0-9a-f]{64}$/;

function utc(value: Date | string): string {
  const result = new Date(value).toISOString();
  if (!Number.isFinite(Date.parse(result))) throw new Error("HISTORICAL_FORECAST_PIT_REFUSED:INVALID_TIME");
  return result;
}

function cloneAndDeepFreeze<T>(value: T): T {
  const clone = JSON.parse(JSON.stringify(value)) as T;
  const freeze = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== "object" || Object.isFrozen(candidate)) return;
    for (const child of Object.values(candidate as Record<string, unknown>)) freeze(child);
    Object.freeze(candidate);
  };
  freeze(clone);
  return clone;
}

export function assertHistoricalForecastInputPitBindingV2(
  row: PitInputRow,
  expected: HistoricalForecastInputPitIdentityV2,
): ForecastRuntimeInputV2 {
  const pitAnchor = utc(row.pit_anchor);
  if (
    row.organization_id !== expected.organizationId || row.run_id !== expected.runId ||
    row.cycle_id !== expected.cycleId || row.forecast_id !== expected.forecastId || row.symbol !== expected.symbol ||
    pitAnchor !== expected.pitAnchor || utc(row.visible_from) > expected.pitAnchor ||
    row.knowledge_content_digest_hex !== expected.knowledgeContentDigestHex ||
    !DIGEST.test(expected.knowledgeContentDigestHex) || row.schema_version !== HISTORICAL_FORECAST_INPUT_PIT_V2 ||
    row.forecast_authority_content_digest_hex !== expected.forecastAuthorityContentDigestHex ||
    row.dataset_membership_content_digest_hex !== expected.datasetMembership.contentDigestHex ||
    row.partition !== expected.datasetMembership.partition || row.record_index !== expected.datasetMembership.recordIndex ||
    canonicalMembershipDigest(row.dataset_membership_json) !== expected.datasetMembership.contentDigestHex
  ) throw new Error("HISTORICAL_FORECAST_PIT_REFUSED:SCOPE_OR_PIT_MISMATCH");

  const input = row.runtime_input_json;
  if (
    input.knowledgeContentDigestHex !== expected.knowledgeContentDigestHex ||
    input.marketStateSnapshot?.organizationId !== expected.organizationId ||
    input.marketStateSnapshot.symbol.replace("/", "") !== expected.symbol ||
    input.marketStateSnapshot.pitAnchor !== expected.pitAnchor ||
    input.predictiveAdmissionReceipt?.pitAnchor !== expected.pitAnchor ||
    input.forecastContractBinding?.organizationId !== expected.organizationId
  ) throw new Error("HISTORICAL_FORECAST_PIT_REFUSED:INPUT_BINDING_MISMATCH");

  const body = { schemaVersion: HISTORICAL_FORECAST_INPUT_PIT_V2, organizationId: row.organization_id,
    runId: row.run_id, cycleId: row.cycle_id, forecastId: row.forecast_id,
    datasetMembership: row.dataset_membership_json, symbol: row.symbol, pitAnchor,
    visibleFrom: utc(row.visible_from), knowledgeContentDigestHex: row.knowledge_content_digest_hex,
    forecastAuthorityContentDigestHex: row.forecast_authority_content_digest_hex, runtimeInput: input };
  if (!DIGEST.test(row.content_digest_hex) || computeSemanticSha256Hex(body) !== row.content_digest_hex)
    throw new Error("HISTORICAL_FORECAST_PIT_REFUSED:ROW_DIGEST_MISMATCH");

  // Replays the complete Forecast V2 identity graph. Authorized inputs must reproduce an
  // authority; malformed or internally substituted inputs fail here rather than at simulation.
  const outcome = issueForecastRuntimeV2(input);
  if (outcome.status !== "FORECAST_AUTHORIZED") {
    throw new Error(`HISTORICAL_FORECAST_PIT_REFUSED:${outcome.reason}`);
  }
  if (
    outcome.authority.organizationId !== expected.organizationId ||
    outcome.authority.anchorClosedBarAt !== expected.pitAnchor ||
    outcome.authority.knowledgeContentDigestHex !== expected.knowledgeContentDigestHex ||
    outcome.authority.contentDigestHex !== expected.forecastAuthorityContentDigestHex
  ) throw new Error("HISTORICAL_FORECAST_PIT_REFUSED:AUTHORITY_REPLAY_MISMATCH");
  return cloneAndDeepFreeze(input);
}

function canonicalMembershipDigest(value: HistoricalDatasetMembershipV2): string {
  const { contentDigestHex, ...body } = value;
  if (!DIGEST.test(contentDigestHex) || computeSemanticSha256Hex(body) !== contentDigestHex) return "";
  return contentDigestHex;
}

/**
 * Concrete PostgreSQL loader. The canonical PIT input table is intentionally queried by exact
 * organization/run/cycle/symbol/PIT identity; no "latest" lookup or caller-provided closure exists.
 * Its migration is a prerequisite of the final production graph, not part of this foundation.
 */
export function createPostgresHistoricalForecastInputPitLoaderV2(sql: postgres.Sql) {
  return async (expected: HistoricalForecastInputPitIdentityV2): Promise<ForecastRuntimeInputV2> => {
    const rows = await sql<PitInputRow[]>`
      SELECT organization_id::text, run_id, cycle_id, forecast_id::text, symbol, partition, record_index,
             dataset_membership_content_digest_hex, dataset_membership_json, pit_anchor, visible_from,
             knowledge_content_digest_hex, forecast_authority_content_digest_hex, runtime_input_json,
             content_digest_hex, schema_version
      FROM trader_historical_forecast_input_pit_v2
      WHERE organization_id=${expected.organizationId}::uuid AND run_id=${expected.runId}
        AND cycle_id=${expected.cycleId} AND forecast_id=${expected.forecastId}::uuid AND symbol=${expected.symbol}
        AND partition=${expected.datasetMembership.partition} AND record_index=${expected.datasetMembership.recordIndex}
        AND dataset_membership_content_digest_hex=${expected.datasetMembership.contentDigestHex}
        AND pit_anchor=${expected.pitAnchor}::timestamptz
        AND knowledge_content_digest_hex=${expected.knowledgeContentDigestHex}
        AND forecast_authority_content_digest_hex=${expected.forecastAuthorityContentDigestHex}
        AND schema_version=${HISTORICAL_FORECAST_INPUT_PIT_V2}
        AND visible_from <= ${expected.pitAnchor}::timestamptz
    `;
    if (rows.length !== 1) throw new Error("HISTORICAL_FORECAST_PIT_REFUSED:EXACT_ROW_NOT_FOUND");
    return assertHistoricalForecastInputPitBindingV2(rows[0]!, expected);
  };
}
