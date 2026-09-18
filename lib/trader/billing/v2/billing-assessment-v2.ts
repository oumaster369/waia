import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  compareDecimal,
  formatDecimal,
  multiplyDecimal,
  parseDecimal,
} from "@/lib/trader/risk/numeric";
import {
  assertBillingV2ForbiddenKeys,
  BILLING_V2_NAKED_FINANCIAL_KEYS,
  requireBillingV2Decimal,
  requireBillingV2DigestHex,
  requireBillingV2IsoUtc,
} from "@/lib/trader/billing/v2/billing-v2-guards";
import {
  assertCanonicalBillingPolicyV2,
  BILLING_PERFORMANCE_FEE_RATE_V2,
  type BillingPolicyV2,
} from "@/lib/trader/billing/v2/billing-policy-v2";
import {
  assertRealizedStrategyProfitReceiptV2,
  type RealizedStrategyProfitReceiptV2,
} from "@/lib/trader/billing/v2/realized-strategy-profit-receipt-v2";

export const BILLING_ASSESSMENT_V2_SCHEMA = "waia.trader.billing_assessment.v2" as const;

export const BILLING_HWM_EVENT_V2_SCHEMA = "waia.trader.billing_hwm_event.v2" as const;

export const BILLING_HWM_EVENT_KINDS_V2 = ["BOOTSTRAP", "ADVANCE", "NO_CHANGE"] as const;
export type BillingHwmEventKindV2 = (typeof BILLING_HWM_EVENT_KINDS_V2)[number];

export type BillingHwmPriorV2 = Readonly<{
  namespace: "BILLING_HWM";
  highWaterMark: string;
  eventDigestHex: string | null;
}>;

export type BillingHwmEventV2 = Readonly<{
  schemaVersion: typeof BILLING_HWM_EVENT_V2_SCHEMA;
  eventKind: BillingHwmEventKindV2;
  namespace: "BILLING_HWM";
  capitalAuthority: "NONE";
  priorHwm: string;
  newHwm: string;
  receiptDigestHex: string;
  policyDigestHex: string;
  contentDigestHex: string;
}>;

export type BillingAssessmentV2 = Readonly<{
  schemaVersion: typeof BILLING_ASSESSMENT_V2_SCHEMA;
  capitalAuthority: "NONE";
  organizationId: string;
  accountId: string;
  strategyId: string;
  assessedAtUtc: string;
  receiptDigestHex: string;
  policyDigestHex: string;
  priorHwmEventDigestHex: string | null;
  cumulativeRealizedStrategyProfit: string;
  previousBillingHwm: string;
  billableProfit: string;
  performanceFee: string;
  feeRate: typeof BILLING_PERFORMANCE_FEE_RATE_V2;
  billable: boolean;
  reasonCodes: readonly string[];
  hwmEvent: BillingHwmEventV2;
  contentDigestHex: string;
}>;

export type BillingAssessmentV2Input = Readonly<{
  receipt: RealizedStrategyProfitReceiptV2;
  priorHwm: BillingHwmPriorV2;
  policy: BillingPolicyV2;
  assessedAtUtc: string;
}>;

function maxDecimal(left: string, right: string): string {
  return compareDecimal(left, right) >= 0
    ? formatDecimal(parseDecimal(left))
    : formatDecimal(parseDecimal(right));
}

function buildHwmEvent(input: {
  eventKind: BillingHwmEventKindV2;
  priorHwm: string;
  newHwm: string;
  receiptDigestHex: string;
  policyDigestHex: string;
}): BillingHwmEventV2 {
  const body = {
    schemaVersion: BILLING_HWM_EVENT_V2_SCHEMA,
    eventKind: input.eventKind,
    namespace: "BILLING_HWM" as const,
    capitalAuthority: "NONE" as const,
    priorHwm: input.priorHwm,
    newHwm: input.newHwm,
    receiptDigestHex: input.receiptDigestHex,
    policyDigestHex: input.policyDigestHex,
  };
  return Object.freeze({
    ...body,
    contentDigestHex: computeSemanticSha256Hex(body),
  });
}

export function refuseEquityHwmAsBillingHwmV2(input: { equityHwm: string }): never {
  void input;
  throw new Error("BILLING_EQUITY_HWM_CANNOT_POPULATE_BILLING_HWM");
}

