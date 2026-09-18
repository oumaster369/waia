import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import { assertBillingV2ForbiddenKeys } from "@/lib/trader/billing/v2/billing-v2-guards";
import {
  assertBillingAssessmentV2,
  type BillingAssessmentV2,
} from "@/lib/trader/billing/v2/billing-assessment-v2";

export const INVOICE_BASIS_RECEIPT_V2_SCHEMA = "waia.trader.invoice_basis_receipt.v2" as const;

export const INVOICE_BASIS_KINDS_V2 = ["DRAFT_BASIS", "NO_BILL"] as const;
export type InvoiceBasisKindV2 = (typeof INVOICE_BASIS_KINDS_V2)[number];

export type InvoiceBasisReceiptV2 = Readonly<{
  schemaVersion: typeof INVOICE_BASIS_RECEIPT_V2_SCHEMA;
  invoiceAuthority: "DRAFT_BASIS_ONLY";
  issuanceAuthority: "NONE";
  collectionAuthority: "NONE";
  capitalAuthority: "NONE";
  manualGateRequired: true;
  basisKind: InvoiceBasisKindV2;
  organizationId: string;
  accountId: string;
  strategyId: string;
  assessmentDigestHex: string;
  hwmEventDigestHex: string;
  policyDigestHex: string;
  performanceFee: string;
  contentDigestHex: string;
}>;

export type InvoiceBasisReceiptV2Input = Readonly<{
  assessment: BillingAssessmentV2;
}>;

export function refuseIssuedInvoiceAuthorityV2(): never {
  throw new Error("INVOICE_BASIS_ISSUED_FORBIDDEN");
}

export function buildInvoiceBasisReceiptV2(
  input: InvoiceBasisReceiptV2Input,
): InvoiceBasisReceiptV2 {
  assertBillingV2ForbiddenKeys(
    input,
    ["status", "issuedAt", "collection", "payment", "ISSUED"],
    "INVOICE_BASIS_ISSUED_FORBIDDEN",
  );
  assertBillingAssessmentV2(input.assessment);
  if (input.assessment.capitalAuthority !== "NONE") {
    throw new Error("INVOICE_BASIS_CAPITAL_AUTHORITY_REFUSED");
  }

  const basisKind: InvoiceBasisKindV2 =
    input.assessment.billable && compareDecimal(input.assessment.performanceFee, "0") > 0
      ? "DRAFT_BASIS"
      : "NO_BILL";

  const body = {
    schemaVersion: INVOICE_BASIS_RECEIPT_V2_SCHEMA,
    invoiceAuthority: "DRAFT_BASIS_ONLY" as const,
    issuanceAuthority: "NONE" as const,
    collectionAuthority: "NONE" as const,
    capitalAuthority: "NONE" as const,
    manualGateRequired: true as const,
    basisKind,
    organizationId: input.assessment.organizationId,
    accountId: input.assessment.accountId,
    strategyId: input.assessment.strategyId,
    assessmentDigestHex: input.assessment.contentDigestHex,
    hwmEventDigestHex: input.assessment.hwmEvent.contentDigestHex,
    policyDigestHex: input.assessment.policyDigestHex,
    performanceFee: input.assessment.performanceFee,
  };

  return Object.freeze({
    ...body,
    contentDigestHex: computeSemanticSha256Hex(body),
  });
}
