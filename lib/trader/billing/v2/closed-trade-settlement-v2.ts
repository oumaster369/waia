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
  requireBillingV2NonNegative,
  requireBillingV2ZeroQuantity,
} from "@/lib/trader/billing/v2/billing-v2-guards";

export const CLOSED_TRADE_SETTLEMENT_V2_SCHEMA = "waia.trader.closed_trade_settlement.v2" as const;

export const CLOSED_TRADE_SETTLEMENT_ACCOUNTING_POLICY_V2 =
  "closed-trade-settlement-accounting/v2" as const;

export const CLOSED_TRADE_LIFECYCLE_STATES_V2 = ["FULLY_CLOSED"] as const;
export type ClosedTradeLifecycleStateV2 = (typeof CLOSED_TRADE_LIFECYCLE_STATES_V2)[number];

export const CLOSED_TRADE_CASHFLOW_CAUSES_V2 = ["STRATEGY_REALIZED"] as const;
export type ClosedTradeCashflowCauseV2 = (typeof CLOSED_TRADE_CASHFLOW_CAUSES_V2)[number];

export type ClosedTradeCashflowFactV2 = Readonly<{
  truthRecordDigestHex: string;
  amount: string;
  cause: ClosedTradeCashflowCauseV2;
}>;

export type ClosedTradeCostFactV2 = Readonly<{
  truthRecordDigestHex: string;
  amount: string;
  admitted: true;
}>;

export type ClosedTradeSettlementV2 = Readonly<{
  schemaVersion: typeof CLOSED_TRADE_SETTLEMENT_V2_SCHEMA;
  accountingPolicyVersion: typeof CLOSED_TRADE_SETTLEMENT_ACCOUNTING_POLICY_V2;
  capitalAuthority: "NONE";
  venueWriteAuthority: "NONE";
  organizationId: string;
  accountId: string;
  strategyId: string;
  symbol: string;
  lifecycleId: string;
  lifecycleState: ClosedTradeLifecycleStateV2;
  remainingQuantity: string;
  realityFrontierDigestHex: string;
  openingFillTruthRecordDigests: readonly string[];
  closingFillTruthRecordDigests: readonly string[];
  partialFillTruthRecordDigests: readonly string[];
  cashflowFacts: readonly ClosedTradeCashflowFactV2[];
  costFacts: readonly ClosedTradeCostFactV2[];
  cashflowTruthRecordDigests: readonly string[];
  admittedCostTruthRecordDigests: readonly string[];
  grossRealizedCashflow: string;
  admittedTradingCosts: string;
  netRealizedCashflow: string;
  supersedesSettlementDigestHex: string | null;
  contentDigestHex: string;
}>;

export type ClosedTradeSettlementV2Input = Omit<
  ClosedTradeSettlementV2,
  | "schemaVersion"
  | "accountingPolicyVersion"
  | "capitalAuthority"
  | "venueWriteAuthority"
  | "cashflowTruthRecordDigests"
  | "admittedCostTruthRecordDigests"
  | "grossRealizedCashflow"
  | "admittedTradingCosts"
  | "netRealizedCashflow"
  | "contentDigestHex"
>;

function freezeUniqueDigests(values: readonly string[], duplicateCode: string): readonly string[] {
  const unique = sortCodePointStrings([...new Set(values)]);
  if (unique.length !== values.length) {
    throw new Error(duplicateCode);
  }
  for (const digest of unique) {
    requireBillingV2DigestHex(digest, "CLOSED_TRADE_MISSING_TRUTH_RECORD");
  }
  return Object.freeze(unique);
}

