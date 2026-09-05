import type postgres from "postgres";
import { isDeepStrictEqual } from "node:util";

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
import { verifyHistoricalForecastInformationProofV2 } from
  "@/lib/trader/intelligence/forecast-v2/forecast-v2-persistence-service";
import { digestHex } from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import { requireScientificAdmissionV2, type ScientificAdmissionReceiptV2 } from "@/lib/trader/research/execopp-qualification/scientific-admission-v2";
import type { HistoricalDatasetMembershipV2 } from "./dataset-membership-v2";
import {
  buildHistoricalKnowledgeSnapshotAuthorityFromRowsV2,
  type HistoricalForecastPitKnowledgeRowV2,
} from "./knowledge-snapshot-binding-v2";
export { computeHistoricalForecastPitKnowledgeDigestV2 } from
  "./knowledge-snapshot-binding-v2";
export type { HistoricalForecastPitKnowledgeRowV2 } from
  "./knowledge-snapshot-binding-v2";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { withPostgresSerializableTransactionRetryV2 } from
  "./postgres-session-transaction-v2";

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
  datasetAuthorityDigestHex: string;
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

export function createPostgresHistoricalForecastInputPitProducerV2(sql: postgres.Sql) {
  return async (input: Readonly<{
  organizationId: string; runId: string; cycleId: string; forecastId: string;
    symbol: "BTCUSDT" | "ETHUSDT"; pitAnchor: string; datasetAuthorityId: string;
  }>): Promise<HistoricalForecastInputPitRecordV2> => {
    return withPostgresSerializableTransactionRetryV2(
      sql,
      async (sql) => {
    if (iso(input.pitAnchor) !== input.pitAnchor) throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:PIT");
    const priorRows = await sql<{ forecast_id: string; dataset_authority_id: string; symbol: string;
      pit_anchor: Date | string }[]>`
      SELECT forecast_id::text, dataset_authority_id::text, symbol, pit_anchor
      FROM trader_historical_forecast_input_pit_v2
      WHERE organization_id=${input.organizationId}::uuid AND run_id=${input.runId}
        AND cycle_id=${input.cycleId}
    `;
    const prior = priorRows[0];
    if (priorRows.length > 1 || (prior && (prior.forecast_id !== input.forecastId ||
        prior.dataset_authority_id !== input.datasetAuthorityId || prior.symbol !== input.symbol ||
        iso(prior.pit_anchor) !== input.pitAnchor))) {
      throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:IDEMPOTENCY_CONFLICT");
    }
    const runRows = await sql<{ started_at: Date | string }[]>`
      SELECT started_at FROM trader_historical_simulation_run_start_v2
      WHERE organization_id=${input.organizationId}::uuid AND run_id=${input.runId}
    `;
    if (runRows.length !== 1) throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:RUN_BOUNDARY");
    const datasets = await sql<{ membership_json: HistoricalDatasetMembershipV2; dataset_authority_digest_hex: string;
      authority_content_digest_hex: string; membership_content_digest_hex: string;
      sealed_cycle_content_digest_hex: string; sealed_cycle_json: unknown }[]>`
      SELECT membership_json, dataset_authority_digest_hex, authority_content_digest_hex,
             membership_content_digest_hex, sealed_cycle_content_digest_hex, sealed_cycle_json
      FROM trader_historical_dataset_authority_v2
      WHERE id=${input.datasetAuthorityId}::uuid AND organization_id=${input.organizationId}::uuid
        AND run_id=${input.runId} AND cycle_id=${input.cycleId}
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
    await verifyHistoricalForecastInformationProofV2(sql, {
      organizationId: input.organizationId,
      runId: input.runId,
      cycleId: input.cycleId,
      symbol: input.symbol,
      expectedDatasetAuthority: {
        id: input.datasetAuthorityId,
        datasetAuthorityDigestHex: dataset.dataset_authority_digest_hex,
        authorityContentDigestHex: dataset.authority_content_digest_hex,
        membershipContentDigestHex: dataset.membership_content_digest_hex,
        sealedCycleContentDigestHex: dataset.sealed_cycle_content_digest_hex,
      },
      runtimeInput,
    });
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
      },
    );
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
      WHERE organization_id=${input.organizationId}::uuid AND run_id=${input.runId}
        AND replace(symbol, '/', '')=replace(${input.symbol}, '/', '')
        AND update_model_version =
          'waia.trader.knowledge_confidence_update_model.v1.forecast-v2-evidence-only'
        AND (source_record_ids_json::jsonb ->> 'visible_from_cycle_pit_anchor')::timestamptz
              <= ${input.pitAnchor}::timestamptz
        AND resolved_at <= ${input.pitAnchor}::timestamptz
        AND pit_evidence_boundary <= ${input.pitAnchor}::timestamptz
      ORDER BY content_digest ASC
    `;
    let knowledgeSnapshotAuthority;
    try {
      knowledgeSnapshotAuthority = buildHistoricalKnowledgeSnapshotAuthorityFromRowsV2({
        organizationId: input.organizationId,
        runId: input.runId,
        symbol: input.symbol,
        pitAnchor: input.pitAnchor,
      }, knowledgeRows);
    } catch {
      throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:KNOWLEDGE_SOURCE");
    }
    const knowledgeContentDigestHex = knowledgeSnapshotAuthority.knowledgeContentDigestHex;
    if (runtimeInput.knowledgeContentDigestHex !== knowledgeContentDigestHex ||
        outcome.authority.knowledgeContentDigestHex !== knowledgeContentDigestHex ||
        !runtimeInput.historicalKnowledgeSnapshotAuthority ||
        !isDeepStrictEqual(
          runtimeInput.historicalKnowledgeSnapshotAuthority,
          knowledgeSnapshotAuthority,
        )) {
      throw new Error("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED:KNOWLEDGE_SOURCE");
    }
    const body = {
      schemaVersion: HISTORICAL_FORECAST_INPUT_PIT_V2,
      organizationId: input.organizationId, runId: input.runId, cycleId: input.cycleId,
      forecastId: input.forecastId, datasetMembership: cloneAndDeepFreeze(datasetMembership),
      forecastTargetRoleId: "EXECUTION_OPPORTUNITY" as const,
      forecastContentDigestHex: forecast.forecast_content_digest,
      bundleId: source.bundle_id, runtimeInputSourceId: source.id,
      datasetAuthorityId: input.datasetAuthorityId, datasetAuthorityDigestHex: dataset.dataset_authority_digest_hex,
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
        dataset_authority_id, dataset_authority_digest_hex, symbol, partition, record_index,
        dataset_membership_content_digest_hex, dataset_membership_json, pit_anchor, visible_from,
        knowledge_content_digest_hex, forecast_authority_content_digest_hex,
        runtime_input_content_digest_hex, verifier_build_digest_hex,
        runtime_input_json, content_digest_hex, schema_version
      ) VALUES (
        ${record.organizationId}::uuid, ${record.runId}, ${record.cycleId}, ${record.forecastId}::uuid,
        ${source.bundle_id}::uuid, ${record.forecastTargetRoleId},
        ${Buffer.from(record.forecastContentDigestHex, "hex")}, ${source.id}::uuid,
        ${input.datasetAuthorityId}::uuid,
        ${dataset.dataset_authority_digest_hex},
        ${record.symbol}, ${record.datasetMembership.partition}, ${record.datasetMembership.recordIndex},
        ${record.datasetMembership.contentDigestHex},
        ${JSON.stringify(record.datasetMembership)}::text::jsonb,
        ${record.pitAnchor}::timestamptz, ${record.visibleFrom}::timestamptz,
        ${record.knowledgeContentDigestHex}, ${record.forecastAuthorityContentDigestHex},
        ${source.runtime_input_content_digest_hex}, ${source.verifier_build_digest_hex},
        ${JSON.stringify(record.runtimeInput)}::text::jsonb,
        ${record.contentDigestHex}, ${record.schemaVersion}
      ) ON CONFLICT DO NOTHING
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
  };
}
