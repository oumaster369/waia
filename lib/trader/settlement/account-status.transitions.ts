import { IllegalAccountStatusTransitionError } from "@/lib/trader/settlement/settlement.errors";
import type {
  AccountStatus,
  AccountStatusEventType,
} from "@/lib/trader/settlement/settlement.types";

export function resolveStatusAfterReactivation(): AccountStatus {
  return "ACTIVE";
}

export function resolveStatusAfterSuspension(): AccountStatus {
  return "SUSPENDED";
}

export function shouldAppendReactivationEvent(currentStatus: AccountStatus | null): boolean {
  return currentStatus === "SUSPENDED";
}

export function shouldAppendSuspensionEvent(currentStatus: AccountStatus | null): boolean {
  return currentStatus !== "SUSPENDED";
}

export function isInvoiceOverdue(issuedAt: Date, asOf: Date, gracePeriodMs: number): boolean {
  return issuedAt.getTime() + gracePeriodMs < asOf.getTime();
}

export function assertReactivationAllowed(
  currentStatus: AccountStatus | null,
  eventType: AccountStatusEventType,
): void {
  if (eventType !== "REACTIVATED") {
    throw new IllegalAccountStatusTransitionError(currentStatus ?? "NONE", eventType);
  }
  if (currentStatus !== null && currentStatus !== "SUSPENDED" && currentStatus !== "ACTIVE") {
    throw new IllegalAccountStatusTransitionError(currentStatus, eventType);
  }
}

export function assertSuspensionAllowed(
  currentStatus: AccountStatus | null,
  eventType: AccountStatusEventType,
): void {
  if (eventType !== "SUSPENDED") {
    throw new IllegalAccountStatusTransitionError(currentStatus ?? "NONE", eventType);
  }
  if (currentStatus === "SUSPENDED") {
    throw new IllegalAccountStatusTransitionError(currentStatus, eventType);
  }
}