function compareFactDigest(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function freezeCashflowFacts(
  facts: readonly ClosedTradeCashflowFactV2[],
): readonly ClosedTradeCashflowFactV2[] {
  const normalized = facts.map((fact) => {
    if (fact.cause !== "STRATEGY_REALIZED") {
      throw new Error("CLOSED_TRADE_NON_STRATEGY_CASHFLOW");
    }
    requireBillingV2DigestHex(fact.truthRecordDigestHex, "CLOSED_TRADE_MISSING_TRUTH_RECORD");
    requireBillingV2Decimal(fact.amount, "CLOSED_TRADE_INVALID_CASHFLOW");
    return Object.freeze({
      truthRecordDigestHex: fact.truthRecordDigestHex,
      amount: formatDecimal(parseDecimal(fact.amount)),
      cause: "STRATEGY_REALIZED" as const,
    });
  });
  normalized.sort((left, right) =>
    compareFactDigest(left.truthRecordDigestHex, right.truthRecordDigestHex),
  );
  return Object.freeze(normalized);
}

function freezeCostFacts(
  facts: readonly ClosedTradeCostFactV2[],
): readonly ClosedTradeCostFactV2[] {
  const normalized = facts.map((fact) => {
    if (fact.admitted !== true) {
      throw new Error("CLOSED_TRADE_COST_NOT_ADMITTED");
    }
    requireBillingV2DigestHex(fact.truthRecordDigestHex, "CLOSED_TRADE_MISSING_TRUTH_RECORD");
    requireBillingV2NonNegative(fact.amount, "CLOSED_TRADE_NEGATIVE_COST");
    return Object.freeze({
      truthRecordDigestHex: fact.truthRecordDigestHex,
      amount: formatDecimal(parseDecimal(fact.amount)),
      admitted: true as const,
    });
  });
  normalized.sort((left, right) =>
    compareFactDigest(left.truthRecordDigestHex, right.truthRecordDigestHex),
  );
  return Object.freeze(normalized);
}

function sumAmounts(values: readonly string[]): string {
  return values.reduce((sum, value) => addDecimal(sum, value), "0");
}

export function buildClosedTradeSettlementV2(
  input: ClosedTradeSettlementV2Input,
): ClosedTradeSettlementV2 {
  assertBillingV2ForbiddenKeys(
    input,
    BILLING_V2_NAKED_FINANCIAL_KEYS,
    "CLOSED_TRADE_NAKED_PNL_REFUSED",
  );
  for (const field of [
    input.organizationId,
    input.accountId,
    input.strategyId,
    input.symbol,
    input.lifecycleId,
  ]) {
    requireBillingV2NonEmpty(field, "CLOSED_TRADE_SCOPE_INCOMPLETE");
  }
  if (input.lifecycleState !== "FULLY_CLOSED") {
    throw new Error("CLOSED_TRADE_INCOMPLETE_LIFECYCLE");
  }
  requireBillingV2ZeroQuantity(input.remainingQuantity, "CLOSED_TRADE_INCOMPLETE_LIFECYCLE");
  requireBillingV2DigestHex(input.realityFrontierDigestHex, "CLOSED_TRADE_MISSING_TRUTH_RECORD");
  if (input.supersedesSettlementDigestHex !== null) {
    requireBillingV2DigestHex(
      input.supersedesSettlementDigestHex,
      "CLOSED_TRADE_INVALID_SUPERSESSION",
    );
  }
  if (input.openingFillTruthRecordDigests.length === 0) {
    throw new Error("CLOSED_TRADE_INCOMPLETE_LIFECYCLE");
  }
  if (input.closingFillTruthRecordDigests.length === 0) {
    throw new Error("CLOSED_TRADE_INCOMPLETE_LIFECYCLE");
  }
  if (input.cashflowFacts.length === 0) {
    throw new Error("CLOSED_TRADE_MISSING_CASHFLOW_FACTS");
  }

  const openingFillTruthRecordDigests = freezeUniqueDigests(
    input.openingFillTruthRecordDigests,
    "CLOSED_TRADE_DUPLICATE_TRUTH_RECORD",
  );
  const closingFillTruthRecordDigests = freezeUniqueDigests(
    input.closingFillTruthRecordDigests,
    "CLOSED_TRADE_DUPLICATE_TRUTH_RECORD",
  );
  const partialFillTruthRecordDigests = freezeUniqueDigests(
    input.partialFillTruthRecordDigests,
    "CLOSED_TRADE_DUPLICATE_TRUTH_RECORD",
  );
  const cashflowFacts = freezeCashflowFacts(input.cashflowFacts);
  const costFacts = freezeCostFacts(input.costFacts);
  const cashflowTruthRecordDigests = freezeUniqueDigests(
    cashflowFacts.map((fact) => fact.truthRecordDigestHex),
    "CLOSED_TRADE_DUPLICATE_TRUTH_RECORD",
  );
  const admittedCostTruthRecordDigests = freezeUniqueDigests(
    costFacts.map((fact) => fact.truthRecordDigestHex),
    "CLOSED_TRADE_DUPLICATE_TRUTH_RECORD",
  );
  const grossRealizedCashflow = sumAmounts(cashflowFacts.map((fact) => fact.amount));
  const admittedTradingCosts = sumAmounts(costFacts.map((fact) => fact.amount));
  const netRealizedCashflow = formatDecimal(
    parseDecimal(grossRealizedCashflow) - parseDecimal(admittedTradingCosts),
  );

  const body = {
    schemaVersion: CLOSED_TRADE_SETTLEMENT_V2_SCHEMA,
    accountingPolicyVersion: CLOSED_TRADE_SETTLEMENT_ACCOUNTING_POLICY_V2,
    capitalAuthority: "NONE" as const,
    venueWriteAuthority: "NONE" as const,
    organizationId: input.organizationId,
    accountId: input.accountId,
    strategyId: input.strategyId,
    symbol: input.symbol,
    lifecycleId: input.lifecycleId,
    lifecycleState: "FULLY_CLOSED" as const,
    remainingQuantity: formatDecimal(parseDecimal(input.remainingQuantity)),
    realityFrontierDigestHex: input.realityFrontierDigestHex,
    openingFillTruthRecordDigests,
    closingFillTruthRecordDigests,
    partialFillTruthRecordDigests,
    cashflowFacts,
    costFacts,
    cashflowTruthRecordDigests,
    admittedCostTruthRecordDigests,
    grossRealizedCashflow,
    admittedTradingCosts,
    netRealizedCashflow,
    supersedesSettlementDigestHex: input.supersedesSettlementDigestHex,
  };

  return Object.freeze({
    ...body,
    contentDigestHex: computeSemanticSha256Hex(body),
  });
}

export function assertClosedTradeSettlementV2(value: ClosedTradeSettlementV2): void {
  const rebuilt = buildClosedTradeSettlementV2({
    organizationId: value.organizationId,
    accountId: value.accountId,
    strategyId: value.strategyId,
    symbol: value.symbol,
    lifecycleId: value.lifecycleId,
    lifecycleState: value.lifecycleState,
    remainingQuantity: value.remainingQuantity,
    realityFrontierDigestHex: value.realityFrontierDigestHex,
    openingFillTruthRecordDigests: value.openingFillTruthRecordDigests,
    closingFillTruthRecordDigests: value.closingFillTruthRecordDigests,
    partialFillTruthRecordDigests: value.partialFillTruthRecordDigests,
    cashflowFacts: value.cashflowFacts,
    costFacts: value.costFacts,
    supersedesSettlementDigestHex: value.supersedesSettlementDigestHex,
  });
  if (rebuilt.contentDigestHex !== value.contentDigestHex) {
    throw new Error("CLOSED_TRADE_DIGEST_MISMATCH");
  }
}
