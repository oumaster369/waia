import type postgres from "postgres";

import {
  type CashEconomicAuthorityV1,
  type Dee659ExecutablePolicyInstanceV1,
  type EconomicAdmissibleSizeSetV1,
  type ForecastAnchorPriceAuthorityV1,
  validateCashEconomicAuthorityV1,
  validateDee659ExecutablePolicyInstanceV1,
  validateEconomicAdmissibleSizeSetV1,
  validateForecastAnchorPriceAuthorityV1,
} from "@/lib/trader/intelligence/decision-economics/dee659-execution-payoff-authorities-v1";
import {
  sameDee659AuthorityBindingV1,
  validateVerifiedDecisionEconomicAuthorityV1,
  type ExecutionPayoffAuthorityVerificationV1,
} from "@/lib/trader/intelligence/decision-economics/dee659-execution-payoff-contract-v1";
import {
  readScientificAdmissionReceiptV1,
} from "@/lib/trader/research/execopp-qualification/scientific-admission-receipt-service-v1";
import type {
  PersistedDecisionEconomicsAuthoritiesV2,
  PersistedDecisionEconomicsAuthorityPortV2,
} from "@/lib/trader/historical-simulation-v2/decision-economics-production-adapter-v2";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

export const DEE659_DURABLE_AUTHORITY_BUNDLE_V2 =
  "waia.trader.dee659_durable_authority_bundle.v2" as const;

export type PersistDee659AuthorityBundleV2Input = PersistedDecisionEconomicsAuthoritiesV2 & Readonly<{
  organizationId: string;
  accountId: string;
  cycleId: string;
  forecastAuthorityContentDigestHex: string;
  runId: string;
  datasetAuthorityDigestHex: string;
  dee659PreregistrationId: string;
  pitAnchor: string;
}>;

/** Must be backed by upstream append-only receipt storage; this repository never mints receipts. */
export type CanonicalDecisionVerificationReceiptPortV2 = Readonly<{
  loadForecastVerification(input: Readonly<{
    organizationId: string; forecastId: string; subjectContentDigestHex: string;
  }>): Promise<Readonly<{ verificationReceiptDigestHex: string }>>;
  loadScientificVerification(input: Readonly<{
    organizationId: string; forecastId: string; scientificAdmissionContentDigestHex: string;
  }>): Promise<Readonly<{ verificationReceiptDigestHex: string }>>;
  loadExecutionPayoffVerification(input: Readonly<{
    organizationId: string; accountId: string; instrumentIdentityDigestHex: string;
    runId: string; datasetAuthorityDigestHex: string; dee659PreregistrationId: string; forecastId: string;
    pitAnchor: string;
    subjectContentDigestHex: Readonly<{
      anchor: string; executablePolicy: string; economicSize: string; cash: string;
    }>;
  }>): Promise<ExecutionPayoffAuthorityVerificationV1>;
}>;

type AuthorityRow = Readonly<{
  organization_id: string;
  account_id: string;
  cycle_id: string;
  run_id: string;
  dataset_authority_digest_hex: string;
  dee659_preregistration_id: string;
  forecast_authority_content_digest_hex: string;
  forecast_id: string;
  forecast_issuance_receipt_digest_hex: string;
  forecast_verification_receipt_digest_hex: string;
  scientific_admission_evidence_digest_hex: string;
  scientific_verification_receipt_digest_hex: string;
  anchor_authority_json: unknown;
  executable_policy_json: unknown;
  economic_size_set_json: unknown;
  cash_authority_json: unknown;
  execution_payoff_verification_json: unknown;
  pit_anchor: Date | string;
  bundle_content_digest_hex: string;
}>;

const DIGEST = /^[0-9a-f]{64}$/;

function canonicalUtc(value: string, field: string): void {
  const epoch = Date.parse(value);
  if (!Number.isSafeInteger(epoch) || new Date(epoch).toISOString() !== value) {
    throw new Error(`DEE659_DURABLE_AUTHORITY_INVALID:${field}`);
  }
}

function requireDigest(value: string, field: string): void {
  if (!DIGEST.test(value)) throw new Error(`DEE659_DURABLE_AUTHORITY_INVALID:${field}`);
}

function asJsonValue(value: unknown): postgres.JSONValue {
  return JSON.parse(JSON.stringify(value)) as postgres.JSONValue;
}

function parseObject<T>(value: unknown, field: string): T {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`DEE659_DURABLE_AUTHORITY_CORRUPTION:${field}`);
  }
  return value as T;
}

