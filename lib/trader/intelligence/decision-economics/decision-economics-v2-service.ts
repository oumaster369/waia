import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import { orgScopedPostgresPredicate } from "@/lib/waia-core/scope/org-context";
import { requireScientificAdmissionReceiptForOrganization } from "@/lib/trader/research/execopp-qualification/scientific-admission-receipt-service-v1";

import {
  computeDecisionEconomicsContentDigest,
  computeDecisionEvRangeV1,
  computeReplicaPayoffMeans,
  DECISION_ECONOMICS_SCHEMA_VERSION,
  ECONOMIC_SEMANTICS_VERSION,
  type DecisionEvRange,
} from "./decision-economics-v2";

export type PersistDecisionEconomicsV2Input = {
  organizationId: string;
  forecastId: string;
  decisionRecordId?: string | null;
  notionalUsdt: number;
  costRate: number;
  slippageBufferUsdt: number;
  replicaSamples: readonly (readonly (readonly number[])[])[];
  scientificAdmissionReceiptDigest?: string | null;
  /**
   * Must be true only after org-bound scientific admission was verified
   * (DB require* or TEST_ONLY ceremony identity check). Raw digests are never enough.
   */
  scientificAdmissionVerified: boolean;
};

export type DecisionEconomicsV2Record = {
  id: string;
  organizationId: string;
  forecastId: string;
  decisionRecordId: string | null;
  evLower: string;
  evBase: string;
  evUpper: string;
  decisionActionable: boolean;
  economicSemanticsVersion: string;
  scientificAdmissionReceiptDigest: string | null;
  muBaseReplicasJson: string;
  muLowerReplicasJson: string;
  reasonCodesJson: string;
  contentDigest: string;
  schemaVersion: typeof DECISION_ECONOMICS_SCHEMA_VERSION;
};

/**
 * Build a Decision economics record.
 * Capital-authoritative actionability requires scientificAdmissionVerified=true.
 * Prefer {@link buildCapitalDecisionEconomicsV2Record} for production DB-backed paths.
 */
export function buildDecisionEconomicsV2Record(
  input: PersistDecisionEconomicsV2Input,
): DecisionEconomicsV2Record {
  const means = computeReplicaPayoffMeans({
    notionalUsdt: input.notionalUsdt,
    costRate: input.costRate,
    slippageBufferUsdt: input.slippageBufferUsdt,
    replicaSamples: input.replicaSamples,
  });
  const evRange = computeDecisionEvRangeV1({
    muBaseReplicas: means.muBaseReplicas,
    muLowerReplicas: means.muLowerReplicas,
    scientificAdmissionVerified: input.scientificAdmissionVerified,
  });

  const record: Omit<DecisionEconomicsV2Record, "contentDigest"> = {
    id: randomUUID(),
    organizationId: input.organizationId,
    forecastId: input.forecastId,
    decisionRecordId: input.decisionRecordId ?? null,
    evLower: evRange.evLowerScale8,
    evBase: evRange.evBaseScale8,
    evUpper: evRange.evUpperScale8,
    decisionActionable: evRange.decisionActionable,
    economicSemanticsVersion: ECONOMIC_SEMANTICS_VERSION,
    scientificAdmissionReceiptDigest: input.scientificAdmissionReceiptDigest ?? null,
    muBaseReplicasJson: JSON.stringify(means.muBaseReplicas),
    muLowerReplicasJson: JSON.stringify(means.muLowerReplicas),
    reasonCodesJson: JSON.stringify(evRange.reasonCodes),
    schemaVersion: DECISION_ECONOMICS_SCHEMA_VERSION,
  };

  const contentDigest = computeDecisionEconomicsContentDigest({
    organizationId: record.organizationId,
    forecastId: record.forecastId,
    evLowerScale8: record.evLower,
    evBaseScale8: record.evBase,
    evUpperScale8: record.evUpper,
    decisionActionable: record.decisionActionable,
    economicSemanticsVersion: record.economicSemanticsVersion,
  });

  return { ...record, contentDigest };
}

/**
 * Capital-capable V2 Decision economics builder.
 * Loads + validates organization-bound scientific admission before actionability.
 * Admission ≠ Human capital authorization (H3 / frozen package remain unmet).
 */
export async function buildCapitalDecisionEconomicsV2Record(
  sql: postgres.Sql,
  input: {
    organizationId: string;
    forecastId: string;
    decisionRecordId?: string | null;
    notionalUsdt: number;
    costRate: number;
    slippageBufferUsdt: number;
    replicaSamples: readonly (readonly (readonly number[])[])[];
    scientificAdmissionEvidenceSemanticDigestHex: string;
  },
): Promise<DecisionEconomicsV2Record> {
  const admission = await requireScientificAdmissionReceiptForOrganization(sql, {
    organizationId: input.organizationId,
    evidenceSemanticDigestHex: input.scientificAdmissionEvidenceSemanticDigestHex,
  });
  return buildDecisionEconomicsV2Record({
    organizationId: input.organizationId,
    forecastId: input.forecastId,
    decisionRecordId: input.decisionRecordId,
    notionalUsdt: input.notionalUsdt,
    costRate: input.costRate,
    slippageBufferUsdt: input.slippageBufferUsdt,
    replicaSamples: input.replicaSamples,
    scientificAdmissionReceiptDigest: admission.contentDigest,
    scientificAdmissionVerified: true,
  });
}

