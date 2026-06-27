import { IllegalPaymentTransitionError } from "@/lib/waia-core/payments/payment.errors";
import type { PaymentEventType } from "@/lib/waia-core/payments/payment-events.types";
import type { PaymentStatus } from "@/lib/waia-core/payments/payment-projection.types";

export function eventTypeToStatus(eventType: PaymentEventType): PaymentStatus {
  return eventType;
}

export function assertPaymentTransitionAllowed(
  paymentId: string,
  currentStatus: PaymentStatus | null,
  eventType: PaymentEventType,
): void {
  if (eventType === "DETECTED") {
    if (currentStatus !== null) {
      throw new IllegalPaymentTransitionError(paymentId, currentStatus, eventType);
    }
    return;
  }

  if (currentStatus !== "DETECTED") {
    throw new IllegalPaymentTransitionError(paymentId, currentStatus, eventType);
  }
}

export function isTerminalPaymentStatus(status: PaymentStatus): boolean {
  return status === "CONFIRMED" || status === "FAILED";
}
