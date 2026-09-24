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

export const DUE_NOTE = "по текущей политике; закреплённый срок требует DEE-ADR-A";

export function invoiceDueAt(issuedAt: string | null, graceMs: number): string | null {
  if (!issuedAt) return null;
  const issuedMs = Date.parse(issuedAt);
  if (!Number.isFinite(issuedMs)) return null;
  return new Date(issuedMs + graceMs).toISOString();
}

export function invoiceDisplayStatus(input: InvoiceDisplayInput): InvoiceDisplay {
  const flags = [
    input.reconciliation ? "На сверке" : null,
    input.disputeOpen ? "Оспорен" : null,
    input.corrected ? "Исправлен / зачёт / возврат" : null,
  ].filter((flag): flag is string => flag !== null);
  const dueNote = DUE_NOTE;
  if (input.state === "PAID" && input.paymentApplied && input.paidAt) {
    return { status: "Оплачен", payment: null, flags, dueNote };
  }
  if (input.state === "DRAFT") {
    if (input.approved || input.coolingOffUntil) {
      return {
        status: "Ожидает проверки",
        payment: input.coolingOffUntil ? `Период ожидания до ${input.coolingOffUntil}` : null,
        flags,
        dueNote,
      };
    }
    return { status: "Черновик", payment: null, flags, dueNote };
  }
  const overdue = input.dueAt !== null && Date.parse(input.now) > Date.parse(input.dueAt);
  return {
    status: overdue ? "Просрочен" : "Выставлен, не оплачен",
    payment:
      input.paymentDetected && !input.paymentApplied
        ? "Платёж обнаружен, ждёт подтверждений"
        : null,
    flags,
    dueNote,
  };
}
