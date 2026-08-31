import type postgres from "postgres";

import {
  validateCashEconomicAuthorityV1,
  validateDee659ExecutablePolicyInstanceV1,
  validateEconomicAdmissibleSizeSetV1,
  validateForecastAnchorPriceAuthorityV1,
  type CashEconomicAuthorityV1,
  type Dee659ExecutablePolicyInstanceV1,
  type EconomicAdmissibleSizeSetV1,
  type ForecastAnchorPriceAuthorityV1,
} from "@/lib/trader/intelligence/decision-economics/dee659-execution-payoff-authorities-v1";
import {
  type ExecutionPayoffAuthorityVerificationV1,
  type VerifiedDecisionEconomicAuthorityV1,
  sameDee659AuthorityBindingV1,
} from "@/lib/trader/intelligence/decision-economics/dee659-execution-payoff-contract-v1";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import type { CanonicalDecisionVerificationReceiptPortV2 } from "./dee659-authority-repository-postgres-v2";

export const CANONICAL_DECISION_VERIFICATION_RECEIPT_V2 =
  "waia.trader.canonical_decision_verification_receipt.v2" as const;

type Purpose =
  | "FORECAST_RUNTIME_AUTHORIZED"
  | "SCIENTIFIC_ADMISSION"
  | VerifiedDecisionEconomicAuthorityV1["purpose"];

export type CanonicalDecisionVerificationReceiptV2 = Readonly<{
  schemaVersion: typeof CANONICAL_DECISION_VERIFICATION_RECEIPT_V2;
  organizationId: string;
  accountId: string | null;
  instrumentIdentityDigestHex: string | null;
  purpose: Purpose;
  subjectContentDigestHex: string;
  sourceRecordKind: "FORECAST_BUNDLE_V2" | "SCIENTIFIC_ADMISSION_V1" | "DEE659_AUTHORITY";
  sourceRecordId: string;
  sourceRecordContentDigestHex: string;
  pitAnchor: string;
  verified: true;
  verificationReceiptDigestHex: string;
}>;

