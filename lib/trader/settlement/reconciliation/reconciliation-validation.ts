import { ReconciliationInvoiceNotEligibleError } from "@/lib/trader/settlement/reconciliation/reconciliation.errors";
import type { ReconciliationProjectedImpact } from "@/lib/trader/settlement/reconciliation/reconciliation.event-payloads";
import type { ReconciliationResolutionType } from "@/lib/trader/settlement/reconciliation/reconciliation.types";
import type { InvoiceSettlementRepository } from "@/lib/trader/settlement/account-status-repository.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type ValidateManualApplyInput = {
  targetInvoiceId: string;
  settlementValuedAmount: string | null;
  exchangeAccountId: string;
};

export async function validateManualApplyTarget(
  invoiceRepository: InvoiceSettlementRepository,
  context: OrgContext,
  input: ValidateManualApplyInput,
): Promise<{ performanceFee: string }> {
  const invoice = await invoiceRepository.getInvoiceForSettlementLock(
    context,
    input.targetInvoiceId,
  );
  if (!invoice) {
    throw new ReconciliationInvoiceNotEligibleError(input.targetInvoiceId, "not found");
  }
  if (invoice.organizationId !== context.organizationId) {
    throw new ReconciliationInvoiceNotEligibleError(input.targetInvoiceId, "wrong organization");
  }
  if (invoice.exchangeAccountId !== input.exchangeAccountId) {
    throw new ReconciliationInvoiceNotEligibleError(
      input.targetInvoiceId,
      "wrong exchange account",
    );
  }
  if (invoice.status !== "ISSUED") {
    throw new ReconciliationInvoiceNotEligibleError(
      input.targetInvoiceId,
      `status is ${invoice.status}`,
    );
  }
  if (!input.settlementValuedAmount) {
    throw new ReconciliationInvoiceNotEligibleError(
      input.targetInvoiceId,
      "missing settlement value",
    );
  }
  if (invoice.performanceFee !== input.settlementValuedAmount) {
    throw new ReconciliationInvoiceNotEligibleError(
      input.targetInvoiceId,
      "amount mismatch with settlement valued amount",
    );
  }
  return { performanceFee: invoice.performanceFee };
}

export function buildProjectedImpact(input: {
  resolutionType: ReconciliationResolutionType;
  targetInvoiceId: string | null;
  appliedAmount: string | null;
  accountReactivation: boolean;
}): ReconciliationProjectedImpact {
  return {
    resolutionType: input.resolutionType,
    targetInvoiceId: input.targetInvoiceId,
    appliedAmount: input.appliedAmount,
    invoiceStatusAfter: input.resolutionType === "MANUAL_APPLY" ? "PAID" : null,
    accountReactivation: input.accountReactivation,
  };
}
