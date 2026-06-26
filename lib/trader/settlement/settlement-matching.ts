import type { SettlementAllocationPolicy } from "@/lib/trader/settlement/allocation-policy";
import { fifoAllocationPolicy } from "@/lib/trader/settlement/allocation-policy";
import type { SettlementValuationPolicy } from "@/lib/trader/settlement/valuation-policy";
import { parityUsdtUsdValuation } from "@/lib/trader/settlement/valuation-policy";
import {
  DEFAULT_SETTLEMENT_AMOUNT_TOLERANCE,
  settlementExceptionReasons,
  type ConfirmedPaymentForSettlement,
  type InvoiceSettlementCandidate,
  type SettlementEvaluation,
} from "@/lib/trader/settlement/settlement.types";
import { absDecimal, compareDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";

export type EvaluateSettlementInput = {
  payment: ConfirmedPaymentForSettlement;
  candidates: InvoiceSettlementCandidate[];
  amountTolerance?: string;
  allocationPolicy?: SettlementAllocationPolicy;
  valuationPolicy?: SettlementValuationPolicy;
};

export function amountsMatchWithinTolerance(
  valuedAmount: string,
  invoiceFee: string,
  tolerance: string = DEFAULT_SETTLEMENT_AMOUNT_TOLERANCE,
): boolean {
  const diff = absDecimal(subtractDecimal(valuedAmount, invoiceFee));
  return compareDecimal(diff, tolerance) <= 0;
}

export function evaluateSettlement(input: EvaluateSettlementInput): SettlementEvaluation {
  const allocationPolicy = input.allocationPolicy ?? fifoAllocationPolicy;
  const valuationPolicy = input.valuationPolicy ?? parityUsdtUsdValuation;
  const amountTolerance = input.amountTolerance ?? DEFAULT_SETTLEMENT_AMOUNT_TOLERANCE;

  const exchangeAccountId = input.payment.exchangeAccountId?.trim();
  if (!exchangeAccountId || !input.payment.paymentAddressId) {
    return {
      outcome: "EXCEPTION",
      exceptionReason: settlementExceptionReasons.missingAttribution,
      exchangeAccountId: exchangeAccountId ?? "unknown",
      invoiceId: null,
      appliedAmount: null,
      valuedAmount: null,
      valuationCurrency: null,
      valuationBasis: null,
    };
  }

  const valuation = valuationPolicy({
    settlementNetwork: input.payment.settlementNetwork,
    settlementAsset: input.payment.settlementAsset,
    onChainAmount: input.payment.settlementAmount,
  });

  if (!valuation.ok) {
    return {
      outcome: "EXCEPTION",
      exceptionReason: valuation.reason,
      exchangeAccountId,
      invoiceId: null,
      appliedAmount: null,
      valuedAmount: null,
      valuationCurrency: null,
      valuationBasis: null,
    };
  }

  const allocation = allocationPolicy(input.candidates);
  if (!allocation.ok) {
    return {
      outcome: "EXCEPTION",
      exceptionReason: allocation.reason,
      exchangeAccountId,
      invoiceId: null,
      appliedAmount: null,
      valuedAmount: valuation.valuedAmount,
      valuationCurrency: valuation.valuationCurrency,
      valuationBasis: valuation.valuationBasis,
    };
  }

  const invoice = allocation.invoice;
  if (invoice.status !== "ISSUED") {
    return {
      outcome: "EXCEPTION",
      exceptionReason: settlementExceptionReasons.invoiceNotIssued,
      exchangeAccountId,
      invoiceId: invoice.id,
      appliedAmount: null,
      valuedAmount: valuation.valuedAmount,
      valuationCurrency: valuation.valuationCurrency,
      valuationBasis: valuation.valuationBasis,
    };
  }

  if (
    !amountsMatchWithinTolerance(valuation.valuedAmount, invoice.performanceFee, amountTolerance)
  ) {
    return {
      outcome: "EXCEPTION",
      exceptionReason: settlementExceptionReasons.amountMismatch,
      exchangeAccountId,
      invoiceId: invoice.id,
      appliedAmount: null,
      valuedAmount: valuation.valuedAmount,
      valuationCurrency: valuation.valuationCurrency,
      valuationBasis: valuation.valuationBasis,
    };
  }

  return {
    outcome: "APPLIED",
    exceptionReason: null,
    exchangeAccountId,
    invoiceId: invoice.id,
    appliedAmount: valuation.valuedAmount,
    valuedAmount: valuation.valuedAmount,
    valuationCurrency: valuation.valuationCurrency,
    valuationBasis: valuation.valuationBasis,
  };
}