type ExecutionAuthorities = Readonly<{
  anchor: ForecastAnchorPriceAuthorityV1;
  executablePolicy: Dee659ExecutablePolicyInstanceV1;
  economicSize: EconomicAdmissibleSizeSetV1;
  cash: CashEconomicAuthorityV1;
}>;

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
      organization_id, account_id, instrument_identity_digest_hex, purpose, subject_content_digest_hex, source_record_kind,
      source_record_id, source_record_content_digest_hex, pit_anchor, verified,
      verification_receipt_digest_hex, receipt_json, schema_version
    ) VALUES (
      ${receipt.organizationId}::uuid, ${receipt.accountId}, ${receipt.instrumentIdentityDigestHex}, ${receipt.purpose},
      ${receipt.subjectContentDigestHex}, ${receipt.sourceRecordKind}, ${receipt.sourceRecordId},
      ${receipt.sourceRecordContentDigestHex}, ${receipt.pitAnchor}::timestamptz, true,
      ${receipt.verificationReceiptDigestHex}, ${sql.json(JSON.parse(JSON.stringify(receipt)) as postgres.JSONValue)},
      ${receipt.schemaVersion}
    ) ON CONFLICT (organization_id, purpose, subject_content_digest_hex) DO NOTHING
  `;
  const rows = await sql<{ verification_receipt_digest_hex: string }[]>`
    SELECT verification_receipt_digest_hex
    FROM trader_canonical_decision_verification_receipt_v2
    WHERE organization_id=${receipt.organizationId}::uuid AND purpose=${receipt.purpose}
      AND subject_content_digest_hex=${receipt.subjectContentDigestHex}
  `;
  if (rows[0]?.verification_receipt_digest_hex !== receipt.verificationReceiptDigestHex) {
    throw new Error("CANONICAL_DECISION_VERIFICATION_CONFLICT");
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

export function createCanonicalDecisionVerificationReceiptServiceV2(sql: postgres.Sql) {
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
    const outcome = row?.authorized_outcome_json as { status?: unknown; authority?: { contentDigestHex?: unknown } } | undefined;
    if (!row || row.target_role_id !== "EXECUTION_OPPORTUNITY" ||
        outcome?.status !== "FORECAST_AUTHORIZED" ||
        outcome.authority?.contentDigestHex !== input.subjectContentDigestHex) {
      throw new Error("CANONICAL_DECISION_VERIFICATION_REFUSED:FORECAST_SOURCE");
    }
    const pitAnchor = new Date(Number(row.anchor_closed_bar_epoch_ms)).toISOString();
    const receipt = seal({
      schemaVersion: CANONICAL_DECISION_VERIFICATION_RECEIPT_V2,
      organizationId: input.organizationId, accountId: null,
      instrumentIdentityDigestHex: null,
      purpose: "FORECAST_RUNTIME_AUTHORIZED", subjectContentDigestHex: input.subjectContentDigestHex,
      sourceRecordKind: "FORECAST_BUNDLE_V2", sourceRecordId: row.bundle_id,
      sourceRecordContentDigestHex: row.bundle_content_digest_hex, pitAnchor, verified: true,
    });
    await persist(sql, receipt);
    return receipt;
  }

  async function issueScientific(input: Readonly<{
    organizationId: string; scientificAdmissionContentDigestHex: string; pitAnchor: string;
  }>): Promise<CanonicalDecisionVerificationReceiptV2> {
    const rows = await sql<{ id: string; content_digest: string }[]>`
      SELECT id::text, content_digest FROM trader_scientific_admission_receipt_v1
      WHERE organization_id=${input.organizationId}::uuid
        AND content_digest=${input.scientificAdmissionContentDigestHex}
    `;
    const row = rows[0];
    if (!row || !DIGEST.test(row.content_digest)) {
      throw new Error("CANONICAL_DECISION_VERIFICATION_REFUSED:SCIENTIFIC_SOURCE");
    }
    const receipt = seal({
      schemaVersion: CANONICAL_DECISION_VERIFICATION_RECEIPT_V2,
      organizationId: input.organizationId, accountId: null, purpose: "SCIENTIFIC_ADMISSION",
      instrumentIdentityDigestHex: null,
      subjectContentDigestHex: row.content_digest, sourceRecordKind: "SCIENTIFIC_ADMISSION_V1",
      sourceRecordId: row.id, sourceRecordContentDigestHex: row.content_digest,
      pitAnchor: input.pitAnchor, verified: true,
    });
    await persist(sql, receipt);
    return receipt;
  }

  async function issueExecution(input: Readonly<{ pitAnchor: string; authorities: ExecutionAuthorities }>){
    requireExecutionAuthorities(input.authorities);
    const a = input.authorities.anchor;
    const definitions = [
      ["ANCHOR_QUALIFICATION", input.authorities.anchor, input.authorities.anchor.qualificationReceiptDigestHex],
      ["EXECUTABLE_POLICY_PREREGISTRATION", input.authorities.executablePolicy, input.authorities.executablePolicy.preregistrationReceiptDigestHex],
      ["ECONOMIC_SIZE_AUTHORIZATION", input.authorities.economicSize, input.authorities.economicSize.authorityReceiptDigestHex],
      ["CASH_SNAPSHOT_AUTHORIZATION", input.authorities.cash, input.authorities.cash.authorityReceiptDigestHex],
    ] as const;
    const receipts: VerifiedDecisionEconomicAuthorityV1[] = [];
    for (const [purpose, authority, sourceDigest] of definitions) {
      const receipt = seal({
        schemaVersion: CANONICAL_DECISION_VERIFICATION_RECEIPT_V2,
        organizationId: a.organizationId, accountId: a.accountId, purpose,
        instrumentIdentityDigestHex: a.instrumentIdentityDigestHex,
        subjectContentDigestHex: authority.contentDigestHex, sourceRecordKind: "DEE659_AUTHORITY",
        sourceRecordId: authority.contentDigestHex, sourceRecordContentDigestHex: sourceDigest,
        pitAnchor: input.pitAnchor, verified: true,
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

  return Object.freeze({ issueForecast, issueScientific, issueExecution });
}

export function createPostgresCanonicalDecisionVerificationReceiptPortV2(
  sql: postgres.Sql,
): CanonicalDecisionVerificationReceiptPortV2 {
  async function load(purpose: Purpose, organizationId: string, subject: string) {
    const rows = await sql<{ receipt_json: CanonicalDecisionVerificationReceiptV2 }[]>`
      SELECT receipt_json FROM trader_canonical_decision_verification_receipt_v2
      WHERE organization_id=${organizationId}::uuid AND purpose=${purpose}
        AND subject_content_digest_hex=${subject}
    `;
    const receipt = rows[0]?.receipt_json;
    if (!receipt || !hasValidDigest(receipt)) {
      throw new Error("CANONICAL_DECISION_VERIFICATION_RECEIPT_MISSING_OR_CORRUPT");
    }
    return receipt;
  }
  return {
    loadForecastVerification: (value) => load("FORECAST_RUNTIME_AUTHORIZED", value.organizationId, value.subjectContentDigestHex),
    loadScientificVerification: (value) => load("SCIENTIFIC_ADMISSION", value.organizationId, value.scientificAdmissionContentDigestHex),
    async loadExecutionPayoffVerification(value): Promise<ExecutionPayoffAuthorityVerificationV1> {
      const purposes = ["ANCHOR_QUALIFICATION", "EXECUTABLE_POLICY_PREREGISTRATION", "ECONOMIC_SIZE_AUTHORIZATION", "CASH_SNAPSHOT_AUTHORIZATION"] as const;
      const receipts = await Promise.all(purposes.map(async (purpose) => {
        const rows = await sql<{ receipt_json: CanonicalDecisionVerificationReceiptV2 }[]>`
          SELECT receipt_json FROM trader_canonical_decision_verification_receipt_v2
          WHERE organization_id=${value.organizationId}::uuid AND account_id=${value.accountId}
            AND instrument_identity_digest_hex=${value.instrumentIdentityDigestHex}
            AND purpose=${purpose} ORDER BY pit_anchor DESC LIMIT 1
        `;
        return rows[0]?.receipt_json;
      }));
      const pitAnchor = receipts[0]?.pitAnchor;
      if (receipts.some((receipt) => !receipt || !hasValidDigest(receipt) ||
          receipt.accountId !== value.accountId ||
          receipt.instrumentIdentityDigestHex !== value.instrumentIdentityDigestHex ||
          receipt.pitAnchor !== pitAnchor)) {
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
