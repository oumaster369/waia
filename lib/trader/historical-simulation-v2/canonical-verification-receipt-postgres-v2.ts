import type postgres from "postgres";

import {
  validateCashEconomicAuthorityV1,
  validateDee659ExecutablePolicyInstanceV1,
  validateEconomicAdmissibleSizeSetV1,
  validateForecastAnchorPriceAuthorityV1,
  createForecastAnchorPriceAuthorityV1,
  createDee659ExecutablePolicyInstanceV1,
  createSingletonEconomicSizeSetV1,
  createCashEconomicAuthorityV1,
  type CashEconomicAuthorityV1,
  type Dee659ExecutablePolicyInstanceV1,
  type EconomicAdmissibleSizeSetV1,
  type ForecastAnchorPriceAuthorityV1,
  type Dee659ExecutablePolicyDraftV1,
} from "@/lib/trader/intelligence/decision-economics/dee659-execution-payoff-authorities-v1";
import {
  computeDee659InstrumentIdentityDigestV1,
  DEE659_ANCHOR_AUTHORITY_SCHEMA_VERSION,
  DEE659_EXECUTABLE_POLICY_SCHEMA_VERSION,
  type ExecutionPayoffAuthorityVerificationV1,
  type VerifiedDecisionEconomicAuthorityV1,
  sameDee659AuthorityBindingV1,
} from "@/lib/trader/intelligence/decision-economics/dee659-execution-payoff-contract-v1";
import { formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import { historicalInstrumentsMatch } from "@/lib/trader/symbols/historical-instrument";
import type { AccountingFrontierV1 } from "@/lib/trader/accounting/accounting-frontier.types";
import { createInitialAccountingState, computeAccountingSemanticDigest } from "@/lib/trader/accounting/canonical-cross-backend-accounting-engine";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { computeBarContentDigest } from "@/lib/trader/market-data/bar-content-digest";
import {
  assertHistoricalMarketCycleV2,
  type HistoricalSealedMarketCycleV2,
} from "./modeled-execution-advance-v2";
import {
  bindHistoricalCyclesToPreHoldoutDatasetV2,
  bindHistoricalCyclesToSealedDatasetV2,
  HISTORICAL_DATASET_MEMBERSHIP_V2,
  type HistoricalDatasetMembershipV2,
  type HistoricalPreHoldoutDatasetMembershipV2,
} from "./dataset-membership-v2";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { requireForecastRuntimeAuthorizedOutcomeV2 } from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import {
  requireScientificAdmissionV2,
  SCIENTIFIC_ADMISSION_RECEIPT_V2_VERSION,
  type ScientificAdmissionReceiptV2,
} from "@/lib/trader/research/execopp-qualification/scientific-admission-v2";
import type { CanonicalDecisionVerificationReceiptPortV2 } from "./dee659-authority-repository-postgres-v2";

export const CANONICAL_DECISION_VERIFICATION_RECEIPT_V2 =
  "waia.trader.canonical_decision_verification_receipt.v2" as const;
export const CANONICAL_DECISION_VERIFICATION_SUBJECT_V2 =
  "waia.trader.canonical_decision_verification_subject.v2" as const;
const VERIFIER_VERSION = "historical-simulation-v2-canonical-verifier/1";
function verifierCodeDigestHex(): string {
  const waiaSha = process.env.WAIA_RELEASE_SHA?.toLowerCase();
  const vercelSha = process.env.VERCEL_GIT_COMMIT_SHA?.toLowerCase();
  if (waiaSha && vercelSha && waiaSha !== vercelSha) {
    throw new Error("CANONICAL_DECISION_VERIFIER_RELEASE_SHA_CONFLICT");
  }
  const releaseSha = waiaSha ?? vercelSha ?? "";
  if (!/^[0-9a-f]{40}$/.test(releaseSha)) {
    throw new Error("CANONICAL_DECISION_VERIFIER_RELEASE_SHA_MISSING");
  }
  return computeStableJsonDigest({ verifierVersion: VERIFIER_VERSION, releaseSha });
}

type Purpose =
  | "FORECAST_RUNTIME_AUTHORIZED"
  | "SCIENTIFIC_ADMISSION"
  | VerifiedDecisionEconomicAuthorityV1["purpose"];

export type CanonicalDecisionVerificationReceiptV2 = Readonly<{
  schemaVersion: typeof CANONICAL_DECISION_VERIFICATION_RECEIPT_V2;
  organizationId: string;
  accountId: string | null;
  instrumentIdentityDigestHex: string | null;
  forecastId: string | null;
  forecastBundleId: string | null;
  dee659PreregistrationId: string | null;
  purpose: Purpose;
  subjectKind: "FORECAST_RUNTIME_AUTHORITY" | "SCIENTIFIC_ADMISSION" |
    "FORECAST_ANCHOR_PRICE_AUTHORITY" | "EXECUTABLE_POLICY" | "ECONOMIC_SIZE_SET" | "CASH_AUTHORITY";
  subjectContentDigestHex: string;
  sourceRecordKind: "FORECAST_BUNDLE_V2" | "SCIENTIFIC_ADMISSION_V2" | "DEE659_AUTHORITY_PREREGISTRATION_V2";
  sourceRecordId: string;
  sourceRecordContentDigestHex: string;
  pitAnchor: string;
  verifierVersion: typeof VERIFIER_VERSION;
  verifierCodeDigestHex: string;
  verified: true;
  verificationReceiptDigestHex: string;
}>;

type ExecutionAuthorities = Readonly<{
  anchor: ForecastAnchorPriceAuthorityV1;
  executablePolicy: Dee659ExecutablePolicyInstanceV1;
  economicSize: EconomicAdmissibleSizeSetV1;
  cash: CashEconomicAuthorityV1;
}>;

type HistoricalPolicyConfigV2 = Omit<Dee659ExecutablePolicyDraftV1,
  "organizationId" | "accountId" | "venue" | "market" | "symbol" | "baseAsset" |
  "quoteAsset" | "instrumentIdentityDigestHex" | "schemaVersion" |
  "preregistrationReceiptDigestHex" | "costAuthorityReceiptDigestHex" |
  "liquidityCapacityAuthorityReceiptDigestHex" | "quantityRulesAuthorityReceiptDigestHex">;

const DIGEST = /^[0-9a-f]{64}$/;

function seal(body: Omit<CanonicalDecisionVerificationReceiptV2, "verificationReceiptDigestHex">):
CanonicalDecisionVerificationReceiptV2 {
  return Object.freeze({ ...body, verificationReceiptDigestHex: computeStableJsonDigest(body) });
}

function hasValidDigest(receipt: CanonicalDecisionVerificationReceiptV2): boolean {
  const { verificationReceiptDigestHex, ...body } = receipt;
  return verificationReceiptDigestHex === computeStableJsonDigest(body);
}

async function persist(sql: postgres.Sql, receipt: CanonicalDecisionVerificationReceiptV2): Promise<void> {
  await sql`
    INSERT INTO trader_canonical_decision_verification_receipt_v2 (
      organization_id, account_id, instrument_identity_digest_hex, purpose, subject_kind,
      subject_content_digest_hex, source_record_kind,
      source_record_id, forecast_id, forecast_bundle_id, scientific_admission_receipt_id, dee659_preregistration_id,
      source_record_content_digest_hex, pit_anchor, verified,
      verifier_version, verifier_code_digest_hex, verification_receipt_digest_hex, receipt_json, schema_version
    ) VALUES (
      ${receipt.organizationId}::uuid, ${receipt.accountId}, ${receipt.instrumentIdentityDigestHex}, ${receipt.purpose}, ${receipt.subjectKind},
      ${receipt.subjectContentDigestHex}, ${receipt.sourceRecordKind}, ${receipt.sourceRecordId},
      ${receipt.forecastId}::uuid,
      ${receipt.forecastBundleId}::uuid,
      ${receipt.sourceRecordKind === "SCIENTIFIC_ADMISSION_V2" ? receipt.sourceRecordId : null}::uuid,
      ${receipt.dee659PreregistrationId}::uuid,
      ${receipt.sourceRecordContentDigestHex}, ${receipt.pitAnchor}::timestamptz, true,
      ${receipt.verifierVersion}, ${receipt.verifierCodeDigestHex},
      ${receipt.verificationReceiptDigestHex}, ${sql.json(JSON.parse(JSON.stringify(receipt)) as postgres.JSONValue)},
      ${receipt.schemaVersion}
    ) ON CONFLICT DO NOTHING
  `;
  const rows = await sql<{ verification_receipt_digest_hex: string }[]>`
    SELECT verification_receipt_digest_hex
    FROM trader_canonical_decision_verification_receipt_v2
    WHERE organization_id=${receipt.organizationId}::uuid AND purpose=${receipt.purpose}
      AND subject_content_digest_hex=${receipt.subjectContentDigestHex}
      AND source_record_kind=${receipt.sourceRecordKind} AND source_record_id=${receipt.sourceRecordId}
      AND pit_anchor=${receipt.pitAnchor}::timestamptz
      AND verifier_code_digest_hex=${receipt.verifierCodeDigestHex}
  `;
  if (rows[0]?.verification_receipt_digest_hex !== receipt.verificationReceiptDigestHex) {
    throw new Error("CANONICAL_DECISION_VERIFICATION_CONFLICT");
  }
}

async function persistSubject(sql: postgres.Sql, input: Readonly<{
  organizationId: string; accountId: string | null; instrumentIdentityDigestHex: string | null;
  subjectKind: CanonicalDecisionVerificationReceiptV2["subjectKind"];
  subjectContentDigestHex: string; subject: unknown; pitAnchor: string;
}>): Promise<void> {
  await sql`
    INSERT INTO trader_canonical_decision_verification_subject_v2 (
      organization_id, account_id, instrument_identity_digest_hex, subject_kind,
      subject_content_digest_hex, subject_json, pit_anchor, schema_version
    ) VALUES (
      ${input.organizationId}::uuid, ${input.accountId}, ${input.instrumentIdentityDigestHex},
      ${input.subjectKind}, ${input.subjectContentDigestHex},
      ${sql.json(JSON.parse(JSON.stringify(input.subject)) as postgres.JSONValue)},
      ${input.pitAnchor}::timestamptz, ${CANONICAL_DECISION_VERIFICATION_SUBJECT_V2}
    ) ON CONFLICT (organization_id, subject_kind, subject_content_digest_hex) DO NOTHING
  `;
  const rows = await sql<{ subject_json: unknown; account_id: string | null;
    instrument_identity_digest_hex: string | null; pit_anchor: Date | string }[]>`
    SELECT subject_json, account_id, instrument_identity_digest_hex, pit_anchor
    FROM trader_canonical_decision_verification_subject_v2
    WHERE organization_id=${input.organizationId}::uuid AND subject_kind=${input.subjectKind}
      AND subject_content_digest_hex=${input.subjectContentDigestHex}
  `;
  const existing = rows[0];
  if (!existing || computeStableJsonDigest(existing.subject_json) !== computeStableJsonDigest(input.subject) ||
      existing.account_id !== input.accountId ||
      existing.instrument_identity_digest_hex !== input.instrumentIdentityDigestHex ||
      Date.parse(new Date(existing.pit_anchor).toISOString()) > Date.parse(input.pitAnchor)) {
    throw new Error(`CANONICAL_DECISION_VERIFICATION_SUBJECT_CONFLICT:${input.subjectKind}`);
  }
}

function requireExecutionAuthorities(input: ExecutionAuthorities): void {
  const errors = [
    ...validateForecastAnchorPriceAuthorityV1(input.anchor),
    ...validateDee659ExecutablePolicyInstanceV1(input.executablePolicy),
    ...validateEconomicAdmissibleSizeSetV1(input.economicSize),
    ...validateCashEconomicAuthorityV1(input.cash),
  ];
  if ([input.executablePolicy, input.economicSize, input.cash]
    .some((value) => !sameDee659AuthorityBindingV1(input.anchor, value)) || errors.length > 0) {
    throw new Error(`CANONICAL_DECISION_VERIFICATION_REFUSED:${errors.join(",") || "BINDING"}`);
  }
}

function createCanonicalDecisionVerificationReceiptServiceInternalV2(
  sql: postgres.Sql,
  transactionalPreregistration = true,
) {
  const verifierDigest = verifierCodeDigestHex();
  async function issueForecast(input: Readonly<{
    organizationId: string; forecastId: string; subjectContentDigestHex: string;
  }>): Promise<CanonicalDecisionVerificationReceiptV2> {
    const rows = await sql<Readonly<{
      bundle_id: string; bundle_content_digest_hex: string; anchor_closed_bar_epoch_ms: string | number;
      authorized_outcome_json: unknown; target_role_id: string;
    }>[]>`
      SELECT b.id::text AS bundle_id, encode(b.bundle_content_digest,'hex') AS bundle_content_digest_hex,
             b.anchor_closed_bar_epoch_ms, b.forecast_runtime_authorized_outcome_json AS authorized_outcome_json,
             f.target_role_id
      FROM trader_forecast_v2 f JOIN trader_forecast_bundle_v2 b
        ON b.organization_id=f.organization_id AND b.id=f.bundle_id
      WHERE f.organization_id=${input.organizationId}::uuid AND f.id=${input.forecastId}::uuid
    `;
    const row = rows[0];
    if (!row || row.target_role_id !== "EXECUTION_OPPORTUNITY") {
      throw new Error("CANONICAL_DECISION_VERIFICATION_REFUSED:FORECAST_SOURCE");
    }
    const outcome = requireForecastRuntimeAuthorizedOutcomeV2(row.authorized_outcome_json as never);
    if (outcome.authority.contentDigestHex !== input.subjectContentDigestHex) {
      throw new Error("CANONICAL_DECISION_VERIFICATION_REFUSED:FORECAST_SOURCE");
    }
    const pitAnchor = new Date(Number(row.anchor_closed_bar_epoch_ms)).toISOString();
    await persistSubject(sql, {
      organizationId: input.organizationId, accountId: null, instrumentIdentityDigestHex: null,
      subjectKind: "FORECAST_RUNTIME_AUTHORITY", subjectContentDigestHex: input.subjectContentDigestHex,
      subject: outcome.authority, pitAnchor,
    });
    const receipt = seal({
      schemaVersion: CANONICAL_DECISION_VERIFICATION_RECEIPT_V2,
      organizationId: input.organizationId, accountId: null,
      instrumentIdentityDigestHex: null,
      forecastId: input.forecastId,
      forecastBundleId: row.bundle_id,
      dee659PreregistrationId: null,
      subjectKind: "FORECAST_RUNTIME_AUTHORITY",
      purpose: "FORECAST_RUNTIME_AUTHORIZED", subjectContentDigestHex: input.subjectContentDigestHex,
      sourceRecordKind: "FORECAST_BUNDLE_V2", sourceRecordId: row.bundle_id,
      sourceRecordContentDigestHex: row.bundle_content_digest_hex, pitAnchor, verified: true,
      verifierVersion: VERIFIER_VERSION, verifierCodeDigestHex: verifierDigest,
    });
    await persist(sql, receipt);
    return receipt;
  }

  async function issueScientific(input: Readonly<{
    organizationId: string; runId: string; forecastId: string; scientificAdmissionContentDigestHex: string;
  }>): Promise<CanonicalDecisionVerificationReceiptV2> {
    const rows = await sql<{ id: string; content_digest: string; receipt_json: string | ScientificAdmissionReceiptV2;
      created_at: Date | string; anchor_closed_bar_epoch_ms: string | number; authorized_outcome_json: unknown }[]>`
      SELECT s.id::text, s.content_digest, s.receipt_json, s.created_at,
             b.anchor_closed_bar_epoch_ms, b.forecast_runtime_authorized_outcome_json AS authorized_outcome_json
      FROM trader_scientific_admission_receipt_v1 s
      JOIN trader_forecast_v2 f ON f.organization_id=s.organization_id AND f.id=${input.forecastId}::uuid
      JOIN trader_forecast_bundle_v2 b ON b.organization_id=f.organization_id AND b.id=f.bundle_id
      JOIN trader_historical_simulation_run_start_v2 rs
        ON rs.organization_id=s.organization_id AND rs.run_id=${input.runId}
      WHERE s.organization_id=${input.organizationId}::uuid
        AND s.content_digest=${input.scientificAdmissionContentDigestHex}
        AND s.schema_version=${SCIENTIFIC_ADMISSION_RECEIPT_V2_VERSION}
        AND s.created_at <= rs.started_at
    `;
    const row = rows[0];
    if (!row || !DIGEST.test(row.content_digest)) {
      throw new Error("CANONICAL_DECISION_VERIFICATION_REFUSED:SCIENTIFIC_SOURCE");
    }
    const forecast = requireForecastRuntimeAuthorizedOutcomeV2(row.authorized_outcome_json as never);
    const pitAnchor = new Date(Number(row.anchor_closed_bar_epoch_ms)).toISOString();
    const raw = typeof row.receipt_json === "string" ? JSON.parse(row.receipt_json) : row.receipt_json;
    const predictive = raw.predictiveTerminalReceipt;
    const scientific = requireScientificAdmissionV2(raw, {
      organizationId: input.organizationId,
      developmentDatasetDigestHex: predictive.developmentDatasetDigestHex,
      targetGridReceiptDigestHex: predictive.targetGridReceiptDigestHex,
      predictivePackageGenerationIdentityDigestHex: predictive.predictivePackageGenerationIdentityDigestHex,
      predictivePackageContentDigestHex: predictive.predictivePackageContentDigestHex,
      runtimeContractDigestHex: predictive.runtimeContractDigestHex,
      scoringContractVersion: predictive.scoringContractVersion,
      evaluationPartitionReceiptDigestHex: predictive.evaluationPartitionReceiptDigestHex,
      kmConvergenceEvidenceSemanticDigestHex: raw.kmConvergenceReceipt.evidenceSemanticDigestHex,
      epistemicParameterRatificationReceiptDigestHex: raw.epistemicParameterRatificationReceipt.contentDigestHex,
      predictiveTerminalReceiptContentDigestHex: predictive.contentDigestHex,
    });
    if (forecast.authority.scientificAdmissionReceiptContentDigestHex !== row.content_digest ||
        forecast.authority.selectedPredictivePackageContentDigestHex !==
          scientific.predictiveTerminalReceipt.predictivePackageContentDigestHex) {
      throw new Error("CANONICAL_DECISION_VERIFICATION_REFUSED:SCIENTIFIC_PIT_BINDING");
    }
    if (scientific.contentDigestHex !== row.content_digest) {
      throw new Error("CANONICAL_DECISION_VERIFICATION_REFUSED:SCIENTIFIC_SOURCE");
    }
    await persistSubject(sql, {
      organizationId: input.organizationId, accountId: null, instrumentIdentityDigestHex: null,
      subjectKind: "SCIENTIFIC_ADMISSION", subjectContentDigestHex: row.content_digest,
      subject: scientific, pitAnchor: new Date(row.created_at).toISOString(),
    });
    const receipt = seal({
      schemaVersion: CANONICAL_DECISION_VERIFICATION_RECEIPT_V2,
      organizationId: input.organizationId, accountId: null, purpose: "SCIENTIFIC_ADMISSION",
      instrumentIdentityDigestHex: null,
      forecastId: input.forecastId,
      forecastBundleId: null,
      dee659PreregistrationId: null,
      subjectKind: "SCIENTIFIC_ADMISSION",
      subjectContentDigestHex: row.content_digest, sourceRecordKind: "SCIENTIFIC_ADMISSION_V2",
      sourceRecordId: row.id, sourceRecordContentDigestHex: row.content_digest,
      pitAnchor, verified: true,
      verifierVersion: VERIFIER_VERSION, verifierCodeDigestHex: verifierDigest,
    });
    await persist(sql, receipt);
    return receipt;
  }

  async function registerDatasetAuthority(input: Readonly<{
    datasetRoot: string; organizationId: string; runId: string;
    partition: "DEVELOPMENT" | "WALK_FORWARD"; symbol: "BTCUSDT" | "ETHUSDT";
    cycles: readonly HistoricalSealedMarketCycleV2[];
    qualificationReceiptPath?: string;
    releaseSha?: string;
  }>): Promise<ReadonlyMap<string, string>> {
    const memberships: ReadonlyMap<string,
      HistoricalDatasetMembershipV2 | HistoricalPreHoldoutDatasetMembershipV2> =
      input.qualificationReceiptPath
        ? await bindHistoricalCyclesToPreHoldoutDatasetV2({ ...input,
            qualificationReceiptPath: input.qualificationReceiptPath,
            releaseSha: input.releaseSha ?? "" })
        : await bindHistoricalCyclesToSealedDatasetV2(input);
    return sql.begin("isolation level serializable", async (transaction) => {
      const tx = transaction as unknown as postgres.Sql;
      const ids = new Map<string, string>();
      for (const cycle of input.cycles) {
        const membership = memberships.get(cycle.cycleId);
        if (!membership) throw new Error("HISTORICAL_DATASET_AUTHORITY_MISSING_MEMBERSHIP");
        const datasetAuthorityDigestHex = membership.datasetAuthorityDigestHex ??
          ("sealReceiptDigestHex" in membership ? membership.sealReceiptDigestHex : undefined);
        if (!datasetAuthorityDigestHex) throw new Error("HISTORICAL_DATASET_AUTHORITY_MISSING_DIGEST");
        const body = { organizationId: input.organizationId, runId: input.runId,
          membership, sealedCycle: cycle };
        const authorityDigest = computeStableJsonDigest(body);
        const inserted = await tx<{ id: string }[]>`
        INSERT INTO trader_historical_dataset_authority_v2 (
          organization_id, run_id, cycle_id, dataset_authority_class, dataset_authority_digest_hex,
          membership_content_digest_hex, sealed_cycle_content_digest_hex,
          membership_json, sealed_cycle_json, authority_content_digest_hex, schema_version
        ) VALUES (
          ${input.organizationId}::uuid, ${input.runId}, ${cycle.cycleId},
          ${membership.datasetAuthorityClass ?? "FULL_SEALED_DATASET_V2"}, ${datasetAuthorityDigestHex},
          ${membership.contentDigestHex}, ${cycle.contentDigestHex},
          ${tx.json(JSON.parse(JSON.stringify(membership)) as postgres.JSONValue)},
          ${tx.json(JSON.parse(JSON.stringify(cycle)) as postgres.JSONValue)},
          ${authorityDigest}, 'waia.trader.historical_dataset_authority.v2'
        ) ON CONFLICT (organization_id, run_id, cycle_id) DO NOTHING RETURNING id::text
      `;
        const existing = inserted[0] ? inserted : await tx<{ id: string }[]>`
        SELECT id::text FROM trader_historical_dataset_authority_v2
        WHERE organization_id=${input.organizationId}::uuid AND run_id=${input.runId}
          AND cycle_id=${cycle.cycleId} AND authority_content_digest_hex=${authorityDigest}
      `;
        if (!existing[0]) throw new Error("HISTORICAL_DATASET_AUTHORITY_CONFLICT");
        ids.set(cycle.cycleId, existing[0].id);
      }
      return ids;
    });
  }

  async function preregisterExecution(input: Readonly<{
    organizationId: string; accountId: string; runId: string; forecastId: string;
    datasetAuthorityId: string; cycleId: string;
    policyConfig: HistoricalPolicyConfigV2; defaultQuantity: string;
    initialAccountingFrontierId: string;
  }>): Promise<Readonly<{ preregistrationId: string; authorities: ExecutionAuthorities;
    datasetAuthorityDigestHex: string }>> {
    if (transactionalPreregistration) {
      return sql.begin("isolation level serializable", (tx) =>
        createCanonicalDecisionVerificationReceiptServiceInternalV2(
          tx as unknown as postgres.Sql,
          false,
        ).preregisterExecution(input));
    }
    const datasetRows = await sql<{ membership_json: HistoricalDatasetMembershipV2;
      sealed_cycle_json: HistoricalSealedMarketCycleV2; authority_content_digest_hex: string;
      dataset_authority_class: "FULL_SEALED_DATASET_V2" | "PRE_HOLDOUT_QUALIFICATION_V1";
      dataset_authority_digest_hex: string }[]>`
      SELECT membership_json, sealed_cycle_json, authority_content_digest_hex,
             dataset_authority_class, dataset_authority_digest_hex
      FROM trader_historical_dataset_authority_v2
      WHERE id=${input.datasetAuthorityId}::uuid AND organization_id=${input.organizationId}::uuid
        AND run_id=${input.runId} AND cycle_id=${input.cycleId}
      FOR SHARE
    `;
    const dataset = datasetRows[0];
    if (!dataset || computeStableJsonDigest({ organizationId: input.organizationId, runId: input.runId,
      membership: dataset.membership_json, sealedCycle: dataset.sealed_cycle_json }) !==
      dataset.authority_content_digest_hex) {
      throw new Error("CANONICAL_DECISION_PREREGISTRATION_REFUSED:DATASET_AUTHORITY");
    }
    const membership = dataset.membership_json;
    const datasetAuthorityClass = membership.datasetAuthorityClass ?? "FULL_SEALED_DATASET_V2";
    const datasetAuthorityDigestHex = membership.datasetAuthorityDigestHex ??
      ("sealReceiptDigestHex" in membership ? membership.sealReceiptDigestHex : undefined);
    const sealedCycle = dataset.sealed_cycle_json;
    assertHistoricalMarketCycleV2(sealedCycle, input.cycleId);
    const membershipBody = { ...membership } as Record<string, unknown>;
    delete membershipBody.contentDigestHex;
    if (membership.schemaVersion !== HISTORICAL_DATASET_MEMBERSHIP_V2 ||
        computeSemanticSha256Hex(membershipBody) !== membership.contentDigestHex ||
        membership.organizationId !== input.organizationId ||
        membership.cycleId !== sealedCycle.cycleId ||
        membership.sealedCycleContentDigestHex !== sealedCycle.contentDigestHex ||
        membership.barContentDigestHex !== computeBarContentDigest(sealedCycle.closedBar) ||
        datasetAuthorityClass !== dataset.dataset_authority_class ||
        datasetAuthorityDigestHex !== dataset.dataset_authority_digest_hex ||
        !datasetAuthorityDigestHex || !input.initialAccountingFrontierId.trim()) {
      throw new Error("CANONICAL_DECISION_PREREGISTRATION_REFUSED:SOURCE_BINDING");
    }
    const accountingRows = await sql<Record<string, unknown>[]>`
      SELECT * FROM trader_accounting_frontier
      WHERE id=${input.initialAccountingFrontierId}::uuid
        AND organization_id=${input.organizationId}::uuid AND account_key=${input.accountId}
        AND run_id=${input.runId} AND accounting_sequence=1
        AND NOT EXISTS (
          SELECT 1 FROM trader_accounting_frontier earlier
          WHERE earlier.organization_id=${input.organizationId}::uuid
            AND earlier.account_key=${input.accountId}
            AND earlier.run_id=${input.runId}
            AND earlier.accounting_sequence < trader_accounting_frontier.accounting_sequence
        )
    `;
    const ar = accountingRows[0] as Record<string, unknown> | undefined;
    if (!ar) throw new Error("CANONICAL_DECISION_PREREGISTRATION_REFUSED:INITIAL_ACCOUNTING_INCEPTION");
    // The 0100 frontier row intentionally stores the compact accounting projection, while the
    // semantic digest also covers deterministic drawdown inception fields. Rebuild sequence-one
    // inception from its durable identity/cash/time instead of pretending the compact row carries
    // those omitted fields.
    const inception = createInitialAccountingState({ organizationId: String(ar.organization_id),
      accountKey: String(ar.account_key), runId: String(ar.run_id), startingCash: String(ar.cash),
      frontierAsOf: new Date(ar.frontier_as_of as string | Date).toISOString() });
    const empty = (value: unknown) => value !== null && typeof value === "object" && Object.keys(value).length === 0;
    const inceptionDigest = computeAccountingSemanticDigest(inception);
    if (inceptionDigest !== String(ar.semantic_content_digest) ||
        String(ar.schema_version) !== inception.schemaVersion ||
        String(ar.gross_realized_pnl) !== "0" || String(ar.net_realized_pnl) !== "0" ||
        String(ar.equity) !== inception.equity || String(ar.equity_hwm) !== inception.equityHwm ||
        Number(ar.account_drawdown_bps) !== 0 || ar.source_fill_id !== null ||
        !empty(ar.position_quantity_json) || !empty(ar.gross_position_basis_json) ||
        !empty(ar.net_position_basis_json) || !empty(ar.marks_json)) {
      throw new Error("CANONICAL_DECISION_PREREGISTRATION_REFUSED:ACCOUNTING_DIGEST");
    }
    const initialAccounting: AccountingFrontierV1 = { ...inception, id: String(ar.id),
      sourceFillId: null, sourceEconomicsDigest: String(ar.source_economics_digest),
      semanticContentDigest: inceptionDigest, idempotencyKey: String(ar.idempotency_key) };
    const forecastRows = await sql<{ authorized_outcome_json: unknown; anchor_closed_bar_epoch_ms: string | number }[]>`
      SELECT b.forecast_runtime_authorized_outcome_json AS authorized_outcome_json,
             b.anchor_closed_bar_epoch_ms
      FROM trader_forecast_v2 f JOIN trader_forecast_bundle_v2 b
        ON b.organization_id=f.organization_id AND b.id=f.bundle_id
      WHERE f.organization_id=${input.organizationId}::uuid AND f.id=${input.forecastId}::uuid
        AND f.target_role_id='EXECUTION_OPPORTUNITY'
    `;
    const forecastRow = forecastRows[0];
    if (!forecastRow) throw new Error("CANONICAL_DECISION_PREREGISTRATION_REFUSED:FORECAST");
    const forecast = requireForecastRuntimeAuthorizedOutcomeV2(forecastRow.authorized_outcome_json as never);
    const barEpoch = Date.parse(sealedCycle.closedBar.barCloseTime);
    if (forecast.authority.organizationId !== input.organizationId ||
        forecast.authority.anchorClosedBarEpochMs !== barEpoch ||
        Number(forecastRow.anchor_closed_bar_epoch_ms) !== barEpoch ||
        !historicalInstrumentsMatch(forecast.issuance.package.family.symbol, sealedCycle.closedBar.symbol)) {
      throw new Error("CANONICAL_DECISION_PREREGISTRATION_REFUSED:FORECAST_BINDING");
    }
    const symbol = sealedCycle.closedBar.symbol.replace("/", "");
    const identity = { organizationId: input.organizationId, accountId: input.accountId,
      venue: "HTX", market: "SPOT" as const, symbol,
      baseAsset: symbol.endsWith("USDT") ? symbol.slice(0, -4) : symbol, quoteAsset: "USDT" as const };
    const binding = { ...identity, instrumentIdentityDigestHex: computeDee659InstrumentIdentityDigestV1(identity) };
    const qualificationReceiptDigestHex = computeStableJsonDigest({
      source: "DATASET_AUTHORITY_BAR", datasetAuthorityClass, datasetAuthorityDigestHex,
      sealedCycleContentDigestHex: sealedCycle.contentDigestHex,
      datasetMembershipContentDigestHex: membership.contentDigestHex,
      forecastAuthorityContentDigestHex: forecast.authority.contentDigestHex,
    });
    const close = formatDecimal(parseDecimal(String(sealedCycle.closedBar.close)));
    const anchor = createForecastAnchorPriceAuthorityV1({ ...binding,
      schemaVersion: DEE659_ANCHOR_AUTHORITY_SCHEMA_VERSION,
      forecastAnchorClosedBarEpochMs: barEpoch, qualifiedAnchorClosedBarEpochMs: barEpoch,
      forecastAnchorClosePrice: close, qualifiedAnchorClosePrice: close,
      qualificationReceiptDigestHex });
    const policyEvidence = { policyConfig: input.policyConfig, binding,
      datasetAuthorityClass, datasetAuthorityDigestHex };
    const policyConfigDigestHex = computeStableJsonDigest(input.policyConfig);
    await sql`
      INSERT INTO trader_historical_simulation_policy_config_v2 (
        organization_id, run_id, policy_config_digest_hex, policy_config_json,
        verifier_code_digest_hex, schema_version
      ) VALUES (
        ${input.organizationId}::uuid, ${input.runId}, ${policyConfigDigestHex},
        ${sql.json(JSON.parse(JSON.stringify(input.policyConfig)) as postgres.JSONValue)},
        ${verifierDigest}, 'waia.trader.historical_simulation_policy_config.v2'
      ) ON CONFLICT (organization_id, run_id, policy_config_digest_hex) DO NOTHING
    `;
    const policyRows = await sql<{ policy_config_json: unknown; verifier_code_digest_hex: string }[]>`
      SELECT policy_config_json, verifier_code_digest_hex
      FROM trader_historical_simulation_policy_config_v2
      WHERE organization_id=${input.organizationId}::uuid AND run_id=${input.runId}
        AND policy_config_digest_hex=${policyConfigDigestHex}
    `;
    if (!policyRows[0] || computeStableJsonDigest(policyRows[0].policy_config_json) !== computeStableJsonDigest(input.policyConfig) ||
        policyRows[0].verifier_code_digest_hex !== verifierDigest) {
      throw new Error("HISTORICAL_POLICY_CONFIG_CONFLICT");
    }
    const executablePolicy = createDee659ExecutablePolicyInstanceV1({ ...binding,
      schemaVersion: DEE659_EXECUTABLE_POLICY_SCHEMA_VERSION, ...input.policyConfig,
      preregistrationReceiptDigestHex: computeStableJsonDigest({ ...policyEvidence, purpose: "PREREGISTRATION" }),
      costAuthorityReceiptDigestHex: computeStableJsonDigest({ ...policyEvidence, purpose: "COSTS" }),
      liquidityCapacityAuthorityReceiptDigestHex: computeStableJsonDigest({ ...policyEvidence, purpose: "LIQUIDITY" }),
      quantityRulesAuthorityReceiptDigestHex: computeStableJsonDigest({ ...policyEvidence, purpose: "QUANTITY" }),
    });
    const economicSize = createSingletonEconomicSizeSetV1({ ...binding,
      sizeSetId: `${input.runId}:initial-size`,
      unit: "BASE_ASSET_QUANTITY", exactQuantity: input.defaultQuantity,
      authorityReceiptDigestHex: computeStableJsonDigest({ defaultQuantity: input.defaultQuantity,
        policyContentDigestHex: executablePolicy.contentDigestHex, accountingDigest: initialAccounting.semanticContentDigest }),
    });
    const cash = createCashEconomicAuthorityV1({ ...binding,
      availableCashUsdt: initialAccounting.cash,
      authorityReceiptDigestHex: computeStableJsonDigest({ accountingFrontierId: initialAccounting.id,
        accountingSemanticContentDigest: initialAccounting.semanticContentDigest,
        cash: initialAccounting.cash }),
    });
    const authorities = { anchor, executablePolicy, economicSize, cash };
    requireExecutionAuthorities(authorities);
    const a = anchor;
    const definitions = [
      ["ANCHOR_QUALIFICATION", "FORECAST_ANCHOR_PRICE_AUTHORITY", authorities.anchor, authorities.anchor.qualificationReceiptDigestHex],
      ["EXECUTABLE_POLICY_PREREGISTRATION", "EXECUTABLE_POLICY", authorities.executablePolicy, authorities.executablePolicy.preregistrationReceiptDigestHex],
      ["ECONOMIC_SIZE_AUTHORIZATION", "ECONOMIC_SIZE_SET", authorities.economicSize, authorities.economicSize.authorityReceiptDigestHex],
      ["CASH_SNAPSHOT_AUTHORIZATION", "CASH_AUTHORITY", authorities.cash, authorities.cash.authorityReceiptDigestHex],
    ] as const;
    for (const [, subjectKind, authority] of definitions) {
      await persistSubject(sql, {
        organizationId: a.organizationId, accountId: a.accountId,
        instrumentIdentityDigestHex: a.instrumentIdentityDigestHex, subjectKind,
        subjectContentDigestHex: authority.contentDigestHex, subject: authority,
        pitAnchor: sealedCycle.closedBar.barCloseTime,
      });
    }
    const body = { schemaVersion: "waia.trader.dee659_authority_preregistration.v2",
      organizationId: input.organizationId, accountId: input.accountId, runId: input.runId,
      forecastId: input.forecastId, datasetMembership: membership,
      sealedCycle, policyConfig: input.policyConfig,
      initialAccountingIdentity: { id: initialAccounting.id,
        semanticContentDigest: initialAccounting.semanticContentDigest }, authorities };
    const bundleDigest = computeStableJsonDigest(body);
    const rows = await sql<{ id: string }[]>`
      INSERT INTO trader_dee659_authority_preregistration_v2 (
        organization_id, account_id, run_id, cycle_id, forecast_id, instrument_identity_digest_hex, dataset_authority_id,
        dataset_authority_digest_hex, policy_config_digest_hex, anchor_subject_digest_hex, policy_subject_digest_hex,
        size_subject_digest_hex, cash_subject_digest_hex, authority_bundle_json,
        authority_bundle_digest_hex, effective_market_from, schema_version
      ) VALUES (
        ${a.organizationId}::uuid, ${a.accountId}, ${input.runId}, ${input.cycleId}, ${input.forecastId}::uuid,
        ${a.instrumentIdentityDigestHex}, ${input.datasetAuthorityId}::uuid, ${datasetAuthorityDigestHex}, ${policyConfigDigestHex}, ${a.contentDigestHex},
        ${authorities.executablePolicy.contentDigestHex}, ${authorities.economicSize.contentDigestHex},
        ${authorities.cash.contentDigestHex}, ${sql.json(JSON.parse(JSON.stringify(body)) as postgres.JSONValue)},
        ${bundleDigest}, ${sealedCycle.closedBar.barCloseTime}::timestamptz,
        ${body.schemaVersion}
      ) ON CONFLICT (organization_id, account_id, run_id, forecast_id, authority_bundle_digest_hex)
        DO NOTHING RETURNING id::text
    `;
    if (rows[0]) return Object.freeze({ preregistrationId: rows[0].id, authorities,
      datasetAuthorityDigestHex });
    const existing = await sql<{ id: string }[]>`
      SELECT id::text FROM trader_dee659_authority_preregistration_v2
      WHERE organization_id=${a.organizationId}::uuid AND account_id=${a.accountId}
        AND run_id=${input.runId} AND forecast_id=${input.forecastId}::uuid
        AND authority_bundle_digest_hex=${bundleDigest}
    `;
    if (!existing[0]) throw new Error("CANONICAL_DECISION_PREREGISTRATION_CONFLICT");
    return Object.freeze({ preregistrationId: existing[0].id, authorities,
      datasetAuthorityDigestHex });
  }

  async function issueExecution(input: Readonly<{
    preregistrationId: string; organizationId: string; accountId: string; runId: string;
    forecastId: string; datasetAuthorityDigestHex: string; pitAnchor: string;
    subjectContentDigestHex: Readonly<{ anchor: string; executablePolicy: string; economicSize: string; cash: string }>;
  }>) {
    const rows = await sql<{ authority_bundle_json: { authorities: ExecutionAuthorities };
      authority_bundle_digest_hex: string; effective_market_from: Date | string; registered_at: Date | string }[]>`
      SELECT p.authority_bundle_json, p.authority_bundle_digest_hex, p.effective_market_from, p.registered_at
      FROM trader_dee659_authority_preregistration_v2 p
      JOIN trader_historical_simulation_run_start_v2 rs
        ON rs.organization_id=p.organization_id AND rs.run_id=p.run_id
       AND rs.account_id=p.account_id
       AND rs.dataset_authority_digest_hex=p.dataset_authority_digest_hex
       AND rs.policy_config_digest_hex=p.policy_config_digest_hex
      WHERE p.id=${input.preregistrationId}::uuid AND p.organization_id=${input.organizationId}::uuid
        AND p.account_id=${input.accountId} AND p.run_id=${input.runId} AND p.forecast_id=${input.forecastId}::uuid
        AND p.dataset_authority_digest_hex=${input.datasetAuthorityDigestHex}
        AND p.anchor_subject_digest_hex=${input.subjectContentDigestHex.anchor}
        AND p.policy_subject_digest_hex=${input.subjectContentDigestHex.executablePolicy}
        AND p.size_subject_digest_hex=${input.subjectContentDigestHex.economicSize}
        AND p.cash_subject_digest_hex=${input.subjectContentDigestHex.cash}
        AND p.effective_market_from <= ${input.pitAnchor}::timestamptz
    `;
    const prereg = rows[0];
    if (!prereg || computeStableJsonDigest(prereg.authority_bundle_json) !== prereg.authority_bundle_digest_hex) {
      throw new Error("CANONICAL_DECISION_VERIFICATION_REFUSED:PREREGISTRATION");
    }
    const authorities = prereg.authority_bundle_json.authorities;
    requireExecutionAuthorities(authorities);
    const a = authorities.anchor;
    const definitions = [
      ["ANCHOR_QUALIFICATION", "FORECAST_ANCHOR_PRICE_AUTHORITY", authorities.anchor, authorities.anchor.qualificationReceiptDigestHex],
      ["EXECUTABLE_POLICY_PREREGISTRATION", "EXECUTABLE_POLICY", authorities.executablePolicy, authorities.executablePolicy.preregistrationReceiptDigestHex],
      ["ECONOMIC_SIZE_AUTHORIZATION", "ECONOMIC_SIZE_SET", authorities.economicSize, authorities.economicSize.authorityReceiptDigestHex],
      ["CASH_SNAPSHOT_AUTHORIZATION", "CASH_AUTHORITY", authorities.cash, authorities.cash.authorityReceiptDigestHex],
    ] as const;
    const receipts: VerifiedDecisionEconomicAuthorityV1[] = [];
    for (const [purpose, subjectKind, authority] of definitions) {
      const subjects = await sql<{ subject_json: unknown; pit_anchor: Date | string;
        account_id: string | null; instrument_identity_digest_hex: string | null }[]>`
        SELECT subject_json, pit_anchor, account_id, instrument_identity_digest_hex
        FROM trader_canonical_decision_verification_subject_v2
        WHERE organization_id=${a.organizationId}::uuid AND subject_kind=${subjectKind}
          AND subject_content_digest_hex=${authority.contentDigestHex}
      `;
      const subject = subjects[0];
      if (!subject || computeStableJsonDigest(subject.subject_json) !== computeStableJsonDigest(authority) ||
          subject.account_id !== a.accountId ||
          subject.instrument_identity_digest_hex !== a.instrumentIdentityDigestHex ||
          new Date(subject.pit_anchor).getTime() > Date.parse(input.pitAnchor)) {
        throw new Error("CANONICAL_DECISION_VERIFICATION_REFUSED:PREREGISTERED_SUBJECT");
      }
      const receipt = seal({
        schemaVersion: CANONICAL_DECISION_VERIFICATION_RECEIPT_V2,
        organizationId: a.organizationId, accountId: a.accountId, purpose,
        instrumentIdentityDigestHex: a.instrumentIdentityDigestHex,
        forecastId: input.forecastId,
        forecastBundleId: null,
        dee659PreregistrationId: input.preregistrationId,
        subjectKind,
        subjectContentDigestHex: authority.contentDigestHex, sourceRecordKind: "DEE659_AUTHORITY_PREREGISTRATION_V2",
        sourceRecordId: input.preregistrationId, sourceRecordContentDigestHex: prereg.authority_bundle_digest_hex,
        pitAnchor: input.pitAnchor, verified: true,
        verifierVersion: VERIFIER_VERSION, verifierCodeDigestHex: verifierDigest,
      });
      await persist(sql, receipt);
      receipts.push({
        schemaVersion: "dee659-authority-verification/v1", verified: true, purpose,
        organizationId: a.organizationId, accountId: a.accountId,
        instrumentIdentityDigestHex: a.instrumentIdentityDigestHex,
        subjectContentDigestHex: authority.contentDigestHex,
        verificationReceiptDigestHex: receipt.verificationReceiptDigestHex,
      });
    }
    return { anchor: receipts[0]!, executablePolicy: receipts[1]!, economicSize: receipts[2]!, cash: receipts[3]! };
  }

  async function startRun(input: Readonly<{
    organizationId: string; accountId: string; runId: string; preregistrationId: string;
    datasetAuthorityDigestHex: string;
  }>): Promise<void> {
    const prereg = await sql<{ policy_config_digest_hex: string }[]>`
      SELECT policy_config_digest_hex
      FROM trader_dee659_authority_preregistration_v2
      WHERE id=${input.preregistrationId}::uuid AND organization_id=${input.organizationId}::uuid
        AND account_id=${input.accountId} AND run_id=${input.runId}
        AND dataset_authority_digest_hex=${input.datasetAuthorityDigestHex}
      FOR SHARE
    `;
    if (!prereg[0]) throw new Error("HISTORICAL_SIMULATION_RUN_START_PREREGISTRATION_MISMATCH");
    await sql`
      INSERT INTO trader_historical_simulation_run_start_v2 (
        organization_id, run_id, account_id, dataset_authority_digest_hex,
        policy_config_digest_hex, initial_dee659_preregistration_id, schema_version
      ) VALUES (
        ${input.organizationId}::uuid, ${input.runId}, ${input.accountId}, ${input.datasetAuthorityDigestHex},
        ${prereg[0].policy_config_digest_hex}, ${input.preregistrationId}::uuid,
        'waia.trader.historical_simulation_run_start.v2'
      ) ON CONFLICT (organization_id, run_id) DO NOTHING
    `;
    const rows = await sql<{ account_id: string; dataset_authority_digest_hex: string;
      policy_config_digest_hex: string }[]>`
      SELECT account_id, dataset_authority_digest_hex, policy_config_digest_hex
      FROM trader_historical_simulation_run_start_v2
      WHERE organization_id=${input.organizationId}::uuid AND run_id=${input.runId}
    `;
    if (!rows[0] || rows[0].account_id !== input.accountId ||
        rows[0].dataset_authority_digest_hex !== input.datasetAuthorityDigestHex ||
        rows[0].policy_config_digest_hex !== prereg[0].policy_config_digest_hex) {
      throw new Error("HISTORICAL_SIMULATION_RUN_START_CONFLICT");
    }
  }

  return Object.freeze({ registerDatasetAuthority, issueForecast, issueScientific,
    preregisterExecution, startRun, issueExecution });
}

/** Production factory. Transactional preregistration cannot be disabled by callers. */
export function createCanonicalDecisionVerificationReceiptServiceV2(sql: postgres.Sql) {
  return createCanonicalDecisionVerificationReceiptServiceInternalV2(sql, true);
}

export function createPostgresCanonicalDecisionVerificationReceiptPortV2(
  sql: postgres.Sql,
): CanonicalDecisionVerificationReceiptPortV2 {
  const verifierDigest = verifierCodeDigestHex();
  async function load(purpose: Purpose, organizationId: string, subject: string,
    sourceRecordId?: string, forecastId?: string) {
    const rows = await sql<{ receipt_json: CanonicalDecisionVerificationReceiptV2 }[]>`
      SELECT r.receipt_json FROM trader_canonical_decision_verification_receipt_v2 r
      JOIN trader_canonical_decision_verification_subject_v2 s
        ON s.organization_id=r.organization_id AND s.subject_kind=r.subject_kind
       AND s.subject_content_digest_hex=r.subject_content_digest_hex
      WHERE r.organization_id=${organizationId}::uuid AND r.purpose=${purpose}
        AND r.subject_content_digest_hex=${subject}
        AND (${sourceRecordId ?? null}::text IS NULL OR r.source_record_id=${sourceRecordId ?? null})
        AND (${forecastId ?? null}::text IS NULL OR r.forecast_id::text=${forecastId ?? null})
        AND r.schema_version=${CANONICAL_DECISION_VERIFICATION_RECEIPT_V2}
        AND r.verifier_version=${VERIFIER_VERSION}
        AND r.verifier_code_digest_hex=${verifierDigest} AND r.verified=true
    `;
    const receipt = rows[0]?.receipt_json;
      if (!receipt || !hasValidDigest(receipt) || receipt.organizationId !== organizationId ||
          receipt.purpose !== purpose || receipt.subjectContentDigestHex !== subject ||
          receipt.schemaVersion !== CANONICAL_DECISION_VERIFICATION_RECEIPT_V2 ||
          receipt.verifierVersion !== VERIFIER_VERSION ||
          receipt.verifierCodeDigestHex !== verifierDigest || receipt.verified !== true) {
      throw new Error("CANONICAL_DECISION_VERIFICATION_RECEIPT_MISSING_OR_CORRUPT");
    }
    return receipt;
  }
  return {
    loadForecastVerification: (value) => load("FORECAST_RUNTIME_AUTHORIZED", value.organizationId,
      value.subjectContentDigestHex, undefined, value.forecastId)
      .then((receipt) => {
        if (receipt.forecastId !== value.forecastId) throw new Error("CANONICAL_DECISION_VERIFICATION_RECEIPT_FORECAST_MISMATCH");
        return receipt;
      }),
    loadScientificVerification: (value) => load("SCIENTIFIC_ADMISSION", value.organizationId,
      value.scientificAdmissionContentDigestHex, undefined, value.forecastId)
      .then((receipt) => {
        if (receipt.forecastId !== value.forecastId) throw new Error("CANONICAL_DECISION_VERIFICATION_RECEIPT_FORECAST_MISMATCH");
        return receipt;
      }),
    async loadExecutionPayoffVerification(value): Promise<ExecutionPayoffAuthorityVerificationV1> {
      const purposes = ["ANCHOR_QUALIFICATION", "EXECUTABLE_POLICY_PREREGISTRATION", "ECONOMIC_SIZE_AUTHORIZATION", "CASH_SNAPSHOT_AUTHORIZATION"] as const;
      const expectedSubjects = [value.subjectContentDigestHex.anchor,
        value.subjectContentDigestHex.executablePolicy, value.subjectContentDigestHex.economicSize,
        value.subjectContentDigestHex.cash];
      const receipts = await Promise.all(purposes.map(async (purpose, index) => {
        const rows = await sql<{ receipt_json: CanonicalDecisionVerificationReceiptV2 }[]>`
          SELECT r.receipt_json FROM trader_canonical_decision_verification_receipt_v2 r
          JOIN trader_canonical_decision_verification_subject_v2 s
            ON s.organization_id=r.organization_id AND s.subject_kind=r.subject_kind
           AND s.subject_content_digest_hex=r.subject_content_digest_hex
          JOIN trader_dee659_authority_preregistration_v2 p
            ON p.organization_id=r.organization_id AND p.id=r.dee659_preregistration_id
          WHERE r.organization_id=${value.organizationId}::uuid AND r.account_id=${value.accountId}
            AND r.instrument_identity_digest_hex=${value.instrumentIdentityDigestHex}
            AND r.purpose=${purpose} AND r.subject_content_digest_hex=${expectedSubjects[index]}
            AND r.dee659_preregistration_id=${value.dee659PreregistrationId}::uuid
            AND r.source_record_id=${value.dee659PreregistrationId}
            AND r.forecast_id=${value.forecastId}::uuid
            AND p.run_id=${value.runId} AND p.dataset_authority_digest_hex=${value.datasetAuthorityDigestHex}
            AND r.pit_anchor=${value.pitAnchor}::timestamptz
            AND r.schema_version=${CANONICAL_DECISION_VERIFICATION_RECEIPT_V2}
            AND r.verifier_version=${VERIFIER_VERSION}
            AND r.verifier_code_digest_hex=${verifierDigest} AND r.verified=true
        `;
        return rows[0]?.receipt_json;
      }));
      const pitAnchor = value.pitAnchor;
      if (receipts.some((receipt, index) => !receipt || !hasValidDigest(receipt) ||
          receipt.accountId !== value.accountId ||
          receipt.instrumentIdentityDigestHex !== value.instrumentIdentityDigestHex ||
          receipt.pitAnchor !== pitAnchor || receipt.subjectContentDigestHex !== expectedSubjects[index] ||
          receipt.dee659PreregistrationId !== value.dee659PreregistrationId ||
          receipt.forecastId !== value.forecastId ||
          receipt.verifierVersion !== VERIFIER_VERSION || receipt.verifierCodeDigestHex !== verifierDigest)) {
        throw new Error("CANONICAL_DECISION_VERIFICATION_RECEIPT_MISSING_OR_CORRUPT");
      }
      return Object.fromEntries(receipts.map((r, index) => [index === 0 ? "anchor" : index === 1 ? "executablePolicy" : index === 2 ? "economicSize" : "cash", {
        schemaVersion: "dee659-authority-verification/v1", verified: true, purpose: r!.purpose,
        organizationId: r!.organizationId, accountId: r!.accountId!, instrumentIdentityDigestHex: r!.instrumentIdentityDigestHex!,
        subjectContentDigestHex: r!.subjectContentDigestHex, verificationReceiptDigestHex: r!.verificationReceiptDigestHex,
      }])) as ExecutionPayoffAuthorityVerificationV1;
    },
  };
}
