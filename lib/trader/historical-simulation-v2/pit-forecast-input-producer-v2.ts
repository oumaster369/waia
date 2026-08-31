import type postgres from "postgres";

import {
  canonicalizeSemanticJsonString,
  computeSemanticSha256Hex,
} from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  issueForecastRuntimeV2,
  type ForecastRuntimeInputV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import { readForecastContractBindingV1 } from "@/lib/trader/intelligence/forecast-v2/forecast-contract-binding-service-v1";
import { HISTORICAL_SIMULATION_KNOWLEDGE_BINDING_V2 } from "./knowledge-port-postgres";

export const HISTORICAL_FORECAST_INPUT_PIT_V2 =
  "waia.trader.historical_forecast_input_pit.v2" as const;

export type HistoricalForecastInputPitRecordV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_FORECAST_INPUT_PIT_V2;
  organizationId: string;
  runId: string;
  cycleId: string;
  forecastId: string;
  symbol: "BTCUSDT" | "ETHUSDT";
  pitAnchor: string;
  visibleFrom: string;
  knowledgeContentDigestHex: string;
  forecastAuthorityContentDigestHex: string;
  runtimeInput: ForecastRuntimeInputV2;
  contentDigestHex: string;
}>;

type KnowledgeRow = Readonly<{
  id: string; knowledge_edge_id: string; content_digest: string;
  resolved_at: Date | string; pit_evidence_boundary: Date | string; source_record_ids_json: string;
}>;

function iso(value: Date | string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:TIME");
  return date.toISOString();
}

function knowledgeDigest(organizationId: string, symbol: string, pitAnchor: string, rows: readonly KnowledgeRow[]): string {
  return computeSemanticSha256Hex({
    schemaVersion: HISTORICAL_SIMULATION_KNOWLEDGE_BINDING_V2,
    organizationId,
    symbol,
    visibleEvidence: rows.map((row) => {
      const source = JSON.parse(row.source_record_ids_json) as Record<string, unknown>;
      const visible = source.visible_from_cycle_pit_anchor;
      if (typeof visible !== "string" || iso(visible) > pitAnchor) {
        throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:KNOWLEDGE_SOURCE");
      }
      return {
        id: row.id, knowledgeEdgeId: row.knowledge_edge_id, contentDigestHex: row.content_digest,
        resolvedAt: iso(row.resolved_at), pitEvidenceBoundary: iso(row.pit_evidence_boundary),
        visibleFromPitAnchor: visible,
        forecastAuthorityContentDigestHex: source.forecast_runtime_authority_content_digest_hex,
        outcomeContentDigestHex: source.forecast_outcome_content_digest_hex,
      };
    }).sort((a, b) => a.contentDigestHex.localeCompare(b.contentDigestHex)),
  });
}

