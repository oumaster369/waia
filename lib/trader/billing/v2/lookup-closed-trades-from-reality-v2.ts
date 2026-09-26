import { BillingCanonicalProfitAdmissionError } from "@/lib/trader/billing/v2/admit-realized-profit-receipt-v2";
import {
  buildClosedTradeSettlementV2,
  type ClosedTradeSettlementV2,
} from "@/lib/trader/billing/v2/closed-trade-settlement-v2";
import { requireBillingV2NonEmpty } from "@/lib/trader/billing/v2/billing-v2-guards";
import { BILLING_POLICY_V2_CURRENCY } from "@/lib/trader/billing/v2/billing-policy-v2";
import { validateTruthRecordV2, type TruthRecordV2 } from "@/lib/trader/reality/v2/contracts";
import {
  addDecimal,
  formatDecimal,
  isZeroDecimal,
  parseDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";

export type LookupClosedTradeSettlementsFromRealityV2Input = Readonly<{
  organizationId: string;
  accountId: string;
  strategyId: string;
  truthRecords: readonly TruthRecordV2[];
}>;

export type LookupClosedTradeSettlementsFromRealityV2Result = Readonly<{
  settlements: readonly ClosedTradeSettlementV2[];
  realityFrontierDigestHex: string;
}>;

type FillRecord = Readonly<{
  digestHex: string;
  venueOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: string;
  feeAmount: string;
  feeAsset: string;
  settlementStatus: "OBSERVED" | "SETTLED";
  knowledgeAtUtc: string;
}>;

type CashflowRecord = Readonly<{
  digestHex: string;
  causeNativeId: string;
  amount: string;
}>;

function rethrowLookup(error: unknown): never {
  if (error instanceof BillingCanonicalProfitAdmissionError) {
    throw error;
  }
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) {
    throw new BillingCanonicalProfitAdmissionError(error.message);
  }
  throw error;
}

function requireQuantity(value: string): string {
  try {
    return formatDecimal(parseDecimal(value));
  } catch {
    throw new BillingCanonicalProfitAdmissionError("LOOKUP_INVALID_QUANTITY");
  }
}

function cashflowSignedAmount(direction: "INFLOW" | "OUTFLOW", amount: string): string {
  const normalized = requireQuantity(amount);
  return direction === "INFLOW" ? normalized : formatDecimal(-parseDecimal(normalized));
}

function frontierDigest(records: readonly TruthRecordV2[]): string {
  const latest = [...records]
    .sort((left, right) => {
      if (left.knowledgeAtUtc !== right.knowledgeAtUtc) {
        return left.knowledgeAtUtc < right.knowledgeAtUtc ? -1 : 1;
      }
      return left.contentDigestHex < right.contentDigestHex
        ? -1
        : left.contentDigestHex > right.contentDigestHex
          ? 1
          : 0;
    })
    .at(-1);
  if (!latest) {
    throw new BillingCanonicalProfitAdmissionError("LOOKUP_EMPTY_REALITY");
  }
  return latest.contentDigestHex;
}

function classifyRecords(input: LookupClosedTradeSettlementsFromRealityV2Input): {
  fills: FillRecord[];
  cashflows: CashflowRecord[];
} {
  const fills: FillRecord[] = [];
  const cashflows: CashflowRecord[] = [];
  for (const record of input.truthRecords) {
    // Supplied arrays may bypass the persisted loader's content validation.
    if (!validateTruthRecordV2(record)) {
      throw new BillingCanonicalProfitAdmissionError("LOOKUP_INVALID_TRUTH_RECORD");
    }
    if (record.organizationId !== input.organizationId || record.accountId !== input.accountId) {
      throw new BillingCanonicalProfitAdmissionError("LOOKUP_SCOPE_MISMATCH");
    }
    if (
      record.markers.includes("UNATTRIBUTED") ||
      record.markers.includes("SOURCE_CONTRADICTION")
    ) {
      throw new BillingCanonicalProfitAdmissionError("LOOKUP_UNATTRIBUTED_TRUTH");
    }
    const assertion = record.primitiveAssertion;
    if (assertion.kind === "FILL") {
      fills.push({
        digestHex: record.contentDigestHex,
        venueOrderId: assertion.venueOrderId,
        symbol: assertion.symbol,
        side: assertion.side,
        quantity: requireQuantity(assertion.quantity),
        feeAmount: requireQuantity(assertion.feeAmount),
        feeAsset: assertion.feeAsset,
        settlementStatus: assertion.settlementStatus,
        knowledgeAtUtc: record.knowledgeAtUtc,
      });
      continue;
    }
    if (assertion.kind === "REALIZED_CASHFLOW") {
      if (assertion.asset !== BILLING_POLICY_V2_CURRENCY) {
        throw new BillingCanonicalProfitAdmissionError(
          "LOOKUP_CASHFLOW_CONVERSION_EVIDENCE_REQUIRED",
        );
      }
      cashflows.push({
        digestHex: record.contentDigestHex,
        causeNativeId: assertion.causeNativeId,
        amount: cashflowSignedAmount(assertion.direction, assertion.amount),
      });
    }
  }
  return { fills, cashflows };
}

function groupFills(fills: readonly FillRecord[]): Map<string, FillRecord[]> {
  const groups = new Map<string, FillRecord[]>();
  for (const fill of fills) {
    requireBillingV2NonEmpty(fill.venueOrderId, "LOOKUP_FILL_SCOPE_INCOMPLETE");
    const existing = groups.get(fill.venueOrderId) ?? [];
    existing.push(fill);
    groups.set(fill.venueOrderId, existing);
  }
  return groups;
}

