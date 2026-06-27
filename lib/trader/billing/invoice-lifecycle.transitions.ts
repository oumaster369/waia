import type { InvoiceStatus } from "@/lib/trader/billing/invoice.types";

export const INVOICE_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  DRAFT: ["ISSUED"],
  ISSUED: ["PAID"],
  PAID: [],
};

export function assertAllowedInvoiceTransition(from: InvoiceStatus, to: InvoiceStatus): void {
  const allowed = INVOICE_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid invoice transition: ${from} -> ${to}`);
  }
}

export function isTerminalInvoiceStatus(status: InvoiceStatus): boolean {
  return INVOICE_TRANSITIONS[status].length === 0;
}
