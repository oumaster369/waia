import type postgres from "postgres";

import {
  canonicalizeSemanticJsonString,
  computeSemanticSha256Hex,
} from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  issueForecastRuntimeV2,
  requireForecastRuntimeAuthorizedOutcomeV2,
  reviveForecastRuntimeJsonV2,
  type ForecastRuntimeInputV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import { readForecastContractBindingV1 } from "@/lib/trader/intelligence/forecast-v2/forecast-contract-binding-service-v1";
import { digestHex } from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import {
  computeKnowledgeConfidenceUpdateContentDigest,
  type KnowledgeConfidenceUpdateRecord,
} from "@/lib/trader/knowledge/knowledge-confidence-update";
import { requireScientificAdmissionV2, type ScientificAdmissionReceiptV2 } from "@/lib/trader/research/execopp-qualification/scientific-admission-v2";
import type { HistoricalDatasetMembershipV2 } from "./dataset-membership-v2";
import { HISTORICAL_SIMULATION_KNOWLEDGE_BINDING_V2 } from "./knowledge-port-postgres";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

export const HISTORICAL_FORECAST_INPUT_PIT_V2 =
  "waia.trader.historical_forecast_input_pit.v2" as const;

export type HistoricalForecastInputPitRecordV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_FORECAST_INPUT_PIT_V2;
  organizationId: string;
  runId: string;
  cycleId: string;
  forecastId: string;
  forecastTargetRoleId: "EXECUTION_OPPORTUNITY";
  forecastContentDigestHex: string;
  bundleId: string;
  runtimeInputSourceId: string;
  datasetAuthorityId: string;
  datasetSealDigestHex: string;
  datasetMembership: HistoricalDatasetMembershipV2;
  symbol: "BTCUSDT" | "ETHUSDT";
  pitAnchor: string;
  visibleFrom: string;
  knowledgeContentDigestHex: string;
  forecastAuthorityContentDigestHex: string;
  runtimeInputContentDigestHex: string;
  verifierBuildDigestHex: string;
  runtimeInput: ForecastRuntimeInputV2;
  contentDigestHex: string;
}>;