export function assessBillingV2(input: BillingAssessmentV2Input): BillingAssessmentV2 {
  assertBillingV2ForbiddenKeys(
    input,
    BILLING_V2_NAKED_FINANCIAL_KEYS,
    "BILLING_NAKED_REALIZED_PNL_REFUSED",
  );
  assertBillingV2ForbiddenKeys(
    input.priorHwm,
    ["equityHwm", "equity"],
    "BILLING_EQUITY_HWM_CANNOT_POPULATE_BILLING_HWM",
  );
  if (input.priorHwm.namespace !== "BILLING_HWM") {
    throw new Error("BILLING_EQUITY_HWM_CANNOT_POPULATE_BILLING_HWM");
  }
  requireBillingV2IsoUtc(input.assessedAtUtc, "BILLING_ASSESSED_AT_INVALID");
  requireBillingV2Decimal(input.priorHwm.highWaterMark, "BILLING_HWM_INVALID");
  if (input.priorHwm.eventDigestHex !== null) {
    requireBillingV2DigestHex(input.priorHwm.eventDigestHex, "BILLING_HWM_EVENT_DIGEST_INVALID");
  }

  assertRealizedStrategyProfitReceiptV2(input.receipt);
  assertCanonicalBillingPolicyV2(input.policy);
  if (input.receipt.capitalAuthority !== "NONE") {
    throw new Error("BILLING_CAPITAL_AUTHORITY_REFUSED");
  }

  const previousBillingHwm = formatDecimal(parseDecimal(input.priorHwm.highWaterMark));
  const cumulativeRealizedStrategyProfit = input.receipt.netRealizedStrategyProfit;
  const billableProfit =
    compareDecimal(cumulativeRealizedStrategyProfit, previousBillingHwm) > 0
      ? formatDecimal(
          parseDecimal(cumulativeRealizedStrategyProfit) - parseDecimal(previousBillingHwm),
        )
      : "0";
  const performanceFee = multiplyDecimal(billableProfit, BILLING_PERFORMANCE_FEE_RATE_V2);
  const newHwm = maxDecimal(previousBillingHwm, cumulativeRealizedStrategyProfit);
  const billable = compareDecimal(billableProfit, "0") > 0;

  const eventKind: BillingHwmEventKindV2 =
    input.priorHwm.eventDigestHex === null && compareDecimal(newHwm, "0") === 0
      ? "BOOTSTRAP"
      : compareDecimal(newHwm, previousBillingHwm) > 0
        ? "ADVANCE"
        : "NO_CHANGE";

  const reasonCodes = Object.freeze(
    billable
      ? (["BILLABLE_NEW_PROFIT_ABOVE_HWM"] as const)
      : input.receipt.closedTradeSettlementDigests.length === 0
        ? (["NO_BILL_ZERO_CLOSED_TRADES"] as const)
        : (["NO_BILL_NO_NEW_PROFIT_ABOVE_HWM"] as const),
  );

  const hwmEvent = buildHwmEvent({
    eventKind,
    priorHwm: previousBillingHwm,
    newHwm,
    receiptDigestHex: input.receipt.contentDigestHex,
    policyDigestHex: input.policy.contentDigestHex,
  });

  const body = {
    schemaVersion: BILLING_ASSESSMENT_V2_SCHEMA,
    capitalAuthority: "NONE" as const,
    organizationId: input.receipt.organizationId,
    accountId: input.receipt.accountId,
    strategyId: input.receipt.strategyId,
    assessedAtUtc: input.assessedAtUtc,
    receiptDigestHex: input.receipt.contentDigestHex,
    policyDigestHex: input.policy.contentDigestHex,
    priorHwmEventDigestHex: input.priorHwm.eventDigestHex,
    cumulativeRealizedStrategyProfit,
    previousBillingHwm,
    billableProfit,
    performanceFee,
    feeRate: BILLING_PERFORMANCE_FEE_RATE_V2,
    billable,
    reasonCodes,
    hwmEvent,
  };

  return Object.freeze({
    ...body,
    contentDigestHex: computeSemanticSha256Hex(body),
  });
}
