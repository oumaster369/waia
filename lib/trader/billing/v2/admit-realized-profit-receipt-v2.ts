import { assertBillingV2ForbiddenKeys } from "@/lib/trader/billing/v2/billing-v2-guards";
import {
  buildRealizedStrategyProfitReceiptV2,
  assertRealizedStrategyProfitReceiptV2,
  type RealizedStrategyProfitReceiptV2,
} from "@/lib/trader/billing/v2/realized-strategy-profit-receipt-v2";
import type { ClosedTradeSettlementV2 } from "@/lib/trader/billing/v2/closed-trade-settlement-v2";

export const NAKED_REALIZED_PNL_REFUSED = "NAKED_REALIZED_PNL_REFUSED" as const;

export const BILLING_ORCHESTRATOR_FORBIDDEN_PROFIT_KEYS = [
  "realizedPnl",
  "equity",
  "equityHwm",
  "feeRate",
] as const;

export class BillingCanonicalProfitAdmissionError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = code;
    this.code = code;
  }
}

export function billingPeriodReportingScopeIdV2(input: {
  organizationId: string;
  accountId: string;
  periodStart: Date;
  periodEnd: Date;
}): string {
  return `billing-period/v2:${input.organizationId}:${input.accountId}:${input.periodStart.toISOString()}/${input.periodEnd.toISOString()}`;
}

export type AdmitCanonicalPeriodProfitInputV2 = Readonly<{
  organizationId: string;
  accountId: string;
  receipt: RealizedStrategyProfitReceiptV2;
  settlements: readonly ClosedTradeSettlementV2[];
  expectedReportingScopeId: string;
}>;

function rethrowAdmission(error: unknown): never {
  if (error instanceof BillingCanonicalProfitAdmissionError) {
    throw error;
  }
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) {
    throw new BillingCanonicalProfitAdmissionError(error.message);
  }
  throw error;
}

export function admitCanonicalPeriodProfitFromReceiptV2(
  input: AdmitCanonicalPeriodProfitInputV2,
): string {
  try {
    assertBillingV2ForbiddenKeys(
      input,
      BILLING_ORCHESTRATOR_FORBIDDEN_PROFIT_KEYS,
      NAKED_REALIZED_PNL_REFUSED,
    );
    assertRealizedStrategyProfitReceiptV2(input.receipt);
    const rebuilt = buildRealizedStrategyProfitReceiptV2({
      organizationId: input.receipt.organizationId,
      accountId: input.receipt.accountId,
      strategyId: input.receipt.strategyId,
      reportingScopeId: input.receipt.reportingScopeId,
      realityFrontierDigestHex: input.receipt.realityFrontierDigestHex,
      settlements: input.settlements,
      nonProfitCashflowFacts: input.receipt.nonProfitCashflowFacts,
    });
    if (rebuilt.contentDigestHex !== input.receipt.contentDigestHex) {
      throw new BillingCanonicalProfitAdmissionError("BILLING_RECEIPT_SETTLEMENT_MISMATCH");
    }
    if (input.receipt.organizationId !== input.organizationId) {
      throw new BillingCanonicalProfitAdmissionError("RECEIPT_ORGANIZATION_MISMATCH");
    }
    if (input.receipt.accountId !== input.accountId) {
      throw new BillingCanonicalProfitAdmissionError("RECEIPT_ACCOUNT_MISMATCH");
    }
    if (input.receipt.reportingScopeId !== input.expectedReportingScopeId) {
      throw new BillingCanonicalProfitAdmissionError("RECEIPT_REPORTING_SCOPE_MISMATCH");
    }
    return input.receipt.netRealizedStrategyProfit;
  } catch (error) {
    rethrowAdmission(error);
  }
}

export function refuseNakedRealizedPnl(): never {
  throw new BillingCanonicalProfitAdmissionError(NAKED_REALIZED_PNL_REFUSED);
}
