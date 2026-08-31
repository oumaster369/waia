import type postgres from "postgres";

import {
  issueForecastRuntimeV2,
  reviveForecastRuntimeJsonV2,
  type ForecastRuntimeInputV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import { canonicalizeSemanticJsonString, computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { HistoricalDatasetMembershipV2 } from "./dataset-membership-v2";
import { computeHistoricalForecastPitKnowledgeDigestV2, HISTORICAL_FORECAST_INPUT_PIT_V2,
  type HistoricalForecastPitKnowledgeRowV2 } from "./pit-forecast-input-producer-v2";
import { requireScientificAdmissionV2, type ScientificAdmissionReceiptV2 } from "@/lib/trader/research/execopp-qualification/scientific-admission-v2";
import { digestHex } from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

type PitInputRow = Readonly<{
  organization_id: string;
  run_id: string;
  cycle_id: string;
  forecast_id: string;
  forecast_target_role_id: string;
  forecast_content_digest_hex: string;
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
  dataset_authority_id: string;
  bundle_id: string;
  runtime_input_source_id: string;
  dataset_seal_digest_hex: string;
  verifier_build_digest_hex: string;
  dataset_authority_content_digest_hex: string;
  sealed_cycle_json: unknown;
  runtime_input_content_digest_hex: string;
  source_runtime_input_json: ForecastRuntimeInputV2;
  source_authorized_outcome_json: unknown;
  source_forecast_authority_content_digest_hex: string;
  source_verifier_build_digest_hex: string;
  canonical_authorized_outcome_json: unknown;
  canonical_forecast_content_digest_hex: string;
  canonical_package_content_digest_hex: string;
  canonical_scientific_content_digest_hex: string;
  canonical_scientific_receipt_json: string;
  canonical_binding_content_digest_hex: string;
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
  datasetAuthorityId: string;
}>;

const DIGEST = /^[0-9a-f]{64}$/;

function currentVerifierBuildDigest(): string {
  const release = process.env.WAIA_RELEASE_SHA; const vercel = process.env.VERCEL_GIT_COMMIT_SHA;
  if (release && vercel && release !== vercel) throw new Error("HISTORICAL_FORECAST_PIT_REFUSED:BUILD_SHA_CONFLICT");
  const sha = release ?? vercel;
  if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) throw new Error("HISTORICAL_FORECAST_PIT_REFUSED:BUILD_SHA_MISSING");
  return computeSemanticSha256Hex({ verifierVersion: "waia.forecast-runtime-input-source.verifier.v2", sourceSha: sha.toLowerCase() });
}

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
    row.forecast_target_role_id !== "EXECUTION_OPPORTUNITY" ||
    !DIGEST.test(row.forecast_content_digest_hex) ||
    pitAnchor !== expected.pitAnchor || utc(row.visible_from) > expected.pitAnchor ||
    row.knowledge_content_digest_hex !== expected.knowledgeContentDigestHex ||
    !DIGEST.test(expected.knowledgeContentDigestHex) || row.schema_version !== HISTORICAL_FORECAST_INPUT_PIT_V2 ||
    row.forecast_authority_content_digest_hex !== expected.forecastAuthorityContentDigestHex ||
    row.dataset_authority_id !== expected.datasetAuthorityId ||
    canonicalMembershipDigest(row.dataset_membership_json) !== row.dataset_membership_content_digest_hex ||
    computeStableJsonDigest({ organizationId: expected.organizationId, runId: expected.runId,
      membership: row.dataset_membership_json, sealedCycle: row.sealed_cycle_json }) !== row.dataset_authority_content_digest_hex ||
    computeSemanticSha256Hex(row.source_runtime_input_json) !== row.runtime_input_content_digest_hex ||
    computeSemanticSha256Hex(row.runtime_input_json) !== row.runtime_input_content_digest_hex ||
    canonicalizeSemanticJsonString(row.source_runtime_input_json) !== canonicalizeSemanticJsonString(row.runtime_input_json) ||
    row.source_forecast_authority_content_digest_hex !== expected.forecastAuthorityContentDigestHex ||
    row.source_verifier_build_digest_hex !== currentVerifierBuildDigest()
  ) throw new Error("HISTORICAL_FORECAST_PIT_REFUSED:SCOPE_OR_PIT_MISMATCH");

  const input = reviveForecastRuntimeJsonV2(row.runtime_input_json);
  const binding = input.forecastContractBinding;
  const scientific = reviveForecastRuntimeJsonV2(
    JSON.parse(row.canonical_scientific_receipt_json) as ScientificAdmissionReceiptV2,
  );
  if (input.knowledgeContentDigestHex !== expected.knowledgeContentDigestHex ||
    input.marketStateSnapshot?.organizationId !== expected.organizationId ||
    input.marketStateSnapshot.symbol.replace("/", "") !== expected.symbol ||
    input.marketStateSnapshot.pitAnchor !== expected.pitAnchor ||
    input.predictiveAdmissionReceipt?.pitAnchor !== expected.pitAnchor)
    throw new Error("HISTORICAL_FORECAST_PIT_REFUSED:INPUT_RUNTIME_BINDING_MISMATCH");
  if (
    binding?.organizationId !== expected.organizationId ||
    binding.contentDigestHex !== row.canonical_binding_content_digest_hex ||
    binding.selectedPredictivePackageContentDigestHex !== row.canonical_package_content_digest_hex ||
    binding.scientificAdmissionReceiptContentDigestHex !== row.canonical_scientific_content_digest_hex)
    throw new Error("HISTORICAL_FORECAST_PIT_REFUSED:INPUT_CONTRACT_BINDING_MISMATCH");
  if (scientific.contentDigestHex !== row.canonical_scientific_content_digest_hex)
    throw new Error("HISTORICAL_FORECAST_PIT_REFUSED:INPUT_SCIENTIFIC_BINDING_MISMATCH");
  if (
    canonicalizeSemanticJsonString(row.canonical_authorized_outcome_json) !== canonicalizeSemanticJsonString(row.source_authorized_outcome_json)
  ) throw new Error("HISTORICAL_FORECAST_PIT_REFUSED:INPUT_FORECAST_BINDING_MISMATCH");

  const predictive = scientific.predictiveTerminalReceipt;
  requireScientificAdmissionV2(scientific, {
    organizationId: scientific.organizationId,
    developmentDatasetDigestHex: predictive.developmentDatasetDigestHex,
    targetGridReceiptDigestHex: predictive.targetGridReceiptDigestHex,
    predictivePackageGenerationIdentityDigestHex: predictive.predictivePackageGenerationIdentityDigestHex,
    predictivePackageContentDigestHex: predictive.predictivePackageContentDigestHex,
    runtimeContractDigestHex: predictive.runtimeContractDigestHex,
    scoringContractVersion: predictive.scoringContractVersion,
    evaluationPartitionReceiptDigestHex: predictive.evaluationPartitionReceiptDigestHex,
    kmConvergenceEvidenceSemanticDigestHex: scientific.kmConvergenceReceipt.evidenceSemanticDigestHex,
    epistemicParameterRatificationReceiptDigestHex: scientific.epistemicParameterRatificationReceipt.contentDigestHex,
    predictiveTerminalReceiptContentDigestHex: predictive.contentDigestHex,
  });

  const body = { schemaVersion: HISTORICAL_FORECAST_INPUT_PIT_V2, organizationId: row.organization_id,
    runId: row.run_id, cycleId: row.cycle_id, forecastId: row.forecast_id,
    forecastTargetRoleId: "EXECUTION_OPPORTUNITY" as const,
    forecastContentDigestHex: row.forecast_content_digest_hex,
    bundleId: row.bundle_id, runtimeInputSourceId: row.runtime_input_source_id,
    datasetAuthorityId: row.dataset_authority_id, datasetSealDigestHex: row.dataset_seal_digest_hex,
    datasetMembership: row.dataset_membership_json, symbol: row.symbol, pitAnchor,
    visibleFrom: utc(row.visible_from), knowledgeContentDigestHex: row.knowledge_content_digest_hex,
    forecastAuthorityContentDigestHex: row.forecast_authority_content_digest_hex,
    runtimeInputContentDigestHex: row.runtime_input_content_digest_hex,
    verifierBuildDigestHex: row.verifier_build_digest_hex, runtimeInput: row.runtime_input_json };
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
  if (digestHex(outcome.issuance.forecastContentDigestExec) !== row.canonical_forecast_content_digest_hex ||
      row.forecast_content_digest_hex !== row.canonical_forecast_content_digest_hex) {
    throw new Error("HISTORICAL_FORECAST_PIT_REFUSED:FORECAST_MEMBER_MISMATCH");
  }
  if (canonicalizeSemanticJsonString(outcome) !== canonicalizeSemanticJsonString(
    reviveForecastRuntimeJsonV2(row.source_authorized_outcome_json),
  )) {
    throw new Error("HISTORICAL_FORECAST_PIT_REFUSED:AUTHORIZED_OUTCOME_SOURCE_MISMATCH");
  }
  return reviveForecastRuntimeJsonV2(cloneAndDeepFreeze(input));
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
    return sql.begin("isolation level repeatable read read only", async (transaction) => {
    const sql = transaction as unknown as postgres.Sql;
    const rows = await sql<PitInputRow[]>`
      SELECT p.organization_id::text, p.run_id, p.cycle_id, p.forecast_id::text, p.bundle_id::text,
             p.forecast_target_role_id, encode(p.forecast_content_digest, 'hex') AS forecast_content_digest_hex,
             p.runtime_input_source_id::text, p.dataset_seal_digest_hex, p.verifier_build_digest_hex,
             p.symbol, p.partition, p.record_index,
             p.dataset_membership_content_digest_hex, p.dataset_membership_json, p.pit_anchor, p.visible_from,
             p.knowledge_content_digest_hex, p.forecast_authority_content_digest_hex, p.runtime_input_json,
             p.content_digest_hex, p.schema_version, p.dataset_authority_id::text,
             d.authority_content_digest_hex AS dataset_authority_content_digest_hex, d.sealed_cycle_json,
             s.runtime_input_content_digest_hex, s.runtime_input_json AS source_runtime_input_json,
             s.authorized_outcome_json AS source_authorized_outcome_json,
             s.forecast_authority_content_digest_hex AS source_forecast_authority_content_digest_hex,
             s.verifier_build_digest_hex AS source_verifier_build_digest_hex,
             b.forecast_runtime_authorized_outcome_json AS canonical_authorized_outcome_json,
             encode(f.forecast_content_digest, 'hex') AS canonical_forecast_content_digest_hex,
             pkg.predictive_package_content_digest AS canonical_package_content_digest_hex,
             sci.content_digest AS canonical_scientific_content_digest_hex,
             sci.receipt_json AS canonical_scientific_receipt_json,
             cb.content_digest AS canonical_binding_content_digest_hex
      FROM trader_historical_forecast_input_pit_v2 p
      JOIN trader_historical_dataset_authority_v2 d ON d.id=p.dataset_authority_id
        AND d.organization_id=p.organization_id AND d.run_id=p.run_id AND d.cycle_id=p.cycle_id
      JOIN trader_forecast_runtime_input_source_v2 s ON s.id=p.runtime_input_source_id
        AND s.organization_id=p.organization_id AND s.bundle_id=p.bundle_id
        AND s.execution_forecast_id=p.forecast_id
        AND s.execution_forecast_target_role_id=p.forecast_target_role_id
        AND s.execution_forecast_content_digest=p.forecast_content_digest
      JOIN trader_forecast_v2 f ON f.id=p.forecast_id AND f.organization_id=p.organization_id
        AND f.bundle_id=p.bundle_id AND f.target_role_id=p.forecast_target_role_id
        AND f.forecast_content_digest=p.forecast_content_digest
      JOIN trader_forecast_bundle_v2 b ON b.id=p.bundle_id AND b.organization_id=p.organization_id
      JOIN trader_forecast_predictive_package_v2 pkg ON pkg.id=s.predictive_package_id
        AND pkg.organization_id=s.organization_id
      JOIN trader_scientific_admission_receipt_v1 sci ON sci.id=s.scientific_admission_receipt_id
        AND sci.organization_id=s.organization_id
      JOIN trader_forecast_contract_binding_v1 cb ON cb.organization_id=s.organization_id
        AND cb.content_digest=s.contract_binding_content_digest_hex
      WHERE p.organization_id=${expected.organizationId}::uuid AND p.run_id=${expected.runId}
        AND p.cycle_id=${expected.cycleId} AND p.forecast_id=${expected.forecastId}::uuid AND p.symbol=${expected.symbol}
        AND p.dataset_authority_id=${expected.datasetAuthorityId}::uuid
        AND p.pit_anchor=${expected.pitAnchor}::timestamptz
        AND p.knowledge_content_digest_hex=${expected.knowledgeContentDigestHex}
        AND p.forecast_authority_content_digest_hex=${expected.forecastAuthorityContentDigestHex}
        AND p.schema_version=${HISTORICAL_FORECAST_INPUT_PIT_V2}
        AND p.visible_from <= ${expected.pitAnchor}::timestamptz
    `;
    if (rows.length !== 1) throw new Error("HISTORICAL_FORECAST_PIT_REFUSED:EXACT_ROW_NOT_FOUND");
    const knowledgeRows = await sql<HistoricalForecastPitKnowledgeRowV2[]>`
      SELECT k.id::text, k.organization_id::text, k.run_id, k.cycle_id, k.symbol,
             k.knowledge_edge_id::text, k.update_kind, k.update_model_version,
             k.prior_confidence, k.posterior_confidence, k.delta, k.issued_at,
             k.eligible_resolution_at, k.resolved_at, k.pit_evidence_boundary,
             k.outcome_class, k.score, k.source_record_ids_json, k.content_digest,
             k.idempotency_key, k.provenance_json, k.terminal_reason, k.schema_version
      FROM trader_historical_forecast_input_knowledge_link_v2 l
      JOIN trader_knowledge_confidence_update_record k ON k.id=l.knowledge_update_id
        AND k.organization_id=l.organization_id AND k.content_digest=l.knowledge_update_content_digest_hex
      WHERE l.organization_id=${expected.organizationId}::uuid AND l.run_id=${expected.runId}
        AND l.cycle_id=${expected.cycleId} ORDER BY k.content_digest ASC`;
    if (computeHistoricalForecastPitKnowledgeDigestV2(expected.organizationId, expected.symbol,
      expected.pitAnchor, knowledgeRows) !== expected.knowledgeContentDigestHex) {
      throw new Error("HISTORICAL_FORECAST_PIT_REFUSED:KNOWLEDGE_CLOSURE_MISMATCH");
    }
    return assertHistoricalForecastInputPitBindingV2(rows[0]!, expected);
    });
  };
}
