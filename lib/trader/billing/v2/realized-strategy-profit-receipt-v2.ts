import {
  computeSemanticSha256Hex,
  sortCodePointStrings,
} from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { addDecimal, formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import {
  assertBillingV2ForbiddenKeys,
  BILLING_V2_NAKED_FINANCIAL_KEYS,
  requireBillingV2Decimal,
  requireBillingV2DigestHex,
  requireBillingV2NonEmpty,
} from "@/lib/trader/billing/v2/billing-v2-guards";
import {
  assertClosedTradeSettlementV2,
  type ClosedTradeSettlementV2,
} from "@/lib/trader/billing/v2/closed-trade-settlement-v2";

export const REALIZED_STRATEGY_PROFIT_RECEIPT_V2_SCHEMA =
  "waia.trader.realized_strategy_profit_receipt.v2" as const;

export const REALIZED_STRATEGY_PROFIT_ACCOUNTING_POLICY_V2 =
  "ld-10-realized-strategy-profit/v2" as const;

export const NON_PROFIT_CASHFLOW_CAUSES_V2 = ["DEPOSIT", "WITHDRAWAL", "TRANSFER"] as const;
export type NonProfitCashflowCauseV2 = (typeof NON_PROFIT_CASHFLOW_CAUSES_V2)[number];

export type NonProfitCashflowFactV2 = Readonly<{
  truthRecordDigestHex: string;
  amount: string;
  cause: NonProfitCashflowCauseV2;
}>;

export type RealizedStrategyProfitReceiptV2 = Readonly<{
  schemaVersion: typeof REALIZED_STRATEGY_PROFIT_RECEIPT_V2_SCHEMA;
  accountingPolicyVersion: typeof REALIZED_STRATEGY_PROFIT_ACCOUNTING_POLICY_V2;
  capitalAuthority: "NONE";
  organizationId: string;
  accountId: string;
  strategyId: string;
  reportingScopeId: string;
  realityFrontierDigestHex: string;
  closedTradeSettlementDigests: readonly string[];
  nonProfitCashflowFacts: readonly NonProfitCashflowFactV2[];
  grossRealizedPnl: string;
  admittedTradingCosts: string;
  netRealizedStrategyProfit: string;
  contentDigestHex: string;
}>;

export type RealizedStrategyProfitReceiptV2Input = Readonly<{
  organizationId: string;
  accountId: string;
  strategyId: string;
  reportingScopeId: string;
  realityFrontierDigestHex: string;
  settlements: readonly ClosedTradeSettlementV2[];
  nonProfitCashflowFacts?: readonly NonProfitCashflowFactV2[];
}>;

function freezeNonProfitFacts(
  facts: readonly NonProfitCashflowFactV2[],
): readonly NonProfitCashflowFactV2[] {
  const normalized = facts.map((fact) => {
    if (!(NON_PROFIT_CASHFLOW_CAUSES_V2 as readonly string[]).includes(fact.cause)) {
      throw new Error("RECEIPT_DEPOSIT_AS_PROFIT_REFUSED");
    }
    requireBillingV2DigestHex(fact.truthRecordDigestHex, "RECEIPT_MISSING_TRUTH_RECORD");
    requireBillingV2Decimal(fact.amount, "RECEIPT_INVALID_NON_PROFIT_CASHFLOW");
    return Object.freeze({
      truthRecordDigestHex: fact.truthRecordDigestHex,
      amount: formatDecimal(parseDecimal(fact.amount)),
      cause: fact.cause,
    });
  });
  normalized.sort((left, right) =>
    left.truthRecordDigestHex < right.truthRecordDigestHex
      ? -1
      : left.truthRecordDigestHex > right.truthRecordDigestHex
        ? 1
        : 0,
  );
  return Object.freeze(normalized);
}

export function buildRealizedStrategyProfitReceiptV2(
  input: RealizedStrategyProfitReceiptV2Input,
): RealizedStrategyProfitReceiptV2 {
  assertBillingV2ForbiddenKeys(input, BILLING_V2_NAKED_FINANCIAL_KEYS, "RECEIPT_NAKED_PNL_REFUSED");
  for (const field of [
    input.organizationId,
    input.accountId,
    input.strategyId,
    input.reportingScopeId,
  ]) {
    requireBillingV2NonEmpty(field, "RECEIPT_SCOPE_INCOMPLETE");
  }
  requireBillingV2DigestHex(input.realityFrontierDigestHex, "RECEIPT_MISSING_TRUTH_RECORD");

  const settlements = input.settlements;
  const settlementDigests: string[] = [];
  const lifecycleIds = new Set<string>();
  let grossRealizedPnl = "0";
  let admittedTradingCosts = "0";
  let netRealizedStrategyProfit = "0";

  for (const settlement of settlements) {
    assertClosedTradeSettlementV2(settlement);
    if (settlement.organizationId !== input.organizationId) {
      throw new Error("RECEIPT_ORGANIZATION_MISMATCH");
    }
    if (settlement.accountId !== input.accountId) {
      throw new Error("RECEIPT_ACCOUNT_MISMATCH");
    }
    if (settlement.strategyId !== input.strategyId) {
      throw new Error("RECEIPT_STRATEGY_MISMATCH");
    }
    if (settlement.capitalAuthority !== "NONE") {
      throw new Error("RECEIPT_CAPITAL_AUTHORITY_REFUSED");
    }
    if (lifecycleIds.has(settlement.lifecycleId)) {
      throw new Error("RECEIPT_DUPLICATE_LIFECYCLE");
    }
    lifecycleIds.add(settlement.lifecycleId);
    settlementDigests.push(settlement.contentDigestHex);
    grossRealizedPnl = addDecimal(grossRealizedPnl, settlement.grossRealizedCashflow);
    admittedTradingCosts = addDecimal(admittedTradingCosts, settlement.admittedTradingCosts);
    netRealizedStrategyProfit = addDecimal(
      netRealizedStrategyProfit,
      settlement.netRealizedCashflow,
    );
  }

  const closedTradeSettlementDigests = Object.freeze(sortCodePointStrings(settlementDigests));
  if (new Set(closedTradeSettlementDigests).size !== closedTradeSettlementDigests.length) {
    throw new Error("RECEIPT_DUPLICATE_SETTLEMENT");
  }

  const nonProfitCashflowFacts = freezeNonProfitFacts(input.nonProfitCashflowFacts ?? []);

  const body = {
    schemaVersion: REALIZED_STRATEGY_PROFIT_RECEIPT_V2_SCHEMA,
    accountingPolicyVersion: REALIZED_STRATEGY_PROFIT_ACCOUNTING_POLICY_V2,
    capitalAuthority: "NONE" as const,
    organizationId: input.organizationId,
    accountId: input.accountId,
    strategyId: input.strategyId,
    reportingScopeId: input.reportingScopeId,
    realityFrontierDigestHex: input.realityFrontierDigestHex,
    closedTradeSettlementDigests,
    nonProfitCashflowFacts,
    grossRealizedPnl,
    admittedTradingCosts,
    netRealizedStrategyProfit,
  };

  return Object.freeze({
    ...body,
    contentDigestHex: computeSemanticSha256Hex(body),
  });
}

export function assertRealizedStrategyProfitReceiptV2(
  value: RealizedStrategyProfitReceiptV2,
): void {
  if (value.schemaVersion !== REALIZED_STRATEGY_PROFIT_RECEIPT_V2_SCHEMA) {
    throw new Error("RECEIPT_UNSUPPORTED_VERSION");
  }
  const { contentDigestHex, ...body } = value;
  if (computeSemanticSha256Hex(body) !== contentDigestHex) {
    throw new Error("RECEIPT_DIGEST_MISMATCH");
  }
}
