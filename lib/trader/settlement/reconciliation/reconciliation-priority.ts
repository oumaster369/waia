import { settlementExceptionReasons } from "@/lib/trader/settlement/settlement.types";

const PRIORITY_P0 = 30;
const PRIORITY_P1 = 20;
const PRIORITY_P2 = 10;

const P0_REASONS = new Set<string>([
  settlementExceptionReasons.amountMismatch,
  settlementExceptionReasons.missingAttribution,
]);

const P1_REASONS = new Set<string>([
  settlementExceptionReasons.noCandidateInvoice,
  settlementExceptionReasons.multipleCandidateInvoices,
  settlementExceptionReasons.invoiceNotIssued,
  settlementExceptionReasons.invoiceNotFound,
]);

/** Higher priority value = more urgent queue ordering (DESC). */
export function computeReconciliationPriority(input: {
  exceptionReason: string | null;
  openedAt: Date;
  now?: Date;
}): number {
  const reason = input.exceptionReason ?? "";
  let base = PRIORITY_P2;
  if (P0_REASONS.has(reason)) {
    base = PRIORITY_P0;
  } else if (P1_REASONS.has(reason)) {
    base = PRIORITY_P1;
  }

  const now = input.now ?? new Date();
  const ageHours = Math.max(0, (now.getTime() - input.openedAt.getTime()) / (1000 * 60 * 60));
  const ageBump = Math.min(5, Math.floor(ageHours / 24));
  return base + ageBump;
}