export async function persistDecisionEconomicsV2(
  sql: postgres.Sql,
  record: DecisionEconomicsV2Record,
): Promise<void> {
  await sql`
    INSERT INTO trader_intelligence_decision_economics_v2 (
      id,
      organization_id,
      forecast_id,
      decision_record_id,
      ev_lower,
      ev_base,
      ev_upper,
      decision_actionable,
      economic_semantics_version,
      scientific_admission_receipt_digest,
      mu_base_replicas_json,
      mu_lower_replicas_json,
      reason_codes_json,
      content_digest,
      schema_version
    ) VALUES (
      ${record.id}::uuid,
      ${record.organizationId}::uuid,
      ${record.forecastId}::uuid,
      ${record.decisionRecordId}::uuid,
      ${record.evLower},
      ${record.evBase},
      ${record.evUpper},
      ${record.decisionActionable},
      ${record.economicSemanticsVersion},
      ${record.scientificAdmissionReceiptDigest},
      ${record.muBaseReplicasJson},
      ${record.muLowerReplicasJson},
      ${record.reasonCodesJson},
      ${record.contentDigest},
      ${record.schemaVersion}
    )
  `;
}

/** Organization-scoped read (ADR-0007). Never falls back to an unscoped forecast_id lookup. */
export async function readDecisionEconomicsV2ByForecastId(
  sql: postgres.Sql,
  input: { organizationId: string; forecastId: string },
): Promise<DecisionEconomicsV2Record | null> {
  const rows = await sql<
    {
      id: string;
      organization_id: string;
      forecast_id: string;
      decision_record_id: string | null;
      ev_lower: string;
      ev_base: string;
      ev_upper: string;
      decision_actionable: boolean;
      economic_semantics_version: string;
      scientific_admission_receipt_digest: string | null;
      mu_base_replicas_json: string;
      mu_lower_replicas_json: string;
      reason_codes_json: string;
      content_digest: string;
      schema_version: string;
    }[]
  >`
    SELECT
      id::text AS id,
      organization_id::text AS organization_id,
      forecast_id::text AS forecast_id,
      decision_record_id::text AS decision_record_id,
      ev_lower,
      ev_base,
      ev_upper,
      decision_actionable,
      economic_semantics_version,
      scientific_admission_receipt_digest,
      mu_base_replicas_json,
      mu_lower_replicas_json,
      reason_codes_json,
      content_digest,
      schema_version
    FROM trader_intelligence_decision_economics_v2
    WHERE ${orgScopedPostgresPredicate(sql, input.organizationId)}
      AND forecast_id = ${input.forecastId}::uuid
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    forecastId: row.forecast_id,
    decisionRecordId: row.decision_record_id,
    evLower: row.ev_lower,
    evBase: row.ev_base,
    evUpper: row.ev_upper,
    decisionActionable: row.decision_actionable,
    economicSemanticsVersion: row.economic_semantics_version,
    scientificAdmissionReceiptDigest: row.scientific_admission_receipt_digest,
    muBaseReplicasJson: row.mu_base_replicas_json,
    muLowerReplicasJson: row.mu_lower_replicas_json,
    reasonCodesJson: row.reason_codes_json,
    contentDigest: row.content_digest,
    schemaVersion: row.schema_version as typeof DECISION_ECONOMICS_SCHEMA_VERSION,
  };
}

export function decisionEvRangeFromRecord(record: DecisionEconomicsV2Record): DecisionEvRange {
  return {
    evLower: Number(record.evLower),
    evBase: Number(record.evBase),
    evUpper: Number(record.evUpper),
    evLowerScale8: record.evLower,
    evBaseScale8: record.evBase,
    evUpperScale8: record.evUpper,
    decisionActionable: record.decisionActionable,
    reasonCodes: JSON.parse(record.reasonCodesJson) as string[],
  };
}

export function buildV2WhyNotCashJson(input: {
  forecastId: string;
  packageContentDigestHex: string;
  packageGenerationDigestHex: string;
  evRange: DecisionEvRange;
  economicSemanticsVersion?: string;
  admissionReceiptDigest?: string | null;
}): string {
  return JSON.stringify({
    authority: "forecast_decision_economics_v2",
    forecast_id: input.forecastId,
    predictive_package_content_digest_hex: input.packageContentDigestHex,
    predictive_package_generation_identity_digest_hex: input.packageGenerationDigestHex,
    ev_lower_scale8: input.evRange.evLowerScale8,
    ev_base_scale8: input.evRange.evBaseScale8,
    ev_upper_scale8: input.evRange.evUpperScale8,
    decision_economic_policy_version: input.economicSemanticsVersion ?? ECONOMIC_SEMANTICS_VERSION,
    scientific_admission_receipt_digest: input.admissionReceiptDigest ?? null,
    decision_actionable: input.evRange.decisionActionable,
    reason_codes: input.evRange.reasonCodes,
    risk_beats_cash_rationale:
      "Forecast-sealed epistemic EV_lower/base/upper and package identity justify capital risk over cash preservation.",
  });
}