export type HistoricalForecastPitKnowledgeRowV2 = Readonly<{
  id: string; organization_id: string; run_id: string; cycle_id: string; symbol: string;
  knowledge_edge_id: string; update_kind: string; update_model_version: string;
  prior_confidence: string; posterior_confidence: string; delta: string;
  issued_at: Date | string; eligible_resolution_at: Date | string; resolved_at: Date | string;
  pit_evidence_boundary: Date | string; outcome_class: string; score: string | null;
  source_record_ids_json: string; content_digest: string; idempotency_key: string;
  provenance_json: string; terminal_reason: string; schema_version: string;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;

function currentVerifierBuildDigest(): string {
  const release = process.env.WAIA_RELEASE_SHA;
  const vercel = process.env.VERCEL_GIT_COMMIT_SHA;
  if (release && vercel && release !== vercel) throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:BUILD_SHA_CONFLICT");
  const sha = release ?? vercel;
  if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:BUILD_SHA_MISSING");
  return computeSemanticSha256Hex({ verifierVersion: "waia.forecast-runtime-input-source.verifier.v2", sourceSha: sha.toLowerCase() });
}

function validateMembership(value: HistoricalDatasetMembershipV2, input: {
  organizationId: string; cycleId: string; symbol: string;
}): void {
  const { contentDigestHex, ...body } = value;
  if (!DIGEST.test(contentDigestHex) || computeSemanticSha256Hex(body) !== contentDigestHex ||
      value.organizationId !== input.organizationId || value.cycleId !== input.cycleId ||
      value.symbol !== input.symbol || (value.partition !== "DEVELOPMENT" && value.partition !== "WALK_FORWARD")) {
    throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:DATASET_MEMBERSHIP");
  }
}

function mapKnowledgeRow(row: HistoricalForecastPitKnowledgeRowV2): KnowledgeConfidenceUpdateRecord {
  const source = JSON.parse(row.source_record_ids_json) as Record<string, unknown>;
  const requiredAuthority = ["confidence_value_class", "authority_class", "operator_disposition",
    "capital_authority", "strategy_authority", "trade_eligibility_authority", "guardian_authority"];
  if (requiredAuthority.some((key) => typeof source[key] !== "string")) {
    throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:KNOWLEDGE_AUTHORITY_SOURCE");
  }
  return {
    id: row.id, organizationId: row.organization_id, runId: row.run_id, cycleId: row.cycle_id,
    symbol: row.symbol, knowledgeEdgeId: row.knowledge_edge_id,
    updateKind: row.update_kind as KnowledgeConfidenceUpdateRecord["updateKind"],
    updateModelVersion: row.update_model_version,
    priorMachineRecommendedConfidence: row.prior_confidence,
    machineRecommendedConfidence: row.posterior_confidence, machineRecommendedDelta: row.delta,
    confidenceValueClass: source.confidence_value_class as KnowledgeConfidenceUpdateRecord["confidenceValueClass"],
    authorityClass: source.authority_class as KnowledgeConfidenceUpdateRecord["authorityClass"],
    operatorDisposition: source.operator_disposition as KnowledgeConfidenceUpdateRecord["operatorDisposition"],
    capitalAuthority: source.capital_authority as KnowledgeConfidenceUpdateRecord["capitalAuthority"],
    strategyAuthority: source.strategy_authority as KnowledgeConfidenceUpdateRecord["strategyAuthority"],
    tradeEligibilityAuthority: source.trade_eligibility_authority as KnowledgeConfidenceUpdateRecord["tradeEligibilityAuthority"],
    guardianAuthority: source.guardian_authority as KnowledgeConfidenceUpdateRecord["guardianAuthority"],
    issuedAt: iso(row.issued_at), eligibleResolutionAt: iso(row.eligible_resolution_at),
    resolvedAt: iso(row.resolved_at), pitEvidenceBoundary: iso(row.pit_evidence_boundary),
    outcomeClass: row.outcome_class, score: row.score, sourceRecordIdsJson: row.source_record_ids_json,
    contentDigest: row.content_digest, idempotencyKey: row.idempotency_key,
    provenance: JSON.parse(row.provenance_json) as KnowledgeConfidenceUpdateRecord["provenance"],
    terminalReason: row.terminal_reason,
    schemaVersion: row.schema_version as KnowledgeConfidenceUpdateRecord["schemaVersion"],
  };
}

function iso(value: Date | string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:TIME");
  return date.toISOString();
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

export function computeHistoricalForecastPitKnowledgeDigestV2(organizationId: string, symbol: string, pitAnchor: string, rows: readonly HistoricalForecastPitKnowledgeRowV2[]): string {
  return computeSemanticSha256Hex({
    schemaVersion: HISTORICAL_SIMULATION_KNOWLEDGE_BINDING_V2,
    organizationId,
    symbol,
    visibleEvidence: rows.map((row) => {
      const source = JSON.parse(row.source_record_ids_json) as Record<string, unknown>;
      const visible = source.visible_from_cycle_pit_anchor;
      const canonical = mapKnowledgeRow(row);
      if (!UUID.test(row.id) || !UUID.test(row.knowledge_edge_id) || !DIGEST.test(row.content_digest) ||
          computeKnowledgeConfidenceUpdateContentDigest(canonical) !== row.content_digest ||
          typeof visible !== "string" || iso(visible) > pitAnchor || canonical.resolvedAt > pitAnchor ||
          canonical.pitEvidenceBoundary > pitAnchor || canonical.resolvedAt > iso(visible)) {
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
    symbol: "BTCUSDT" | "ETHUSDT"; pitAnchor: string; datasetAuthorityId: string;
  }>): Promise<HistoricalForecastInputPitRecordV2> => {
    const produceOnce = () => sql.begin("isolation level serializable", async (transaction) => {
    const sql = transaction as unknown as postgres.Sql;
    if (iso(input.pitAnchor) !== input.pitAnchor) throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:PIT");
    const priorRows = await sql<{ forecast_id: string; dataset_authority_id: string; symbol: string;
      pit_anchor: Date | string }[]>`
      SELECT forecast_id::text, dataset_authority_id::text, symbol, pit_anchor
      FROM trader_historical_forecast_input_pit_v2
      WHERE organization_id=${input.organizationId}::uuid AND run_id=${input.runId}
        AND cycle_id=${input.cycleId} FOR SHARE
    `;
    const prior = priorRows[0];
    if (priorRows.length > 1 || (prior && (prior.forecast_id !== input.forecastId ||
        prior.dataset_authority_id !== input.datasetAuthorityId || prior.symbol !== input.symbol ||
        iso(prior.pit_anchor) !== input.pitAnchor))) {
      throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:IDEMPOTENCY_CONFLICT");
    }
    const runRows = await sql<{ started_at: Date | string }[]>`
      SELECT started_at FROM trader_historical_simulation_run_start_v2
      WHERE organization_id=${input.organizationId}::uuid AND run_id=${input.runId} FOR SHARE
    `;
    if (runRows.length !== 1) throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:RUN_BOUNDARY");
    const datasets = await sql<{ membership_json: HistoricalDatasetMembershipV2; dataset_seal_digest_hex: string;
      authority_content_digest_hex: string; sealed_cycle_json: unknown }[]>`
      SELECT membership_json, dataset_seal_digest_hex, authority_content_digest_hex, sealed_cycle_json
      FROM trader_historical_dataset_authority_v2
      WHERE id=${input.datasetAuthorityId}::uuid AND organization_id=${input.organizationId}::uuid
        AND run_id=${input.runId} AND cycle_id=${input.cycleId}
      FOR SHARE
    `;
    const dataset = datasets[0];
    if (!dataset || datasets.length !== 1 || computeStableJsonDigest({ organizationId: input.organizationId,
      runId: input.runId, membership: dataset.membership_json, sealedCycle: dataset.sealed_cycle_json }) !==
      dataset.authority_content_digest_hex) {
      throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:DATASET_AUTHORITY");
    }
    const datasetMembership = dataset.membership_json;
    validateMembership(datasetMembership, input);
    const sourceRows = await sql<{ id: string; bundle_id: string; runtime_input_json: ForecastRuntimeInputV2;
      execution_forecast_target_role_id: string; execution_forecast_content_digest_hex: string;
      runtime_input_content_digest_hex: string; verifier_build_digest_hex: string }[]>`
      SELECT s.id::text, s.bundle_id::text, s.runtime_input_json,
             s.execution_forecast_target_role_id,
             encode(s.execution_forecast_content_digest, 'hex') AS execution_forecast_content_digest_hex,
             s.runtime_input_content_digest_hex, s.verifier_build_digest_hex
      FROM trader_forecast_runtime_input_source_v2 s
      JOIN trader_forecast_v2 f ON f.organization_id=s.organization_id
        AND f.id=s.execution_forecast_id AND f.bundle_id=s.bundle_id
      WHERE s.organization_id=${input.organizationId}::uuid AND s.run_id=${input.runId}
        AND s.cycle_id=${input.cycleId} AND s.execution_forecast_id=${input.forecastId}::uuid
        AND s.symbol=${input.symbol} AND s.pit_anchor=${input.pitAnchor}::timestamptz
      FOR SHARE OF s
    `;
    const source = sourceRows[0];
    if (!source || sourceRows.length !== 1) throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:RUNTIME_INPUT_SOURCE_IDENTITY");
    if (computeSemanticSha256Hex(source.runtime_input_json) !== source.runtime_input_content_digest_hex)
      throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:RUNTIME_INPUT_SOURCE_DIGEST");
    if (source.verifier_build_digest_hex !== currentVerifierBuildDigest())
      throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:RUNTIME_INPUT_SOURCE_BUILD");
    if (source.execution_forecast_target_role_id !== "EXECUTION_OPPORTUNITY" ||
        !DIGEST.test(source.execution_forecast_content_digest_hex))
      throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:RUNTIME_INPUT_SOURCE_FORECAST");
    const runtimeInput = reviveForecastRuntimeJsonV2(source.runtime_input_json);
    const outcome = issueForecastRuntimeV2(runtimeInput);
    if (outcome.status !== "FORECAST_AUTHORIZED" ||
        outcome.authority.organizationId !== input.organizationId ||
        outcome.authority.anchorClosedBarAt !== input.pitAnchor) {
      throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:FORECAST_REPLAY");
    }

    const forecasts = await sql<Readonly<{
      organization_id: string; run_id: string; cycle_id: string; symbol: string; forecast_schema: string;
      forecast_content_digest: string; anchor_epoch_ms: string | number; authorized_outcome: unknown;
    }>[]>`
      SELECT b.organization_id::text, b.run_id, b.cycle_id, b.symbol,
             f.schema_version::text AS forecast_schema,
             encode(f.forecast_content_digest, 'hex') AS forecast_content_digest,
             b.anchor_closed_bar_epoch_ms AS anchor_epoch_ms,
             b.forecast_runtime_authorized_outcome_json AS authorized_outcome
      FROM trader_forecast_v2 f JOIN trader_forecast_bundle_v2 b
        ON b.organization_id=f.organization_id AND b.id=f.bundle_id
      WHERE f.organization_id=${input.organizationId}::uuid AND f.id=${input.forecastId}::uuid
        AND f.target_role_id='EXECUTION_OPPORTUNITY'
      FOR SHARE OF f, b
    `;
    const forecast = forecasts[0];
    const persistedOutcome = forecast ? requireForecastRuntimeAuthorizedOutcomeV2(forecast.authorized_outcome as never) : null;
    if (!forecast || forecasts.length !== 1 || forecast.run_id !== input.runId ||
        forecast.cycle_id !== input.cycleId || forecast.symbol.replace("/", "") !== input.symbol ||
        Number(forecast.forecast_schema) !== 2 || !DIGEST.test(forecast.forecast_content_digest) ||
        forecast.forecast_content_digest !== digestHex(outcome.issuance.forecastContentDigestExec) ||
        forecast.forecast_content_digest !== source.execution_forecast_content_digest_hex ||
        new Date(Number(forecast.anchor_epoch_ms)).toISOString() !== input.pitAnchor ||
        canonicalizeSemanticJsonString(persistedOutcome) !== canonicalizeSemanticJsonString(outcome)) {
      throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:CANONICAL_FORECAST");
    }

    const binding = runtimeInput.forecastContractBinding;
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
      JOIN trader_historical_simulation_run_start_v2 rs
        ON rs.organization_id=cb.organization_id AND rs.run_id=${input.runId}
      WHERE cb.organization_id=${input.organizationId}::uuid
        AND cb.content_digest=${binding.contentDigestHex}
        AND cb.created_at <= rs.started_at
        AND p.created_at <= rs.started_at
      FOR SHARE OF cb, p, rs
    `;
    if (bindingSources.length !== 1) throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:FUTURE_BINDING_OR_PACKAGE");
    const scientific = await sql<{ id: string; content_digest: string; selected_package_content_digest: string | null; receipt_json: string }[]>`
      SELECT id::text, content_digest, selected_package_content_digest, receipt_json
      FROM trader_scientific_admission_receipt_v1
      JOIN trader_historical_simulation_run_start_v2 rs
        ON rs.organization_id=trader_scientific_admission_receipt_v1.organization_id
       AND rs.run_id=${input.runId}
      WHERE trader_scientific_admission_receipt_v1.organization_id=${input.organizationId}::uuid
        AND trader_scientific_admission_receipt_v1.id=${binding.scientificAdmissionReceiptId}::uuid
        AND trader_scientific_admission_receipt_v1.content_digest=${binding.scientificAdmissionReceiptContentDigestHex}
        AND trader_scientific_admission_receipt_v1.created_at <= rs.started_at
      FOR SHARE OF trader_scientific_admission_receipt_v1, rs
    `;
    if (scientific.length !== 1 || scientific[0]?.selected_package_content_digest !== binding.selectedPredictivePackageContentDigestHex) {
      throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:SCIENTIFIC_SOURCE");
    }
    const scientificReceipt = JSON.parse(scientific[0]!.receipt_json) as ScientificAdmissionReceiptV2;
    const predictive = scientificReceipt.predictiveTerminalReceipt;
    requireScientificAdmissionV2(scientificReceipt, {
      organizationId: scientificReceipt.organizationId,
      developmentDatasetDigestHex: predictive.developmentDatasetDigestHex,
      targetGridReceiptDigestHex: predictive.targetGridReceiptDigestHex,
      predictivePackageGenerationIdentityDigestHex: predictive.predictivePackageGenerationIdentityDigestHex,
      predictivePackageContentDigestHex: predictive.predictivePackageContentDigestHex,
      runtimeContractDigestHex: predictive.runtimeContractDigestHex,
      scoringContractVersion: predictive.scoringContractVersion,
      evaluationPartitionReceiptDigestHex: predictive.evaluationPartitionReceiptDigestHex,
      kmConvergenceEvidenceSemanticDigestHex: scientificReceipt.kmConvergenceReceipt.evidenceSemanticDigestHex,
      epistemicParameterRatificationReceiptDigestHex: scientificReceipt.epistemicParameterRatificationReceipt.contentDigestHex,
      predictiveTerminalReceiptContentDigestHex: predictive.contentDigestHex,
    });
    if (scientificReceipt.contentDigestHex !== scientific[0]!.content_digest || scientificReceipt.organizationId !== input.organizationId) {
      throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:SCIENTIFIC_SOURCE");
    }

    const knowledgeRows = await sql<HistoricalForecastPitKnowledgeRowV2[]>`
      SELECT id::text, organization_id::text, run_id, cycle_id, symbol, knowledge_edge_id::text,
             update_kind, update_model_version, prior_confidence, posterior_confidence, delta,
             issued_at, eligible_resolution_at, resolved_at, pit_evidence_boundary, outcome_class,
             score, source_record_ids_json, content_digest, idempotency_key, provenance_json,
             terminal_reason, schema_version
      FROM trader_knowledge_confidence_update_record
      WHERE organization_id=${input.organizationId}::uuid AND run_id=${input.runId} AND symbol=${input.symbol}
        AND update_model_version LIKE '%.forecast-v2-evidence-only'
        AND (source_record_ids_json::jsonb ->> 'visible_from_cycle_pit_anchor')::timestamptz
              <= ${input.pitAnchor}::timestamptz
        AND resolved_at <= ${input.pitAnchor}::timestamptz
        AND pit_evidence_boundary <= ${input.pitAnchor}::timestamptz
      ORDER BY content_digest ASC
      FOR SHARE
    `;
    const knowledgeContentDigestHex = computeHistoricalForecastPitKnowledgeDigestV2(input.organizationId, input.symbol, input.pitAnchor, knowledgeRows);
    if (runtimeInput.knowledgeContentDigestHex !== knowledgeContentDigestHex ||
        outcome.authority.knowledgeContentDigestHex !== knowledgeContentDigestHex) {
      throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:KNOWLEDGE_SOURCE");
    }
    const body = {
      schemaVersion: HISTORICAL_FORECAST_INPUT_PIT_V2,
      organizationId: input.organizationId, runId: input.runId, cycleId: input.cycleId,
      forecastId: input.forecastId, datasetMembership: cloneAndDeepFreeze(datasetMembership),
      forecastTargetRoleId: "EXECUTION_OPPORTUNITY" as const,
      forecastContentDigestHex: forecast.forecast_content_digest,
      bundleId: source.bundle_id, runtimeInputSourceId: source.id,
      datasetAuthorityId: input.datasetAuthorityId, datasetSealDigestHex: dataset.dataset_seal_digest_hex,
      symbol: input.symbol, pitAnchor: input.pitAnchor,
      visibleFrom: input.pitAnchor, knowledgeContentDigestHex,
      forecastAuthorityContentDigestHex: outcome.authority.contentDigestHex,
      runtimeInputContentDigestHex: source.runtime_input_content_digest_hex,
      verifierBuildDigestHex: source.verifier_build_digest_hex,
      runtimeInput: cloneAndDeepFreeze(runtimeInput),
    };
    const record = cloneAndDeepFreeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
    await sql`
      INSERT INTO trader_historical_forecast_input_pit_v2 (
        organization_id, run_id, cycle_id, forecast_id, bundle_id,
        forecast_target_role_id, forecast_content_digest, runtime_input_source_id,
        dataset_authority_id, dataset_seal_digest_hex, symbol, partition, record_index,
        dataset_membership_content_digest_hex, dataset_membership_json, pit_anchor, visible_from,
        knowledge_content_digest_hex, forecast_authority_content_digest_hex,
        runtime_input_content_digest_hex, verifier_build_digest_hex,
        runtime_input_json, content_digest_hex, schema_version
      ) VALUES (
        ${record.organizationId}::uuid, ${record.runId}, ${record.cycleId}, ${record.forecastId}::uuid,
        ${source.bundle_id}::uuid, ${record.forecastTargetRoleId},
        ${Buffer.from(record.forecastContentDigestHex, "hex")}, ${source.id}::uuid,
        ${input.datasetAuthorityId}::uuid,
        ${dataset.dataset_seal_digest_hex},
        ${record.symbol}, ${record.datasetMembership.partition}, ${record.datasetMembership.recordIndex},
        ${record.datasetMembership.contentDigestHex}, ${sql.json(JSON.parse(JSON.stringify(record.datasetMembership)) as postgres.JSONValue)},
        ${record.pitAnchor}::timestamptz, ${record.visibleFrom}::timestamptz,
        ${record.knowledgeContentDigestHex}, ${record.forecastAuthorityContentDigestHex},
        ${source.runtime_input_content_digest_hex}, ${source.verifier_build_digest_hex},
        ${sql.json(JSON.parse(JSON.stringify(record.runtimeInput)) as postgres.JSONValue)},
        ${record.contentDigestHex}, ${record.schemaVersion}
      ) ON CONFLICT (organization_id, run_id, cycle_id) DO NOTHING
    `;
    const persisted = await sql<{ content_digest_hex: string }[]>`
      SELECT content_digest_hex FROM trader_historical_forecast_input_pit_v2
      WHERE organization_id=${record.organizationId}::uuid AND run_id=${record.runId}
        AND cycle_id=${record.cycleId} AND symbol=${record.symbol}
        AND partition=${record.datasetMembership.partition}
        AND dataset_membership_content_digest_hex=${record.datasetMembership.contentDigestHex}
    `;
    if (persisted.length !== 1 || persisted[0]?.content_digest_hex !== record.contentDigestHex) {
      throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:IDEMPOTENCY_CONFLICT");
    }
    for (const knowledgeRow of knowledgeRows) {
      await sql`INSERT INTO trader_historical_forecast_input_knowledge_link_v2
        (organization_id, run_id, cycle_id, knowledge_update_id, knowledge_update_content_digest_hex)
        VALUES (${record.organizationId}::uuid, ${record.runId}, ${record.cycleId},
          ${knowledgeRow.id}::uuid, ${knowledgeRow.content_digest}) ON CONFLICT DO NOTHING`;
    }
    return record;
    });
    // Two workers may legitimately race on the same first cycle. PostgreSQL SERIALIZABLE can
    // abort one even though both inputs are identical; retry the whole source-lock/replay
    // transaction and let the exact digest comparison below distinguish retry from conflict.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await produceOnce(); }
      catch (error) {
        if ((error as { code?: string }).code !== "40001" || attempt === 2) throw error;
      }
    }
    throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:SERIALIZATION_RETRY_EXHAUSTED");
  };
}
