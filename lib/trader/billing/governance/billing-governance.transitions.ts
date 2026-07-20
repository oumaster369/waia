import { IllegalInvoiceDisputeTransitionError } from "@/lib/trader/billing/governance/billing-governance.errors";
import type {
  InvoiceDisputeEventType,
  InvoiceDisputeStatus,
} from "@/lib/trader/billing/governance/billing-governance.types";
import type { InvoiceStatus } from "@/lib/trader/billing/invoice.types";

const DISPUTABLE_INVOICE_STATUSES: readonly InvoiceStatus[] = ["ISSUED", "PAID"];

export function isInvoiceDisputable(status: InvoiceStatus): boolean {
  return DISPUTABLE_INVOICE_STATUSES.includes(status);
}

export function resolveDisputeStatusAfterEvent(
  eventType: InvoiceDisputeEventType,
): InvoiceDisputeStatus {
  switch (eventType) {
    case "OPENED":
      return "OPEN";
    case "RESOLVED_UPHELD":
      return "RESOLVED_UPHELD";
    case "RESOLVED_CORRECTED":
      return "RESOLVED_CORRECTED";
  }
}

export function assertDisputeTransitionAllowed(
  currentStatus: InvoiceDisputeStatus | null,
  eventType: InvoiceDisputeEventType,
): void {
  if (eventType === "OPENED") {
    if (currentStatus !== null) {
      throw new IllegalInvoiceDisputeTransitionError(currentStatus, eventType);
    }
    return;
  }

  if (currentStatus !== "OPEN") {
    throw new IllegalInvoiceDisputeTransitionError(currentStatus ?? "NONE", eventType);
  }
}

export function isInvoiceEnforcementFrozen(status: InvoiceDisputeStatus | null): boolean {
  return status === "OPEN";
}
