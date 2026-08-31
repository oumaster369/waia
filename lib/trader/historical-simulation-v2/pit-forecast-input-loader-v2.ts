import type postgres from "postgres";

import {
  issueForecastRuntimeV2,
  type ForecastRuntimeInputV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";

type PitInputRow = Readonly<{
  organization_id: string;
  run_id: string;
  cycle_id: string;
  symbol: string;
  pit_anchor: Date | string;
  visible_from: Date | string;
  knowledge_content_digest_hex: string;
  runtime_input_json: ForecastRuntimeInputV2;
}>;

export type HistoricalForecastInputPitIdentityV2 = Readonly<{
  organizationId: string;
  runId: string;
  cycleId: string;
  symbol: "BTCUSDT" | "ETHUSDT";
  pitAnchor: string;
  knowledgeContentDigestHex: string;
}>;

const DIGEST = /^[0-9a-f]{64}$/;

function utc(value: Date | string): string {
  const result = new Date(value).toISOString();
  if (!Number.isFinite(Date.parse(result))) throw new Error("HISTORICAL_FORECAST_PIT_REFUSED:INVALID_TIME");
  return result;
}

export function assertHistoricalForecastInputPitBindingV2(
  row: PitInputRow,
  expected: HistoricalForecastInputPitIdentityV2,
): ForecastRuntimeInputV2 {
  const pitAnchor = utc(row.pit_anchor);
  if (
    row.organization_id !== expected.organizationId || row.run_id !== expected.runId ||
    row.cycle_id !== expected.cycleId || row.symbol !== expected.symbol ||
    pitAnchor !== expected.pitAnchor || utc(row.visible_from) > expected.pitAnchor ||
    row.knowledge_content_digest_hex !== expected.knowledgeContentDigestHex ||
    !DIGEST.test(expected.knowledgeContentDigestHex)
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

  // Replays the complete Forecast V2 identity graph. Authorized inputs must reproduce an
  // authority; malformed or internally substituted inputs fail here rather than at simulation.
  const outcome = issueForecastRuntimeV2(input);
  if (outcome.status !== "FORECAST_AUTHORIZED") {
    throw new Error(`HISTORICAL_FORECAST_PIT_REFUSED:${outcome.reason}`);
  }
  if (
    outcome.authority.organizationId !== expected.organizationId ||
    outcome.authority.anchorClosedBarAt !== expected.pitAnchor ||
    outcome.authority.knowledgeContentDigestHex !== expected.knowledgeContentDigestHex
  ) throw new Error("HISTORICAL_FORECAST_PIT_REFUSED:AUTHORITY_REPLAY_MISMATCH");
  return Object.freeze(input);
}

/**
 * Concrete PostgreSQL loader. The canonical PIT input table is intentionally queried by exact
 * organization/run/cycle/symbol/PIT identity; no "latest" lookup or caller-provided closure exists.
 * Its migration is a prerequisite of the final production graph, not part of this foundation.
 */
export function createPostgresHistoricalForecastInputPitLoaderV2(sql: postgres.Sql) {
  return async (expected: HistoricalForecastInputPitIdentityV2): Promise<ForecastRuntimeInputV2> => {
    const rows = await sql<PitInputRow[]>`
      SELECT organization_id::text, run_id, cycle_id, symbol, pit_anchor, visible_from,
             knowledge_content_digest_hex, runtime_input_json
      FROM trader_historical_forecast_input_pit_v2
      WHERE organization_id=${expected.organizationId}::uuid AND run_id=${expected.runId}
        AND cycle_id=${expected.cycleId} AND symbol=${expected.symbol}
        AND pit_anchor=${expected.pitAnchor}::timestamptz
        AND knowledge_content_digest_hex=${expected.knowledgeContentDigestHex}
        AND visible_from <= ${expected.pitAnchor}::timestamptz
    `;
    if (rows.length !== 1) throw new Error("HISTORICAL_FORECAST_PIT_REFUSED:EXACT_ROW_NOT_FOUND");
    return assertHistoricalForecastInputPitBindingV2(rows[0]!, expected);
  };
}

