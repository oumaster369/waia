import type postgres from "postgres";

import {
  issueForecastRuntimeV2,
  requireForecastRuntimeAuthorizedOutcomeV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import { readScientificAdmissionReceiptV1 } from
  "@/lib/trader/research/execopp-qualification/scientific-admission-receipt-service-v1";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

import {
  createCanonicalDecisionVerificationReceiptServiceV2,
  createPostgresCanonicalDecisionVerificationReceiptPortV2,
} from "./canonical-verification-receipt-postgres-v2";
import { createPostgresDee659AuthorityRepositoryV2 } from
  "./dee659-authority-repository-postgres-v2";
import { createPostgresHistoricalForecastInputPitProducerV2 } from
  "./pit-forecast-input-producer-v2";
import { prepareHistoricalProductionNextCycleForecastV2 } from
  "./production-next-cycle-forecast-v2";
import {
  createHistoricalForecastNonActionableSourceV2,
  createHistoricalForecastNonActionableVerificationV2,
  type HistoricalForecastNonActionableSourceV2,
  type HistoricalForecastNonActionableVerificationV2,
} from "./non-actionable-forecast-source-v2";

export const HISTORICAL_PRODUCTION_NEXT_CYCLE_PREPARATION_V2 =
  "waia.trader.historical_production_next_cycle_preparation.v2" as const;

type VerificationService = ReturnType<
  typeof createCanonicalDecisionVerificationReceiptServiceV2
>;
type HistoricalPolicyConfigV2 = Parameters<
  VerificationService["preregisterExecution"]
>[0]["policyConfig"];

type PreviousAuthorityBundleV2 = Readonly<{
  schemaVersion?: unknown;
  organizationId?: unknown;
  accountId?: unknown;
  runId?: unknown;
  sealedCycle?: Readonly<{ cycleId?: unknown }>;
  policyConfig?: unknown;
  authorities?: Readonly<{
    economicSize?: Readonly<{ exactQuantities?: unknown }>;
  }>;
}>;

type PreviousPreparationRowV2 = Readonly<{
  cycle_id: string;
  record_index: number;
  policy_config_digest_hex: string;
  authority_bundle_json: PreviousAuthorityBundleV2;
  authority_bundle_digest_hex: string;
  runtime_input_json: Readonly<{
    predictivePackage?: Readonly<{
      family?: Readonly<{ primaryHorizonMinutes?: unknown }>;
    }>;
  }>;
}>;

function refuse(code: string): never {
  throw new Error(`HISTORICAL_PRODUCTION_NEXT_CYCLE_PREPARATION_REFUSED:${code}`);
}

function asPolicyConfig(value: unknown): HistoricalPolicyConfigV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    refuse("PREVIOUS_POLICY_CONFIG");
  }
  return value as HistoricalPolicyConfigV2;
}

/**
 * Creates the complete source authority for exactly one later WALK_FORWARD cycle.
 * Every write uses the caller's active SERIALIZABLE transaction. Consequently a
 * Forecast, its DEE-659 authority, and its PIT either become visible together
 * with the cycle commit or are all rolled back.
 */
export async function prepareHistoricalProductionNextCycleForCommitV2(input: Readonly<{
  tx: postgres.Sql;
  organizationId: string;
  accountId: string;
  runId: string;
  partition: "WALK_FORWARD";
  symbol: "BTCUSDT" | "ETHUSDT";
  expectedRecordIndex: number;
  previousCycleId: string;
  accountingFrontierId: string;
  accountingFrontierContentDigestHex: string;
  codeSha: string;
}>): Promise<
  | Readonly<{ status: "FORECAST_AUTHORIZED"; cycleId: string; forecastId: string;
      pitContentDigestHex: string }>
  | Readonly<{ status: "NON_ACTIONABLE"; cycleId: string; defaultQuantity: string;
      policyConfigContentDigestHex: string;
      source: HistoricalForecastNonActionableSourceV2;
      verification: HistoricalForecastNonActionableVerificationV2 }>