export function createPostgresHistoricalForecastInputPitProducerV2(sql: postgres.Sql) {
  return async (input: Readonly<{
    organizationId: string; runId: string; cycleId: string; forecastId: string;
    symbol: "BTCUSDT" | "ETHUSDT"; pitAnchor: string; runtimeInput: ForecastRuntimeInputV2;
  }>): Promise<HistoricalForecastInputPitRecordV2> => {
    if (iso(input.pitAnchor) !== input.pitAnchor) throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:PIT");
    const outcome = issueForecastRuntimeV2(input.runtimeInput);
    if (outcome.status !== "FORECAST_AUTHORIZED" ||
        outcome.authority.organizationId !== input.organizationId ||
        outcome.authority.anchorClosedBarAt !== input.pitAnchor) {
      throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:FORECAST_REPLAY");
    }

    const forecasts = await sql<Readonly<{
      organization_id: string; run_id: string; cycle_id: string; symbol: string;
      anchor_epoch_ms: string | number; authorized_outcome: unknown;
    }>[]>`
      SELECT b.organization_id::text, b.run_id, b.cycle_id, b.symbol,
             b.anchor_closed_bar_epoch_ms AS anchor_epoch_ms,
             b.forecast_runtime_authorized_outcome_json AS authorized_outcome
      FROM trader_forecast_v2 f JOIN trader_forecast_bundle_v2 b
        ON b.organization_id=f.organization_id AND b.id=f.bundle_id
      WHERE f.organization_id=${input.organizationId}::uuid AND f.id=${input.forecastId}::uuid
        AND f.target_role_id='EXECUTION_OPPORTUNITY'
    `;
    const forecast = forecasts[0];
    const persistedAuthority = (forecast?.authorized_outcome as
      { status?: unknown; authority?: { contentDigestHex?: unknown } } | undefined)?.authority;
    if (!forecast || forecasts.length !== 1 || forecast.run_id !== input.runId ||
        forecast.cycle_id !== input.cycleId || forecast.symbol.replace("/", "") !== input.symbol ||
        new Date(Number(forecast.anchor_epoch_ms)).toISOString() !== input.pitAnchor ||
        persistedAuthority?.contentDigestHex !== outcome.authority.contentDigestHex) {
      throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:CANONICAL_FORECAST");
    }

    const binding = input.runtimeInput.forecastContractBinding;
    if (!binding) throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:BINDING");
    const durableBinding = await readForecastContractBindingV1(sql, {
      organizationId: input.organizationId,
      selectedPredictivePackageContentDigestHex: binding.selectedPredictivePackageContentDigestHex,
    });
    if (!durableBinding || canonicalizeSemanticJsonString(durableBinding) !== canonicalizeSemanticJsonString(binding)) {
      throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:BINDING");
    }
    const bindingSources = await sql<{ content_digest: string }[]>`
      SELECT cb.content_digest
      FROM trader_forecast_contract_binding_v1 cb
      JOIN trader_forecast_predictive_package_v2 p
        ON p.organization_id=cb.organization_id
       AND p.predictive_package_content_digest=cb.selected_predictive_package_content_digest
      WHERE cb.organization_id=${input.organizationId}::uuid
        AND cb.content_digest=${binding.contentDigestHex}
        AND cb.created_at <= ${input.pitAnchor}::timestamptz
        AND p.created_at <= ${input.pitAnchor}::timestamptz
    `;
    if (bindingSources.length !== 1) throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:FUTURE_BINDING_OR_PACKAGE");
    const scientific = await sql<{ id: string; content_digest: string; selected_package_content_digest: string | null }[]>`
      SELECT id::text, content_digest, selected_package_content_digest
      FROM trader_scientific_admission_receipt_v1
      WHERE organization_id=${input.organizationId}::uuid
        AND id=${binding.scientificAdmissionReceiptId}::uuid
        AND content_digest=${binding.scientificAdmissionReceiptContentDigestHex}
        AND created_at <= ${input.pitAnchor}::timestamptz
    `;
    if (scientific.length !== 1 || scientific[0]?.selected_package_content_digest !== binding.selectedPredictivePackageContentDigestHex) {
      throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:SCIENTIFIC_SOURCE");
    }

    const knowledgeRows = await sql<KnowledgeRow[]>`
      SELECT id::text, knowledge_edge_id::text, content_digest, resolved_at,
             pit_evidence_boundary, source_record_ids_json
      FROM trader_knowledge_confidence_update_record
      WHERE organization_id=${input.organizationId}::uuid AND symbol=${input.symbol}
        AND update_model_version LIKE '%.forecast-v2-evidence-only'
        AND (source_record_ids_json::jsonb ->> 'visible_from_cycle_pit_anchor')::timestamptz
              <= ${input.pitAnchor}::timestamptz
      ORDER BY content_digest ASC
    `;
    const knowledgeContentDigestHex = knowledgeDigest(input.organizationId, input.symbol, input.pitAnchor, knowledgeRows);
    if (input.runtimeInput.knowledgeContentDigestHex !== knowledgeContentDigestHex ||
        outcome.authority.knowledgeContentDigestHex !== knowledgeContentDigestHex) {
      throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:KNOWLEDGE_SOURCE");
    }
    const body = {
      schemaVersion: HISTORICAL_FORECAST_INPUT_PIT_V2,
      organizationId: input.organizationId, runId: input.runId, cycleId: input.cycleId,
      forecastId: input.forecastId, symbol: input.symbol, pitAnchor: input.pitAnchor,
      visibleFrom: input.pitAnchor, knowledgeContentDigestHex,
      forecastAuthorityContentDigestHex: outcome.authority.contentDigestHex,
      runtimeInput: input.runtimeInput,
    };
    const record = Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
    await sql`
      INSERT INTO trader_historical_forecast_input_pit_v2 (
        organization_id, run_id, cycle_id, forecast_id, symbol, pit_anchor, visible_from,
        knowledge_content_digest_hex, forecast_authority_content_digest_hex,
        runtime_input_json, content_digest_hex, schema_version
      ) VALUES (
        ${record.organizationId}::uuid, ${record.runId}, ${record.cycleId}, ${record.forecastId}::uuid,
        ${record.symbol}, ${record.pitAnchor}::timestamptz, ${record.visibleFrom}::timestamptz,
        ${record.knowledgeContentDigestHex}, ${record.forecastAuthorityContentDigestHex},
        ${sql.json(JSON.parse(JSON.stringify(record.runtimeInput)) as postgres.JSONValue)},
        ${record.contentDigestHex}, ${record.schemaVersion}
      ) ON CONFLICT (organization_id, run_id, cycle_id) DO NOTHING
    `;
    const persisted = await sql<{ content_digest_hex: string }[]>`
      SELECT content_digest_hex FROM trader_historical_forecast_input_pit_v2
      WHERE organization_id=${record.organizationId}::uuid AND run_id=${record.runId} AND cycle_id=${record.cycleId}
    `;
    if (persisted.length !== 1 || persisted[0]?.content_digest_hex !== record.contentDigestHex) {
      throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:IDEMPOTENCY_CONFLICT");
    }
    return record;
  };
}