function validateBundle(input: PersistDee659AuthorityBundleV2Input): void {
  if (!input.organizationId.trim() || !input.accountId.trim() || !input.cycleId.trim() ||
      !input.forecastId.trim() || !input.runId.trim() || !input.dee659PreregistrationId.trim()) {
    throw new Error("DEE659_DURABLE_AUTHORITY_INVALID:identity");
  }
  canonicalUtc(input.pitAnchor, "pitAnchor");
  [
    [input.forecastAuthorityContentDigestHex, "forecastAuthorityContentDigestHex"],
    [input.forecastIssuanceReceiptDigestHex, "forecastIssuanceReceiptDigestHex"],
    [input.forecastVerificationReceiptDigestHex, "forecastVerificationReceiptDigestHex"],
    [input.scientificVerificationReceiptDigestHex, "scientificVerificationReceiptDigestHex"],
    [input.datasetAuthorityDigestHex, "datasetAuthorityDigestHex"],
  ].forEach(([value, field]) => requireDigest(value, field));
  const anchor = input.anchorAuthority;
  const authorities = [input.executablePolicy, input.economicSizeSet, input.cashAuthority];
  if (
    anchor.organizationId !== input.organizationId || anchor.accountId !== input.accountId ||
    authorities.some((authority) => !sameDee659AuthorityBindingV1(anchor, authority)) ||
    anchor.forecastAnchorClosedBarEpochMs !== Date.parse(input.pitAnchor) ||
    input.scientificAdmission.organizationId !== input.organizationId
  ) throw new Error("DEE659_DURABLE_AUTHORITY_INVALID:scopeOrPitBinding");
  const errors = [
    ...validateForecastAnchorPriceAuthorityV1(anchor),
    ...validateDee659ExecutablePolicyInstanceV1(input.executablePolicy),
    ...validateEconomicAdmissibleSizeSetV1(input.economicSizeSet),
    ...validateCashEconomicAuthorityV1(input.cashAuthority),
    ...validateVerifiedDecisionEconomicAuthorityV1({ verification: input.executionPayoffVerification.anchor, purpose: "ANCHOR_QUALIFICATION", subjectContentDigestHex: anchor.contentDigestHex, authority: anchor }),
    ...validateVerifiedDecisionEconomicAuthorityV1({ verification: input.executionPayoffVerification.executablePolicy, purpose: "EXECUTABLE_POLICY_PREREGISTRATION", subjectContentDigestHex: input.executablePolicy.contentDigestHex, authority: anchor }),
    ...validateVerifiedDecisionEconomicAuthorityV1({ verification: input.executionPayoffVerification.economicSize, purpose: "ECONOMIC_SIZE_AUTHORIZATION", subjectContentDigestHex: input.economicSizeSet.contentDigestHex, authority: anchor }),
    ...validateVerifiedDecisionEconomicAuthorityV1({ verification: input.executionPayoffVerification.cash, purpose: "CASH_SNAPSHOT_AUTHORIZATION", subjectContentDigestHex: input.cashAuthority.contentDigestHex, authority: anchor }),
  ];
  if (errors.length > 0) throw new Error(`DEE659_DURABLE_AUTHORITY_INVALID:${errors.join(",")}`);
}

function bundleDigest(input: PersistDee659AuthorityBundleV2Input): string {
  return computeStableJsonDigest({
    schemaVersion: DEE659_DURABLE_AUTHORITY_BUNDLE_V2,
    ...input,
  });
}

async function assertCanonicalForecastAndScientificSources(
  sql: postgres.Sql,
  input: PersistDee659AuthorityBundleV2Input,
): Promise<void> {
  const rows = await sql<Readonly<{
    cycle_id: string;
    anchor_closed_bar_epoch_ms: string | number;
    bundle_content_digest_hex: string;
    authorized_outcome_json: unknown;
    target_role_id: string;
  }>[]>`
    SELECT b.cycle_id, b.anchor_closed_bar_epoch_ms,
           encode(b.bundle_content_digest, 'hex') AS bundle_content_digest_hex,
           b.forecast_runtime_authorized_outcome_json AS authorized_outcome_json,
           f.target_role_id
    FROM trader_forecast_v2 f
    JOIN trader_forecast_bundle_v2 b
      ON b.organization_id = f.organization_id AND b.id = f.bundle_id
    WHERE f.organization_id = ${input.organizationId}::uuid
      AND f.id = ${input.forecastId}::uuid
  `;
  const row = rows[0];
  const outcome = row?.authorized_outcome_json as
    | { status?: unknown; authority?: { contentDigestHex?: unknown } }
    | undefined;
  if (
    !row || row.target_role_id !== "EXECUTION_OPPORTUNITY" || row.cycle_id !== input.cycleId ||
    Number(row.anchor_closed_bar_epoch_ms) !== Date.parse(input.pitAnchor) ||
    row.bundle_content_digest_hex !== input.forecastIssuanceReceiptDigestHex ||
    outcome?.status !== "FORECAST_AUTHORIZED" ||
    outcome.authority?.contentDigestHex !== input.forecastAuthorityContentDigestHex
  ) {
    throw new Error("DEE659_DURABLE_AUTHORITY_INVALID:canonicalSourceBinding");
  }
}