> {
  const rows = await input.tx<PreviousPreparationRowV2[]>`
    SELECT p.cycle_id, h.record_index, p.policy_config_digest_hex,
           p.authority_bundle_json, p.authority_bundle_digest_hex,
           s.runtime_input_json
    FROM trader_dee659_authority_preregistration_v2 p
    JOIN trader_historical_forecast_input_pit_v2 h
      ON h.organization_id=p.organization_id AND h.run_id=p.run_id
     AND h.cycle_id=p.cycle_id AND h.forecast_id::text=p.forecast_id::text
     AND h.partition='WALK_FORWARD' AND h.symbol=${input.symbol}
    JOIN trader_forecast_runtime_input_source_v2 s
      ON s.organization_id=h.organization_id AND s.id=h.runtime_input_source_id
     AND s.execution_forecast_id=h.forecast_id AND s.run_id=h.run_id
     AND s.cycle_id=h.cycle_id AND s.symbol=h.symbol AND s.pit_anchor=h.pit_anchor
    WHERE p.organization_id=${input.organizationId}::uuid
      AND p.account_id=${input.accountId} AND p.run_id=${input.runId}
      AND h.record_index < ${input.expectedRecordIndex}
    ORDER BY h.record_index DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row || rows.length !== 1 ||
      computeStableJsonDigest(row.authority_bundle_json) !==
        row.authority_bundle_digest_hex ||
      row.authority_bundle_json.organizationId !== input.organizationId ||
      row.authority_bundle_json.accountId !== input.accountId ||
      row.authority_bundle_json.runId !== input.runId ||
      row.authority_bundle_json.sealedCycle?.cycleId !== row.cycle_id ||
      !Number.isSafeInteger(row.record_index) ||
      row.record_index >= input.expectedRecordIndex) {
    refuse("PREVIOUS_AUTHORITY");
  }
  const primaryHorizonMinutes =
    row.runtime_input_json.predictivePackage?.family?.primaryHorizonMinutes;
  if (primaryHorizonMinutes !== 30 && primaryHorizonMinutes !== 60) {
    refuse("PRIMARY_HORIZON");
  }
  const quantities = row.authority_bundle_json.authorities?.economicSize
    ?.exactQuantities;
  if (!Array.isArray(quantities) || quantities.length < 1 ||
      typeof quantities[0] !== "string" || quantities[0].trim() === "") {
    refuse("DEFAULT_QUANTITY");
  }

  const accountingRows = await input.tx<Array<Readonly<{
    id: string;
    semantic_content_digest: string;
  }>>>`
    SELECT id::text, semantic_content_digest
    FROM trader_accounting_frontier
    WHERE id=${input.accountingFrontierId}::uuid
      AND organization_id=${input.organizationId}::uuid
      AND account_key=${input.accountId} AND run_id=${input.runId}
  `;
  if (accountingRows.length !== 1 ||
      accountingRows[0]?.semantic_content_digest !==
        input.accountingFrontierContentDigestHex) {
    refuse("ACCOUNTING_FRONTIER");
  }

  const forecast = await prepareHistoricalProductionNextCycleForecastV2({
    tx: input.tx,
    organizationId: input.organizationId,
    accountId: input.accountId,
    runId: input.runId,
    partition: input.partition,
    symbol: input.symbol,
    primaryHorizonMinutes,
    expectedRecordIndex: input.expectedRecordIndex,
  });
  const current = forecast.information.sourceAuthority;
  const pitAnchor = current.currentSealedCycle.closedBar.barCloseTime;
  if (forecast.status === "NON_ACTIONABLE") {
    const source = createHistoricalForecastNonActionableSourceV2({
      organizationId: input.organizationId,
      accountId: input.accountId,
      runId: input.runId,
      cycleId: current.currentCycleId,
      symbol: input.symbol,
      pitAnchor,
      datasetMembershipContentDigestHex: current.currentMembership.contentDigestHex,
      runtimeInput: forecast.runtimeInput,
      outcome: forecast.outcome,
    });
    return Object.freeze({
      status: "NON_ACTIONABLE" as const,
      cycleId: current.currentCycleId,
      defaultQuantity: quantities[0],
      policyConfigContentDigestHex: row.policy_config_digest_hex,
      source,
      verification: createHistoricalForecastNonActionableVerificationV2({
        source,
        releaseSha: input.codeSha,
      }),
    });
  }
  const issued = issueForecastRuntimeV2(forecast.runtimeInput);
  if (issued.status !== "FORECAST_AUTHORIZED") {
    refuse(`FORECAST_${issued.reason}`);
  }
  const outcome = requireForecastRuntimeAuthorizedOutcomeV2(issued);
  if (outcome.authority.contentDigestHex !==
      forecast.forecastAuthorityContentDigestHex) {
    refuse("FORECAST_AUTHORITY");
  }

  const verification = createCanonicalDecisionVerificationReceiptServiceV2(input.tx);
  const preregistration = await verification.preregisterExecution({
    organizationId: input.organizationId,
    accountId: input.accountId,
    runId: input.runId,
    forecastId: forecast.forecastId,
    datasetAuthorityId: current.currentDatasetAuthorityId,
    cycleId: current.currentCycleId,
    policyConfig: asPolicyConfig(row.authority_bundle_json.policyConfig),
    defaultQuantity: quantities[0],
    accountingFrontierId: accountingRows[0]!.id,
  });
  const forecastVerification = await verification.issueForecast({
    organizationId: input.organizationId,
    forecastId: forecast.forecastId,
    subjectContentDigestHex: outcome.authority.contentDigestHex,
  });
  const admission = forecast.runtimeInput.predictiveAdmissionReceipt;
  const forecastBinding = forecast.runtimeInput.forecastContractBinding;
  if (!admission || !forecastBinding) refuse("SCIENTIFIC_ADMISSION");
  const scientificAdmissionContentDigestHex =
    admission.scientificAdmissionReceiptContentDigestHex;
  if (!scientificAdmissionContentDigestHex ||
      scientificAdmissionContentDigestHex !==
        forecastBinding.scientificAdmissionReceiptContentDigestHex) {
    refuse("SCIENTIFIC_ADMISSION_IDENTITY");
  }
  await verification.issueScientific({
    organizationId: input.organizationId,
    runId: input.runId,
    forecastId: forecast.forecastId,
    scientificAdmissionContentDigestHex,
  });
  const executionVerification = await verification.issueExecution({
    preregistrationId: preregistration.preregistrationId,
    organizationId: input.organizationId,
    accountId: input.accountId,
    runId: input.runId,
    forecastId: forecast.forecastId,
    datasetAuthorityDigestHex: preregistration.datasetAuthorityDigestHex,
    pitAnchor,
    subjectContentDigestHex: {
      anchor: preregistration.authorities.anchor.contentDigestHex,
      executablePolicy: preregistration.authorities.executablePolicy.contentDigestHex,
      economicSize: preregistration.authorities.economicSize.contentDigestHex,
      cash: preregistration.authorities.cash.contentDigestHex,
    },
  });
  const verificationPort =
    createPostgresCanonicalDecisionVerificationReceiptPortV2(input.tx);
  const scientificVerification = await verificationPort.loadScientificVerification({
    organizationId: input.organizationId,
    forecastId: forecast.forecastId,
    scientificAdmissionContentDigestHex,
  });
  const scientificIdentityRows = await input.tx<Array<Readonly<{
    evidence_semantic_digest: string;
  }>>>`
    SELECT evidence_semantic_digest
    FROM trader_scientific_admission_receipt_v1
    WHERE organization_id=${input.organizationId}::uuid
      AND id=${forecastBinding.scientificAdmissionReceiptId}::uuid
      AND content_digest=${scientificAdmissionContentDigestHex}
  `;
  if (scientificIdentityRows.length !== 1) refuse("SCIENTIFIC_RECORD_IDENTITY");
  const scientificRecord = await readScientificAdmissionReceiptV1(input.tx, {
    organizationId: input.organizationId,
    evidenceSemanticDigestHex:
      scientificIdentityRows[0]!.evidence_semantic_digest,
  });
  if (!scientificRecord ||
      scientificRecord.id !== forecastBinding.scientificAdmissionReceiptId ||
      scientificRecord.contentDigest !== scientificAdmissionContentDigestHex) {
    refuse("SCIENTIFIC_RECORD_REPLAY");
  }
  const bundleRows = await input.tx<Array<Readonly<{ digest: string }>>>`
    SELECT encode(bundle_content_digest,'hex') AS digest
    FROM trader_forecast_bundle_v2
    WHERE organization_id=${input.organizationId}::uuid
      AND id=${forecast.bundleId}::uuid
  `;
  if (bundleRows.length !== 1) refuse("FORECAST_BUNDLE");
  await createPostgresDee659AuthorityRepositoryV2({
    sql: input.tx,
    verificationReceipts: verificationPort,
  }).persist({
    organizationId: input.organizationId,
    accountId: input.accountId,
    runId: input.runId,
    cycleId: current.currentCycleId,
    forecastId: forecast.forecastId,
    forecastAuthorityContentDigestHex: outcome.authority.contentDigestHex,
    datasetAuthorityDigestHex: preregistration.datasetAuthorityDigestHex,
    dee659PreregistrationId: preregistration.preregistrationId,
    pitAnchor,
    forecastIssuanceReceiptDigestHex: bundleRows[0]!.digest,
    forecastVerificationReceiptDigestHex:
      forecastVerification.verificationReceiptDigestHex,
    scientificAdmission: scientificRecord,
    scientificVerificationReceiptDigestHex:
      scientificVerification.verificationReceiptDigestHex,
    anchorAuthority: preregistration.authorities.anchor,
    executablePolicy: preregistration.authorities.executablePolicy,
    economicSizeSet: preregistration.authorities.economicSize,
    cashAuthority: preregistration.authorities.cash,
    executionPayoffVerification: executionVerification,
  });
  const pit = await createPostgresHistoricalForecastInputPitProducerV2(input.tx)({
    organizationId: input.organizationId,
    runId: input.runId,
    cycleId: current.currentCycleId,
    forecastId: forecast.forecastId,
    symbol: input.symbol,
    pitAnchor,
    datasetAuthorityId: current.currentDatasetAuthorityId,
  });
  return Object.freeze({
    status: "FORECAST_AUTHORIZED" as const,
    cycleId: current.currentCycleId,
    forecastId: forecast.forecastId,
    pitContentDigestHex: pit.contentDigestHex,
  });
}
