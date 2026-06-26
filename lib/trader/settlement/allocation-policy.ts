import type { InvoiceSettlementCandidate } from "@/lib/trader/settlement/settlement.types";
import { settlementExceptionReasons } from "@/lib/trader/settlement/settlement.types";

export type AllocationPolicyResult =
  | { ok: true; invoice: InvoiceSettlementCandidate }
  | { ok: false; reason: string };

export type SettlementAllocationPolicy = (
  candidates: InvoiceSettlementCandidate[],
) => AllocationPolicyResult;

/** Oldest period_start first; MVP declines when more than one ISSUED candidate exists. */
export const fifoAllocationPolicy: SettlementAllocationPolicy = (candidates) => {
  const issued = candidates
    .filter((candidate) => candidate.status === "ISSUED")
    .sort((left, right) => left.periodStart.getTime() - right.periodStart.getTime());

  if (issued.length === 0) {
    return { ok: false, reason: settlementExceptionReasons.noCandidateInvoice };
  }
  if (issued.length > 1) {
    return { ok: false, reason: settlementExceptionReasons.multipleCandidateInvoices };
  }

  return { ok: true, invoice: issued[0]! };
};
