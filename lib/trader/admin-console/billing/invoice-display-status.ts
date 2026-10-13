export type InvoiceDisplayInput = {
  state: "DRAFT" | "ISSUED" | "PAID";
  approved: boolean;
  coolingOffUntil: string | null;
  paymentDetected: boolean;
  paymentApplied: boolean;
  now: string;
  dueAt: string | null;
  paidAt: string | null;
  reconciliation: boolean;
  disputeOpen: boolean;
  corrected: boolean;
};

export type InvoiceDisplay = {
  status: string;
  payment: string | null;
  flags: string[];
  dueNote: string;
};

export const DUE_NOTE = "under current policy; a fixed deadline requires DEE-ADR-A";

export function invoiceDueAt(issuedAt: string | null, graceMs: number): string | null {
  if (!issuedAt) return null;
  const issuedMs = Date.parse(issuedAt);
  if (!Number.isFinite(issuedMs)) return null;
  return new Date(issuedMs + graceMs).toISOString();
}

export function invoiceDisplayStatus(input: InvoiceDisplayInput): InvoiceDisplay {
  const flags = [
    input.reconciliation ? "Under reconciliation" : null,
    input.disputeOpen ? "Disputed" : null,
    input.corrected ? "Corrected / applied / refunded" : null,
  ].filter((flag): flag is string => flag !== null);
  const dueNote = DUE_NOTE;
  if (input.state === "PAID" && input.paymentApplied && input.paidAt) {
    return { status: "Paid", payment: null, flags, dueNote };
  }
  if (input.state === "DRAFT") {
    if (input.approved || input.coolingOffUntil) {
      return {
        status: "Awaiting review",
        payment: input.coolingOffUntil ? `Cooling-off until ${input.coolingOffUntil}` : null,
        flags,
        dueNote,
      };
    }
    return { status: "Draft", payment: null, flags, dueNote };
  }
  const overdue = input.dueAt !== null && Date.parse(input.now) > Date.parse(input.dueAt);
  return {
    status: overdue ? "Overdue" : "Issued, unpaid",
    payment:
      input.paymentDetected && !input.paymentApplied
        ? "Payment detected, awaiting confirmations"
        : null,
    flags,
    dueNote,
  };
}