async function assertCanonicalVerificationReceipts(
  port: CanonicalDecisionVerificationReceiptPortV2,
  input: PersistDee659AuthorityBundleV2Input,
): Promise<void> {
  const [forecast, scientific, execution] = await Promise.all([
    port.loadForecastVerification({
      organizationId: input.organizationId,
      forecastId: input.forecastId,
      subjectContentDigestHex: input.forecastAuthorityContentDigestHex,
    }),
    port.loadScientificVerification({
      organizationId: input.organizationId,
      forecastId: input.forecastId,
      scientificAdmissionContentDigestHex: input.scientificAdmission.contentDigest,
    }),
    port.loadExecutionPayoffVerification({
      organizationId: input.organizationId,
      accountId: input.accountId,
      instrumentIdentityDigestHex: input.anchorAuthority.instrumentIdentityDigestHex,
      runId: input.runId,
      datasetAuthorityDigestHex: input.datasetAuthorityDigestHex,
      dee659PreregistrationId: input.dee659PreregistrationId,
      forecastId: input.forecastId,
      pitAnchor: input.pitAnchor,
      subjectContentDigestHex: {
        anchor: input.anchorAuthority.contentDigestHex,
        executablePolicy: input.executablePolicy.contentDigestHex,
        economicSize: input.economicSizeSet.contentDigestHex,
        cash: input.cashAuthority.contentDigestHex,
      },
    }),
  ]);
  if (
    forecast.verificationReceiptDigestHex !== input.forecastVerificationReceiptDigestHex ||
    scientific.verificationReceiptDigestHex !== input.scientificVerificationReceiptDigestHex ||
    computeStableJsonDigest(execution) !== computeStableJsonDigest(input.executionPayoffVerification)
  ) throw new Error("DEE659_DURABLE_AUTHORITY_INVALID:canonicalVerificationReceiptBinding");
}