function remainingQuantity(fills: readonly FillRecord[]): string {
  const bought = fills
    .filter((fill) => fill.side === "buy")
    .reduce((sum, fill) => addDecimal(sum, fill.quantity), "0");
  const sold = fills
    .filter((fill) => fill.side === "sell")
    .reduce((sum, fill) => addDecimal(sum, fill.quantity), "0");
  return subtractDecimal(bought, sold);
}

function assertFullyClosedGroup(fills: readonly FillRecord[]): void {
  // Only costs entering a closed settlement need conversion. Preserve native
  // units and never silently treat USDT (or another asset) as billing currency.
  if (
    fills.some(
      (fill) => !isZeroDecimal(fill.feeAmount) && fill.feeAsset !== BILLING_POLICY_V2_CURRENCY,
    )
  ) {
    throw new BillingCanonicalProfitAdmissionError("LOOKUP_COST_CONVERSION_EVIDENCE_REQUIRED");
  }
  if (fills.some((fill) => fill.settlementStatus !== "SETTLED")) {
    throw new BillingCanonicalProfitAdmissionError("LOOKUP_FILL_NOT_SETTLED");
  }
  const symbols = new Set(fills.map((fill) => fill.symbol));
  if (symbols.size !== 1) {
    throw new BillingCanonicalProfitAdmissionError("LOOKUP_FILL_SCOPE_INCOMPLETE");
  }
  const opening = fills.filter((fill) => fill.side === "buy");
  const closing = fills.filter((fill) => fill.side === "sell");
  if (opening.length === 0 || closing.length === 0) {
    throw new BillingCanonicalProfitAdmissionError("CLOSED_TRADE_INCOMPLETE_LIFECYCLE");
  }
}

export function lookupClosedTradeSettlementsFromRealityV2(
  input: LookupClosedTradeSettlementsFromRealityV2Input,
): LookupClosedTradeSettlementsFromRealityV2Result {
  try {
    requireBillingV2NonEmpty(input.organizationId, "CLOSED_TRADE_SCOPE_INCOMPLETE");
    requireBillingV2NonEmpty(input.accountId, "CLOSED_TRADE_SCOPE_INCOMPLETE");
    requireBillingV2NonEmpty(input.strategyId, "CLOSED_TRADE_SCOPE_INCOMPLETE");
    if (input.truthRecords.length === 0) {
      throw new BillingCanonicalProfitAdmissionError("LOOKUP_EMPTY_REALITY");
    }
    const { fills, cashflows } = classifyRecords(input);
    const groups = groupFills(fills);
    const closedOrderIds = new Set<string>();
    const openOrderIds = new Set<string>();
    for (const [venueOrderId, group] of groups) {
      if (isZeroDecimal(remainingQuantity(group))) {
        assertFullyClosedGroup(group);
        closedOrderIds.add(venueOrderId);
      } else {
        openOrderIds.add(venueOrderId);
      }
    }

    for (const cashflow of cashflows) {
      if (openOrderIds.has(cashflow.causeNativeId)) {
        throw new BillingCanonicalProfitAdmissionError("LOOKUP_CASHFLOW_INCOMPLETE_LIFECYCLE");
      }
      if (!closedOrderIds.has(cashflow.causeNativeId)) {
        throw new BillingCanonicalProfitAdmissionError("LOOKUP_UNATTRIBUTED_CASHFLOW");
      }
    }

    const realityFrontierDigestHex = frontierDigest(input.truthRecords);
    const settlements: ClosedTradeSettlementV2[] = [];
    for (const venueOrderId of [...closedOrderIds].sort()) {
      const group = groups.get(venueOrderId)!;
      const opening = group.filter((fill) => fill.side === "buy");
      const closing = group.filter((fill) => fill.side === "sell");
      const relatedCashflows = cashflows.filter((fact) => fact.causeNativeId === venueOrderId);
      if (relatedCashflows.length === 0) {
        throw new BillingCanonicalProfitAdmissionError("CLOSED_TRADE_MISSING_CASHFLOW_FACTS");
      }
      settlements.push(
        buildClosedTradeSettlementV2({
          organizationId: input.organizationId,
          accountId: input.accountId,
          strategyId: input.strategyId,
          symbol: group[0]!.symbol,
          lifecycleId: `closed-trade/${venueOrderId}`,
          lifecycleState: "FULLY_CLOSED",
          remainingQuantity: "0",
          realityFrontierDigestHex,
          openingFillTruthRecordDigests: opening.map((fill) => fill.digestHex),
          closingFillTruthRecordDigests: closing.map((fill) => fill.digestHex),
          partialFillTruthRecordDigests: [],
          cashflowFacts: relatedCashflows.map((fact) => ({
            truthRecordDigestHex: fact.digestHex,
            amount: fact.amount,
            cause: "STRATEGY_REALIZED",
          })),
          costFacts: group
            .filter((fill) => !isZeroDecimal(fill.feeAmount))
            .map((fill) => ({
              truthRecordDigestHex: fill.digestHex,
              amount: fill.feeAmount,
              admitted: true as const,
            })),
          supersedesSettlementDigestHex: null,
        }),
      );
    }
    return Object.freeze({
      settlements: Object.freeze(settlements),
      realityFrontierDigestHex,
    });
  } catch (error) {
    rethrowLookup(error);
  }
}
