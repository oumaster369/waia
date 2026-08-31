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
  pitAnchor: string;
}>;

type AuthorityRow = Readonly<{
  organization_id: string;
  account_id: string;
  cycle_id: string;
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
      !input.forecastId.trim()) {
    throw new Error("DEE659_DURABLE_AUTHORITY_INVALID:identity");
  }
  canonicalUtc(input.pitAnchor, "pitAnchor");
  [
    [input.forecastAuthorityContentDigestHex, "forecastAuthorityContentDigestHex"],
    [input.forecastIssuanceReceiptDigestHex, "forecastIssuanceReceiptDigestHex"],
    [input.forecastVerificationReceiptDigestHex, "forecastVerificationReceiptDigestHex"],
    [input.scientificVerificationReceiptDigestHex, "scientificVerificationReceiptDigestHex"],
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

export function createPostgresDee659AuthorityRepositoryV2(sql: postgres.Sql):
PersistedDecisionEconomicsAuthorityPortV2 & Readonly<{
  persist(input: PersistDee659AuthorityBundleV2Input): Promise<void>;
}> {
  return Object.freeze({
    async persist(input) {
      validateBundle(input);
      const digest = bundleDigest(input);
      const inserted = await sql<{ bundle_content_digest_hex: string }[]>`
        INSERT INTO trader_dee659_authority_bundle_v2 (
          organization_id, account_id, cycle_id, forecast_authority_content_digest_hex,
          forecast_id, forecast_issuance_receipt_digest_hex,
          forecast_verification_receipt_digest_hex, scientific_admission_evidence_digest_hex,
          scientific_verification_receipt_digest_hex, anchor_authority_json,
          executable_policy_json, economic_size_set_json, cash_authority_json,
          execution_payoff_verification_json, pit_anchor, schema_version,
          bundle_content_digest_hex
        ) VALUES (
          ${input.organizationId}::uuid, ${input.accountId}, ${input.cycleId},
          ${input.forecastAuthorityContentDigestHex}, ${input.forecastId},
          ${input.forecastIssuanceReceiptDigestHex}, ${input.forecastVerificationReceiptDigestHex},
          ${input.scientificAdmission.evidenceSemanticDigest},
          ${input.scientificVerificationReceiptDigestHex}, ${sql.json(asJsonValue(input.anchorAuthority))},
          ${sql.json(asJsonValue(input.executablePolicy))}, ${sql.json(asJsonValue(input.economicSizeSet))},
          ${sql.json(asJsonValue(input.cashAuthority))},
          ${sql.json(asJsonValue(input.executionPayoffVerification))}, ${input.pitAnchor}::timestamptz,
          ${DEE659_DURABLE_AUTHORITY_BUNDLE_V2}, ${digest}
        ) ON CONFLICT (organization_id, account_id, cycle_id, forecast_authority_content_digest_hex)
          DO NOTHING
        RETURNING bundle_content_digest_hex
      `;
      if (inserted[0] && inserted[0].bundle_content_digest_hex !== digest) {
        throw new Error("DEE659_DURABLE_AUTHORITY_CORRUPTION:insertedDigest");
      }
      if (inserted.length === 0) {
        const existing = await sql<{ bundle_content_digest_hex: string }[]>`
          SELECT bundle_content_digest_hex FROM trader_dee659_authority_bundle_v2
          WHERE organization_id = ${input.organizationId}::uuid AND account_id = ${input.accountId}
            AND cycle_id = ${input.cycleId}
            AND forecast_authority_content_digest_hex = ${input.forecastAuthorityContentDigestHex}
        `;
        if (existing[0]?.bundle_content_digest_hex !== digest) {
          throw new Error("DEE659_DURABLE_AUTHORITY_CONFLICT");
        }
      }
    },
    async load(identity) {
      const rows = await sql<AuthorityRow[]>`
        SELECT organization_id::text, account_id, cycle_id,
               forecast_authority_content_digest_hex, forecast_id,
               forecast_issuance_receipt_digest_hex, forecast_verification_receipt_digest_hex,
               scientific_admission_evidence_digest_hex,
               scientific_verification_receipt_digest_hex, anchor_authority_json,
               executable_policy_json, economic_size_set_json, cash_authority_json,
               execution_payoff_verification_json, pit_anchor
        FROM trader_dee659_authority_bundle_v2
        WHERE organization_id = ${identity.organizationId}::uuid
          AND account_id = ${identity.accountId}
          AND cycle_id = ${identity.cycleId}
          AND forecast_authority_content_digest_hex = ${identity.forecastAuthorityContentDigestHex}
      `;
      const row = rows[0];
      if (!row) throw new Error("DEE659_DURABLE_AUTHORITY_NOT_FOUND");
      const scientificAdmission = await readScientificAdmissionReceiptV1(sql, {
        organizationId: identity.organizationId,
        evidenceSemanticDigestHex: row.scientific_admission_evidence_digest_hex,
      });
      if (!scientificAdmission) throw new Error("DEE659_DURABLE_AUTHORITY_CORRUPTION:scientificAdmission");
      const loaded: PersistDee659AuthorityBundleV2Input = {
        organizationId: row.organization_id,
        accountId: row.account_id,
        cycleId: row.cycle_id,
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
      const { organizationId: _o, accountId: _a, cycleId: _c,
        forecastAuthorityContentDigestHex: _f, pitAnchor: _p, ...result } = loaded;
      void [_o, _a, _c, _f, _p];
      return Object.freeze(result);
    },
  });
}