export function createPostgresDee659AuthorityRepositoryV2(config: Readonly<{
  sql: postgres.Sql;
  verificationReceipts: CanonicalDecisionVerificationReceiptPortV2;
}>):
PersistedDecisionEconomicsAuthorityPortV2 & Readonly<{
  persist(input: PersistDee659AuthorityBundleV2Input): Promise<void>;
}> {
  return Object.freeze({
    async persist(input) {
      validateBundle(input);
      await assertCanonicalForecastAndScientificSources(config.sql, input);
      await assertCanonicalVerificationReceipts(config.verificationReceipts, input);
      const digest = bundleDigest(input);
      const inserted = await config.sql<{ bundle_content_digest_hex: string }[]>`
        INSERT INTO trader_dee659_authority_bundle_v2 (
          organization_id, account_id, cycle_id, forecast_authority_content_digest_hex,
          run_id, dataset_authority_digest_hex, dee659_preregistration_id,
          forecast_id, forecast_issuance_receipt_digest_hex,
          forecast_verification_receipt_digest_hex, scientific_admission_evidence_digest_hex,
          scientific_verification_receipt_digest_hex, anchor_authority_json,
          executable_policy_json, economic_size_set_json, cash_authority_json,
          execution_payoff_verification_json, pit_anchor, schema_version,
          bundle_content_digest_hex
        ) VALUES (
          ${input.organizationId}::uuid, ${input.accountId}, ${input.cycleId},
          ${input.forecastAuthorityContentDigestHex}, ${input.runId},
          ${input.datasetAuthorityDigestHex}, ${input.dee659PreregistrationId}::uuid, ${input.forecastId},
          ${input.forecastIssuanceReceiptDigestHex}, ${input.forecastVerificationReceiptDigestHex},
          ${input.scientificAdmission.evidenceSemanticDigest},
          ${input.scientificVerificationReceiptDigestHex}, ${config.sql.json(asJsonValue(input.anchorAuthority))},
          ${config.sql.json(asJsonValue(input.executablePolicy))}, ${config.sql.json(asJsonValue(input.economicSizeSet))},
          ${config.sql.json(asJsonValue(input.cashAuthority))},
          ${config.sql.json(asJsonValue(input.executionPayoffVerification))}, ${input.pitAnchor}::timestamptz,
          ${DEE659_DURABLE_AUTHORITY_BUNDLE_V2}, ${digest}
        ) ON CONFLICT (organization_id, account_id, run_id, cycle_id, dataset_authority_digest_hex,
          dee659_preregistration_id, forecast_id, forecast_authority_content_digest_hex, pit_anchor)
          DO NOTHING
        RETURNING bundle_content_digest_hex
      `;
      if (inserted[0] && inserted[0].bundle_content_digest_hex !== digest) {
        throw new Error("DEE659_DURABLE_AUTHORITY_CORRUPTION:insertedDigest");
      }
      if (inserted.length === 0) {
        const existing = await config.sql<{ bundle_content_digest_hex: string }[]>`
          SELECT bundle_content_digest_hex FROM trader_dee659_authority_bundle_v2
          WHERE organization_id = ${input.organizationId}::uuid AND account_id = ${input.accountId}
            AND cycle_id = ${input.cycleId}
            AND run_id = ${input.runId} AND dataset_authority_digest_hex = ${input.datasetAuthorityDigestHex}
            AND dee659_preregistration_id = ${input.dee659PreregistrationId}::uuid
            AND forecast_id = ${input.forecastId} AND pit_anchor = ${input.pitAnchor}::timestamptz
            AND forecast_authority_content_digest_hex = ${input.forecastAuthorityContentDigestHex}
        `;
        if (existing[0]?.bundle_content_digest_hex !== digest) {
          throw new Error("DEE659_DURABLE_AUTHORITY_CONFLICT");
        }
      }
    },
    async load(identity) {
      const rows = await config.sql<AuthorityRow[]>`
        SELECT organization_id::text, account_id, cycle_id, run_id, dataset_authority_digest_hex,
               dee659_preregistration_id::text,
               forecast_authority_content_digest_hex, forecast_id,
               forecast_issuance_receipt_digest_hex, forecast_verification_receipt_digest_hex,
               scientific_admission_evidence_digest_hex,
               scientific_verification_receipt_digest_hex, anchor_authority_json,
               executable_policy_json, economic_size_set_json, cash_authority_json,
               execution_payoff_verification_json, pit_anchor, bundle_content_digest_hex
        FROM trader_dee659_authority_bundle_v2
        WHERE organization_id = ${identity.organizationId}::uuid
          AND account_id = ${identity.accountId}
          AND cycle_id = ${identity.cycleId}
          AND forecast_authority_content_digest_hex = ${identity.forecastAuthorityContentDigestHex}
      `;
      if (rows.length !== 1) {
        throw new Error(rows.length === 0 ? "DEE659_DURABLE_AUTHORITY_NOT_FOUND" :
          "DEE659_DURABLE_AUTHORITY_AMBIGUOUS_IDENTITY");
      }
      const row = rows[0]!;
      const scientificAdmission = await readScientificAdmissionReceiptV1(config.sql, {
        organizationId: identity.organizationId,
        evidenceSemanticDigestHex: row.scientific_admission_evidence_digest_hex,
      });
      if (!scientificAdmission) throw new Error("DEE659_DURABLE_AUTHORITY_CORRUPTION:scientificAdmission");
      const loaded: PersistDee659AuthorityBundleV2Input = {
        organizationId: row.organization_id,
        accountId: row.account_id,
        cycleId: row.cycle_id,
        runId: row.run_id,
        datasetAuthorityDigestHex: row.dataset_authority_digest_hex,
        dee659PreregistrationId: row.dee659_preregistration_id,
        forecastAuthorityContentDigestHex: row.forecast_authority_content_digest_hex,
        pitAnchor: new Date(row.pit_anchor).toISOString(),
        forecastId: row.forecast_id,
        forecastIssuanceReceiptDigestHex: row.forecast_issuance_receipt_digest_hex,
        forecastVerificationReceiptDigestHex: row.forecast_verification_receipt_digest_hex,
        scientificAdmission,
        scientificVerificationReceiptDigestHex: row.scientific_verification_receipt_digest_hex,
        anchorAuthority: parseObject<ForecastAnchorPriceAuthorityV1>(row.anchor_authority_json, "anchor"),
        executablePolicy: parseObject<Dee659ExecutablePolicyInstanceV1>(row.executable_policy_json, "policy"),
        economicSizeSet: parseObject<EconomicAdmissibleSizeSetV1>(row.economic_size_set_json, "size"),
        cashAuthority: parseObject<CashEconomicAuthorityV1>(row.cash_authority_json, "cash"),
        executionPayoffVerification: parseObject<ExecutionPayoffAuthorityVerificationV1>(row.execution_payoff_verification_json, "verification"),
      };
      validateBundle(loaded);
      if (bundleDigest(loaded) !== row.bundle_content_digest_hex) {
        throw new Error("DEE659_DURABLE_AUTHORITY_CORRUPTION:bundleDigest");
      }
      await assertCanonicalForecastAndScientificSources(config.sql, loaded);
      await assertCanonicalVerificationReceipts(config.verificationReceipts, loaded);
      const { organizationId: _o, accountId: _a, cycleId: _c,
        forecastAuthorityContentDigestHex: _f, pitAnchor: _p, ...result } = loaded;
      void [_o, _a, _c, _f, _p];
      return Object.freeze(result);
    },
  });
}
